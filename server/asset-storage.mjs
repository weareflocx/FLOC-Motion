import { readdir, readFile, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import { acceptAssetUpload, hashFile } from './asset-upload.mjs';
import { database, transaction } from './database.mjs';
import { fallbackAssetName } from '../src/editor/media-library.js';

export const ASSET_QUOTA_BYTES = 1.5e9;
export const ORPHAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const assetName = /^[a-f0-9-]{36}\.(?:png|jpe?g|webp|gif|avif|mp4|webm|mp3|wav|m4a|ogg|svg|glb)$/i;
const assetSource = /^\/assets\/([a-f0-9-]{36}\.[a-z0-9]+)$/i;
const quotaError = () => Object.assign(new Error('Workspace media storage is full. Remove unused media or run storage cleanup.'), { status: 507 });
// Copies are identical when their bytes match and their extensions name the same format.
const format = name => { const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase(); return ext === 'jpeg' ? 'jpg' : ext; };
const extension = name => name.slice(name.lastIndexOf('.') + 1);
const isGif = name => /\.gif$/i.test(name);
const videoOf = gif => gif.replace(/\.gif$/i, '.webm');
// A GIF's video derivative follows its GIF and is never deduplicated on its own.
const isDerivative = (name, stored) => /\.webm$/i.test(name) && stored.has(name.replace(/\.webm$/i, '.gif'));

function collectReferences(value, output) {
  if (typeof value === 'string') {
    const match = value.match(assetSource);
    if (match) output.add(match[1]);
  } else if (Array.isArray(value)) value.forEach(item => collectReferences(item, output));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => collectReferences(item, output));
}

// Replaces every source naming a merged copy with the copy it was merged into.
function relink(value, aliases) {
  if (typeof value === 'string') { const match = value.match(assetSource); return match && aliases.has(match[1]) ? `/assets/${aliases.get(match[1])}` : value; }
  if (Array.isArray(value)) return value.map(item => relink(item, aliases));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, relink(item, aliases)]));
  return value;
}

