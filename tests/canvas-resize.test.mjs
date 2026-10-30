import test from 'node:test';
import { alignmentPlacement } from '../src/layout.js';
import assert from 'node:assert/strict';
import { centeredResize, layerResizeBounds, snapCenteredResize } from '../src/editor/canvas-resize.js';
import { demoProject, fileLayer, patchLayer, validateProject, linkFormats, switchFormat } from '../src/project.js';
import { captureState, evaluateChoreography } from '../src/choreography.js';
import { registerStageScene } from '../src/editor/layer-bounds.js';
import { readFileSync } from 'node:fs';
import { choreographyPatch } from '../src/editor/choreography-edit.js';
import { dataFlowLayer } from '../src/data-flow-style.js';

test('growing and shrinking images preserves their center even outside the canvas', () => {
  const layer = { type: 'media', size: 40 };
  const bounds = { x: 5, y: -20, width: 40, height: 80 };
  for (const size of [20, 80, 100]) {
    const next = centeredResize(layer, size, bounds);
    assert.equal(next.x + size / 2, bounds.x + bounds.width / 2);
    assert.equal(next.y + size, bounds.y + bounds.height / 2);
  }
  assert.equal(centeredResize(layer, 1000, bounds).size, 500);
});

test('brand images keep their center when growth crosses a canvas edge', () => {
  const p = demoProject();
  const layer = p.layers.find(l => l.type === 'logo');
  const bounds = { x: 0, y: 0, width: layer.size, height: layer.size };
  const next = centeredResize(layer, layer.size * 2, bounds);
  assert(next.x < 0 && next.y < 0);
  const valid = patchLayer(p, layer.id, next).layers.find(l => l.id === layer.id);
  assert.equal(valid.x + valid.size / 2, layer.size / 2);
  assert.equal(valid.y + valid.size / 2, layer.size / 2);
});

test('off-canvas media positions survive validation, animation and linked format restoration', () => {
  const p = demoProject();
  p.layers.push(fileLayer({ src: '/demo/poster-1.svg', name: 'Image' }, p.duration, 'image'));
  let next = patchLayer(p, 'image', { x: -35, y: -60, size: 100 });
  const layer = next.layers.at(-1);
  layer.choreography = captureState(layer, 0, next.fps);
  layer.choreography = captureState(layer, 2, next.fps, { x: 10, y: -20 });
  next = validateProject(next);
  assert.equal(evaluateChoreography(next.layers.at(-1), 1).x, -12.5);
  next = linkFormats(next);
  next = switchFormat(next, 'portrait');
  next = switchFormat(next, 'square');
  assert.equal(next.layers.at(-1).x, -35);
  assert.equal(next.layers.at(-1).y, -60);
  assert.throws(() => patchLayer(next, 'image', { x: -1001 }));
});

test('center resize snaps to canvas and safe edges, then releases beyond the magnet', () => {
  const layer = { type: 'media', size: 40 };
  const bounds = { x: 30, y: 25, width: 40, height: 50 };
  const layout = { enabled: true, marginX: 5, marginY: 5 };
  const tolerance = { x: .6, y: .6 };
  const height = snapCenteredResize(layer, 79.6, bounds, bounds, layout, tolerance);
  assert.equal(height.size, 80);
  assert(height.guides.some(g => g.axis === 'y' && g.value === 0));
  assert(height.guides.some(g => g.axis === 'y' && g.value === 100));
  const beyond = snapCenteredResize(layer, 83, bounds, bounds, layout, tolerance);
  assert.equal(beyond.size, 83);
  assert.equal(beyond.guides.length, 0);
  const margins = snapCenteredResize(layer, 71.7, bounds, bounds, layout, tolerance);
  assert.equal(margins.size, 72);
  assert(margins.guides.some(g => g.axis === 'y' && g.value === 5));
  assert(margins.guides.some(g => g.axis === 'y' && g.value === 95));
  assert.equal(margins.x + margins.size / 2, 50);
});

