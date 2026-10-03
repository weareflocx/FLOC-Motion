import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasViewport } from '../src/editor/canvas-viewport.js';
import { FORMATS } from '../src/project.js';

test('fit keeps every format inside the holder and centers it after resize', () => {
  for (const dimensions of Object.values(FORMATS)) {
    for (const box of [{ width: 374, height: 400 }, { width: 720, height: 515 }]) {
      const view = canvasViewport(dimensions, box, 'fit', { x: 300, y: -300 });
      assert(dimensions[0] * view.scale <= box.width - 24 + 1e-8);
      assert(dimensions[1] * view.scale <= box.height - 24 + 1e-8);
      assert.equal(view.canPan, false);
      assert.equal(view.x, 0); assert.equal(view.y, 0);
    }
  }
});
test('100 percent preserves authored dimensions and panning is bounded to the frame edges', () => {
  const view = canvasViewport([1440, 1080], { width: 374, height: 400 }, 1, { x: 2000, y: -2000 });
  assert.equal(view.scale, 1); assert.equal(view.canPan, true);
  assert.equal(view.x, 545); assert.equal(view.y, -352);
  const resized = canvasViewport([1440, 1080], { width: 1600, height: 1200 }, 1, view);
  assert.equal(resized.canPan, false); assert.equal(resized.x, 0); assert.equal(resized.y, 0);
});
test('explicit zoom is bounded and zero-sized holders remain finite', () => {
  assert.equal(canvasViewport([1920, 1080], { width: 800, height: 600 }, 0).scale, 0.05);
  assert.equal(canvasViewport([1920, 1080], { width: 800, height: 600 }, 10).scale, 2);
  const view = canvasViewport([1920, 1080], { width: 0, height: 0 });
  assert(Number.isFinite(view.scale)); assert(Number.isFinite(view.x));
});
