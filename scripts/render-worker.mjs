import { mkdir, readFile, rename, rm, copyFile, open, appendFile, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureRenderer, trustedOrigin, saveRenderedVideo, rendererDataDirectory } from './renderer-runtime.mjs';
import { readCurrent, updateEngine, ROLLBACK_MESSAGE } from './renderer-update.mjs';
import { rendererVersion } from '../server/renderer-version.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Under the launcher, FLOC_RENDERER_HOME keeps connection, logs and job data outside the engine.
const home = process.env.FLOC_RENDERER_HOME ? path.resolve(process.env.FLOC_RENDERER_HOME) : null;
const dataDirectory = rendererDataDirectory(root);
const configFile = process.argv[2] || path.join(dataDirectory, 'config.json');
const config = JSON.parse(await readFile(configFile, 'utf8'));
const origin = trustedOrigin(config.origin);
if (typeof config.token !== 'string' || config.token.length < 32) throw new Error('A renderer token is required.');
process.env.FLOC_DATA_DIR = path.join(dataDirectory, 'data');
await configureRenderer(config);
const version = await rendererVersion();
const personal = config.token.includes('.');
const { startExport, cancelExport } = await import('../server/export.mjs');
const { isTerminalJobState } = await import('../src/export-jobs.js');
const { validateProject } = await import('../src/project.js');
const { exportFormat } = await import('../src/export-settings.js');
const { validateFontFaces, workspaceFontFile } = await import('../src/fonts.js');
await mkdir(path.join(process.env.FLOC_DATA_DIR, 'assets'), { recursive: true });
await mkdir(path.join(process.env.FLOC_DATA_DIR, 'fonts'), { recursive: true });
const lock = path.join(dataDirectory, 'worker.pid');
try { const pid = Number(await readFile(lock, 'utf8')); if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 0); throw new Error('The renderer is already running.'); } catch (cause) { if (cause.code !== 'ESRCH') throw cause; } } await rm(lock, { force: true }); }
catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
const handle = await open(lock, 'wx'); await handle.writeFile(String(process.pid)); await handle.close();
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (stopping) return; stopping = true;
  const { terminateProcesses } = await import('../server/process.mjs');
  terminateProcesses();
  await new Promise(resolve => setTimeout(resolve, 2000));
  await rm(lock, { force: true }); process.exit(0);
});
async function log(message) {
  console.log(message);
  const filename = path.join(dataDirectory, 'worker.log');
  try { if ((await stat(filename).catch(() => ({ size: 0 }))).size > 1e6) await rename(filename, `${filename}.previous`); await appendFile(filename, `${new Date().toISOString()} ${message}\n`); } catch {}
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(route, body, stream = false) {
  const response = await fetch(new URL(route, origin), { method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': stream ? 'video/mp4' : 'application/json' }, body: stream ? body : JSON.stringify(body), ...(stream ? { duplex: 'half' } : {}), signal: AbortSignal.timeout(stream ? 120000 : 15000), redirect: 'error' });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || `Editor returned ${response.status}.`), { status: response.status });
  return result;
}
// The editor answers 409 once a job is cancelled, expired or reassigned.
const revokedError = () => Object.assign(new Error('The export was cancelled in the editor.'), { revoked: true });
async function downloadAssets(project, signal) {
  const sources = new Set();
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.src === 'string' && value.src.startsWith('/assets/')) sources.add(value.src);
    for (const child of Object.values(value)) if (typeof child === 'object') walk(child);
  };
  walk(project);
  for (const src of sources) {
    if (!/^\/assets\/[a-f0-9-]{36}\.(?:png|jpe?g|webp|gif|avif|mp4|webm|mp3|wav|m4a|ogg|svg|glb)$/.test(src)) throw new Error('Invalid project asset.');
    const dest = path.join(process.env.FLOC_DATA_DIR, src.slice(1)), temp = `${dest}.download`;
    const response = await fetch(new URL(src, origin), { headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]), redirect: 'error' });
    if (!response.ok) throw new Error(`Could not download project asset (${response.status}).`);
    let size = 0;
    try {
      await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, encoding, callback) { size += chunk.length; callback(size > 75e6 ? new Error('Project asset exceeds 75 MB.') : null, chunk); } }), createWriteStream(temp));
      await rename(temp, dest);
    } finally { await rm(temp, { force: true }); }
  }
}
// Workspace fonts use the same token as assets. A face deleted after the export was queued
// answers 404 and is left out, so its text falls back to Geist as it does in the editor.
async function downloadFonts(input, signal) {
  const available = [];
  for (const face of validateFontFaces(input)) {
    const dest = path.join(process.env.FLOC_DATA_DIR, 'fonts', workspaceFontFile(face)), temp = `${dest}.download`;
    const response = await fetch(new URL(`/fonts/workspace/${workspaceFontFile(face)}`, origin), { headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]), redirect: 'error' });
    if (response.status === 404) { await log(`Workspace font ${face.family} ${face.weight} is no longer in the library; using Geist.`); continue; }
    if (!response.ok) throw new Error(`Could not download workspace font (${response.status}).`);
    let size = 0;
    try {
      await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, encoding, callback) { size += chunk.length; callback(size > 10 * 1024 * 1024 ? new Error('Workspace font exceeds 10 MB.') : null, chunk); } }), createWriteStream(temp));
      await rename(temp, dest);
    } finally { await rm(temp, { force: true }); }
    available.push(face);
  }
  return available;
}
// Personal renderers under the launcher update their engine when the editor asks. Claims
// continue during the update so the editor keeps the renderer online and queues exports.
// The launcher restarts into the new engine on exit 75, which only happens between jobs.
const RESTART_INTO_NEW_ENGINE = 75, RETRY_FAILED_UPDATE_MS = 10 * 60 * 1000;
const updater = Boolean(home) && personal;
let engine = { state: 'ready' }, failure = null, engineUpdating = false, restart = false;
if (updater) {
  const current = await readCurrent(home).catch(() => null);
  if (current?.failed) { engine = { state: 'failed', message: ROLLBACK_MESSAGE, target: current.failed }; failure = { at: Date.now(), rollback: true }; }
}
function startUpdate(update) {
  if (engineUpdating || restart || typeof update?.version !== 'string') return;
  if (update.version === version) { engine = { state: 'ready' }; failure = null; return; }
  // After a failure, retry when the user presses Update now, or periodically unless the
  // launcher had to restore the previous engine.
  if (failure && update.requested !== true && (failure.rollback || Date.now() - failure.at < RETRY_FAILED_UPDATE_MS)) return;
  engineUpdating = true;
  engine = { state: 'updating', target: update.version };
  log(`Updating engine to ${update.version.slice(0, 12)}`);
  updateEngine({ home, origin: origin.origin, target: update.version, manifest: update.manifest, configFile, log: message => message && log(message) })
    .then(() => { failure = null; restart = true; return log('Engine update installed; restarting.'); })
    .catch(error => {
      engine = { state: 'failed', message: error.message.slice(0, 500), target: update.version };
      failure = { at: Date.now() };
      return log(`Engine update failed: ${error.message}`);
    })
    .finally(() => { engineUpdating = false; });
}
let connected = false;
while (!stopping) {
  if (restart) { await rm(lock, { force: true }); process.exit(RESTART_INTO_NEW_ENGINE); }
  try {
    const input = await request('/api/render-worker/claim', personal ? { version, ...(updater ? { updater: 1, engine } : {}) } : {});
    if (!connected) { await log(`Renderer connected to ${origin.origin}`); connected = true; }
    if (input?.update) { if (updater) startUpdate(input.update); }
    // No update requested: the editor accepts this engine, so an earlier failure is moot.
    else if (engine.state === 'failed' && !engineUpdating) { engine = { state: 'ready' }; failure = null; }
    if (input && !input.update) {
      const route = `/api/render-worker/${input.id}`;
      const lease = new AbortController();
      let heartbeat, localJob;
      const revoke = () => {
        if (lease.signal.aborted) return;
        lease.abort(revokedError());
        // Terminate HyperFrames/FFmpeg for this job; its result is never saved or uploaded.
        if (localJob && !isTerminalJobState(localJob.state)) cancelExport(localJob.id).catch(error => console.error(error.message));
      };
      try {
        const project = validateProject(input.project);
        // Keep the lease alive during downloads, extraction, rendering and upload.
        let updating = false;
        heartbeat = setInterval(async () => {
          if (updating || lease.signal.aborted) return; updating = true;
          try { await request(`${route}/progress`, { progress: localJob?.progress || 0, message: localJob?.message || 'Downloading assets on your computer' }); }
          catch (error) { if (error.status === 409) revoke(); else console.error(error.message); }
          finally { updating = false; }
        }, 5000);
        await downloadAssets(project, lease.signal);
        const fonts = await downloadFonts(input.fonts, lease.signal);
        lease.signal.throwIfAborted();
        localJob = await startExport(project, input.settings, fonts);
        while (!isTerminalJobState(localJob.state)) await sleep(1000);
        await copyFile(path.join(process.env.FLOC_DATA_DIR, 'renders', localJob.id, 'render.log'), path.join(process.env.FLOC_DATA_DIR, 'last-render.log')).catch(error => console.error(`Could not retain render diagnostics: ${error.message}`));
        lease.signal.throwIfAborted();
        if (localJob.state === 'failed') throw new Error(localJob.message);
        const filename = path.join(process.env.FLOC_DATA_DIR, 'renders', localJob.id, exportFormat(localJob.format).file);
        let send, file;
        if (personal) {
          // Personal exports stay on this computer; the editor only learns where.
          const saved = await saveRenderedVideo(filename, project.name);
          const relative = path.relative(os.homedir(), saved);
          file = relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : saved;
          await log(`Saved export: ${saved}`);
          await rm(path.dirname(filename), { recursive: true, force: true });
          send = () => request(`${route}/result`, { file, duration: localJob.duration });
        } else send = () => request(`${route}/result`, createReadStream(filename), true);
        let delivered = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt) {
            const status = await fetch(new URL(`/api/exports/${input.id}`, origin), { headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(15000), redirect: 'error' });
            if (status.ok && (await status.json()).state === 'done') { delivered = true; break; }
          }
          try { await send(); delivered = true; break; }
          catch (error) {
            if (error.status === 409) throw file ? new Error(`The export was saved to ${file}, but it was cancelled in the editor.`) : revokedError();
            if (attempt < 2) { await sleep(3000); continue; }
            throw file ? new Error(`The export was saved to ${file}, but the editor could not be notified: ${error.message}`) : error;
          }
        }
        if (delivered) {
          await log(`Export completed: ${input.id}`);
          await rm(path.dirname(filename), { recursive: true, force: true });
        }
      } catch (error) {
        if (lease.signal.aborted || error.revoked) await log(`Export cancelled: ${input.id}`);
        else {
          await log(`Export failed: ${error.message}`);
          await request(`${route}/progress`, { state: 'failed', message: error.message }).catch(() => {});
        }
      } finally { clearInterval(heartbeat); }
    }
  } catch (error) { connected = false; await log(error.message); }
  await sleep(5000);
}
