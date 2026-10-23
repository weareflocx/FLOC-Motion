import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createAssetStorage } from '../server/asset-storage.mjs';
import { createDraftStore } from '../server/draft-store.mjs';
import { createTemplateStore } from '../server/template-store.mjs';
import { demoProject } from '../src/project.js';
import { DatabaseSync } from 'node:sqlite';
import { closeDatabase, database, DATABASE_FILE } from '../server/database.mjs';

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
  const different = Buffer.from(svg.toString().replace('h1v1', 'h2v2')), second = Readable.from([different]); second.headers = { 'content-length': String(different.length) };
  await assert.rejects(createAssetStorage({ data, quotaBytes: svg.length - 1, graceMs: 0, now: () => 1000 }).upload(second, { ext: 'svg', run() {}, convertGif() {} }), error => error.status === 507);
  assert.deepEqual(await readdir(assets), [`${uploaded.id}.svg`]);
});

test('the media library lists uploads newest first with their file names, usage and no GIF derivatives', async t => {
  const data = await folder(t), assets = path.join(data, 'assets');
  const photo = asset(1), gif = asset(2, 'gif'), track = asset(3, 'mp3');
  for (const [index, name] of [photo, gif, asset(2, 'webm'), track].entries()) { await writeFile(path.join(assets, name), name); await age(path.join(assets, name), index * 1000); }
  await createTemplateStore(data).create({ name: 'Saved', tags: [], project: using(photo) });
  const storage = createAssetStorage({ data });
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>');
  const request = Readable.from([svg]); request.headers = { 'content-length': String(svg.length) };
  const uploaded = await storage.upload(request, { ext: 'svg', name: 'Brand mark.svg', run() {}, convertGif() {} });
  const library = await storage.library();
  assert.deepEqual(library.map(item => [item.src, item.name, item.used]), [
    [`/assets/${uploaded.id}.svg`, 'Brand mark.svg', false],
    [`/assets/${track}`, `Audio ${id(3).slice(0, 8)}`, false],
    [`/assets/${gif}`, `GIF ${id(2).slice(0, 8)}`, false],
    [`/assets/${photo}`, `Image ${id(1).slice(0, 8)}`, true]
  ]);
  assert.equal(library[0].id, uploaded.id);
  assert.equal(library[0].bytes, svg.length);
});

