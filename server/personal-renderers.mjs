import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { validateProject } from '../src/project.js';
import { validateExportSettings, exportDimensions } from '../src/export-settings.js';
import { verifyExport } from './export.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const error = (message, status = 409) => Object.assign(new Error(message), { status });
const cookieName = 'floc_renderer';
export function rendererCookie(key, secure) {
  return `${cookieName}=${key}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${secure ? '; Secure' : ''}`;
}
export function browserRendererKey(cookie = '') {
  return cookie.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
}

export function createPersonalRenderers({ data, jobs, version, now = Date.now }) {
  const devices = new Map(), codes = new Map();
  const directory = path.join(data, 'renderers');
  const folder = id => path.join(data, 'renders', id);
  const persistJob = job => writeFile(path.join(folder(job.id), 'job.json'), JSON.stringify(job));
  async function persistDevice(device) {
    await mkdir(directory, { recursive: true });
    const filename = path.join(directory, `${device.id}.json`);
    await writeFile(`${filename}.tmp`, JSON.stringify({ id: device.id, name: device.name, browserHash: device.browserHash, engineHash: device.engineHash }), { mode: 0o600 });
    await rename(`${filename}.tmp`, filename);
  }
  async function authenticate(key, kind) {
    const match = typeof key === 'string' && key.match(/^([a-f0-9-]{36})\.([a-f0-9]{64})$/);
    if (!match) return null;
    let device = devices.get(match[1]);
    if (!device) {
      try { device = { ...JSON.parse(await readFile(path.join(directory, `${match[1]}.json`))), seen: 0, active: null }; devices.set(device.id, device); }
      catch (cause) { if (cause.code === 'ENOENT') return null; throw cause; }
    }
    const expected = device[`${kind}Hash`];
    return expected && timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(digest(match[2]), 'hex')) ? device : null;
  }
  async function expire(device) {
    for (const [code, entry] of codes) if (entry.device === device && now() > entry.expires) { codes.delete(code); device.connecting = false; }
    if (device.active && now() - device.seen > 90000) {
      const job = jobs.get(device.active.id);
      Object.assign(job, { state: 'failed', message: 'Your renderer disconnected. Open it and export again.' });
      device.active = null;
      await persistJob(job);
    }
  }
  return {
    version,
    browser: cookie => authenticate(browserRendererKey(cookie), 'browser'),
    engine: header => authenticate(header?.startsWith('Bearer ') ? header.slice(7) : '', 'engine'),
    async startPairing(cookie) {
      const current = await authenticate(browserRendererKey(cookie), 'browser');
      if (current) { await expire(current); if (current.active) throw error('Wait for your export to finish before connecting another renderer.'); }
      for (const [code, entry] of codes) if (now() > entry.expires || entry.device === current) { codes.delete(code); entry.device.connecting = false; if (!entry.device.engineHash && entry.device !== current) devices.delete(entry.device.id); }
      if (codes.size >= 64) throw error('Too many connection requests. Try again shortly.', 429);
      const secret = randomBytes(32).toString('hex');
      const device = current || { id: randomUUID(), browserHash: digest(secret), seen: 0, active: null };
      device.connecting = true;
      const code = randomBytes(5).toString('hex').toUpperCase();
      const expires = now() + 600000;
      codes.set(code, { device, expires }); devices.set(device.id, device);
      return { key: current ? browserRendererKey(cookie) : `${device.id}.${secret}`, code: `${code.slice(0, 5)}-${code.slice(5)}`, expiresAt: expires };
    },
    async finishPairing(input) {
      const code = String(input.code || '').replace(/[-\s]/g, '').toUpperCase();
      const entry = codes.get(code);
      if (!entry || now() > entry.expires) throw error('This connection code is invalid or expired. Get a new code in Export.', 400);
      if (input.version !== version) throw error('Update the renderer to match this editor before connecting.');
      codes.delete(code);
      const secret = randomBytes(32).toString('hex');
      const device = entry.device;
      const previousHash = device.engineHash;
      device.engineHash = digest(secret); device.name = String(input.name || 'This computer').slice(0, 80); device.version = input.version;
      try { await persistDevice(device); }
      catch (cause) { device.engineHash = previousHash; codes.set(code, entry); throw cause; }
      device.connecting = false;
      return { token: `${device.id}.${secret}` };
    },
    async status(device) {
      if (!device) return { paired: false, online: false };
      await expire(device);
      return { paired: Boolean(device.engineHash), connecting: Boolean(device.connecting), online: Boolean(device.seen && now() - device.seen <= 15000), compatible: device.version === version, name: device.name || 'This computer', busy: Boolean(device.active) };
    },
    async enqueue(device, input, options) {
      await expire(device);
      if (device.connecting) throw error('Finish connecting your renderer before exporting.');
      if (!device.seen || now() - device.seen > 15000) throw error('Your renderer is offline. Open FLOC Motion Renderer on this computer.', 503);
      if (device.version !== version) throw error('Update your renderer before exporting.', 409);
      if (device.active) throw error('Your renderer is already exporting. Wait until it finishes.');
      const project = validateProject(input), settings = validateExportSettings(options);
      if (!project.layers.some(l => l.visible && l.type !== 'music')) throw error('Add a visible visual layer before exporting.', 400);
      const [width, height] = exportDimensions(project.format, settings.resolution);
      const job = { id: randomUUID(), rendererId: device.id, state: 'queued', progress: 0, message: 'Waiting for your renderer', name: project.name, ...settings, width, height, fps: project.fps, createdAt: new Date(now()).toISOString() };
      device.active = { id: job.id, project, settings }; jobs.set(job.id, job);
      try { await mkdir(folder(job.id), { recursive: true }); await persistJob(job); }
      catch (cause) { device.active = null; jobs.delete(job.id); throw cause; }
      return job;
    },
    async claim(device, input) {
      await expire(device);
      device.seen = now(); device.version = input.version;
      if (device.connecting) throw error('Finish connecting the renderer in the installer.');
      if (device.version !== version) throw error('Update your renderer to match the editor.');
      if (!device.active) return null;
      const job = jobs.get(device.active.id);
      if (job.state !== 'queued') return null;
      Object.assign(job, { state: 'rendering', message: 'Preparing assets on your computer' });
      await persistJob(job);
      return { ...device.active };
    },
    async update(device, id, input) {
      await expire(device);
      if (device.active?.id !== id || jobs.get(id)?.state !== 'rendering') throw error('This export is no longer assigned to your renderer.');
      device.seen = now();
      const job = jobs.get(id);
      if (input.state === 'failed') {
        Object.assign(job, { state: 'failed', message: String(input.message || 'Local rendering failed.').slice(-2500) }); device.active = null;
      } else {
        if (typeof input.message === 'string') job.message = input.message.slice(0, 2500);
        if (Number.isFinite(input.progress)) job.progress = Math.max(0, Math.min(99, input.progress));
      }
      await persistJob(job); return job;
    },
    async complete(device, id, stream) {
      await expire(device);
      const lease = device.active;
      if (lease?.id !== id || jobs.get(id)?.state !== 'rendering') throw error('This export is no longer assigned to your renderer.');
      device.seen = now();
      const temp = path.join(folder(id), 'upload.mp4'); let size = 0, created = false;
      try {
        const output = createWriteStream(temp, { flags: 'wx' });
        output.on('open', () => { created = true; });
        await pipeline(stream, new Transform({ transform(chunk, encoding, callback) { size += chunk.length; callback(size > 512e6 ? error('Export exceeds 512 MB.', 413) : null, chunk); } }), output);
        const result = await verifyExport(lease.project, temp, lease.settings);
        if (device.active !== lease) throw error('This export is no longer assigned to your renderer.');
        await rename(temp, path.join(folder(id), 'video.mp4'));
        const job = jobs.get(id);
        Object.assign(job, { state: 'done', progress: 100, message: 'MP4 ready', url: `/exports/${id}/video.mp4`, duration: result.duration });
        await persistJob(job); device.active = null; return job;
      } catch (cause) { if (created) await rm(temp, { force: true }); throw cause; }
    },
    async job(device, id) {
      if (device) await expire(device);
      let job = jobs.get(id);
      if (!job) {
        try { job = JSON.parse(await readFile(path.join(folder(id), 'job.json'))); }
        catch (cause) { if (cause.code === 'ENOENT') return null; throw cause; }
        if (job.rendererId && !['done', 'failed'].includes(job.state)) {
          Object.assign(job, { state: 'failed', message: 'The editor restarted during export. Export again.' }); await persistJob(job);
        }
      }
      if (job?.rendererId && job.rendererId !== device?.id) throw error('Export not found.', 404);
      return job;
    }
  };
}