test('an off-center model silhouette snaps its own edge while scaling about the canvas center', () => {
  const layer = { type: 'model', size: 20 };
  const canvas = { x: 20, y: 20, width: 20, height: 20 };
  const silhouette = { x: 32, y: 30, width: 10, height: 10 };
  const next = snapCenteredResize(layer, 116, canvas, silhouette, { enabled: false }, { x: .6, y: .6 });
  // The right edge, 12 units from the canvas center at x = 30, reaches the frame edge.
  assert.ok(Math.abs(next.size - 20 * 70 / 12) < 1e-9, String(next.size));
  assert.deepEqual(next.guides, [{ axis: 'x', value: 100 }]);
  assert.ok(Math.abs(next.x + next.size / 2 - 30) < 1e-9, 'the canvas center stays in place');
});

test('matching aspect ratios indicate both width and height at once', () => {
  const layer = { type: 'media', size: 40 };
  const bounds = { x: 30, y: 30, width: 40, height: 40 };
  const next = snapCenteredResize(layer, 99.7, bounds, bounds, { enabled: false }, { x: .6, y: .6 });
  assert.equal(next.size, 100);
  assert.deepEqual(next.guides, [{ axis: 'x', value: 0 }, { axis: 'x', value: 100 }, { axis: 'y', value: 0 }, { axis: 'y', value: 100 }]);
});

test('unconstrained alignment snaps oversized media without pinning it inside margins', () => {
  const bounds = { width: 120, height: 180 };
  const layout = { enabled: true, marginX: 5, marginY: 5 };
  const aligned = alignmentPlacement({ x: -.3, y: -30 }, bounds, [], layout, { x: .6, y: .6 }, { constrain: false });
  assert.equal(aligned.x, 0);
  assert.equal(aligned.y, -30);
  assert(aligned.guides.some(g => g.axis === 'x' && g.value === 0));
  const beyond = alignmentPlacement({ x: -2, y: -30 }, bounds, [], layout, { x: .6, y: .6 }, { constrain: false });
  assert.equal(beyond.x, -2);
  assert.equal(beyond.y, -30);
});

test('images can grow beyond canvas width while preserving their center and saved size', () => {
  const p = demoProject();
  const layer = fileLayer({ src: '/demo/poster-1.svg', name: 'Image' }, p.duration, 'image');
  Object.assign(layer, { size: 100, x: 0, y: -50 });
  p.layers.push(layer);
  const next = centeredResize(layer, 300, { x: 0, y: -50, width: 100, height: 200 });
  assert.equal(next.x + next.size / 2, 50);
  assert.equal(next.y + next.size, 50);
  let saved = patchLayer(p, 'image', next);
  saved = switchFormat(switchFormat(linkFormats(saved), 'portrait'), 'square');
  const restored = saved.layers.at(-1);
  assert.equal(restored.size, 300);
  assert.equal(restored.x, -100);
  assert.equal(restored.y, -250);
});

test('spatial resize keeps intrinsic authored center when the root camera projects a different box', () => {
  const layer = { id: 'plane', type: 'media', space: 'spatial', x: 20, y: 30, size: 40 };
  const node = { dataset: { flocLayer: 'plane' }, style: { left: '80%', top: '80%' }, offsetWidth: 400, offsetHeight: 200 };
  const root = { clientWidth: 1000, clientHeight: 1000, querySelectorAll: () => [node] };
  registerStageScene(root, { projectedBounds: () => ({ x: 10, y: 25, width: 80, height: 50 }) });
  const bounds = layerResizeBounds(layer, root);
  assert.deepEqual(bounds, { x: 20, y: 30, width: 40, height: 20 });
  const next = centeredResize(layer, 80, bounds);
  assert.equal(next.x + 40, 40);
  assert.equal(next.y + 20, 40);
  registerStageScene(root, { projectedBounds: () => null });
  assert.equal(layerResizeBounds(layer, root), null, 'an absent scene object cannot be resized via hidden source DOM');
  registerStageScene(root, null);
});

test('spatial resize snaps projected edges without replacing its authored coordinates', () => {
  const layer = { type: 'media', size: 40 };
  const intrinsic = { x: 20, y: 30, width: 40, height: 20 };
  const projected = { x: 30, y: 25, width: 40, height: 50 };
  const next = snapCenteredResize(layer, 79.6, intrinsic, projected, { enabled: false }, { x: .6, y: .6 }, { x: 50, y: 50 });
  assert.equal(next.size, 80);
  assert.deepEqual([next.x, next.y], [0, 20]);
  assert(next.guides.some(guide => guide.axis === 'y' && guide.value === 0));
  assert(next.guides.some(guide => guide.axis === 'y' && guide.value === 100));
});

