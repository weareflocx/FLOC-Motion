import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
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
