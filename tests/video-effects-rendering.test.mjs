import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { executablePath, openGoldenSession, PARITY_TOLERANCE } from '../scripts/golden-frames.mjs';
import { EFFECTS, effectLayer, newEffect } from '../src/effects.js';
import { demoProject, fileLayer, validateProject } from '../src/project.js';

const run = promisify(execFile);

function videoProject(src, effect) {
  const demo = demoProject();
  const background = { ...demo.layers[0], start: 0, end: 2, mode: 'color', color: '#111111', effects: [] };
  const media = { ...fileLayer({ name: 'Video effect fixture', src }, 2, 'video'), space: 'flat', x: 0, y: 0, size: 100, effects: effect ? [effect] : [] };
  return validateProject({ ...demo, name: effect ? `Video ${effect.type}` : 'Video control', format: 'landscape', duration: 2, fps: 24, images: [], layers: [background, media] });
}

test('every layer effect follows moving video, preserves reverse seeks and matches exported frames', { skip: !executablePath && 'Chrome or Edge is required for video effect verification', timeout: 240000 }, async t => {
  const assets = await mkdtemp(path.join(os.tmpdir(), 'floc-video-effects-'));
  t.after(() => rm(assets, { recursive: true, force: true }));
  const asset = '12121212-1212-4212-8212-121212121212.webm';
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', "smptebars=size=640x360:rate=24,format=rgba,colorchannelmixer=aa=0.999,drawbox=x=270:y=100:w=100:h=100:color=white:t=fill:enable='between(t,0.5,1)'", '-t', '2', '-c:v', 'libvpx-vp9', '-lossless', '1', '-pix_fmt', 'yuva420p', path.join(assets, asset)]);

  const src = `/assets/${asset}`;
  const fixtures = [
    { id: 'control', times: [0.25, 0.75, 0.25], project: videoProject(src) },
    ...EFFECTS.map(({ id }, index) => ({ id, times: [0.25, 0.75, 0.25], project: videoProject(src, { ...newEffect(id, index), ...(['noise', 'chromatic'].includes(id) ? { animated: true } : {}) }) }))
  ];
  const session = await openGoldenSession({ lanes: 2, assetDirectory: assets, captureWidth: 640 });
  t.after(() => session.close());
  const captures = await session.captureAll(fixtures);
  for (const fixture of fixtures) {
    const frames = captures[fixture.id];
    for (const [index, frame] of frames.entries()) {
      const control = captures.control[index];
      const parity = await session.compare(frame.preview, frame.exported, PARITY_TOLERANCE);
      assert(parity.ok, `${fixture.id} at ${frame.time}s preview/export parity: ${parity.summary}`);
      if (fixture.id === 'control') continue;
      for (const [kind, actual, baseline] of [['preview', frame.preview, control.preview], ['export', frame.exported, control.exported]]) {
        const sensitivity = await session.compare(actual, baseline, { channel: 8, ratio: 0 });
        assert(sensitivity.ratio > 0.01, `${fixture.id} ${kind} changed only ${(sensitivity.ratio * 100).toFixed(3)}% of video pixels`);
      }
    }
    const reverse = await session.compare(frames[0].exported, frames[2].exported, { channel: 0, ratio: 0 });
    assert(reverse.ok, `${fixture.id} changed after a reverse seek: ${reverse.summary}`);
    const motion = await session.compare(frames[0].exported, frames[1].exported, { channel: 8, ratio: 0 });
    assert(motion.ratio > 0.01, `${fixture.id} lost the video's changing frames`);
  }
});

test('opaque video retains full color precision through layer and Below dithering', { skip: !executablePath && 'Chrome or Edge is required for video effect verification', timeout: 120000 }, async t => {
  const assets = await mkdtemp(path.join(os.tmpdir(), 'floc-opaque-dither-'));
  t.after(() => rm(assets, { recursive: true, force: true }));
  const asset = '23232323-2323-4323-8323-232323232323.mp4';
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'smptebars=size=640x360:rate=24', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(assets, asset)]);
  const src = `/assets/${asset}`, dither = newEffect('dithering');
  const direct = videoProject(src, dither), below = videoProject(src);
  below.layers.push({ ...effectLayer('grade', 2), effects: [dither] });
  const fixtures = [
    { id: 'direct', times: [.75], project: direct },
    { id: 'below', times: [.75], project: validateProject(below) }
  ];
  const session = await openGoldenSession({ lanes: 2, assetDirectory: assets, captureWidth: 640 });
  t.after(() => session.close());
  const captures = await session.captureAll(fixtures);
  for (const fixture of fixtures) {
    const frame = captures[fixture.id][0];
    const parity = await session.compare(frame.preview, frame.exported, PARITY_TOLERANCE);
    assert(parity.ok, `${fixture.id} full-precision dithering parity: ${parity.summary}`);
  }
  const placement = await session.compare(captures.direct[0].exported, captures.below[0].exported, { channel: 0, ratio: 0 });
  assert(placement.ok, `moving the same treatment to a Below adjustment changes its color: ${placement.summary}`);
});
