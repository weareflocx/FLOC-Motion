import { readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { acceptAssetUpload } from './asset-upload.mjs';

export const ASSET_QUOTA_BYTES = 1.5e9;
export const ORPHAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const assetName = /^[a-f0-9-]{36}\.(?:png|jpe?g|webp|gif|avif|mp4|webm|mp3|wav|m4a|ogg|svg|glb)$/i;
const quotaError = () => Object.assign(new Error('Workspace media storage is full. Remove unused media or run storage cleanup.'), { status: 507 });

function collectReferences(value, output) {
  if (typeof value === 'string') {
    const match = value.match(/^\/assets\/([a-f0-9-]{36}\.[a-z0-9]+)$/i);
    if (match) output.add(match[1]);
  } else if (Array.isArray(value)) value.forEach(item => collectReferences(item, output));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => collectReferences(item, output));
}

export function createAssetStorage({ data, quotaBytes = ASSET_QUOTA_BYTES, graceMs = ORPHAN_GRACE_MS, now = Date.now }) {
  const directory = path.join(data, 'assets');
  let queue = Promise.resolve();
  const serial = action => { const result = queue.catch(() => {}).then(action); queue = result; return result; };
  async function references() {
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
    for (const name of ['templates', 'drafts', 'renders']) await scanDirectory(path.join(data, name));
    try { collectReferences(JSON.parse(await readFile(path.join(data, 'project.json'), 'utf8')), output); }
    catch (error) { if (error.code !== 'ENOENT') badJson.push({ filename: path.join(data, 'project.json'), error }); }
    if (badJson.length) throw Object.assign(new Error(`Storage cleanup stopped because ${badJson.length} persisted JSON file is unreadable.`), { status: 500, files: badJson.map(item => item.filename) });
    return output;
  }
  async function inventory() {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return { files: [], references: new Set() }; throw error; }
    const refs = await references();
    const files = [];
    for (const entry of entries) if (entry.isFile() && assetName.test(entry.name)) { const info = await stat(path.join(directory, entry.name)); files.push({ name: entry.name, bytes: info.size, modifiedAt: info.mtimeMs }); }
    const names = new Set(files.map(file => file.name));
    for (const name of [...refs]) if (name.endsWith('.gif')) { const derivative = name.replace(/\.gif$/i, '.webm'); if (names.has(derivative)) refs.add(derivative); }
    return { files, references: refs };
  }
  const summarize = ({ files, references }) => {
    const referenced = files.filter(file => references.has(file.name));
    const orphaned = files.filter(file => !references.has(file.name));
    const eligible = orphaned.filter(file => now() - file.modifiedAt >= graceMs);
    const bytes = list => list.reduce((total, file) => total + file.bytes, 0);
    return { quotaBytes, graceMs, files: files.length, bytes: bytes(files), referencedFiles: referenced.length, referencedBytes: bytes(referenced), orphanFiles: orphaned.length, orphanBytes: bytes(orphaned), eligibleFiles: eligible.length, eligibleBytes: bytes(eligible), eligible };
  };
  async function cleanupInternal({ dryRun = true } = {}) {
    const snapshot = summarize(await inventory());
    if (!dryRun) for (const file of snapshot.eligible) await rm(path.join(directory, file.name), { force: true });
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
  return {
    usage: () => serial(async () => { const result = summarize(await inventory()); return { ...result, eligible: undefined }; }),
    cleanup: options => serial(() => cleanupInternal(options)),
    upload: (req, options) => serial(() => acceptAssetUpload(req, { ...options, directory, beforePublish: ({ size }) => ensureCapacity(size), afterPublish: ensureUnderQuota }))
  };
}
