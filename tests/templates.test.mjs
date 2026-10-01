import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTemplateStore } from '../server/template-store.mjs';
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
