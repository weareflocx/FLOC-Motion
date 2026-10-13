import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTemplateStore, VERSION_COALESCE_MS, VERSION_LIMIT } from '../server/template-store.mjs';
import { createAuthStore } from '../server/auth-store.mjs';
import { demoProject, validateProject } from '../src/project.js';

test('saved templates persist complete independent snapshots, metadata and media through restart', async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'floc-templates-'));
  try {
    const store = createTemplateStore(data), project = demoProject();
    const entry = await store.create({ name: ' Studio loop ', tags: ['Brand', 'Brand'], project });
    project.name = 'Changed canvas';
    assert.deepEqual(entry.tags, ['Brand']);
    const restarted = createTemplateStore(data);
    const [saved] = await restarted.list();
    assert.equal(saved.name, 'Studio loop'); assert.notEqual(saved.project.name, project.name);
    assert.deepEqual(saved.project.layers, validateProject(demoProject()).layers);
    const renamed = await restarted.update(saved.id, { name: 'New name', tags: ['Campaign'] });
    assert.deepEqual(renamed.project, saved.project); assert.equal(renamed.createdAt, saved.createdAt);
    await restarted.remove(saved.id); assert.deepEqual(await restarted.list(), []);
  } finally { await rm(data, { recursive: true, force: true }); }
});
test('template writes validate names, tags, projects and IDs and serialize concurrent updates', async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'floc-templates-'));
  try {
    const store = createTemplateStore(data), input = { name: 'Loop', tags: [], project: demoProject() };
    await assert.rejects(store.create({ ...input, project: { ...input.project, format: 'invalid' } }));
    await assert.rejects(store.create({ ...input, name: ' ' }));
    await assert.rejects(store.create({ ...input, tags: [7] }));
    await assert.rejects(store.remove('../project'));
    const entry = await store.create(input);
    await Promise.all(['One', 'Two'].map(name => store.update(entry.id, { name, tags: [] })));
    assert.equal((await store.list())[0].name, 'Two');
    await assert.rejects(store.update(entry.id, { name: 'Bad', tags: Array(11).fill('tag') }));
    assert.equal((await store.list())[0].name, 'Two');
  } finally { await rm(data, { recursive: true, force: true }); }
});

test('composition updates persist edits and reject stale copies without changing saved content', async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'floc-composition-'));
  try {
    const store = createTemplateStore(data);
    const entry = await store.create({ name: 'Original', tags: ['Brand'], project: demoProject() });
    await new Promise(resolve => setTimeout(resolve, 5));
    const project = { ...entry.project, name: 'Edited', duration: 15 };
    const updated = await store.update(entry.id, { name: project.name, project, updatedAt: entry.updatedAt });
    assert.equal(updated.project.duration, 15);
    assert.deepEqual(updated.tags, ['Brand']);
    await assert.rejects(store.update(entry.id, { project: entry.project, updatedAt: entry.updatedAt }), error => error.status === 409);
    assert.equal((await createTemplateStore(data).list())[0].project.duration, 15);
  } finally { await rm(data, { recursive: true, force: true }); }
});

test('saves record attributed versions; restore adds a new current version and respects revisions', async t => {
  const data = await mkdtemp(path.join(tmpdir(), 'floc-versions-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  const auth = createAuthStore(data), invitation = await auth.bootstrap('author@example.com');
  const { user } = await auth.accept({ ...invitation, password: 'A long test password' }, 'test');
  const store = createTemplateStore(data), author = { userId: user.id };
  const created = await store.create({ name: 'Loop', tags: [], project: demoProject() }, author);
  const edited = await store.update(created.id, { name: 'Loop', project: { ...created.project, duration: 15 }, updatedAt: created.updatedAt }, author);
  const tagged = await store.update(created.id, { name: 'Loop', tags: ['Brand'], updatedAt: edited.updatedAt }, author);
  const unchanged = await store.update(created.id, { name: 'Loop', project: tagged.project, updatedAt: tagged.updatedAt }, author);
  const versions = await store.versions(created.id);
  assert.deepEqual(versions.map(item => [item.version, item.name, item.author?.email]), [[2, 'Loop', 'author@example.com'], [1, 'Loop', 'author@example.com']], 'tag-only and identical saves add no version');
  assert.equal((await store.version(created.id, 1)).project.duration, created.project.duration);
  await assert.rejects(store.restore(created.id, 1, { updatedAt: created.updatedAt }, author), error => error.status === 409);
  await assert.rejects(store.restore(created.id, 1, {}, author), error => error.status === 400);
  await assert.rejects(store.restore(created.id, 9, { updatedAt: unchanged.updatedAt }, author), error => error.status === 404);
  const restored = await store.restore(created.id, 1, { updatedAt: unchanged.updatedAt }, author);
  assert.equal(restored.project.duration, created.project.duration); assert.deepEqual(restored.tags, ['Brand']);
  assert.deepEqual((await store.read(created.id)).project, restored.project);
  const [latest] = await store.versions(created.id);
  assert.deepEqual([latest.version, latest.restoredFrom], [3, 1]);
  assert.equal((await store.version(created.id, 2)).project.duration, 15, 'restoring keeps the replaced version');
  await store.remove(created.id);
  await assert.rejects(store.versions(created.id), error => error.status === 404);
});

test(`only the newest ${VERSION_LIMIT} versions of a composition are retained`, async t => {
  const data = await mkdtemp(path.join(tmpdir(), 'floc-versions-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  let clock = Date.now();
  const store = createTemplateStore(data, { now: () => clock });
  let entry = await store.create({ name: 'Loop', tags: [], project: demoProject() });
  for (let index = 1; index <= VERSION_LIMIT + 4; index++) { clock += VERSION_COALESCE_MS; entry = await store.update(entry.id, { name: `Loop ${index}`, updatedAt: entry.updatedAt }); }
  const versions = await store.versions(entry.id);
  assert.equal(versions.length, VERSION_LIMIT);
  assert.deepEqual([versions[0].version, versions.at(-1).version, versions[0].name], [VERSION_LIMIT + 5, 6, `Loop ${VERSION_LIMIT + 4}`]);
  await assert.rejects(store.version(entry.id, 5), error => error.status === 404);
});
