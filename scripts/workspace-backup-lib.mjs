import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, rename, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const FORMAT = 'floc-motion-workspace-backup';
const VERSION = 1;
const MANIFEST = 'manifest.json';
const CONTENT = 'files';
const MAX_MANIFEST_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 100_000;
const FULL_DIRECTORIES = new Set(['access', 'assets', 'drafts', 'renderers', 'templates']);
const ROOT_FILES = new Set(['project.json', 'project-migration.json']);
const RENDER_FILES = new Set(['job.json', 'render-input.json', 'render.log']);
const TEMPORARY_NAME = /\.(?:tmp|upload)(?:-|$)/;

const fail = message => new Error(message);
const portablePath = value => value.split(path.sep).join('/');

function validateRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || value.includes('\0')) throw fail('Backup contains an invalid path.');
  if (path.posix.isAbsolute(value) || path.posix.normalize(value) !== value || value === '.' || value.startsWith('../')) throw fail(`Backup path escapes the workspace: ${value}`);
  return value;
}

function included(relative) {
  const parts = relative.split('/');
  if (parts.some(part => TEMPORARY_NAME.test(part))) return false;
  if (parts.length === 1) return ROOT_FILES.has(relative);
  if (FULL_DIRECTORIES.has(parts[0])) return true;
  return parts[0] === 'renders' && parts.length === 3 && RENDER_FILES.has(parts[2]);
}

