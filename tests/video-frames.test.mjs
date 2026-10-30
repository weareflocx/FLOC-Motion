import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { extractVideoFrames } from '../server/video-frames.mjs';
import { ensureGifVideo } from '../server/card-media.mjs';
import { run } from '../server/process.mjs';
import { audioTime } from '../src/project.js';
import { cardFrameIndex, videoFrameIndex, videoFrameSource } from '../src/card-media.js';

async function withVideos(t, callback) {
  if (spawnSync('ffmpeg', ['-version']).error?.code === 'ENOENT') return t.skip('FFmpeg is required for real extraction');
  const folder = await mkdtemp(path.join(tmpdir(), 'floc-video-frames-'));
  try {
    await mkdir(path.join(folder, 'assets'));
    await callback(folder);
  } finally { await rm(folder, { recursive: true, force: true }); }
}

async function colorClip(folder, name = 'colors.mp4', rate = 12) {
  const src = `assets/${name}`;
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=32x24:r=12:d=1', '-f', 'lavfi', '-i', 'color=c=lime:s=32x24:r=12:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=32x24:r=12:d=1', '-filter_complex', `[0:v][1:v][2:v]concat=n=3:v=1:a=0,fps=${rate}[v]`, '-map', '[v]', '-c:v', 'libx264', '-g', String(rate), '-pix_fmt', 'yuv420p', path.join(folder, src)]);
  return src;
}

async function assertColor(folder, frames, index, color) {
  const sample = path.join(folder, `sample-${index}.rgb`);
  await run('ffmpeg', ['-v', 'error', '-y', '-i', path.join(folder, videoFrameSource(frames, index)), '-frames:v', '1', '-vf', 'scale=1:1,format=rgb24', '-f', 'rawvideo', sample]);
  const pixels = await readFile(sample), channel = { red: 0, lime: 1, blue: 2 }[color];
  assert.ok(pixels[channel] > 200 && [0, 1, 2].every(index => index === channel || pixels[index] < 35), `Expected ${color} pixels, got RGB ${Array.from(pixels)}`);
}

const projectFor = (layers, duration = 0.5, fps = 12) => ({ fps, duration, images: [], layers });

test('prepared card clocks loop, respect layer start and clamp the final export frame', () => {
  const frames = { duration: 2, fps: 30, count: 60, firstFrame: 0, directory: 'video-frames/0', extension: 'jpg' };
  assert.equal(cardFrameIndex(frames, 1, 2), 0);
  assert.equal(cardFrameIndex(frames, 3, 2), 30);
  assert.equal(cardFrameIndex(frames, 4, 2), 0);
  assert.equal(cardFrameIndex({ ...frames, duration: 20 }, 15, 0), 59);
  assert.equal(videoFrameSource(frames, 30), 'video-frames/0/000030.jpg');
});

test('real extraction deduplicates cards, bounds long clips and preserves VP9 alpha', async t => {
  await withVideos(t, async folder => {
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32:r=12:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(folder, 'assets/opaque.mp4')]);
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red@0.25:s=32x32:r=12:d=1,format=rgba', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', path.join(folder, 'assets/alpha.webm')]);
    const cards = [{ src: 'assets/opaque.mp4' }, { src: 'assets/alpha.webm' }];
    const project = { fps: 24, duration: 0.5, images: cards, layers: [{ type: 'carousel' }, { type: 'carousel', images: cards }] };
    const before = structuredClone(project);
    const frames = await extractVideoFrames(project, folder, run);
    assert.equal(Object.keys(frames).length, 2);
    assert.equal(frames[cards[0].src].count, 12);
    assert.equal(frames[cards[0].src].extension, 'jpg');
    assert.equal(frames[cards[1].src].count, 12);
    assert.equal(frames[cards[1].src].extension, 'png');
    assert.equal(frames[cards[1].src].firstFrame, 0);
    const image = path.join(folder, videoFrameSource(frames[cards[1].src], 0));
    const pixels = await run('ffmpeg', ['-v', 'error', '-i', image, '-vf', 'alphaextract,signalstats,metadata=print:file=-', '-f', 'null', '-']);
    assert.match(pixels, /YAVG=6[0-9]/);
    assert.deepEqual(project, before);
  });
});

