import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { blankProject, fileLayer, validateProject } from '../src/project.js';
import { MODEL_SHAPES } from '../src/model-shapes.js';
import { applyModelPreset } from '../src/model-style.js';
import { run } from '../server/process.mjs';
import { openGoldenSession, executablePath, PARITY_TOLERANCE } from '../scripts/golden-frames.mjs';

const shapes = MODEL_SHAPES.filter(shape => ['morphing-sphere', 'liquid-ribbons', 'magical-octahedron'].includes(shape.id));

test('Prismatic refraction uses the video Background on every new sculpture, including through the mesh', { skip: !executablePath && 'Chrome or Edge is required for refractive video pixels', timeout: 240000 }, async () => {
  const assets = await mkdtemp(path.join(os.tmpdir(), 'floc-prismatic-video-'));
  let session;
  try {
    const filename = '00000000-0000-4000-8000-000000000014.mp4';
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0xd00000:s=160x90:r=24:d=0.5', '-f', 'lavfi', '-i', 'color=c=0x0010df:s=160x90:r=24:d=0.5', '-f', 'lavfi', '-i', 'color=c=0x00ce08:s=160x90:r=24:d=0.5', '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(assets, filename)]);
    const cases = shapes.map(shape => {
      const project = blankProject(`Prismatic ${shape.name} over video`);
      project.duration = 1;
      project.layers[0] = { ...project.layers[0], end: 1, mode: 'video', src: `/assets/${filename}`, color: '#ffffff', offset: .25, loop: false, fit: 'cover' };
      const sculpture = fileLayer(shape, 1, 'sculpture');
      sculpture.modelStyle = applyModelPreset(sculpture.modelStyle, 'refractive-prism');
      project.layers.push(sculpture);
      const video = { id: `${shape.id}-video`, project: validateProject(project), times: [.125, .5, .875, .125] };
      const references = [['red', '#d00000', .125], ['blue', '#0010df', .5], ['green', '#00ce08', .875]].map(([colorName, color, time]) => {
        const solid = structuredClone(video.project);
        solid.layers[0] = { ...solid.layers[0], mode: 'color', color };
        return { id: `${shape.id}-${colorName}`, project: validateProject(solid), times: [time] };
      });
      return { video, references };
    });
    session = await openGoldenSession({ lanes: 1, assetDirectory: assets, captureWidth: 360 });
    const captures = await session.captureAll(cases.flatMap(({ video, references }) => [video, ...references]));
    for (const { video, references } of cases) {
      for (const [index, reference] of references.entries()) {
        const actual = captures[video.id][index], expected = captures[reference.id][0];
        const parity = await session.compare(actual.preview, actual.exported, PARITY_TOLERANCE);
        assert.ok(parity.ok, `${video.id} preview/export at ${actual.time}s: ${parity.summary}`);
        // Whole-frame comparison covers refractive mesh pixels, not just corners:
        // an opaque or white transmission would differ from the same solid input.
        const refracted = await session.compare(actual.exported, expected.exported, PARITY_TOLERANCE);
        assert.ok(refracted.ok, `${video.id} must refract ${reference.id} content at ${actual.time}s: ${refracted.summary}`);
      }
      const seek = await session.compare(captures[video.id][0].exported, captures[video.id][3].exported, { channel: 0, ratio: 0 });
      assert.ok(seek.ok, `${video.id} seek must restore video and refractive content together: ${seek.summary}`);
    }
  } finally { await session?.close(); await rm(assets, { recursive: true, force: true }); }
});
