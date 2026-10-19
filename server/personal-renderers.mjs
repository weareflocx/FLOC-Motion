import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { validateProject } from '../src/project.js';
import { validateFontFaces } from '../src/fonts.js';
import { validateExportSettings, exportDimensions, exportFormat } from '../src/export-settings.js';
import { readJson, writeJsonAtomic } from './json-store.mjs';
import { database } from './database.mjs';
import { createAuditLog } from './audit-log.mjs';
import { reportExportEnded } from './export.mjs';
import { isTerminalJobState, CANCELLED_MESSAGE } from '../src/export-jobs.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const error = (message, status = 409) => Object.assign(new Error(message), { status });
const cookieName = 'floc_renderer';
export function rendererCookie(key, secure) {
  return `${cookieName}=${key}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${secure ? '; Secure' : ''}`;
}
export function browserRendererKey(cookie = '') {
  return cookie.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
}
// Each renderer renders one export at a time (`device.active`, the claimed lease) and keeps
// later exports in a FIFO queue; claims hand them out in order.
export const RENDERER_QUEUE_LIMIT = 50;
// Installed renderers fetch this manifest to update their engine without pairing again.
export const ENGINE_MANIFEST = '/renderer/engine/manifest.json';
const ENGINE_STATES = ['ready', 'updating', 'failed'];
function engineReport(input) {
  if (!input || typeof input !== 'object' || !ENGINE_STATES.includes(input.state)) throw error('Invalid engine state.', 400);
  return { state: input.state, message: typeof input.message === 'string' ? input.message.slice(0, 500) : '', target: typeof input.target === 'string' ? input.target.slice(0, 128) : '' };
}
const updateFailure = device => `Your renderer could not update: ${(device.engine.message || 'the update failed').replace(/[\s.]+$/, '')}. Use Update now or reinstall.`;