test('data flow resizing preserves the composition-aspect center in landscape and portrait', () => {
  for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
    const layer = { id: 'flow', type: 'dataflow', space: 'flat', x: -20, y: 30, size: 40 };
    const node = { dataset: { flocLayer: 'flow' }, offsetWidth: width * .4, offsetHeight: height * .4 };
    const root = { clientWidth: width, clientHeight: height, querySelectorAll: () => [node] };
    registerStageScene(root, { projectedBounds: () => ({ x: -20, y: 30, width: 40, height: 40 }) });
    const bounds = layerResizeBounds(layer, root);
    assert.deepEqual(bounds, { x: -20, y: 30, width: 40, height: 40 });
    for (const size of [2, 20, 80, 500]) {
      const next = centeredResize(layer, size, bounds);
      assert.equal(next.x + size / 2, 0);
      assert.equal(next.y + size / 2, 50);
    }
    assert.equal(centeredResize(layer, 1, bounds).size, 2);
    assert.equal(centeredResize(layer, 501, bounds).size, 500);
    assert.deepEqual(centeredResize(layer, 500, { x: -999, y: -999, width: 40, height: 40 }), { size: 500, x: -1000, y: -1000 });
    registerStageScene(root, null);
  }
});

test('data flow resizing snaps the projected composition edges without a square-model assumption', () => {
  const layer = { type: 'dataflow', space: 'spatial', size: 40 };
  const authored = { x: 20, y: 30, width: 40, height: 40 };
  const projected = { x: 30, y: 25, width: 40, height: 50 };
  const next = snapCenteredResize(layer, 79.6, authored, projected, { enabled: false }, { x: .6, y: .6 }, { x: 50, y: 50 });
  assert.equal(next.size, 80);
  assert.deepEqual([next.x, next.y], [0, 10]);
  assert(next.guides.some(guide => guide.axis === 'y' && guide.value === 0));
  assert(next.guides.some(guide => guide.axis === 'y' && guide.value === 100));
});

test('inspector size edits center the evaluated data flow pose and save one playhead keyframe', () => {
  const source = readFileSync(new URL('../src/editor/useLayerEditing.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace('export function', 'function');
  for (const space of ['flat', 'spatial']) {
    const project = demoProject(), flow = { ...dataFlowLayer(project.duration, 'flow'), space, x: 10, y: 20, size: 40 };
    flow.choreography = captureState(flow, 0, project.fps, {}, 'start');
    flow.choreography = captureState(flow, 2, project.fps, { x: 30, y: 40, size: 80 }, 'end');
    project.layers.push(flow);
    const node = { dataset: { flocLayer: 'flow' }, offsetWidth: 1152, offsetHeight: 648 };
    const root = { clientWidth: 1920, clientHeight: 1080, querySelectorAll: () => [node] };
    registerStageScene(root, { projectedBounds: () => ({ x: -5, y: 10, width: 90, height: 70 }) });
    const deps = { useCallback: fn => fn, useMemo: fn => fn(), evaluateChoreography, choreographyPatch, centeredResize, layerResizeBounds, document: { querySelector: () => root } };
    const hook = new Function(...Object.keys(deps), `${source}\nreturn useLayerEditing;`)(...Object.values(deps));
    const patches = [], errors = [], playback = [];
    const api = hook({ project, projectRef: { current: project }, clock: { get: () => ({ time: 1 }) }, time: 1,
      patch(id, fields) { patches.push({ id, fields }); }, setTime() {}, setPlaying: value => playback.push(value), setError: error => errors.push(error) });
    api.editLayer('flow', { size: 120 });
    assert.deepEqual(errors, []);
    assert.deepEqual(playback, [false]);
    assert.equal(patches.length, 1);
    const { id, fields } = patches[0];
    const saved = patchLayer(project, id, fields).layers.find(layer => layer.id === id);
    const at = evaluateChoreography(saved, 1);
    assert.deepEqual([at.x, at.y, at.size], [-10, 0, 120]);
    assert.deepEqual([evaluateChoreography(saved, 2).x, evaluateChoreography(saved, 2).size], [30, 80]);
    assert.equal(saved.choreography.length, 3);
    registerStageScene(root, null);
  }
});
