import { chmod, mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const corrupt = (filename, cause) => Object.assign(new Error(`Persisted JSON is corrupt: ${path.basename(filename)}.`, { cause }), { code: 'EINVALIDJSON', status: 500 });

export async function readJson(filename, options = {}) {
  let source;
  try { source = await readFile(filename, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT' && Object.hasOwn(options, 'missing')) return structuredClone(options.missing);
    throw error;
  }
  try { return JSON.parse(source); }
  catch (error) { throw corrupt(filename, error); }
}

export async function writeJsonAtomic(filename, value, { mode, directoryMode } = {}) {
  const directory = path.dirname(filename);
  await mkdir(directory, { recursive: true, ...(directoryMode === undefined ? {} : { mode: directoryMode }) });
  const temporary = `${filename}.tmp-${process.pid}-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporary, 'wx', mode);
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
    await handle.close(); handle = null;
    await rename(temporary, filename);
    if (mode !== undefined) await chmod(filename, mode);
    let directoryHandle;
    try { directoryHandle = await open(directory, 'r'); await directoryHandle.sync(); } catch {}
    finally { await directoryHandle?.close().catch(() => {}); }
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function removeStaleJsonTemps(directory, { ageMs = 24 * 60 * 60 * 1000, now = Date.now(), recursive = false } = {}) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
  let removed = 0;
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) { if (recursive) removed += await removeStaleJsonTemps(filename, { ageMs, now, recursive }); continue; }
    if (!/\.json\.tmp(?:-|$)/.test(entry.name)) continue;
    try {
      if (now - (await stat(filename)).mtimeMs < ageMs) continue;
      await rm(filename, { force: true }); removed++;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return removed;
}