export function createAssetStorage({ data, quotaBytes = ASSET_QUOTA_BYTES, graceMs = ORPHAN_GRACE_MS, now = Date.now }) {
  const directory = path.join(data, 'assets');
  const db = database(data);
  let queue = Promise.resolve();
  const serial = action => { const result = queue.catch(() => {}).then(action); queue = result; return result; };
  const remember = db.prepare('INSERT OR REPLACE INTO asset_names (asset, name) VALUES (?, ?)');
  const nameOf = db.prepare('SELECT name FROM asset_names WHERE asset = ?');
  const forget = db.prepare('DELETE FROM asset_names WHERE asset = ?');
  const recordHash = db.prepare('INSERT OR REPLACE INTO asset_hashes (asset, sha256) VALUES (?, ?)');
  const forgetHash = db.prepare('DELETE FROM asset_hashes WHERE asset = ?');
  const alias = db.prepare('INSERT OR REPLACE INTO asset_aliases (asset, target) VALUES (?, ?)');
  const retarget = db.prepare('UPDATE asset_aliases SET target = ? WHERE target = ?');
  const dropAliasesTo = db.prepare('DELETE FROM asset_aliases WHERE target = ?');
  const aliases = () => new Map(db.prepare('SELECT asset, target FROM asset_aliases').all().map(row => [row.asset, row.target]));
  // Render jobs and the pre-library project.json are files; they are never rewritten, so copies
  // they name stay on disk until they are released.
  async function fileReferences() {
    const output = new Set(), badJson = [];
    async function scanDirectory(folder) {
      let entries;
      try { entries = await readdir(folder, { withFileTypes: true }); }
      catch (error) { if (error.code === 'ENOENT') return; throw error; }
      for (const entry of entries) {
        const filename = path.join(folder, entry.name);
        if (entry.isDirectory()) await scanDirectory(filename);
        else if (entry.name.endsWith('.json')) {
          try { collectReferences(JSON.parse(await readFile(filename, 'utf8')), output); }
          catch (error) { badJson.push({ filename, error }); }
        }
      }
    }
    await scanDirectory(path.join(data, 'renders'));
    try { collectReferences(JSON.parse(await readFile(path.join(data, 'project.json'), 'utf8')), output); }
    catch (error) { if (error.code !== 'ENOENT') badJson.push({ filename: path.join(data, 'project.json'), error }); }
    if (badJson.length) throw Object.assign(new Error(`Storage cleanup stopped because ${badJson.length} persisted JSON file is unreadable.`), { status: 500, files: badJson.map(item => item.filename) });
    return output;
  }
  // Drafts, compositions and every retained version are indexed in the database. A reference to
  // a merged copy also keeps the copy it was merged into.
  async function inventory() {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return { files: [], references: new Set(), fileReferences: new Set() }; throw error; }
    const pinned = await fileReferences();
    const refs = new Set([...db.prepare('SELECT DISTINCT asset FROM asset_references').all().map(row => row.asset), ...pinned]);
    const merged = aliases();
    for (const name of [...refs]) if (merged.has(name)) refs.add(merged.get(name));
    const files = [];
    for (const entry of entries) if (entry.isFile() && assetName.test(entry.name)) { const info = await stat(path.join(directory, entry.name)); files.push({ name: entry.name, bytes: info.size, modifiedAt: info.mtimeMs }); }
    const names = new Set(files.map(file => file.name));
    for (const name of [...refs]) if (isGif(name) && names.has(videoOf(name))) refs.add(videoOf(name));
    return { files, references: refs, fileReferences: pinned };
  }
  // Content hashes of every stored upload; files that arrived without an upload (restores,
  // workspaces from before deduplication) are hashed on first sight.
  async function contentHashes(files) {
    const known = new Map(db.prepare('SELECT asset, sha256 FROM asset_hashes').all().map(row => [row.asset, row.sha256]));
    const stored = new Set(files.map(file => file.name));
    for (const name of known.keys()) if (!stored.has(name)) { forgetHash.run(name); known.delete(name); }
    for (const file of files) if (!known.has(file.name) && !isDerivative(file.name, stored)) {
      const sha256 = await hashFile(path.join(directory, file.name));
      recordHash.run(file.name, sha256); known.set(file.name, sha256);
    }
    return known;
  }
  // Copies with the same content and format, keeper first: one no other copy was merged from,
  // then one a render job still names (it cannot be released yet), then the oldest.
  function sameContent(files, hashes) {
    const stored = new Set(files.map(file => file.name)), merged = aliases(), groups = new Map();
    for (const file of files) {
      const sha256 = hashes.get(file.name);
      if (!sha256 || isDerivative(file.name, stored)) continue;
      const key = `${sha256}.${format(file.name)}`;
      groups.set(key, [...(groups.get(key) ?? []), file]);
    }
    return { groups, rank: (copies, pinned) => [...copies].sort((a, b) => merged.has(a.name) - merged.has(b.name) || pinned.has(b.name) - pinned.has(a.name) || a.modifiedAt - b.modifiedAt || a.name.localeCompare(b.name)) };
  }
  const summarize = ({ files, references }) => {
    const referenced = files.filter(file => references.has(file.name));
    const orphaned = files.filter(file => !references.has(file.name));
    const eligible = orphaned.filter(file => now() - file.modifiedAt >= graceMs);
    const bytes = list => list.reduce((total, file) => total + file.bytes, 0);
    return { quotaBytes, graceMs, files: files.length, bytes: bytes(files), referencedFiles: referenced.length, referencedBytes: bytes(referenced), orphanFiles: orphaned.length, orphanBytes: bytes(orphaned), eligibleFiles: eligible.length, eligibleBytes: bytes(eligible), eligible };
  };
  function removed(name) { forget.run(name); forgetHash.run(name); dropAliasesTo.run(name); }
  async function cleanupInternal({ dryRun = true } = {}) {
    const snapshot = summarize(await inventory());
    if (!dryRun) for (const file of snapshot.eligible) { await rm(path.join(directory, file.name), { force: true }); removed(file.name); }
    return { ...snapshot, dryRun, removedFiles: dryRun ? 0 : snapshot.eligibleFiles, removedBytes: dryRun ? 0 : snapshot.eligibleBytes, eligible: undefined };
  }
  async function ensureCapacity(size) {
    let usage = summarize(await inventory());
    if (usage.bytes + size <= quotaBytes) return;
    await cleanupInternal({ dryRun: false });
    usage = summarize(await inventory());
    if (usage.bytes + size > quotaBytes) throw quotaError();
  }
  async function ensureUnderQuota() { const usage = summarize(await inventory()); if (usage.bytes > quotaBytes) throw quotaError(); }
  // The stored copy an upload with this content and format reuses, if any; its extension may
  // differ from the upload's (jpg and jpeg).
  async function storedCopy(sha256, ext) {
    const { files, fileReferences: pinned } = await inventory();
    const hashes = await contentHashes(files);
    const { groups, rank } = sameContent(files, hashes);
    const copies = groups.get(`${sha256}.${format(`.${ext}`)}`);
    if (!copies) return null;
    const [kept] = rank(copies, pinned);
    return { id: kept.name.slice(0, 36), ext: extension(kept.name) };
  }
  const projectTables = {
    draft: ['SELECT project FROM drafts WHERE id = ?', 'UPDATE drafts SET project = ? WHERE id = ?'],
    template: ['SELECT project FROM templates WHERE id = ?', 'UPDATE templates SET project = ? WHERE id = ?'],
    version: ['SELECT project FROM composition_versions WHERE composition_id = ? AND version = ?', 'UPDATE composition_versions SET project = ? WHERE composition_id = ? AND version = ?']
  };
  // Owners are 'draft:<id>', 'template:<id>' or 'version:<composition>:<number>'.
  function relinkOwner(owner, merged) {
    const [kind, ...key] = owner.split(':');
    const [select, update] = projectTables[kind];
    if (kind === 'version') key[1] = Number(key[1]);
    const row = db.prepare(select).get(...key);
    if (row) db.prepare(update).run(JSON.stringify(relink(JSON.parse(row.project), merged)), ...key);
  }
  // Merges every set of identical uploads into one copy: saved drafts, compositions and versions
  // are relinked to it, and copies nothing names any more are deleted. Merged copies stay
  // aliases of their keeper so open editors and old links keep resolving.
  async function deduplicateInternal() {
    const { files, fileReferences: pinned } = await inventory();
    const { groups, rank } = sameContent(files, await contentHashes(files));
    const before = aliases(), merges = [];
    for (const copies of groups.values()) if (copies.length > 1) {
      const [kept, ...rest] = rank(copies, pinned);
      for (const copy of rest) merges.push({ from: copy.name, to: kept.name });
    }
    transaction(db, () => {
      for (const { from, to } of merges) {
        const pairs = isGif(from) ? [[from, to], [videoOf(from), videoOf(to)]] : [[from, to]];
        for (const [source, target] of pairs) { retarget.run(target, source); alias.run(source, target); }
        const name = nameOf.get(from)?.name;
        if (name && !nameOf.get(to)) remember.run(to, name);
      }
      const merged = aliases();
      for (const { owner } of db.prepare('SELECT DISTINCT owner FROM asset_references WHERE asset IN (SELECT asset FROM asset_aliases)').all()) relinkOwner(owner, merged);
    });
    const { files: current, references } = await inventory(), sizes = new Map(current.map(file => [file.name, file.bytes]));
    let removedFiles = 0, removedBytes = 0;
    for (const { from } of merges) {
      const copies = isGif(from) ? [from, videoOf(from)] : [from];
      if (copies.some(name => references.has(name))) continue;
      for (const name of copies) if (sizes.has(name)) { await rm(path.join(directory, name), { force: true }); forget.run(name); forgetHash.run(name); removedFiles++; removedBytes += sizes.get(name); }
    }
    return { mergedFiles: merges.filter(({ from, to }) => before.get(from) !== to).length, removedFiles, removedBytes };
  }
  // Every stored upload, newest first. GIF video derivatives stay behind their GIF and merged
  // copies behind their keeper. `used` means a draft, composition, version or render refers to
  // it; unused files remain subject to cleanup.
  async function library() {
    const { files, references: refs } = await inventory();
    const names = new Map(db.prepare('SELECT asset, name FROM asset_names').all().map(row => [row.asset, row.name]));
    const stored = new Set(files.map(item => item.name)), merged = aliases();
    return files.filter(item => !isDerivative(item.name, stored) && !stored.has(merged.get(item.name)))
      .sort((a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name))
      .map(item => ({ id: item.name.slice(0, 36), src: `/assets/${item.name}`, name: names.get(item.name) ?? fallbackAssetName(item.name), bytes: item.bytes, createdAt: Math.round(item.modifiedAt), used: refs.has(item.name) }));
  }
  return {
    usage: () => serial(async () => { const result = summarize(await inventory()); return { ...result, eligible: undefined }; }),
    cleanup: options => serial(() => cleanupInternal(options)),
    deduplicate: () => serial(deduplicateInternal),
    library,
    // The stored file a source names: merged copies resolve to their keeper.
    resolve: name => aliases().get(name) ?? name,
    // A project whose sources name merged copies, relinked to their keepers before it is saved
    // or rendered.
    canonical: project => { const merged = aliases(); return merged.size ? relink(project, merged) : project; },
    // `name` is the uploaded file's own name, shown in the media library. Content that is already
    // stored returns that upload instead of a second copy; it moves to the top of the library and
    // restarts its cleanup grace period.
    upload: (req, { name, ...options }) => serial(async () => {
      const asset = await acceptAssetUpload(req, { ...options, directory, existing: ({ sha256 }) => storedCopy(sha256, options.ext), beforePublish: ({ size }) => ensureCapacity(size), afterPublish: ensureUnderQuota });
      const file = `${asset.id}.${asset.ext}`;
      if (asset.existing) {
        const time = new Date(now());
        for (const touched of isGif(file) ? [file, videoOf(file)] : [file]) await utimes(path.join(directory, touched), time, time).catch(error => { if (error.code !== 'ENOENT') throw error; });
        if (name && !nameOf.get(file)) remember.run(file, name);
        return asset;
      }
      recordHash.run(file, asset.sha256);
      if (name) remember.run(file, name);
      return asset;
    })
  };
}
