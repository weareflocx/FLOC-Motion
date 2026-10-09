import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readJson, removeStaleJsonTemps, writeJsonAtomic } from '../server/json-store.mjs';
import { createAuthStore } from '../server/auth-store.mjs';
import { createDraftStore } from '../server/draft-store.mjs';
import { createTemplateStore } from '../server/template-store.mjs';
import { demoProject } from '../src/project.js';

const folder = async t => { const value = await mkdtemp(path.join(os.tmpdir(), 'floc-json-')); t.after(() => rm(value, { recursive: true, force: true })); return value; };

test('atomic JSON writes replace complete values and leave no temporary files', async t => {
  const directory = await folder(t), filename = path.join(directory, 'state.json');
  await writeJsonAtomic(filename, { revision: 1 });
  await writeJsonAtomic(filename, { revision: 2, payload: 'complete' });
  assert.deepEqual(await readJson(filename), { revision: 2, payload: 'complete' });
  assert.deepEqual(await readdir(directory), ['state.json']);
});

test('missing JSON uses an explicit default while corrupt JSON is observable', async t => {
  const directory = await folder(t), filename = path.join(directory, 'state.json');
  assert.deepEqual(await readJson(filename, { missing: { empty: true } }), { empty: true });
  await writeFile(filename, '{"partial":');
  await assert.rejects(readJson(filename, { missing: {} }), error => error.code === 'EINVALIDJSON' && error.status === 500 && /state\.json/.test(error.message));
});

test('failed atomic writes preserve the last valid state', { skip: process.platform === 'win32' }, async t => {
  const directory = await folder(t), filename = path.join(directory, 'state.json');
  await writeJsonAtomic(filename, { revision: 1 });
  await chmod(directory, 0o500);
  try { await assert.rejects(writeJsonAtomic(filename, { revision: 2 })); }
  finally { await chmod(directory, 0o700); }
  assert.deepEqual(await readJson(filename), { revision: 1 });
});

test('stale JSON temporaries are removed recursively without touching current or recent files', async t => {
  const directory = await folder(t), nested = path.join(directory, 'job'); await mkdir(nested);
  const old = path.join(nested, 'job.json.tmp-old'), recent = path.join(nested, 'job.json.tmp-recent'), current = path.join(nested, 'job.json');
  await Promise.all([writeFile(old, 'old'), writeFile(recent, 'recent'), writeFile(current, '{}')]);
  await utimes(old, new Date(0), new Date(0));
  assert.equal(await removeStaleJsonTemps(directory, { ageMs: 1000, now: 2000, recursive: true }), 1);
  assert.deepEqual((await readdir(nested)).sort(), ['job.json', 'job.json.tmp-recent']);
});

test('auth, drafts and templates reject corrupt persisted state instead of resetting it', async t => {
  const data = await folder(t), id = '12345678-1234-4234-8234-123456789012';
  await writeFile(path.join(data, 'project.json'), JSON.stringify({ project: demoProject(), revision: 0 }));
  const auth = createAuthStore(data); const invite = await auth.bootstrap('owner@example.com');
  await writeFile(path.join(data, 'access/auth.json'), '{');
  await assert.rejects(auth.user('floc_session=' + invite.token), error => error.code === 'EINVALIDJSON');
  await rm(path.join(data, 'access'), { recursive: true, force: true });
  await writeJsonAtomic(path.join(data, 'drafts', `${id}.json`), { project: demoProject(), revision: 1 });
  await writeFile(path.join(data, 'drafts', `${id}.json`), '{');
  await assert.rejects(createDraftStore(data).read(id), error => error.code === 'EINVALIDJSON');
  const templates = createTemplateStore(data); const entry = await templates.create({ name: 'Saved', tags: [], project: demoProject() });
  await writeFile(path.join(data, 'templates', `${entry.id}.json`), '{');
  await assert.rejects(templates.read(entry.id), error => error.code === 'EINVALIDJSON');
});
