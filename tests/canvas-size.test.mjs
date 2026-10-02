import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasWheelSize } from '../src/editor-controls.js';
import { demoProject, patchLayer } from '../src/project.js';

test('canvas wheel changes the same validated size fields as the inspector', () => {
  const p = demoProject();
  for (const id of ['headline', 'logo', 'carousel']) {
    const l = p.layers.find(l => l.id === id);
    const larger = canvasWheelSize(l, -100);
    assert.ok(larger > l.size);
    assert.equal(patchLayer(p, id, { size: larger }).layers.find(l => l.id === id).size, larger);
    assert.equal(canvasWheelSize(l, 100, larger), l.size);
    assert.equal(canvasWheelSize(l, 0), l.size);
  }
});
test('wheel limits prevent invalid text, logo and carousel sizes', () => {
  for (const [type, min, max] of [['text', 12, 180], ['logo', 2, 35], ['carousel', 0.5, 2.5]]) {
    assert.equal(canvasWheelSize({ type, size: max }, -1), max);
    assert.equal(canvasWheelSize({ type, size: min }, 1), min);
  }
  assert.throws(() => canvasWheelSize({ type: 'music', size: 1 }, 10));
});

test('carousel moves by its center and stays inside its validated position range', async () => {
  const { carouselPlacement } = await import('../src/editor-controls.js');
  assert.deepEqual(carouselPlacement(53.5, 47.25), { x: 53.5, y: 47.25 });
  assert.deepEqual(carouselPlacement(-20, 150), { x: 10, y: 90 });
  assert.doesNotThrow(() => patchLayer(demoProject(), 'carousel', carouselPlacement(-20, 150)));
});