test('a video background alone gets frames; retained inactive background and library sources do not', async t => {
  await withVideos(t, async folder => {
    const src = await colorClip(folder);
    const project = projectFor([
      { type: 'background', mode: 'video', src, start: 0, end: 0.5, offset: 0, loop: true },
      { type: 'background', mode: 'color', src: 'assets/inactive.mp4' },
      { type: 'background', mode: 'image', src: 'assets/inactive-image.webm' },
      { type: 'background', mode: 'procedural', src: 'assets/inactive-pattern.webm' },
    ]);
    project.images = [{ src: 'assets/unused-library.mp4' }];
    const frames = await extractVideoFrames(project, folder, run);
    assert.deepEqual(Object.keys(frames), [src]);
    assert.equal(frames[src].count, 6);
    assert.equal(frames[src].duration, 3);
    assert.equal(frames[src].width, 32);
    assert.equal(frames[src].height, 24);
    await assertColor(folder, frames[src], 0, 'red');
  });
});

test('late standalone offsets extract only their short source window, not the preceding clip', async t => {
  await withVideos(t, async folder => {
    const src = await colorClip(folder);
    const layer = { type: 'media', src, start: 0, end: 0.5, offset: 2, loop: false };
    const project = projectFor([layer]);
    const before = structuredClone(project);
    const frames = (await extractVideoFrames(project, folder, run))[src];
    assert.equal(frames.duration, 3);
    assert.equal(frames.firstFrame, 24);
    assert.equal(frames.count, 6);
    await assertColor(folder, frames, videoFrameIndex(frames, audioTime(layer, 0, frames.duration)), 'blue');
    await assertColor(folder, frames, videoFrameIndex(frames, audioTime(layer, 5 / 12, frames.duration)), 'blue');
    assert.deepEqual(project, before);
  });
});

test('a shared carousel, background and media source uses the union of their requested windows', async t => {
  await withVideos(t, async folder => {
    const src = await colorClip(folder);
    const background = { type: 'background', mode: 'video', src, start: 0, end: 0.5, offset: 2, loop: false };
    const media = { type: 'media', src, start: 0, end: 0.5, offset: 1.5, loop: true };
    const project = projectFor([{ type: 'carousel', start: 0, end: 0.5, images: [{ src }, { src }] }, background, media]);
    const manifest = await extractVideoFrames(project, folder, run);
    assert.deepEqual(Object.keys(manifest), [src]);
    const frames = manifest[src];
    assert.equal(frames.firstFrame, 0);
    assert.equal(frames.count, 30);
    await assertColor(folder, frames, cardFrameIndex(frames, 0, 0), 'red');
    await assertColor(folder, frames, videoFrameIndex(frames, audioTime(media, 0, frames.duration)), 'lime');
    await assertColor(folder, frames, videoFrameIndex(frames, audioTime(background, 0, frames.duration)), 'blue');
  });
});

test('non-looping media hold the final source frame and offsets beyond the end still produce an image', async t => {
  await withVideos(t, async folder => {
    const src = await colorClip(folder);
    const layer = { type: 'media', src, start: 0, end: 2, offset: 2.5, loop: false };
    let frames = (await extractVideoFrames(projectFor([layer], 2), folder, run))[src];
    assert.equal(frames.firstFrame, 30);
    assert.equal(frames.count, 6);
    assert.equal(videoFrameIndex(frames, audioTime(layer, 2, frames.duration)), 5);
    await assertColor(folder, frames, 5, 'blue');
    layer.offset = 8;
    frames = (await extractVideoFrames(projectFor([layer], 2), folder, run))[src];
    assert.equal(frames.firstFrame, 35);
    assert.equal(frames.count, 1);
    assert.equal(frames.duration, 3);
    await assertColor(folder, frames, videoFrameIndex(frames, audioTime(layer, 0, frames.duration)), 'blue');
  });
});

