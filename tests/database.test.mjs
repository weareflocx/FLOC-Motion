import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { closeDatabase, database } from '../server/database.mjs';
import { createAuthStore, sessionCookie } from '../server/auth-store.mjs';
import { createDraftStore } from '../server/draft-store.mjs';
import { createTemplateStore } from '../server/template-store.mjs';
import { createPersonalRenderers, rendererCookie } from '../server/personal-renderers.mjs';
import { demoProject, validateProject } from '../src/project.js';

const folder = async t => { const value = await mkdtemp(path.join(os.tmpdir(), 'floc-db-')); t.after(() => { closeDatabase(value); return rm(value, { recursive: true, force: true }); }); return value; };
const put = async (root, relative, value) => { await mkdir(path.dirname(path.join(root, relative)), { recursive: true }); await writeFile(path.join(root, relative), typeof value === 'string' ? value : JSON.stringify(value)); };
const sha = value => createHash('sha256').update(value).digest('hex');
const ids = { user: '11111111-1111-4111-8111-111111111111', draft: '22222222-2222-4222-8222-222222222222', template: '33333333-3333-4333-8333-333333333333', device: '44444444-4444-4444-8444-444444444444' };

async function legacyWorkspace(t) {
  const data = await folder(t), token = 'a'.repeat(64), browserSecret = 'b'.repeat(64), project = demoProject();
  project.name = 'Imported';
  await put(data, 'access/auth.json', { users: [{ id: ids.user, email: 'owner@example.com', salt: 'salt', passwordHash: 'ab'.repeat(64) }], invitations: [{ email: 'next@example.com', hash: sha('c'.repeat(64)), expiresAt: Date.now() + 60000 }], sessions: [{ hash: sha(token), userId: ids.user, expiresAt: Date.now() + 60000 }] });
  await put(data, `drafts/${ids.draft}.json`, { project, revision: 7 });
  await put(data, `templates/${ids.template}.json`, { id: ids.template, name: ' Library ', tags: ['Brand'], project, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' });
  await put(data, `renderers/${ids.device}.json`, { id: ids.device, name: 'Mac', browserHash: sha(browserSecret), engineHash: sha('d'.repeat(64)) });
  await put(data, 'project-migration.json', { compositionId: ids.template });
  return { data, token, browserSecret, project };
}

test('legacy JSON workspaces import once into SQLite and keep the JSON files untouched', async t => {
  const { data, token, browserSecret, project } = await legacyWorkspace(t);
  const before = await readFile(path.join(data, `templates/${ids.template}.json`), 'utf8');
  const auth = createAuthStore(data), templates = createTemplateStore(data);
  await templates.preserveLegacyProject();
  assert.deepEqual(await auth.user(sessionCookie(token, false)), { id: ids.user, email: 'owner@example.com', role: 'admin' });
  assert.deepEqual(await createDraftStore(data).read(ids.draft), { project: validateProject(project), revision: 7 });
  const [entry] = await templates.list();
  assert.deepEqual(entry, { id: ids.template, name: 'Library', tags: ['Brand'], project: validateProject(project), createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' });
  assert.deepEqual((await templates.versions(ids.template)).map(item => [item.version, item.author, item.createdAt]), [[1, null, entry.updatedAt]]);
  const renderers = createPersonalRenderers({ data, jobs: new Map(), version: 'v1' });
  assert.equal((await renderers.browser(rendererCookie(`${ids.device}.${browserSecret}`, false)))?.name, 'Mac');
  await assert.rejects(auth.bootstrap('new@example.com'), error => error.status === 409);
  if (process.platform !== 'win32') assert.equal((await stat(path.join(data, 'floc.db'))).mode & 0o777, 0o600);
  // A restart, or a second process opening the same workspace, never imports twice.
  closeDatabase(data);
  const db = database(data);
  assert.deepEqual(['users', 'sessions', 'drafts', 'templates', 'composition_versions', 'renderer_devices'].map(table => db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count), [1, 1, 1, 1, 1, 1]);
  assert.equal(await readFile(path.join(data, `templates/${ids.template}.json`), 'utf8'), before);
  // The imported state stays recoverable: the first save adds a version instead of coalescing into it.
  const reopened = createTemplateStore(data), saved = (await reopened.list())[0];
  await reopened.update(ids.template, { name: 'Library', project: { ...saved.project, duration: 15 }, updatedAt: saved.updatedAt }, { userId: ids.user });
  assert.deepEqual((await reopened.versions(ids.template)).map(item => [item.version, item.author?.email ?? null]), [[2, 'owner@example.com'], [1, null]]);
  assert.equal((await reopened.version(ids.template, 1)).project.duration, validateProject(project).duration);
});

test('corrupt legacy JSON stops the import without marking it complete', async t => {
  const { data } = await legacyWorkspace(t);
  await put(data, `drafts/${ids.draft}.json`, '{');
  assert.throws(() => database(data), error => error.code === 'EINVALIDJSON');
  await put(data, `drafts/${ids.draft}.json`, { project: demoProject(), revision: 3 });
  assert.equal((await createDraftStore(data).read(ids.draft)).revision, 3);
  assert.equal((await createTemplateStore(data).list()).length, 1);
});

test('an unreadable database is reported instead of being replaced', async t => {
  const data = await folder(t);
  await writeFile(path.join(data, 'floc.db'), 'not a database');
  assert.throws(() => database(data), /not a database/);
  assert.equal(await readFile(path.join(data, 'floc.db'), 'utf8'), 'not a database');
});

const cardProject = (...sources) => {
  const project = demoProject();
  project.layers.find(layer => layer.type === 'carousel').images = sources.map((src, index) => ({ id: `card-${index}`, name: `Card ${index + 1}`, src }));
  return validateProject(project);
};
const media = name => `/assets/55555555-5555-4555-8555-55555555555${name}.mp4`;
const references = (db, owner) => db.prepare('SELECT asset FROM asset_references WHERE owner = ? ORDER BY asset').all(owner).map(row => `/assets/${row.asset}`);

test('reusing carousel media saves a draft and keeps the resource referenced until its last card is replaced', async t => {
  const data = await folder(t), drafts = createDraftStore(data), a = media(1), b = media(2);
  await drafts.update(ids.draft, { revision: 0, project: cardProject(a, b) });
  const repeated = cardProject(a, a);
  await drafts.update(ids.draft, { revision: 1, project: repeated });
  assert.deepEqual(await drafts.read(ids.draft), { revision: 2, project: repeated });
  assert.deepEqual(references(database(data), `draft:${ids.draft}`), [a]);
  await drafts.update(ids.draft, { revision: 2, project: cardProject(b, a) });
  assert.deepEqual(references(database(data), `draft:${ids.draft}`), [a, b]);
  await drafts.update(ids.draft, { revision: 3, project: cardProject(b, b) });
  assert.deepEqual(references(database(data), `draft:${ids.draft}`), [b]);
});

test('saved compositions retain their original version when cards reuse the same media', async t => {
  const data = await folder(t), templates = createTemplateStore(data), a = media(1), b = media(2);
  const original = cardProject(a, b), repeated = cardProject(a, a);
  const created = await templates.create({ name: 'Reusable media', tags: [], project: original });
  const saved = await templates.update(created.id, { name: created.name, project: repeated, updatedAt: created.updatedAt });
  assert.deepEqual((await templates.read(created.id)).project, repeated);
  assert.deepEqual((await templates.version(created.id, 1)).project, original);
  assert.deepEqual((await templates.version(created.id, 2)).project, repeated);
  assert.deepEqual(references(database(data), `template:${created.id}`), [a]);
  assert.deepEqual(references(database(data), `version:${created.id}:1`), [a, b]);
  assert.deepEqual(references(database(data), `version:${created.id}:2`), [a]);
  const final = cardProject(b, b);
  await templates.update(created.id, { name: created.name, project: final, updatedAt: saved.updatedAt });
  assert.deepEqual((await templates.version(created.id, 1)).project, original);
  assert.deepEqual((await templates.version(created.id, 2)).project, final);
  assert.deepEqual(references(database(data), `version:${created.id}:2`), [b]);
});

test('upgrading the schema-six reference index preserves drafts and allows repeated carousel media', async t => {
  const data = await folder(t), original = cardProject(media(1), media(2));
  await createDraftStore(data).update(ids.draft, { revision: 0, project: original });
  const db = database(data);
  // Recreate the pre-fix triggers and migration history of a schema-six workspace.
  for (const trigger of db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%_assets_%'").all()) {
    db.exec(`DROP TRIGGER ${trigger.name}; ${trigger.sql.replaceAll('SELECT DISTINCT ', 'SELECT ')};`);
  }
  db.exec('DELETE FROM schema_migrations WHERE version > 6');
  closeDatabase(data);
  const reopened = createDraftStore(data);
  assert.deepEqual(await reopened.read(ids.draft), { revision: 1, project: original });
  const repeated = cardProject(media(1), media(1));
  await reopened.update(ids.draft, { revision: 1, project: repeated });
  assert.deepEqual(await reopened.read(ids.draft), { revision: 2, project: repeated });
  assert.deepEqual(references(database(data), `draft:${ids.draft}`), [media(1)]);
});
