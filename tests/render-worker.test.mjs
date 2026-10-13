import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable, PassThrough } from 'node:stream';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRenderWorker } from '../server/render-worker.mjs';
import { demoProject } from '../src/project.js';
import { run } from '../server/process.mjs';

test('Mac queue requires availability, assigns once, verifies MP4 and rejects stale completion', async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'floc-worker-'));
  let clock = 100000;
  const jobs = new Map(), token = 'a'.repeat(64);
  const worker = createRenderWorker({ data, jobs, token, now: () => clock });
  try {
    assert.equal(worker.authorize(), false);
    assert.equal(worker.authorize('Bearer wrong'), false);
    assert.equal(worker.authorize(`Bearer ${token}`), true);
    const project = demoProject(); project.duration = 1; project.fps = 24; for (const layer of project.layers) { layer.start = 0; layer.end = 1; layer.fadeIn = 0; layer.fadeOut = 0; }
    await assert.rejects(worker.enqueue(project, {}), /offline/);
    assert.equal(await worker.claim(), null);
    const job = await worker.enqueue(project, { resolution: '1080p' });
    await assert.rejects(worker.enqueue(project, {}), /Another export/);
    const claim = await worker.claim(); assert.equal(claim.id, job.id);
    assert.equal(await worker.claim(), null);
    await worker.update(job.id, { progress: 30, message: 'Rendering frames' });
    assert.equal(job.progress, 30);
    await assert.rejects(worker.complete(job.id, Readable.from('not a video')));
    assert.equal(job.state, 'rendering');
    const mp4 = path.join(data, 'fixture.mp4');
    await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', `color=c=blue:s=${job.width}x${job.height}:r=24:d=1`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4]);
    await worker.complete(job.id, createReadStream(mp4));
    assert.equal(job.state, 'done'); assert.equal(job.progress, 100);
    assert.equal(JSON.parse(await readFile(path.join(data, 'renders', job.id, 'job.json'))).state, 'done');
    assert.ok((await readFile(path.join(data, 'renders', job.id, 'video.mp4'))).length);
    const interrupted = await worker.enqueue(project, {}); await worker.claim();
    clock += 91000;
    assert.equal((await worker.status(interrupted.id)).state, 'failed');
    await assert.rejects(worker.complete(interrupted.id, createReadStream(mp4)), /no longer assigned/);
    await assert.rejects(worker.enqueue(project, {}), /offline/);
  } finally { await rm(data, { recursive: true, force: true }); }
});

test('cancelling a Mac export frees the queue and rejects uploads that were already streaming', async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'floc-worker-cancel-'));
  const jobs = new Map();
  const worker = createRenderWorker({ data, jobs, token: 'a'.repeat(64), now: () => 100000 });
  try {
    const project = demoProject(); project.duration = 1; project.fps = 24; for (const layer of project.layers) { layer.start = 0; layer.end = 1; layer.fadeIn = 0; layer.fadeOut = 0; }
    await worker.claim();
    assert.equal(await worker.cancel('12345678-1234-1234-1234-123456789abc'), null);
    const queued = await worker.enqueue(project, {});
    assert.equal((await worker.cancel(queued.id)).state, 'cancelled');
    assert.equal(await worker.claim(), null, 'a cancelled job is never handed to the Mac');
    const job = await worker.enqueue(project, {});
    await worker.claim();
    const upload = new PassThrough();
    const completion = worker.complete(job.id, upload);
    upload.write(Buffer.alloc(1024));
    const cancelled = await worker.cancel(job.id);
    assert.equal(cancelled.state, 'cancelled'); assert.equal(cancelled.message, 'Export cancelled.');
    upload.end(Buffer.alloc(1024));
    await assert.rejects(completion, /no longer assigned/);
    await assert.rejects(worker.update(job.id, { progress: 50 }), error => error.status === 409);
    assert.equal(job.state, 'cancelled'); assert.equal('url' in job, false);
    assert.equal(JSON.parse(await readFile(path.join(data, 'renders', job.id, 'job.json'))).state, 'cancelled');
    await assert.rejects(readFile(path.join(data, 'renders', job.id, 'video.mp4')), { code: 'ENOENT' });
    assert.equal(await worker.cancel(job.id), null);
    assert.ok(await worker.enqueue(project, {}), 'the queue accepts the next export');
  } finally { await rm(data, { recursive: true, force: true }); }
});

test('the Mac queue stays MP4-only and rejects other formats before queuing', async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'floc-worker-format-'));
  const jobs = new Map();
  const worker = createRenderWorker({ data, jobs, token: 'a'.repeat(64), now: () => 100000 });
  try {
    const project = demoProject(); project.duration = 1; for (const layer of project.layers) { layer.start = 0; layer.end = 1; layer.fadeIn = 0; layer.fadeOut = 0; }
    for (const settings of [{ format: 'mov' }, { format: 'png', transparent: true }]) {
      await assert.rejects(worker.enqueue(project, settings), error => error.status === 400 && /MP4 only/.test(error.message), 'rejected even while the Mac is offline');
      await worker.claim();
      await assert.rejects(worker.enqueue(project, settings), error => error.status === 400 && /MP4 only/.test(error.message));
    }
    assert.equal(jobs.size, 0);
    assert.equal(await worker.claim(), null);
    assert.equal((await worker.enqueue(project, { format: 'mp4' })).format, 'mp4');
  } finally { await rm(data, { recursive: true, force: true }); }
});
