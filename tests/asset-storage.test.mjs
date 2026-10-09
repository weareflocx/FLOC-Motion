import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createAssetStorage } from '../server/asset-storage.mjs';

const id = value => `${String(value).padStart(8, '0')}-1234-4234-8234-123456789012`;
const asset = (value, ext = 'png') => `${id(value)}.${ext}`;
const folder = async t => { const value = await mkdtemp(path.join(os.tmpdir(), 'floc-storage-')); t.after(() => rm(value, { recursive: true, force: true })); await mkdir(path.join(value, 'assets')); return value; };
const age = async (filename, time = 0) => utimes(filename, new Date(time), new Date(time));

test('storage inventory preserves every persisted reference and paired GIF derivative', async t => {
  const data = await folder(t), assets = path.join(data, 'assets');
  const names = [asset(1), asset(2), asset(3, 'gif'), asset(3, 'webm'), asset(4)];
  for (const name of names) await writeFile(path.join(assets, name), name);
  await mkdir(path.join(data, 'templates')); await writeFile(path.join(data, 'templates/a.json'), JSON.stringify({ project: { src: `/assets/${names[0]}` } }));
  await mkdir(path.join(data, 'drafts')); await writeFile(path.join(data, 'drafts/a.json'), JSON.stringify({ project: { image: `/assets/${names[1]}` } }));
  await mkdir(path.join(data, 'renders/r'), { recursive: true }); await writeFile(path.join(data, 'renders/r/render-input.json'), JSON.stringify({ project: { gif: `/assets/${names[2]}` } }));
  const usage = await createAssetStorage({ data, quotaBytes: 1000, graceMs: 100, now: () => 1000 }).usage();
  assert.deepEqual([usage.files, usage.referencedFiles, usage.orphanFiles], [5, 4, 1]);
  assert.equal(usage.orphanBytes, Buffer.byteLength(names[4]));
});

test('cleanup dry-run is non-destructive and confirmed cleanup removes only old orphans', async t => {
  const data = await folder(t), assets = path.join(data, 'assets'), referenced = asset(1), old = asset(2), recent = asset(3);
  for (const name of [referenced, old, recent]) await writeFile(path.join(assets, name), name);
  await age(path.join(assets, referenced)); await age(path.join(assets, old)); await age(path.join(assets, recent), 950);
  await mkdir(path.join(data, 'templates')); await writeFile(path.join(data, 'templates/a.json'), JSON.stringify({ src: `/assets/${referenced}` }));
  const storage = createAssetStorage({ data, quotaBytes: 1000, graceMs: 100, now: () => 1000 });
  const dry = await storage.cleanup({ dryRun: true }); assert.equal(dry.eligibleFiles, 1); assert.equal(dry.removedFiles, 0);
  assert.equal((await readdir(assets)).length, 3);
  const clean = await storage.cleanup({ dryRun: false }); assert.equal(clean.removedFiles, 1);
  assert.deepEqual((await readdir(assets)).sort(), [recent, referenced].sort());
});

test('cleanup aborts without deleting when persisted JSON is corrupt', async t => {
  const data = await folder(t), filename = path.join(data, 'assets', asset(1)); await writeFile(filename, 'orphan'); await age(filename);
  await mkdir(path.join(data, 'drafts')); await writeFile(path.join(data, 'drafts/bad.json'), '{');
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
  await mkdir(path.join(data, 'templates')); await writeFile(path.join(data, 'templates/a.json'), JSON.stringify({ src: `/assets/${uploaded.id}.svg` }));
  const second = Readable.from([svg]); second.headers = { 'content-length': String(svg.length) };
  await assert.rejects(createAssetStorage({ data, quotaBytes: svg.length - 1, graceMs: 0, now: () => 1000 }).upload(second, { ext: 'svg', run() {}, convertGif() {} }), error => error.status === 507);
  assert.deepEqual(await readdir(assets), [`${uploaded.id}.svg`]);
});
