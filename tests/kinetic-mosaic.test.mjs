import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, patchLayer, validateProject } from '../src/project.js';
import { kineticMosaicState, kineticMosaicCellProgress, cardMetrics } from '../src/carousel-motion.js';
import { createTools } from '../src/webmcp.js';

const mosaic = () => patchLayer(demoProject(), 'carousel', { template: 'kinetic-mosaic' });

test('mosaic settings survive validated edits without replacing media or neighboring layers', async () => {
  let project = validateProject(demoProject());
  const before = structuredClone(project);
  const tools = createTools({ get: () => project, set: next => { project = next; }, save: async () => {}, audit() {} });
  await tools.find(tool => tool.name === 'floc_set_carousel').execute({ template: 'kinetic-mosaic', mosaicColumns: 3, mosaicRows: 7, mosaicZoom: .6, mosaicStagger: .2, motionVariant: 'inward' });
  assert.deepEqual(project.images, before.images);
  assert.deepEqual(project.layers.filter(layer => layer.type !== 'carousel'), before.layers.filter(layer => layer.type !== 'carousel'));
  const layer = project.layers.find(layer => layer.type === 'carousel');
  assert.deepEqual([layer.mosaicColumns, layer.mosaicRows, layer.mosaicZoom, layer.mosaicStagger, layer.motionVariant], [3, 7, .6, .2, 'inward']);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
});

test('imports and edits reject fractional grids and invalid mosaic controls', () => {
  const project = mosaic();
  for (const [field, values] of Object.entries({
    mosaicColumns: [0, 13, 2.5, '5', NaN, Infinity],
    mosaicRows: [0, 13, 4.1, '5', NaN, Infinity],
    mosaicZoom: [-.01, 1.01, '0.8', NaN, Infinity],
    mosaicStagger: [-.01, 1.01, '0.35', NaN, Infinity],
    motionVariant: ['diagonal', 'scatter']
  })) for (const value of values) {
    assert.throws(() => patchLayer(project, 'carousel', { [field]: value }), `${field}=${value}`);
    const imported = structuredClone(project);
    imported.layers.find(layer => layer.type === 'carousel')[field] = value;
    assert.throws(() => validateProject(imported), `import ${field}=${value}`);
  }
  for (const patch of [{ mosaicColumns: 1, mosaicRows: 12, mosaicZoom: 0, mosaicStagger: 1 }, { mosaicColumns: 12, mosaicRows: 1, mosaicZoom: 1, mosaicStagger: 0 }]) {
    const layer = patchLayer(project, 'carousel', patch).layers.find(layer => layer.type === 'carousel');
    for (const [key, value] of Object.entries(patch)) assert.equal(layer[key], value);
  }
});

test('mosaic respects reverse, pause, single-image and explicit loop timing', () => {
  const layer = mosaic().layers.find(layer => layer.type === 'carousel');
  const reversed = kineticMosaicState({ ...layer, speed: -18 }, 3, .4);
  assert.deepEqual([reversed.outgoing, reversed.incoming], [0, 2]);
  assert.equal(reversed.progress, .5);
  const paused = kineticMosaicState({ ...layer, speed: 0 }, 3, 9);
  assert.deepEqual([paused.outgoing, paused.progress], [0, 0]);
  const single = kineticMosaicState(layer, 1, .4);
  assert.deepEqual([single.outgoing, single.incoming, single.progress], [0, 0, 0]);
  const continuous = { ...layer, loopDuration: 6, motion: { ...layer.motion, mode: 'continuous' } };
  assert.equal(kineticMosaicState(continuous, 3, 1).progress, .5);
  assert.equal(cardMetrics({ ...layer, cardFit: 'height' }, [.5, 2]).perCard, false);
});

test('cell staggering follows the chosen wave and all tiles land on the whole photograph', () => {
  const layer = mosaic().layers.find(layer => layer.type === 'carousel');
  const cell = (variant, x, y, t) => kineticMosaicCellProgress({ ...layer, motionVariant: variant }, x, y, t);
  for (const variant of ['outward', 'inward', 'left', 'right', 'up', 'down']) {
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
      assert.equal(cell(variant, x, y, 0), 0);
      assert.equal(cell(variant, x, y, 1), 1);
    }
  }
  assert.ok(cell('outward', 2, 2, .3) > cell('outward', 0, 0, .3));
  assert.ok(cell('inward', 0, 0, .3) > cell('inward', 2, 2, .3));
  assert.ok(cell('right', 0, 2, .3) > cell('right', 4, 2, .3));
  assert.ok(cell('up', 2, 0, .3) > cell('up', 2, 4, .3));
  const synchronous = { ...layer, mosaicStagger: 0 };
  assert.equal(kineticMosaicCellProgress(synchronous, 0, 0, .4), kineticMosaicCellProgress(synchronous, 4, 4, .4));
});
