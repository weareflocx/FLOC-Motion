import { randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { validateProject } from '../src/project.js';
import { validateExportSettings, exportDimensions } from '../src/export-settings.js';
import { verifyExport } from './export.mjs';
import { writeJsonAtomic } from './json-store.mjs';

// One trusted Mac pulls jobs outbound. No incoming connection to the Mac is needed.
export function createRenderWorker({ data, jobs, token, now = Date.now }) {
  let seen = 0, active = null;
  const pending = new Map();
  const folder = id => path.join(data, 'renders', id);
  const persist = job => writeJsonAtomic(path.join(folder(job.id), 'job.json'), job);
  const failure = (message, status = 409) => Object.assign(new Error(message), { status });
  async function expire() {
    if (pending.size && now() - seen > 90000) {
      for (const id of pending.keys()) {
        const job = jobs.get(id);
        Object.assign(job, { state: 'failed', message: 'The Mac disconnected. Reconnect it and export again.' });
        await persist(job);
      }
      pending.clear(); active = null;
    }
  }
  return {
    enabled: Boolean(token),
    authorize(header) {
      const expected = Buffer.from(`Bearer ${token}`), received = Buffer.from(header || '');
      return Boolean(token) && received.length === expected.length && timingSafeEqual(received, expected);
    },
    async enqueue(input, options) {
      await expire();
      if (!seen || now() - seen > 15000) throw failure('The render Mac is offline. Open FLOC Motion on the Mac and reconnect its renderer.', 503);
      if (pending.size) throw failure('Another export is running. Wait until it finishes.');
      const project = validateProject(input), settings = validateExportSettings(options);
      if (!project.layers.some(layer => layer.visible && layer.type !== 'music')) throw failure('Add a visible visual layer before exporting.', 400);
      const [width, height] = exportDimensions(project.format, settings.resolution);
      const job = { id: randomUUID(), state: 'queued', progress: 0, message: 'Waiting for the Mac', name: project.name, ...settings, width, height, fps: project.fps, createdAt: new Date(now()).toISOString() };
      jobs.set(job.id, job); pending.set(job.id, { project, settings });
      try { await mkdir(folder(job.id), { recursive: true }); await persist(job); return job; }
      catch (error) { jobs.delete(job.id); pending.delete(job.id); throw error; }
    },
    async claim() {
      await expire(); seen = now();
      if (active) return null;
      const entry = pending.entries().next().value;
      if (!entry) return null;
      const [id, input] = entry; active = id;
      const job = jobs.get(id); Object.assign(job, { state: 'rendering', message: 'Preparing assets on the Mac' }); await persist(job);
      return { id, ...input };
    },
    async update(id, input) {
      await expire();
      if (active !== id) throw failure('This export is no longer assigned to the Mac.');
      seen = now(); const job = jobs.get(id);
      if (input.state === 'failed') {
        Object.assign(job, { state: 'failed', message: String(input.message || 'Local rendering failed.').slice(-2500) });
        pending.delete(id); active = null;
      } else {
        if (typeof input.message === 'string') job.message = input.message.slice(0, 2500);
        if (Number.isFinite(input.progress)) job.progress = Math.max(0, Math.min(99, input.progress));
      }
      await persist(job); return job;
    },
    async complete(id, stream) {
      await expire();
      if (active !== id) throw failure('This export is no longer assigned to the Mac.');
      seen = now(); const temp = path.join(folder(id), 'upload.mp4'); let size = 0;
      try {
        await pipeline(stream, new Transform({ transform(chunk, encoding, callback) {
          size += chunk.length;
          callback(size > 512e6 ? failure('Export exceeds the 512 MB upload limit.', 413) : null, chunk);
        } }), createWriteStream(temp, { flags: 'wx' }));
        const input = pending.get(id);
        const result = await verifyExport(input.project, temp, input.settings);
        const job = jobs.get(id);
        // A disconnected or expired job must never be completed by a stale upload.
        if (active !== id) throw failure('This export is no longer assigned to the Mac.');
        await rename(temp, path.join(folder(id), 'video.mp4'));
        Object.assign(job, { state: 'done', progress: 100, message: 'MP4 ready', url: `/exports/${id}/video.mp4`, duration: result.duration });
        await persist(job); pending.delete(id); active = null; return job;
      } catch (error) { await rm(temp, { force: true }); throw error; }
    },
    async status(id) { await expire(); return jobs.get(id); }
  };
}
