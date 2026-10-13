import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readJson, removeStaleJsonTemps, writeJsonAtomic } from '../server/json-store.mjs';

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
