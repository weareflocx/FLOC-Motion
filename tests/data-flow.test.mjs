import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDataFlowStyle, DEFAULT_DATA_FLOW } from '../src/data-flow-style.js';
import { createDataFlowLayout, dataFlowTime, dataFlowPosition, dataFlowParticlePosition, dataFlowFade, DATA_FLOW_START, DATA_FLOW_LENGTH } from '../src/data-flow.js';
const close = (actual, expected, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} differs from ${expected}`);
const point = (style, layout, fiber, x, elapsed) => {
  const out = new Float64Array(3), k = fiber * 3;
  return dataFlowPosition(style, layout.fibers[k], layout.fibers[k + 1], layout.fibers[k + 2], x, dataFlowTime(style, elapsed), out);
};

test('restarting or seeking fibers reconstructs the same seeded paths without history', () => {
  const style = normalizeDataFlowStyle(), first = createDataFlowLayout(style), second = createDataFlowLayout(style);
  const expected = point(style, first, 17, 177, 2.75);
  point(style, first, 17, 177, 150);
  assert.deepEqual(point(style, first, 17, 177, 2.75), expected);
  assert.deepEqual(point(style, second, 17, 177, 2.75), expected);
  const changed = normalizeDataFlowStyle({ seed: 99 });
  assert.notDeepEqual(point(changed, createDataFlowLayout(changed), 17, 177, 2.75), expected);
  assert.notDeepEqual(point(style, first, 17, 177, 3.5), expected);
  const more = normalizeDataFlowStyle({ fiberCount: 200 });
  assert.deepEqual(point(more, createDataFlowLayout(more), 17, 177, 2.75), expected, 'adding fibers preserves existing seeded paths');
});

test('pinches meet their width, repeat at node distance and follow signed structural flow', () => {
  const style = normalizeDataFlowStyle({ noise: 0, travelSpeed: 0, flowSpeed: 0, nodeDistance: 400, pinchSharpness: 4, spread: 100, pinchWidth: 3 });
  const out = new Float64Array(3);
  dataFlowPosition(style, .5, -.25, 0, 60, 0, out); close(out[1], 50); close(out[2], -25);
  dataFlowPosition(style, .5, -.25, 0, 260, 0, out); close(out[1], 1.5); close(out[2], -.75);
  dataFlowPosition(style, .5, -.25, 0, 460, 0, out); close(out[1], 50); close(out[2], -25);
  const moving = { ...style, flowSpeed: 100 };
  dataFlowPosition(moving, .5, -.25, 0, 60, 1, out); close(out[1], .5 * (3 + 97 / 16));
  dataFlowPosition({ ...moving, flowSpeed: -100 }, .5, -.25, 0, 60, -1, out); close(out[1], .5 * (3 + 97 / 16));
});

test('the overall clock freezes paths and pulses, clamps before start and rejects nonfinite clocks', () => {
  const style = normalizeDataFlowStyle({ speed: 0 }), layout = createDataFlowLayout(style);
  assert.deepEqual(point(style, layout, 5, 125, .1), point(style, layout, 5, 125, 200));
  const a = new Float64Array(3), b = new Float64Array(3);
  dataFlowParticlePosition(style, layout, 5, dataFlowTime(style, .1), a);
  dataFlowParticlePosition(style, layout, 5, dataFlowTime(style, 200), b); assert.deepEqual(a, b);
  assert.deepEqual(point(DEFAULT_DATA_FLOW, layout, 5, 125, -1), point(DEFAULT_DATA_FLOW, layout, 5, 125, 0));
  close(dataFlowTime({ speed: -2 }, 1.25), -2.5);
  for (const time of [NaN, Infinity, -Infinity]) assert.throws(() => dataFlowTime(style, time), RangeError);
});

test('pulses stay on the actual sampled polylines through forward, reverse and wrapped travel', () => {
  for (const particleSpeed of [-300, 0, 50, 300]) {
    const style = normalizeDataFlowStyle({ samples: 64, particleCount: 100, particleSpeed }), layout = createDataFlowLayout(style);
    const actual = new Float64Array(3), a = new Float64Array(3), b = new Float64Array(3);
    for (const time of [-17.25, 0, .3, 1200]) for (let index = 0; index < 100; index += 7) {
      dataFlowParticlePosition(style, layout, index, time, actual);
      assert.ok(actual[0] >= DATA_FLOW_START && actual[0] < DATA_FLOW_START + DATA_FLOW_LENGTH);
      const sample = (actual[0] - DATA_FLOW_START) / DATA_FLOW_LENGTH * (style.samples - 1);
      const first = Math.floor(sample), mix = sample - first, fiber = layout.particles[index * 3] * 3, step = DATA_FLOW_LENGTH / (style.samples - 1);
      dataFlowPosition(style, layout.fibers[fiber], layout.fibers[fiber + 1], layout.fibers[fiber + 2], DATA_FLOW_START + first * step, time, a);
      dataFlowPosition(style, layout.fibers[fiber], layout.fibers[fiber + 1], layout.fibers[fiber + 2], DATA_FLOW_START + (first + 1) * step, time, b);
      for (let axis = 0; axis < 3; axis++) close(actual[axis], a[axis] + (b[axis] - a[axis]) * mix, 1e-8);
    }
  }
});

test('pulse speed pauses along a fiber without stopping the structural animation', () => {
  const style = normalizeDataFlowStyle({ particleSpeed: 0 }), layout = createDataFlowLayout(style), a = new Float64Array(3), b = new Float64Array(3);
  dataFlowParticlePosition(style, layout, 10, 0, a); dataFlowParticlePosition(style, layout, 10, 3, b);
  assert.equal(a[0], b[0]); assert.notDeepEqual(a.slice(1), b.slice(1));
});

test('the visible window fades smoothly to transparent without a rectangular background', () => {
  for (const x of [-100, -30, 350, 1400]) assert.equal(dataFlowFade(x), 0);
  for (const x of [50, 100, 150]) assert.equal(dataFlowFade(x), 1);
  assert.ok(dataFlowFade(10) > 0 && dataFlowFade(10) < dataFlowFade(30));
  assert.ok(dataFlowFade(200) > dataFlowFade(300) && dataFlowFade(300) > 0);
});

test('bounds, seeds and colors are canonical, including inactive pulse density', () => {
  const style = normalizeDataFlowStyle({ particleCount: 0 });
  assert.throws(() => dataFlowParticlePosition(style, createDataFlowLayout(style), 0, 0, new Float64Array(3)), RangeError);
  for (const patch of [{ fiberCount: 0 }, { fiberCount: 301 }, { samples: 63 }, { samples: 513 }, { particleCount: 5001 }, { seed: 1.5 }, { particleSpeed: Infinity }, { lineWidth: 0 }, { particleSize: '2' }, { lineColor: 'blue' }, { particleColor: '#fff' }, { spread: 10, pinchWidth: 11 }, { code: 'void main(){}' }]) assert.throws(() => normalizeDataFlowStyle(patch));
  let accessed = false;
  assert.throws(() => normalizeDataFlowStyle({ get speed() { accessed = true; return 1; } }));
  assert.equal(accessed, false);
  const restored = normalizeDataFlowStyle(JSON.parse(JSON.stringify(normalizeDataFlowStyle({ seed: 65535, particleCount: 5000, speed: -4 }))));
  assert.deepEqual(restored, normalizeDataFlowStyle({ seed: 65535, particleCount: 5000, speed: -4 }));
});
