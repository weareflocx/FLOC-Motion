import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { MODEL_SHAPES } from '../src/model-shapes.js';
import { fileLayer, blankProject, validateProject } from '../src/project.js';
import { generateShape, shapePreviewFixture } from '../scripts/model-shapes-lib.mjs';
import { executablePath, openGoldenSession } from '../scripts/golden-frames.mjs';

const publicFile = src => path.join('public', src);

// Renderers fingerprint the registry, not the files: a generator change must not silently alter a published shape.
test('the generator reproduces every published shape byte for byte, each with its picker thumbnail', async () => {
  for (const shape of MODEL_SHAPES) {
    assert((await generateShape(shape.id)).equals(readFileSync(publicFile(shape.src))), `${shape.id} changed; publish new geometry under a new id`);
    assert(existsSync(publicFile(shape.preview)), `${shape.id} has a thumbnail`);
  }
});

test('model layers accept registered shapes and reject other public paths', () => {
  const project = blankProject();
  const layer = src => fileLayer({ src, name: 'Shape' }, project.duration, 'shape');
  assert.equal(validateProject({ ...project, layers: [...project.layers, layer('/shapes/torus-knot.glb')] }).layers[1].type, 'model');
  for (const src of ['/shapes/unknown.glb', '/shapes/torus-knot.jpg', '/shapes/../demo/poster-1.svg']) {
    assert.throws(() => validateProject({ ...project, layers: [...project.layers, { ...layer('/shapes/torus-knot.glb'), src }] }), src);
  }
});

test('every shape renders visible geometry in export, matching the editor preview', { skip: !executablePath && 'Chrome or Edge is required for shape rendering', timeout: 300000 }, async t => {
  const session = await openGoldenSession();
  t.after(() => session.close());
  const fixtures = MODEL_SHAPES.map(shapePreviewFixture);
  const captures = await session.captureAll(fixtures);
  const empty = fixtures[0].project.layers[0];
  const background = { ...fixtures[0], id: 'empty', project: validateProject({ ...fixtures[0].project, layers: [empty] }) };
  const [blank] = (await session.captureAll([background])).empty;
  for (const shape of MODEL_SHAPES) {
    const [{ exported, preview }] = captures[shape.id];
    const coverage = await session.compare(exported, blank.exported, { channel: 24, ratio: 1 });
    assert(coverage.ratio > 0.05, `${shape.id} covers only ${(coverage.ratio * 100).toFixed(2)}% of the frame`);
    const parity = await session.compare(preview, exported, { channel: 32, ratio: 0.005 });
    assert(parity.ok, `${shape.id} preview vs export: ${parity.summary}`);
  }
});
