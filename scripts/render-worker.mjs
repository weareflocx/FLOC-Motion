import { mkdir, readFile, rename, rm, copyFile, open, appendFile, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureRenderer, trustedOrigin } from './renderer-runtime.mjs';
import { rendererVersion } from '../server/renderer-version.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(process.argv[2] || path.join(root, '.data/render-worker/config.json'), 'utf8'));
const origin = trustedOrigin(config.origin);
if (typeof config.token !== 'string' || config.token.length < 32) throw new Error('A renderer token is required.');
process.env.FLOC_DATA_DIR = path.join(root, '.data/render-worker/data');
await configureRenderer(config);
const version = await rendererVersion();
const personal = config.token.includes('.');
const { startExport } = await import('../server/export.mjs');
const { validateProject } = await import('../src/project.js');
await mkdir(path.join(process.env.FLOC_DATA_DIR, 'assets'), { recursive: true });
const lock = path.join(root, '.data/render-worker/worker.pid');
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
  const filename = path.join(root, '.data/render-worker/worker.log');
  try { if ((await stat(filename).catch(() => ({ size: 0 }))).size > 1e6) await rename(filename, `${filename}.previous`); await appendFile(filename, `${new Date().toISOString()} ${message}\n`); } catch {}
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(route, body, stream = false) {
  const response = await fetch(new URL(route, origin), { method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': stream ? 'video/mp4' : 'application/json' }, body: stream ? body : JSON.stringify(body), ...(stream ? { duplex: 'half' } : {}), signal: AbortSignal.timeout(stream ? 120000 : 15000), redirect: 'error' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Editor returned ${response.status}.`);
  return result;
}
async function downloadAssets(project) {
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
    const response = await fetch(new URL(src, origin), { headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(120000), redirect: 'error' });
    if (!response.ok) throw new Error(`Could not download project asset (${response.status}).`);
    let size = 0;
    try {
      await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, encoding, callback) { size += chunk.length; callback(size > 75e6 ? new Error('Project asset exceeds 75 MB.') : null, chunk); } }), createWriteStream(temp));
      await rename(temp, dest);
    } finally { await rm(temp, { force: true }); }
  }
}
let connected = false;
while (!stopping) {
  try {
    const input = await request('/api/render-worker/claim', personal ? { version } : {});
    if (!connected) { await log(`Renderer connected to ${origin.origin}`); connected = true; }
    if (input) {
      const route = `/api/render-worker/${input.id}`;
      let heartbeat;
      try {
        const project = validateProject(input.project);
        // Keep the lease alive during downloads, extraction, rendering and upload.
        let localJob, updating = false;
        heartbeat = setInterval(async () => {
          if (updating) return; updating = true;
          try { await request(`${route}/progress`, { progress: localJob?.progress || 0, message: localJob?.message || 'Downloading assets on your computer' }); }
          catch (error) { console.error(error.message); }
          finally { updating = false; }
        }, 5000);
        await downloadAssets(project);
        localJob = await startExport(project, input.settings);
        while (!['done', 'failed'].includes(localJob.state)) await sleep(1000);
        await copyFile(path.join(process.env.FLOC_DATA_DIR, 'renders', localJob.id, 'render.log'), path.join(process.env.FLOC_DATA_DIR, 'last-render.log')).catch(error => console.error(`Could not retain render diagnostics: ${error.message}`));
        if (localJob.state === 'failed') throw new Error(localJob.message);
        const filename = path.join(process.env.FLOC_DATA_DIR, 'renders', localJob.id, 'video.mp4');
        let uploaded = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt) {
            const status = await fetch(new URL(`/api/exports/${input.id}`, origin), { headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(15000), redirect: 'error' });
            if (status.ok && (await status.json()).state === 'done') { uploaded = true; break; }
          }
          try { await request(`${route}/result`, createReadStream(filename), true); uploaded = true; break; }
          catch (error) { if (attempt === 2) throw error; await sleep(3000); }
        }
        if (uploaded) {
          await log(`Export completed: ${input.id}`);
          await rm(path.dirname(filename), { recursive: true, force: true });
        }
      } catch (error) {
        await log(`Export failed: ${error.message}`);
        await request(`${route}/progress`, { state: 'failed', message: error.message }).catch(() => {});
      } finally { clearInterval(heartbeat); }
    }
  } catch (error) { connected = false; await log(error.message); }
  await sleep(5000);
}