test('uploading content that is already stored reuses that upload and restarts its cleanup grace', async t => {
  const data = await folder(t), assets = path.join(data, 'assets');
  const svg = text => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><title>${text}</title></svg>`);
  const send = (bytes, name) => { const request = Readable.from([bytes]); request.headers = { 'content-length': String(bytes.length) }; return storage.upload(request, { ext: 'svg', name, run() {}, convertGif() {} }); };
  // Stored before deduplication existed, so it has no recorded hash yet.
  const earlier = asset(1, 'svg'); await writeFile(path.join(assets, earlier), svg('earlier')); await age(path.join(assets, earlier));
  let time = 1000;
  const storage = createAssetStorage({ data, graceMs: 500, now: () => time });
  const first = await send(svg('mark'), 'Brand mark.svg');
  await age(path.join(assets, `${first.id}.svg`));
  time = 5000;
  const again = await send(svg('mark'), 'brand-mark-copy.svg');
  assert.equal(again.id, first.id); assert.equal(again.existing, true);
  assert.equal((await stat(path.join(assets, `${first.id}.svg`))).mtimeMs, 5000);
  assert.equal((await storage.cleanup({ dryRun: true })).eligibleFiles, 1, 'only the untouched earlier upload is old enough to clean up');
  assert.equal((await send(svg('earlier'), 'earlier.svg')).id, id(1));
  const other = await send(svg('other'), 'other.svg');
  assert.notEqual(other.id, first.id);
  assert.equal((await readdir(assets)).length, 3);
  assert.deepEqual((await storage.library()).map(item => item.name).sort(), ['Brand mark.svg', 'earlier.svg', 'other.svg'], 'one entry per content, named by its first upload');
});

test('deduplication relinks saved projects to one copy, deletes released copies and keeps render inputs intact', async t => {
  const data = await folder(t), assets = path.join(data, 'assets');
  const [keeper, saved, drafted, other] = [asset(1), asset(2), asset(3), asset(4)];
  const [gif, gifCopy] = [asset(5, 'gif'), asset(6, 'gif')];
  const [pinnedOld, pinned] = [asset(8), asset(7)], [rendered, renderedCopy] = [asset(11), asset(12)], [jpg, jpeg] = [asset(13, 'jpg'), asset(14, 'jpeg')];
  const files = [[keeper, 'same', 1], [saved, 'same', 2], [drafted, 'same', 3], [other, 'other', 1], [gif, 'gif', 1], [asset(5, 'webm'), 'video', 1], [gifCopy, 'gif', 2], [asset(6, 'webm'), 'video', 2], [pinnedOld, 'pinned', 1], [pinned, 'pinned', 2], [rendered, 'render', 1], [renderedCopy, 'render', 2], [jpg, 'jpeg', 1], [jpeg, 'jpeg', 2]];
  for (const [name, content, time] of files) { await writeFile(path.join(assets, name), content); await age(path.join(assets, name), time * 1000); }
  const templates = createTemplateStore(data);
  const entry = await templates.create({ name: 'Saved', tags: [], project: using(drafted) });
  const project = using(saved); project.images.push({ ...project.images[0], id: 'gif-card', src: `/assets/${gifCopy}` });
  await templates.update(entry.id, { name: 'Saved', project, updatedAt: entry.updatedAt });
  await createDraftStore(data).update(id(9), { revision: 0, project: using(drafted) });
  database(data).prepare('INSERT INTO asset_names (asset, name) VALUES (?, ?)').run(saved, 'photo.png');
  await mkdir(path.join(data, 'renders/r'), { recursive: true });
  const renderInput = path.join(data, 'renders/r/render-input.json');
  await writeFile(renderInput, JSON.stringify({ project: { a: `/assets/${pinned}`, b: `/assets/${rendered}`, c: `/assets/${renderedCopy}` } }));
  const storage = createAssetStorage({ data });

  assert.deepEqual(await storage.deduplicate(), { mergedFiles: 6, removedFiles: 6, removedBytes: 2 * 'same'.length + 'gif'.length + 'video'.length + 'pinned'.length + 'jpeg'.length });
  assert.deepEqual((await readdir(assets)).sort(), [keeper, other, gif, asset(5, 'webm'), pinned, rendered, renderedCopy, jpg].sort(), 'a copy a render job still names stays on disk; jpg and jpeg are one format');
  const stored = database(data).prepare('SELECT project FROM drafts UNION ALL SELECT project FROM templates UNION ALL SELECT project FROM composition_versions').all().map(row => row.project).join('\n');
  for (const name of [saved, drafted, gifCopy]) assert(!stored.includes(name), `${name} is relinked in drafts, compositions and versions`);
  assert((await templates.read(entry.id)).project.images.some(image => image.src === `/assets/${gif}`));
  assert.equal(await readFile(renderInput, 'utf8').then(value => value.includes(renderedCopy)), true, 'render inputs are never rewritten');
  assert.deepEqual((await storage.library()).map(item => [item.src, item.used]).sort(), [[`/assets/${keeper}`, true], [`/assets/${other}`, false], [`/assets/${gif}`, true], [`/assets/${pinned}`, true], [`/assets/${rendered}`, true], [`/assets/${jpg}`, false]].sort());
  assert.equal((await storage.library()).find(item => item.src === `/assets/${keeper}`).name, 'photo.png', 'the keeper inherits a merged name');
  assert.equal(storage.resolve(saved), keeper); assert.equal(storage.resolve(asset(6, 'webm')), asset(5, 'webm')); assert.equal(storage.resolve(other), other);
  assert.equal(storage.canonical(using(drafted)).images[0].src, `/assets/${keeper}`, 'editors opened before the merge save the keeper');

  assert.deepEqual(await storage.deduplicate(), { mergedFiles: 0, removedFiles: 0, removedBytes: 0 });
  await rm(path.join(data, 'renders'), { recursive: true });
  assert.deepEqual(await storage.deduplicate(), { mergedFiles: 0, removedFiles: 1, removedBytes: 6 }, 'a released render copy goes on the next pass');
  assert(!(await readdir(assets)).includes(renderedCopy));
});

test('the media-name migration names earlier uploads from saved projects, preferring file names', async t => {
  const data = await folder(t), card = asset(1), mark = asset(2, 'svg');
  const project = using(card);
  project.images[0].name = 'poster-final.png';
  project.layers.push({ ...project.layers.find(layer => layer.type === 'logo'), id: 'mark', name: 'Studio mark', src: `/assets/${mark}` });
  project.images.push({ id: 'mark-card', src: `/assets/${mark}`, name: 'mark.svg' });
  await createTemplateStore(data).create({ name: 'Saved', tags: [], project });
  const raw = new DatabaseSync(path.join(data, DATABASE_FILE));
  raw.exec('DROP TABLE asset_names; DROP TABLE asset_hashes; DROP TABLE asset_aliases; DROP TABLE password_resets; DELETE FROM schema_migrations WHERE version >= 6;');
  raw.close(); closeDatabase(data);
  const names = Object.fromEntries(database(data).prepare('SELECT asset, name FROM asset_names').all().map(row => [row.asset, row.name]));
  assert.equal(names[card], 'poster-final.png');
  assert.equal(names[mark], 'mark.svg', 'a file-like card name wins over the layer name');
});
