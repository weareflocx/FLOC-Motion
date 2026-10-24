import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { root } from '../server/runtime-config.mjs';
import { run } from '../server/process.mjs';
import { MODEL_SHAPES } from '../src/model-shapes.js';
import { generateShape, shapePreviewFixture } from './model-shapes-lib.mjs';

// Writes the shapes to public/shapes; `--previews` instead renders each shape's 240 px picker
// thumbnail through the export path. `--id=<id>` limits either to one shape.
const only = process.argv.find(argument => argument.startsWith('--id='))?.slice(5);
const shapes = MODEL_SHAPES.filter(shape => !only || shape.id === only);
if (!shapes.length) throw new Error(`Unknown shape: ${only}`);

if (process.argv.includes('--previews')) {
  const { openGoldenSession } = await import('./golden-frames.mjs');
  const session = await openGoldenSession(), scratch = await mkdtemp(path.join(os.tmpdir(), 'floc-shape-previews-'));
  try {
    const captures = await session.captureAll(shapes.map(shapePreviewFixture));
    for (const shape of shapes) {
      const png = path.join(scratch, `${shape.id}.png`);
      await writeFile(png, captures[shape.id][0].exported);
      await run('ffmpeg', ['-v', 'error', '-y', '-i', png, '-vf', 'scale=240:240', '-q:v', '3', path.join(root, 'public', shape.preview)]);
      console.log(shape.preview);
    }
  } finally { await session.close(); await rm(scratch, { recursive: true, force: true }); }
} else {
  for (const shape of shapes) {
    const binary = await generateShape(shape.id);
    await writeFile(path.join(root, 'public', shape.src), binary);
    console.log(`${shape.src}: ${(binary.length / 1024).toFixed(0)} KB`);
  }
}