async function walk(directory, relative = '') {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const output = [];
  for (const entry of entries) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const child = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw fail(`Workspace backups do not follow symbolic links: ${childRelative}`);
    if (entry.isDirectory()) output.push(...await walk(child, childRelative));
    else if (entry.isFile()) output.push(childRelative);
    else if (included(childRelative)) throw fail(`Workspace backup cannot copy special file: ${childRelative}`);
  }
  return output;
}
async function collectSourcePaths(source) {
  const output = [];
  for (const name of [...ROOT_FILES].sort()) {
    try {
      const metadata = await lstat(path.join(source, name));
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw fail(`Workspace backup cannot copy special file: ${name}`);
      output.push(name);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const name of [...FULL_DIRECTORIES].sort()) {
    const directory = path.join(source, name);
    try {
      const metadata = await lstat(directory);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw fail(`Workspace backup cannot read special directory: ${name}`);
      for (const relative of await walk(directory)) {
        const candidate = `${name}/${portablePath(relative)}`;
        if (included(candidate)) output.push(candidate);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const renders = path.join(source, 'renders');
  try {
    const metadata = await lstat(renders);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw fail('Workspace backup cannot read special directory: renders');
    const jobs = await readdir(renders, { withFileTypes: true });
    for (const job of jobs.sort((a, b) => a.name.localeCompare(b.name))) {
      if (job.isSymbolicLink()) throw fail(`Workspace backups do not follow symbolic links: renders/${job.name}`);
      if (!job.isDirectory()) continue;
      for (const name of [...RENDER_FILES].sort()) {
        const relative = `renders/${job.name}/${name}`;
        try {
          const file = await lstat(path.join(source, ...relative.split('/')));
          if (!file.isFile() || file.isSymbolicLink()) throw fail(`Workspace backup cannot copy special file: ${relative}`);
          output.push(relative);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return output.sort((a, b) => a.localeCompare(b));
}
async function copyWithHash(source, destination) {
  const digest = createHash('sha256');
  let size = 0;
  const measure = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      digest.update(chunk);
      callback(null, chunk);
    },
  });
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await pipeline(createReadStream(source), measure, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  return { size, sha256: digest.digest('hex') };
}

async function hashFile(filename) {
  const digest = createHash('sha256');
  let size = 0;
  const input = createReadStream(filename);
  for await (const chunk of input) {
    size += chunk.length;
    digest.update(chunk);
  }
  return { size, sha256: digest.digest('hex') };
}

async function readManifest(backupDirectory) {
  const filename = path.join(backupDirectory, MANIFEST);
  const metadata = await lstat(filename);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_MANIFEST_BYTES) throw fail('Backup manifest is not a bounded regular file.');
  let manifest;
  try { manifest = JSON.parse(await readFile(filename, 'utf8')); }
  catch { throw fail('Backup manifest is not valid JSON.'); }
  if (manifest?.format !== FORMAT || manifest?.version !== VERSION || !Array.isArray(manifest.files)) throw fail('Backup manifest format is unsupported.');
  if (manifest.files.length > MAX_FILES) throw fail('Backup manifest contains too many files.');
  const seen = new Set();
  let previous = '';
  for (const file of manifest.files) {
    validateRelativePath(file?.path);
    if (!included(file.path)) throw fail(`Backup contains an unsupported workspace file: ${file.path}`);
    if (seen.has(file.path) || (previous && previous.localeCompare(file.path) >= 0)) throw fail('Backup manifest paths must be unique and sorted.');
    if (!Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw fail(`Backup manifest metadata is invalid: ${file.path}`);
    seen.add(file.path);
    previous = file.path;
  }
  return manifest;
}

async function listBackupPayload(backupDirectory) {
  const root = path.join(backupDirectory, CONTENT);
  const paths = await walk(root);
  return paths.sort((a, b) => a.localeCompare(b));
}

export async function createWorkspaceBackup(sourceDirectory, backupDirectory, options = {}) {
  const source = path.resolve(sourceDirectory);
  const destination = path.resolve(backupDirectory);
  if (destination === source || destination.startsWith(`${source}${path.sep}`)) throw fail('Backup destination must be outside the workspace.');
  try { await lstat(destination); throw fail('Backup destination already exists.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const staging = `${destination}.tmp-${randomUUID()}`;
  await mkdir(path.join(staging, CONTENT), { recursive: true, mode: 0o700 });
  try {
    const candidates = await collectSourcePaths(source);
    if (candidates.length > MAX_FILES) throw fail('Workspace contains too many backup files.');
    const files = [];
    for (const relative of candidates) {
      const metadata = await copyWithHash(path.join(source, relative), path.join(staging, CONTENT, relative));
      files.push({ path: relative, ...metadata });
    }
    const manifest = { format: FORMAT, version: VERSION, createdAt: new Date(options.now?.() ?? Date.now()).toISOString(), files };
    await open(path.join(staging, MANIFEST), 'wx', 0o600).then(async handle => {
      try { await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`); }
      finally { await handle.close(); }
    });
    await rename(staging, destination);
    return manifest;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyWorkspaceBackup(backupDirectory) {
  const backup = path.resolve(backupDirectory);
  const manifest = await readManifest(backup);
  const actualPaths = await listBackupPayload(backup);
  const expectedPaths = manifest.files.map(file => file.path);
  if (actualPaths.length !== expectedPaths.length || actualPaths.some((value, index) => value !== expectedPaths[index])) throw fail('Backup payload does not match its manifest.');
  let bytes = 0;
  for (const file of manifest.files) {
    const filename = path.join(backup, CONTENT, ...file.path.split('/'));
    const metadata = await lstat(filename);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw fail(`Backup payload is not a regular file: ${file.path}`);
    const digest = await hashFile(filename);
    if (digest.size !== file.size || digest.sha256 !== file.sha256) throw fail(`Backup file failed integrity verification: ${file.path}`);
    bytes += digest.size;
  }
  return { manifest, files: manifest.files.length, bytes };
}

async function targetState(target) {
  try {
    const metadata = await lstat(target);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw fail('Restore target must be an empty directory or not exist.');
    const entries = await readdir(target);
    if (entries.length) throw fail('Restore target must be empty.');
    return 'empty';
  } catch (error) {
    if (error.code === 'ENOENT') return 'missing';
    throw error;
  }
}

export async function restoreWorkspaceBackup(backupDirectory, targetDirectory) {
  const backup = path.resolve(backupDirectory);
  const target = path.resolve(targetDirectory);
  if (target === backup || target.startsWith(`${backup}${path.sep}`)) throw fail('Restore target must be outside the backup.');
  const state = await targetState(target);
  const { manifest } = await verifyWorkspaceBackup(backup);
  const staging = `${target}.restore-${randomUUID()}`;
  await mkdir(staging, { recursive: false, mode: 0o700 });
  try {
    for (const file of manifest.files) {
      const metadata = await copyWithHash(path.join(backup, CONTENT, ...file.path.split('/')), path.join(staging, ...file.path.split('/')));
      if (metadata.size !== file.size || metadata.sha256 !== file.sha256) throw fail(`Backup changed during restore: ${file.path}`);
    }
    if (state === 'empty') await rmdir(target);
    await rename(staging, target);
    return manifest;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (state === 'empty') await mkdir(target, { recursive: true, mode: 0o700 });
    throw error;
  }
}
