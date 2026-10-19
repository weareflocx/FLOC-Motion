// Installs renderer engines side by side under RENDERER_HOME/engines and switches
// current.json only after a candidate is verified. The launcher keeps running the
// previous engine when anything fails. Imports stay limited to Node built-ins and
// dependency-free engine modules, because the installer runs this file before
// any dependency exists.
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, realpathSync } from 'node:fs';
import { access, cp, lstat, mkdir, readdir, readFile, rename, rm, rmdir, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from '../server/process.mjs';
import { readJson, writeJsonAtomic } from '../server/json-store.mjs';
import { trustedOrigin } from './renderer-runtime.mjs';

export const NODE_MISMATCH = 'Reinstall the renderer to update its Node runtime.';
export const ROLLBACK_MESSAGE = 'The updated engine stopped unexpectedly, so the previous engine was restored.';
const ENGINE_ENTRIES = ['package.json', 'package-lock.json', 'src', 'server', 'scripts', 'public'];
const LEGACY_ENTRIES = [...ENGINE_ENTRIES, 'node_modules'];
const VERSION = /^[a-f0-9]{64}$/;
const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 400 * 1024 * 1024;

const sha256 = data => createHash('sha256').update(data).digest('hex');
const exists = target => access(target).then(() => true, () => false);
const unique = () => `${process.pid}-${randomUUID().slice(0, 8)}`;

export async function readCurrent(home) {
  const current = await readJson(path.join(home, 'current.json'), { missing: null });
  if (current === null) return null;
  if (!VERSION.test(current?.version || '')) throw new Error('current.json does not name an installed engine. Reinstall the renderer.');
  return { version: current.version, previous: VERSION.test(current.previous || '') ? current.previous : null, ...(VERSION.test(current.failed || '') ? { failed: current.failed } : {}) };
}
export const writeCurrent = (home, value) => writeJsonAtomic(path.join(home, 'current.json'), value);

// The private runtime ships npm beside node: runtime/lib/node_modules on Mac,
// runtime/node_modules on Windows. Never fall back to a global npm.
export async function npmCli(execPath = process.execPath) {
  const bin = path.dirname(execPath);
  for (const candidate of [path.join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), path.join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js')]) if (await exists(candidate)) return path.resolve(candidate);
  throw new Error('The renderer runtime has no bundled npm. Reinstall the renderer.');
}

// Directory links: symlinks on Mac, junctions (no admin rights needed) on Windows.
async function removeLink(target) {
  try { await unlink(target); }
  catch (cause) {
    if (cause.code === 'ENOENT') return;
    if (!['EPERM', 'EISDIR'].includes(cause.code)) throw cause;
    await rmdir(target);
  }
}
async function removeTree(target) {
  // Unlink node_modules first so a shared dependency install is never traversed.
  await removeLink(path.join(target, 'node_modules')).catch(() => {});
  await rm(target, { recursive: true, force: true });
}

// Engines with the same package-lock.json share one dependency install.
export async function installDependencies(home, engine, { log = () => {}, npm } = {}) {
  const lockSha = sha256(await readFile(path.join(engine, 'package-lock.json')));
  const deps = path.join(home, 'deps', lockSha);
  let reused = await exists(path.join(deps, 'node_modules'));
  if (!reused) {
    const partial = `${deps}.partial-${unique()}`;
    try {
      await mkdir(partial, { recursive: true });
      for (const name of ['package.json', 'package-lock.json']) await cp(path.join(engine, name), path.join(partial, name));
      const cli = npm || await npmCli();
      log('Installing engine dependencies…');
      await run(process.execPath, [cli, 'ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: partial, env: { PATH: [path.dirname(process.execPath), process.env.PATH || ''].join(path.delimiter) } }, text => log(text.trimEnd()));
      await mkdir(path.join(partial, 'node_modules'), { recursive: true });
      try { await rename(partial, deps); }
      catch (cause) { if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(cause.code) || !await exists(path.join(deps, 'node_modules'))) throw cause; reused = true; }
    } finally { await rm(partial, { recursive: true, force: true }); }
  }
  const link = path.join(engine, 'node_modules');
  await removeLink(link);
  await symlink(path.join(deps, 'node_modules'), link, process.platform === 'win32' ? 'junction' : 'dir');
  return { lockSha, reused };
}

// The candidate's own fingerprint code decides its version, in a separate process so
// the running engine never loads modules from an unverified directory.
export async function engineVersion(engine) {
  const source = 'const { rendererVersion } = await import(process.env.FLOC_ENGINE_VERSION_MODULE); process.stdout.write(`\\n${await rendererVersion(process.env.FLOC_ENGINE_DIR)}\\n`);';
  const output = await run(process.execPath, ['--input-type=module', '-e', source], { cwd: engine, timeoutMs: 120000, env: { FLOC_ENGINE_DIR: engine, FLOC_ENGINE_VERSION_MODULE: pathToFileURL(path.join(engine, 'server', 'renderer-version.mjs')).href } });
  const version = output.match(/(?:^|\n)([a-f0-9]{64})\s*$/)?.[1];
  if (!version) throw new Error('Could not fingerprint the downloaded engine.');
  return version;
}

// Same dedicated rendering browser as installRendererBrowser, resolved by the candidate's
// HyperFrames. The worker exports its active browser, so overrides are cleared here.
export async function ensureBrowser(engine, { log = () => {} } = {}) {
  const bin = path.join(engine, 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs');
  const options = { cwd: engine, env: { HYPERFRAMES_BROWSER_PATH: '', PRODUCER_HEADLESS_SHELL_PATH: '' } };
  await run(process.execPath, [bin, 'browser', 'ensure'], options, text => log(text.trimEnd()));
  const browser = (await run(process.execPath, [bin, 'browser', 'path'], options)).trim().split(/\r?\n/).pop()?.trim();
  if (!browser || !path.isAbsolute(browser)) throw new Error('The rendering browser could not be located.');
  try { await run(browser, ['--version'], { timeoutMs: 5000 }); }
  catch (cause) { throw new Error(`The rendering browser cannot start: ${cause.message}`, { cause }); }
  return browser;
}

function entryPath(staging, name) {
  const parts = name.split('/');
  if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[a-z]:/i.test(name)) throw new Error(`Unsafe engine package entry: ${name}`);
  if (name.endsWith('/')) parts.pop();
  if (!parts.length || parts.some(part => !part || part === '.' || part === '..')) throw new Error(`Unsafe engine package entry: ${name}`);
  if (!ENGINE_ENTRIES.includes(parts[0])) throw new Error(`Unexpected engine package entry: ${name}`);
  const target = path.resolve(staging, ...parts);
  if (!target.startsWith(staging + path.sep)) throw new Error(`Unsafe engine package entry: ${name}`);
  return target;
}
// Extracts regular files and directories only: absolute, traversal, symlink and
// device entries reject the whole package before the engine can be used.
export async function extractEngine(zipFile, staging) {
  const { default: AdmZip } = await import('adm-zip');
  const entries = new AdmZip(zipFile).getEntries();
  let total = 0;
  const planned = entries.map(entry => {
    const type = (entry.attr >>> 16) & 0o170000;
    if (type && type !== (entry.isDirectory ? 0o040000 : 0o100000)) throw new Error(`Unsafe engine package entry: ${entry.entryName}`);
    total += entry.header.size;
    if (total > MAX_EXTRACTED_BYTES) throw new Error('The engine package is too large.');
    return { entry, target: entryPath(staging, entry.entryName) };
  });
  for (const { entry, target } of planned) {
    if (entry.isDirectory) { await mkdir(target, { recursive: true }); continue; }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, entry.getData(), { flag: 'wx' });
  }
  for (const name of ['package.json', 'package-lock.json', 'server/renderer-version.mjs', 'scripts/render-worker.mjs']) {
    if (!await exists(path.join(staging, name))) throw new Error(`The engine package is incomplete: ${name} is missing.`);
  }
}

async function fetchManifest(origin, manifestPath, timeoutMs) {
  const url = new URL(manifestPath, origin);
  if (url.origin !== origin.origin) throw new Error('The engine manifest must come from the connected editor.');
  const response = await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Could not read the engine manifest (${response.status}).`);
  const manifest = await response.json();
  if (!VERSION.test(manifest?.version || '') || manifest.file !== `${manifest.version}.zip` || !VERSION.test(manifest.sha256 || '') || !Number.isSafeInteger(manifest.size) || manifest.size <= 0 || typeof manifest.node !== 'string') throw new Error('The engine manifest is invalid.');
  return manifest;
}

async function download(url, file, manifest, { maxBytes, timeoutMs }) {
  if (manifest.size > maxBytes) throw new Error('The engine package is too large.');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok || !response.body) throw new Error(`Could not download the engine (${response.status}).`);
  const hash = createHash('sha256');
  let size = 0;
  await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, encoding, callback) {
    size += chunk.length; hash.update(chunk);
    callback(size > manifest.size ? new Error('The engine download is larger than its manifest.') : null, chunk);
  } }), createWriteStream(file, { flags: 'wx' }));
  if (size !== manifest.size) throw new Error('The engine download is incomplete.');
  if (hash.digest('hex') !== manifest.sha256) throw new Error('The engine download failed verification.');
}

async function updateConfigBrowser(configFile, browserPath) {
  if (!configFile || !browserPath) return;
  const config = await readJson(configFile);
  if (config.browserPath !== browserPath) await writeJsonAtomic(configFile, { ...config, browserPath }, { mode: 0o600 });
}

// Removes every engine except current/previous and every dependency install they do
// not reference, including staging leftovers from interrupted attempts.
export async function pruneEngines(home, keep) {
  const versions = new Set(keep.filter(Boolean));
  const referenced = new Set();
  for (const version of versions) {
    try { referenced.add(sha256(await readFile(path.join(home, 'engines', version, 'package-lock.json')))); } catch {}
  }
  for (const [folder, wanted] of [['engines', versions], ['deps', referenced]]) {
    const directory = path.join(home, folder);
    for (const name of await readdir(directory).catch(() => [])) if (!wanted.has(name)) await removeTree(path.join(directory, name));
  }
}

async function activate(home, staging, version, { configFile, browserPath }) {
  const target = path.join(home, 'engines', version);
  const current = await readCurrent(home).catch(() => null);
  // The new browser was verified to start, so the running engine can use it too.
  await updateConfigBrowser(configFile, browserPath);
  if (await exists(target)) {
    // Reinstalling the same version: the verified copy replaces the old one.
    const old = `${target}.old-${unique()}`;
    await rename(target, old);
    await removeTree(old);
  }
  // Absolute links still point to the shared dependency install after the rename.
  await rename(staging, target);
  const previous = current && current.version !== version ? current.version : current?.previous ?? null;
  await writeCurrent(home, { version, previous });
  await pruneEngines(home, [version, previous]).catch(() => {});
  return { version, previous };
}

export async function updateEngine({ home, origin, target, manifest: manifestPath = '/renderer/engine/manifest.json', configFile, log = () => {}, npm, maxBytes = MAX_PACKAGE_BYTES, timeoutMs = 15000, downloadTimeoutMs = 10 * 60 * 1000 }) {
  home = path.resolve(home);
  const editor = trustedOrigin(origin);
  const manifest = await fetchManifest(editor, manifestPath, timeoutMs);
  if (target && manifest.version !== target) throw new Error('The editor is publishing a different engine. Try again in a moment.');
  if (manifest.node !== process.version) throw new Error(NODE_MISMATCH);
  const current = await readCurrent(home);
  if (current?.version === manifest.version) return { version: manifest.version, previous: current.previous, unchanged: true };
  const engines = path.join(home, 'engines');
  const staging = path.join(engines, `${manifest.version}.staging`), archive = path.join(engines, `${manifest.version}.download-${unique()}.zip`);
  await mkdir(engines, { recursive: true });
  await removeTree(staging);
  try {
    log(`Downloading engine ${manifest.version.slice(0, 12)}…`);
    await download(new URL(`/renderer/engine/${manifest.file}`, editor), archive, manifest, { maxBytes, timeoutMs: downloadTimeoutMs });
    await mkdir(staging);
    await extractEngine(archive, staging);
    await rm(archive, { force: true });
    await installDependencies(home, staging, { log, npm });
    if (await engineVersion(staging) !== manifest.version) throw new Error('The downloaded engine does not match the editor version.');
    const browserPath = await ensureBrowser(staging, { log });
    return await activate(home, staging, manifest.version, { configFile, browserPath });
  } catch (error) {
    await removeTree(staging).catch(() => {});
    throw error;
  } finally { await rm(archive, { force: true }).catch(() => {}); }
}

// Installer step: install the bundled engine, switch to it and retire the legacy
// single-directory layout. Connection data in .data is never touched.
export async function installLocal({ home, source, log = () => {}, npm }) {
  home = path.resolve(home); source = path.resolve(source);
  const engines = path.join(home, 'engines'), staging = path.join(engines, `local-${unique()}.staging`);
  await mkdir(engines, { recursive: true });
  try {
    await mkdir(staging);
    for (const name of ENGINE_ENTRIES) await cp(path.join(source, name), path.join(staging, name), { recursive: true });
    await installDependencies(home, staging, { log, npm });
    const version = await engineVersion(staging);
    const result = await activate(home, staging, version, {});
    if (await exists(path.join(source, 'launcher.mjs'))) {
      const temporary = path.join(home, `launcher.mjs.tmp-${unique()}`);
      await cp(path.join(source, 'launcher.mjs'), temporary);
      await rename(temporary, path.join(home, 'launcher.mjs'));
    }
    if (source !== home) for (const name of LEGACY_ENTRIES) {
      const legacy = path.join(home, name);
      if ((await lstat(legacy).catch(() => null))?.isSymbolicLink()) await removeLink(legacy);
      else await rm(legacy, { recursive: true, force: true });
    }
    return result;
  } catch (error) {
    await removeTree(staging).catch(() => {});
    throw error;
  }
}

// Node resolves the entry script's real path (e.g. /private/var on Mac), so compare real paths.
const entry = process.argv[1] ? (() => { try { return realpathSync(process.argv[1]); } catch { return null; } })() : null;
if (entry && entry === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const option = key => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
  if (!args.includes('--install-local') || !option('--install-local')) throw new Error('Usage: renderer-update.mjs --install-local <package folder> --home <renderer folder>');
  const home = option('--home') || process.env.FLOC_RENDERER_HOME;
  if (!home) throw new Error('Pass --home <renderer folder>.');
  const { version } = await installLocal({ home, source: option('--install-local'), log: message => message && console.log(message) });
  console.log(`Engine installed: ${version.slice(0, 12)}`);
}