export function createPersonalRenderers({ data, jobs, version, now = Date.now }) {
  const devices = new Map(), codes = new Map();
  const db = database(data), audit = createAuditLog(data, { now });
  const folder = id => path.join(data, 'renders', id);
  const persistJob = async job => { await writeJsonAtomic(path.join(folder(job.id), 'job.json'), job); reportExportEnded(job); };
  async function persistDevice(device) {
    db.prepare('INSERT INTO renderer_devices (id, name, browser_hash, engine_hash) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, browser_hash = excluded.browser_hash, engine_hash = excluded.engine_hash').run(device.id, device.name ?? null, device.browserHash, device.engineHash ?? null);
  }
  async function authenticate(key, kind) {
    const match = typeof key === 'string' && key.match(/^([a-f0-9-]{36})\.([a-f0-9]{64})$/);
    if (!match) return null;
    let device = devices.get(match[1]);
    if (!device) {
      const saved = db.prepare('SELECT id, name, browser_hash, engine_hash FROM renderer_devices WHERE id = ?').get(match[1]);
      if (!saved) return null;
      device = { id: saved.id, name: saved.name ?? undefined, browserHash: saved.browser_hash, engineHash: saved.engine_hash ?? undefined, seen: 0, active: null, queue: [] };
      devices.set(device.id, device);
    }
    const expected = device[`${kind}Hash`];
    return expected && timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(digest(match[2]), 'hex')) ? device : null;
  }
  async function expire(device) {
    for (const [code, entry] of codes) if (entry.device === device && now() > entry.expires) { codes.delete(code); device.connecting = false; }
    // A renderer that stops checking in loses its current export and everything queued behind it.
    if ((device.active || device.queue.length) && now() - device.seen > 90000) {
      const lost = [...(device.active ? [device.active] : []), ...device.queue];
      device.active = null; device.queue = [];
      for (const { id } of lost) {
        const job = jobs.get(id);
        Object.assign(job, { state: 'failed', message: 'Your renderer disconnected. Open it and export again.' });
        await persistJob(job);
      }
    }
  }
  return {
    version,
    browser: cookie => authenticate(browserRendererKey(cookie), 'browser'),
    engine: header => authenticate(header?.startsWith('Bearer ') ? header.slice(7) : '', 'engine'),
    async startPairing(cookie, userId = null) {
      const current = await authenticate(browserRendererKey(cookie), 'browser');
      if (current) { await expire(current); if (current.active || current.queue.length) throw error('Wait for your exports to finish before connecting another renderer.'); }
      for (const [code, entry] of codes) if (now() > entry.expires || entry.device === current) { codes.delete(code); entry.device.connecting = false; if (!entry.device.engineHash && entry.device !== current) devices.delete(entry.device.id); }
      if (codes.size >= 64) throw error('Too many connection requests. Try again shortly.', 429);
      const secret = randomBytes(32).toString('hex');
      const device = current || { id: randomUUID(), browserHash: digest(secret), seen: 0, active: null, queue: [] };
      device.connecting = true;
      const code = randomBytes(5).toString('hex').toUpperCase();
      const expires = now() + 600000;
      codes.set(code, { device, expires, userId }); devices.set(device.id, device);
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
      audit.record({ actorId: entry.userId, action: 'renderer.paired', target: { type: 'renderer', id: device.id }, details: { name: device.name } });
      return { token: `${device.id}.${secret}` };
    },
    async status(device) {
      if (!device) return { paired: false, online: false, updater: false, engine: null, updateRequested: false };
      await expire(device);
      return { paired: Boolean(device.engineHash), connecting: Boolean(device.connecting), online: Boolean(device.seen && now() - device.seen <= 15000), compatible: device.version === version, name: device.name || 'This computer', busy: Boolean(device.active || device.queue.length), queued: device.queue.length, updater: Boolean(device.updater), engine: device.engine ?? null, updateRequested: Boolean(device.updateRequested) };
    },
    // The editor asks; the renderer learns it on its next check-in and updates once it is idle.
    async requestUpdate(device) {
      if (!device) throw error('Connect this computer’s renderer first.', 404);
      if (!device.engineHash) throw error('Finish connecting your renderer first.');
      if (!device.updater) throw error('Install the latest renderer once to enable updates.');
      device.updateRequested = true;
      return this.status(device);
    },
    identity: device => ({ id: device.id, name: device.name || 'This computer' }),
    // `fonts` are the workspace font faces the project needs; the renderer downloads them with its token.
    async enqueue(device, input, options, fonts = []) {
      await expire(device);
      if (device.connecting) throw error('Finish connecting your renderer before exporting.');
      if (!device.seen || now() - device.seen > 15000) throw error('Your renderer is offline. Open FLOC Motion Renderer on this computer.', 503);
      // An updating renderer takes the export once it runs the editor's engine.
      const outdated = device.version !== version;
      if (outdated && !device.updater) throw error('Update your renderer before exporting.', 409);
      if (outdated && device.engine?.state === 'failed') throw error(updateFailure(device), 409);
      if (device.queue.length >= RENDERER_QUEUE_LIMIT) throw error(`Up to ${RENDERER_QUEUE_LIMIT} exports can wait for your renderer. Wait for some to finish.`, 429);
      const project = validateProject(input), settings = validateExportSettings(options), faces = validateFontFaces(fonts);
      if (!project.layers.some(l => l.visible && l.type !== 'music')) throw error('Add a visible visual layer before exporting.', 400);
      const [width, height] = exportDimensions(project.format, settings.resolution);
      const job = { id: randomUUID(), rendererId: device.id, state: 'queued', progress: 0, message: outdated ? 'Waiting for your renderer to update' : 'Waiting for your renderer', name: project.name, ...settings, width, height, fps: project.fps, createdAt: new Date(now()).toISOString() };
      const entry = { id: job.id, project, settings, fonts: faces };
      device.queue.push(entry); jobs.set(job.id, job);
      try { await mkdir(folder(job.id), { recursive: true }); await persistJob(job); }
      catch (cause) { device.queue = device.queue.filter(item => item !== entry); jobs.delete(job.id); throw cause; }
      return job;
    },
    async claim(device, input) {
      await expire(device);
      device.seen = now(); device.version = input.version;
      if (device.connecting) throw error('Finish connecting the renderer in the installer.');
      // Renderers without the updater (installed before it existed) keep the original contract.
      const updater = input.updater === 1, engine = updater ? engineReport(input.engine) : null;
      device.updater = updater; device.engine = engine;
      if (!updater && device.version !== version) throw error('Update your renderer to match the editor.');
      if (updater && device.version !== version && engine.state === 'failed') {
        const failed = device.queue; device.queue = [];
        for (const { id } of failed) {
          const job = jobs.get(id);
          Object.assign(job, { state: 'failed', message: updateFailure(device) });
          await persistJob(job);
        }
      }
      if (updater && (device.version !== version || device.updateRequested)) {
        // `requested` marks an Update now press, so a renderer that failed can retry right away.
        const requested = Boolean(device.updateRequested);
        device.updateRequested = false;
        return { update: { version, manifest: ENGINE_MANIFEST, requested } };
      }
      // One export at a time: while a claimed export is unfinished, the next one waits.
      if (device.active || !device.queue.length || engine?.state === 'updating') return null;
      const lease = device.queue.shift(), job = jobs.get(lease.id);
      device.active = lease;
      Object.assign(job, { state: 'rendering', message: 'Preparing assets on your computer' });
      await persistJob(job);
      return { ...lease };
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
    // The renderer verifies and keeps the export on its own computer; the editor stores only the outcome.
    async complete(device, id, input) {
      await expire(device);
      const lease = device.active;
      if (lease?.id !== id || jobs.get(id)?.state !== 'rendering') throw error('This export is no longer assigned to your renderer.');
      const file = typeof input?.file === 'string' ? input.file.trim() : '';
      const duration = Number(input?.duration);
      // The saved file must carry the extension of the format this job asked for.
      const matchesFormat = file.toLowerCase().endsWith(`.${exportFormat(lease.settings.format).extension}`);
      if (!file || file.length > 500 || !matchesFormat || /[\u0000-\u001f]/.test(file) || !(duration > 0 && duration <= lease.project.duration + 1)) throw error('Invalid export result.', 400);
      device.seen = now();
      const job = jobs.get(id);
      Object.assign(job, { state: 'done', progress: 100, message: 'Saved on your computer', file, duration });
      await persistJob(job); device.active = null; return job;
    },
    async job(device, id) {
      if (device) await expire(device);
      let job = jobs.get(id);
      if (!job) {
        try { job = await readJson(path.join(folder(id), 'job.json')); }
        catch (cause) { if (cause.code === 'ENOENT') return null; throw cause; }
      }
      if (job?.rendererId && job.rendererId !== device?.id) throw error('Export not found.', 404);
      return job;
    },
    // Only the browser that owns the renderer may cancel; the renderer learns it on its next progress update.
    async cancel(device, id) {
      if (device) await expire(device);
      const job = jobs.get(id);
      if (!job?.rendererId || job.rendererId !== device?.id) throw error('Export not found.', 404);
      if (isTerminalJobState(job.state)) throw error('This export already ended and cannot be cancelled.');
      Object.assign(job, { state: 'cancelled', message: CANCELLED_MESSAGE });
      if (device.active?.id === id) device.active = null;
      else device.queue = device.queue.filter(item => item.id !== id);
      await persistJob(job); return job;
    }
  };
}
