import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { blankProject, fileLayer, validateProject } from '../src/project.js';
import { LIQUID_RIBBONS_SRC } from '../src/model-shapes.js';
import { applyModelPreset } from '../src/model-style.js';
import { prepareComposition } from '../server/export.mjs';
import { run } from '../server/process.mjs';
import { browserCandidates } from '../scripts/renderer-runtime.mjs';

const browserPath = [process.env.HYPERFRAMES_BROWSER_PATH, ...browserCandidates()].find(file => file && existsSync(file));
const source = '/assets/00000000-0000-4000-8000-000000000013.mp4';

test('real MP4 export retains the timed video Background with Liquid ribbons and Prismatic refraction', { skip: !browserPath && 'Chrome or Edge is required for MP4 export', timeout: 240000 }, async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'floc-video-background-export-'));
  const previousData = process.env.FLOC_DATA_DIR;
  try {
    const data = path.join(work, 'data'), assets = path.join(data, 'assets'), prepared = path.join(work, 'prepared');
    await mkdir(assets, { recursive: true });
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0xd00000:s=160x90:r=24:d=0.5', '-f', 'lavfi', '-i', 'color=c=0x0010df:s=160x90:r=24:d=0.5', '-f', 'lavfi', '-i', 'color=c=0x00ce08:s=160x90:r=24:d=0.5', '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(assets, path.basename(source))]);
    const project = blankProject('Video Background with Liquid ribbons');
    project.duration = 1;
    project.layers[0] = { ...project.layers[0], end: 1, mode: 'video', src: source, color: '#ffffff', fit: 'cover', offset: .25, loop: false };
    const ribbons = fileLayer({ name: 'Liquid ribbons', src: LIQUID_RIBBONS_SRC }, 1, 'ribbons');
    ribbons.modelStyle = applyModelPreset(ribbons.modelStyle, 'refractive-prism');
    project.layers.push(ribbons);
    const canonical = validateProject(project), settings = { format: 'mp4', resolution: '1080p', quality: 'standard' };
    process.env.FLOC_DATA_DIR = data;
    await prepareComposition(canonical, prepared, settings);
    const persisted = JSON.parse(await readFile(path.join(prepared, 'render-input.json'), 'utf8'));
    assert.deepEqual(persisted.project, canonical, 'preparing video frames must not replace the saved source or alter offsets');
    await run(process.execPath, ['scripts/render-prepared.mjs', prepared], { cwd: path.resolve('.'), env: { HYPERFRAMES_BROWSER_PATH: browserPath, FLOC_RENDER_WORKERS: '1' }, timeoutMs: 200000 });
    const video = path.join(prepared, 'video.mp4');
    const metadata = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', video]));
    const stream = metadata.streams.find(value => value.codec_type === 'video');
    assert.equal(stream.codec_name, 'h264');
    assert.equal(stream.width, 1080);
    assert.equal(stream.height, 1080);
    assert.equal(Number(stream.nb_frames), 24);
    for (const [time, channel] of [[.125, 0], [.5, 2], [.875, 1]]) {
      const sample = path.join(work, `sample-${time}.rgb`);
      await run('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', video, '-frames:v', '1', '-vf', 'crop=80:80:0:0,scale=1:1,format=rgb24', '-f', 'rawvideo', sample]);
      const values = await readFile(sample);
      assert.ok(values[channel] > 140, `Background at ${time}s must show source channel ${channel}, not white: ${Array.from(values)}`);
      for (const other of [0, 1, 2].filter(value => value !== channel)) assert.ok(values[other] < 55, `Background at ${time}s has an incorrect source color: ${Array.from(values)}`);
    }
  } finally {
    if (previousData === undefined) delete process.env.FLOC_DATA_DIR; else process.env.FLOC_DATA_DIR = previousData;
    await rm(work, { recursive: true, force: true });
  }
});
