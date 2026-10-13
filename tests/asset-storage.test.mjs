import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createAssetStorage } from '../server/asset-storage.mjs';
import { createDraftStore } from '../server/draft-store.mjs';
import { createTemplateStore } from '../server/template-store.mjs';
import { demoProject } from '../src/project.js';

const id = value => `${String(value).padStart(8, '0')}-1234-4234-8234-123456789012`;
const asset = (value, ext = 'png') => `${id(value)}.${ext}`;
const folder = async t => { const value = await mkdtemp(path.join(os.tmpdir(), 'floc-storage-')); t.after(() => rm(value, { recursive: true, force: true })); await mkdir(path.join(value, 'assets')); return value; };
const age = async (filename, time = 0) => utimes(filename, new Date(time), new Date(time));
const using = name => { const project = demoProject(); project.images[0].src = `/assets/${name}`; return project; };

test('storage inventory preserves every persisted reference, older versions and paired GIF derivatives', async t => {
  const data = await folder(t), assets = path.join(data, 'assets');
  const names = [asset(1), asset(2), asset(3, 'gif'), asset(3, 'webm'), asset(4), asset(5)];
  for (const name of names) await writeFile(path.join(assets, name), name);
  const templates = createTemplateStore(data);
  const entry = await templates.create({ name: 'Versioned', tags: [], project: using(names[5]) });
  await templates.update(entry.id, { name: 'Versioned', project: using(names[0]), updatedAt: entry.updatedAt });
  await createDraftStore(data).update(id(9), { revision: 0, project: using(names[1]) });
  await mkdir(path.join(data, 'renders/r'), { recursive: true }); await writeFile(path.join(data, 'renders/r/render-input.json'), JSON.stringify({ project: { gif: `/assets/${names[2]}` } }));
  const storage = createAssetStorage({ data, quotaBytes: 1000, graceMs: 100, now: () => 1000 });
  let usage = await storage.usage();
  assert.deepEqual([usage.files, usage.referencedFiles, usage.orphanFiles], [6, 5, 1]);
  assert.equal(usage.orphanBytes, Buffer.byteLength(names[4]));
  await templates.remove(entry.id);
  usage = await storage.usage();
  assert.deepEqual([usage.referencedFiles, usage.orphanFiles], [3, 3], 'deleting a composition releases its versions');
});

test('cleanup dry-run is non-destructive and confirmed cleanup removes only old orphans', async t => {
  const data = await folder(t), assets = path.join(data, 'assets'), referenced = asset(1), old = asset(2), recent = asset(3);
  for (const name of [referenced, old, recent]) await writeFile(path.join(assets, name), name);
  await age(path.join(assets, referenced)); await age(path.join(assets, old)); await age(path.join(assets, recent), 950);
  await createTemplateStore(data).create({ name: 'Saved', tags: [], project: using(referenced) });
  const storage = createAssetStorage({ data, quotaBytes: 1000, graceMs: 100, now: () => 1000 });
  const dry = await storage.cleanup({ dryRun: true }); assert.equal(dry.eligibleFiles, 1); assert.equal(dry.removedFiles, 0);
  assert.equal((await readdir(assets)).length, 3);
  const clean = await storage.cleanup({ dryRun: false }); assert.equal(clean.removedFiles, 1);
  assert.deepEqual((await readdir(assets)).sort(), [recent, referenced].sort());
});

test('cleanup aborts without deleting when a render job file is corrupt', async t => {
  const data = await folder(t), filename = path.join(data, 'assets', asset(1)); await writeFile(filename, 'orphan'); await age(filename);
  await mkdir(path.join(data, 'renders/job'), { recursive: true }); await writeFile(path.join(data, 'renders/job/job.json'), '{');
  const storage = createAssetStorage({ data, quotaBytes: 1, graceMs: 0, now: () => 1000 });
  await assert.rejects(storage.cleanup({ dryRun: false }), error => error.status === 500 && /unreadable/.test(error.message));
  assert.equal(await readFile(filename, 'utf8'), 'orphan');
});

test('uploads reclaim eligible orphans at quota and reject when referenced data still exceeds it', async t => {
  const data = await folder(t), assets = path.join(data, 'assets'), old = asset(1); await writeFile(path.join(assets, old), '123456'); await age(path.join(assets, old));
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>');
  const storage = createAssetStorage({ data, quotaBytes: svg.length, graceMs: 0, now: () => 1000 });
  const request = Readable.from([svg]); request.headers = { 'content-length': String(svg.length) };
  const uploaded = await storage.upload(request, { ext: 'svg', run() {}, convertGif() {} });
  assert(!((await readdir(assets)).includes(old))); assert((await readdir(assets)).includes(`${uploaded.id}.svg`));
  await createTemplateStore(data).create({ name: 'Saved', tags: [], project: using(`${uploaded.id}.svg`) });
  const second = Readable.from([svg]); second.headers = { 'content-length': String(svg.length) };
  await assert.rejects(createAssetStorage({ data, quotaBytes: svg.length - 1, graceMs: 0, now: () => 1000 }).upload(second, { ext: 'svg', run() {}, convertGif() {} }), error => error.status === 507);
  assert.deepEqual(await readdir(assets), [`${uploaded.id}.svg`]);
});
