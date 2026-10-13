import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { demoProject } from '../src/project.js';
import { restoreCompositionVersion } from '../src/editor/version-history.js';
import { createTemplateStore, VERSION_COALESCE_MS } from '../server/template-store.mjs';
import { database } from '../server/database.mjs';

test('rapid saves by one author coalesce; another author, a pause or a restore starts a new version', async t => {
  const data = await mkdtemp(path.join(tmpdir(), 'floc-coalesce-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  const [a, b] = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
  for (const id of [a, b]) database(data).prepare('INSERT INTO users (id, email, salt, password_hash) VALUES (?, ?, ?, ?)').run(id, `${id[0]}@example.com`, 'salt', 'hash');
  let clock = Date.parse('2026-10-12T10:00:00.000Z');
  const store = createTemplateStore(data, { now: () => clock });
  let entry = await store.create({ name: 'Loop', tags: [], project: demoProject() }, { userId: a });
  const save = async (userId, duration, minutes = 1) => { clock += minutes * 60000; entry = await store.update(entry.id, { name: 'Loop', project: { ...entry.project, duration }, updatedAt: entry.updatedAt }, { userId }); };
  const list = async () => (await store.versions(entry.id)).map(item => [item.version, item.author?.email, item.restoredFrom]);
  await save(a, 21); await save(a, 22); await save(a, 23);
  assert.deepEqual(await list(), [[2, 'a@example.com', null], [1, 'a@example.com', null]], 'the creation entry is never overwritten; later saves refine version 2');
  const refined = await store.version(entry.id, 2);
  assert.equal(refined.project.duration, 23); assert.equal(refined.createdAt, new Date(clock).toISOString());
  await save(b, 24);
  assert.deepEqual((await list())[0], [3, 'b@example.com', null]);
  await save(b, 25, VERSION_COALESCE_MS / 60000);
  assert.deepEqual((await list()).map(([version]) => version), [4, 3, 2, 1], 'a pause of the full window starts a new version');
  for (const number of [1, 1]) entry = await store.restore(entry.id, number, { updatedAt: entry.updatedAt }, { userId: b });
  await save(b, 26, 0);
  assert.deepEqual((await list()).slice(0, 3), [[7, 'b@example.com', null], [6, 'b@example.com', 1], [5, 'b@example.com', 1]], 'restores never coalesce and are never coalesced into');
  assert.equal((await store.version(entry.id, 3)).project.duration, 24);
});

test('continuous editing still records a version per window, anchored to when each version started', async t => {
  const data = await mkdtemp(path.join(tmpdir(), 'floc-coalesce-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  const author = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', start = Date.parse('2026-10-12T10:00:00.000Z');
  database(data).prepare('INSERT INTO users (id, email, salt, password_hash) VALUES (?, ?, ?, ?)').run(author, 'a@example.com', 'salt', 'hash');
  let clock = start;
  const store = createTemplateStore(data, { now: () => clock });
  let entry = await store.create({ name: 'Loop', tags: [], project: demoProject() }, { userId: author });
  // A save every 3 minutes for 25 minutes (minutes 3–24) after creating the composition at minute 0.
  for (let minute = 3; minute <= 25; minute += 3) {
    clock = start + minute * 60000;
    entry = await store.update(entry.id, { name: 'Loop', project: { ...entry.project, duration: 15 + minute / 3 }, updatedAt: entry.updatedAt }, { userId: author });
  }
  const versions = await store.versions(entry.id), minuteOf = item => (Date.parse(item.createdAt) - start) / 60000;
  assert.deepEqual(versions.map(item => [item.version, minuteOf(item)]), [[3, 24], [2, 12], [1, 0]], 'saves from minute 3 fill version 2 until minute 12; minute 15 starts version 3; displayed times are the latest saves');
  assert.deepEqual(await Promise.all([2, 3].map(async number => (await store.version(entry.id, number)).project.duration)), [19, 23]);
});

test('restoring a version saves pending work first, uses the saved revision and applies one undoable replacement', async t => {
  const calls = [], restored = { ...demoProject(), duration: 4 };
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; });
  globalThis.fetch = async (url, options) => { calls.push(['fetch', url, JSON.parse(options.body)]); return new Response(JSON.stringify({ id: 'c1', name: 'Older name', project: restored, updatedAt: 'after-restore' })); };
  const entry = await restoreCompositionVersion(3, {
    save: async () => { calls.push(['save']); return { composition: { id: 'c1', updatedAt: 'after-save' } }; },
    change: (next, options) => { calls.push(['change', next.name, next.duration, options]); return next; },
    updateCompositionMetadata: value => calls.push(['metadata', value.updatedAt])
  });
  assert.equal(entry.updatedAt, 'after-restore');
  assert.deepEqual(calls, [['save'], ['fetch', '/api/templates/c1/versions/3/restore', { updatedAt: 'after-save' }], ['change', 'Older name', 4, { replace: true }], ['metadata', 'after-restore']]);
  await assert.rejects(restoreCompositionVersion(1, { save: async () => ({ composition: null }), change() {}, updateCompositionMetadata() {} }), /saved composition/);
});