test('standalone looping wraps to its offset, not source zero, and keeps the whole remaining window', async t => {
  await withVideos(t, async folder => {
    const src = await colorClip(folder);
    const layer = { type: 'media', src, start: 1, end: 3, offset: 1.5, loop: true };
    const frames = (await extractVideoFrames(projectFor([layer], 3), folder, run))[src];
    assert.equal(frames.firstFrame, 18);
    assert.equal(frames.count, 18);
    await assertColor(folder, frames, videoFrameIndex(frames, audioTime(layer, 2.25, frames.duration)), 'blue');
    await assertColor(folder, frames, videoFrameIndex(frames, audioTime(layer, 2.5, frames.duration)), 'lime');
  });
});

test('a late CFR window holds the final decoded image of a low-frame-rate source', async t => {
  await withVideos(t, async folder => {
    const src = await colorClip(folder, 'low-rate.mp4', 1);
    const layer = { type: 'background', mode: 'video', src, start: 0, end: 0.5, offset: 2.9, loop: false };
    const frames = (await extractVideoFrames(projectFor([layer], 0.5, 24), folder, run))[src];
    assert.equal(frames.firstFrame, 69);
    assert.equal(frames.count, 3);
    await assertColor(folder, frames, 0, 'blue');
    await assertColor(folder, frames, 2, 'blue');
  });
});

test('a short active layer window does not extract its composition-long tail', async t => {
  await withVideos(t, async folder => {
    const src = await colorClip(folder);
    const layer = { type: 'media', src, start: 2, end: 2.25, offset: 1.5, loop: false };
    const frames = (await extractVideoFrames(projectFor([layer], 3), folder, run))[src];
    assert.equal(frames.firstFrame, 18);
    assert.equal(frames.count, 3);
    await assertColor(folder, frames, 0, 'lime');
    await assertColor(folder, frames, 2, 'lime');
  });
});

test('decodable metadata cannot turn a corrupt video payload into held or missing frames', async t => {
  await withVideos(t, async folder => {
    const src = await colorClip(folder);
    const filename = path.join(folder, src);
    const bytes = await readFile(filename);
    const marker = bytes.indexOf(Buffer.from('mdat'));
    assert.ok(marker > 3);
    const end = marker - 4 + bytes.readUInt32BE(marker - 4);
    bytes.fill(0, marker + 4, end);
    await writeFile(filename, bytes);
    const metadata = JSON.parse(await run('ffprobe', ['-v', 'quiet', '-show_streams', '-of', 'json', filename]));
    assert.equal(metadata.streams[0].codec_type, 'video');
    await assert.rejects(extractVideoFrames(projectFor([{ type: 'media', src, offset: 0, loop: false }]), folder, run));
  });
});

test('GIF-normalized standalone media uses the same prepared visual frames', async t => {
  await withVideos(t, async folder => {
    const gif = path.join(folder, 'assets/animated.gif');
    const src = 'assets/animated.webm';
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x24:r=12:d=1', gif]);
    await ensureGifVideo(gif, path.join(folder, src), run);
    const layer = { type: 'media', src, start: 0, end: 0.5, offset: 0, loop: true };
    const frames = (await extractVideoFrames(projectFor([layer]), folder, run))[src];
    assert.equal(frames.count, 6);
    assert.equal(frames.extension, 'png');
    await assertColor(folder, frames, 0, 'blue');
    await assertColor(folder, frames, 5, 'blue');
  });
});

test('unreadable video sources fail preparation instead of returning an empty derivative', async t => {
  await withVideos(t, async folder => {
    const src = 'assets/broken.mp4';
    await writeFile(path.join(folder, src), 'not a decodable video');
    await assert.rejects(extractVideoFrames(projectFor([{ type: 'media', src, offset: 0, loop: true }]), folder, run));
  });
});
