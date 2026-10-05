import test from 'node:test';
import { alignmentPlacement } from '../src/layout.js';
import assert from 'node:assert/strict';
import { centeredResize, snapCenteredResize } from '../src/editor/canvas-resize.js';
import { demoProject, fileLayer, patchLayer, validateProject, linkFormats, switchFormat } from '../src/project.js';
import { captureState, evaluateChoreography } from '../src/choreography.js';

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
