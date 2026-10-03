import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { extractCardFrames } from '../server/card-frames.mjs';
import { run } from '../server/process.mjs';
import { cardFrameIndex, cardFrameSource } from '../src/card-media.js';

test('prepared card clocks loop, respect layer start and clamp the final export frame', () => {
  const frames = { duration: 2, fps: 30, count: 60, directory: 'card-frames/0', extension: 'jpg' };
  assert.equal(cardFrameIndex(frames, 1, 2), 0);
  assert.equal(cardFrameIndex(frames, 3, 2), 30);
  assert.equal(cardFrameIndex(frames, 4, 2), 0);
  assert.equal(cardFrameIndex({ ...frames, duration: 20 }, 15, 0), 59);
  assert.equal(cardFrameSource(frames, 30), 'card-frames/0/000030.jpg');
});

test('real extraction deduplicates cards, bounds long clips and preserves VP9 alpha', async t => {
  if (spawnSync('ffmpeg', ['-version']).error?.code === 'ENOENT') return t.skip('FFmpeg is required for real extraction');
  const folder = await mkdtemp(path.join(tmpdir(), 'floc-card-frames-'));
  try {
    await mkdir(path.join(folder, 'assets'));
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32:r=12:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(folder, 'assets/opaque.mp4')]);
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red@0.25:s=32x32:r=12:d=1,format=rgba', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', path.join(folder, 'assets/alpha.webm')]);
    const cards = [{ src: 'assets/opaque.mp4' }, { src: 'assets/alpha.webm' }];
    const project = { fps: 24, duration: 0.5, images: cards, layers: [{ type: 'carousel' }, { type: 'carousel', images: cards }] };
    const before = structuredClone(project);
    const frames = await extractCardFrames(project, folder, run);
    assert.equal(Object.keys(frames).length, 2);
    assert.equal(frames[cards[0].src].count, 12);
    assert.equal(frames[cards[0].src].extension, 'jpg');
    assert.equal(frames[cards[1].src].count, 12);
    assert.equal(frames[cards[1].src].extension, 'png');
    const image = path.join(folder, cardFrameSource(frames[cards[1].src], 0));
    const pixels = await run('ffmpeg', ['-v', 'error', '-i', image, '-vf', 'alphaextract,signalstats,metadata=print:file=-', '-f', 'null', '-']);
    assert.match(pixels, /YAVG=6[0-9]/);
    assert.deepEqual(project, before);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
