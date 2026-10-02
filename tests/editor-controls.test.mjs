import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID_POINTS, freePlacement, gridPlacement, nearestGridPoint, nudgePlacement, stepGridPoint, editClip, editFade, timeAtPointer } from '../src/editor-controls.js';
import { demoProject, patchLayer, layerAlpha } from '../src/project.js';
import { stageMarkup } from '../src/scene.js';

test('6 by 6 grid has36 cell centers inside safe margins and a separate exact center', () => {
  assert.equal(GRID_POINTS.length, 37);
  assert.deepEqual(GRID_POINTS[0], { row: 0, column: 0, x: 12.5, y: 12.5 });
  assert.deepEqual(GRID_POINTS[35], { row: 5, column: 5, x: 87.5, y: 87.5 });
  assert.equal(nearestGridPoint(50, 50), 36);
  assert.equal(nearestGridPoint(89, 10), 5);
});
test('grid placement aligns the whole element and prevents clipping at safe margins', () => {
  assert.deepEqual(gridPlacement(36, 20, 10), { x: 40, y: 45, gridIndex: 36 });
  assert.equal(gridPlacement(15, 20, 10, 'left').x, 57.5);
  assert.equal(gridPlacement(15, 20, 10, 'right').x, 37.5);
  assert.deepEqual(gridPlacement(35, 55, 30), { x: 40, y: 65, gridIndex: 35 });
  assert.deepEqual(gridPlacement(0, 100, 120), { x: 0, y: 0, gridIndex: 0 });
  assert.throws(() => gridPlacement(38, 10, 10));
  assert.throws(() => gridPlacement(0, 10, 10, 'invalid'));
  for (let i = 0; i < 37; i++) for (const alignment of ['left', 'center', 'right']) {
    const p = gridPlacement(i, 35, 20, alignment);
    assert(p.x >= 5 && p.x + 35 <= 95 && p.y >= 5 && p.y + 20 <= 95);
  }
});
test('grid keyboard steps stay within rows and columns and can leave the exact center', () => {
  assert.equal(stepGridPoint(0, -1, 0), 0);
  assert.equal(stepGridPoint(5, 1, 0), 5);
  assert.equal(stepGridPoint(35, 0, 1), 35);
  assert.equal(stepGridPoint(7, 0, -1), 1);
  assert.equal(stepGridPoint(36, 1, 0), 15);
});
test('existing free positions are preserved until a grid placement is applied', () => {
  const p = demoProject(); const before = structuredClone(p.layers.find(l => l.id === 'logo'));
  const unchanged = patchLayer(p, 'logo', { visible: true });
  assert.equal(unchanged.layers.find(l => l.id === 'logo').x, before.x);
  const { x, y } = gridPlacement(36, before.size, 8);
  const placed = patchLayer(p, 'logo', { x, y });
  assert.equal(placed.layers.find(l => l.id === 'logo').x, 46.5);
  assert.equal(before.x, 87);
});
test('free placement preserves fractional positions without a grid or safe-margin jump', () => {
  assert.deepEqual(freePlacement(3.125, 42.333333, 20, 10), { x: 3.125, y: 42.333333 });
  assert.deepEqual(freePlacement(-5, 100, 20, 10), { x: 0, y: 90 });
  assert.deepEqual(freePlacement(95, 95, 55, 30), { x: 45, y: 70 });
  assert.deepEqual(freePlacement(12, 12, 100, 120), { x: 0, y: 0 });
  const position = freePlacement(21.1234567, 34.5678901, 20, 10);
  const project = patchLayer(demoProject(), 'logo', position);
  assert.match(stageMarkup(project), /left:21.123457%;top:34.56789%/);
});
test('keyboard nudges use composition pixels, independent of aspect ratio and preview scale', () => {
  for (const dimensions of [[1080, 1080], [1920, 1080], [1080, 1920], [1080, 1440], [1440, 1080]]) {
    const initial = { x: 23.123456, y: 41.654321 };
    const bounds = { width: 20, height: 10 };
    for (const step of [1, 10]) {
      const next = nudgePlacement(initial, 1, -1, dimensions, bounds, step);
      assert(Math.abs((next.x - initial.x) * dimensions[0] / 100 - step) < .00002);
      assert(Math.abs((initial.y - next.y) * dimensions[1] / 100 - step) < .00002);
      assert.doesNotThrow(() => patchLayer(demoProject(), 'logo', next));
    }
    assert.deepEqual(nudgePlacement({ x: 0, y: 90 }, -1, 1, dimensions, bounds), { x: 0, y: 90 });
  }
});
test('clip movement stays in bounds, keeps its span and quantizes drag deltas to frames', () => {
  const clip = { start: 2, end: 5 };
  assert.deepEqual(editClip(clip, 'move', -50, 12, 24), { start: 0, end: 3 });
  assert.deepEqual(editClip(clip, 'move', 50, 12, 24), { start: 9, end: 12 });
  const next = editClip(clip, 'move', .06, 12, 24);
  assert.equal(next.start, 2 + 1 / 24);
  assert(Math.abs(next.end - next.start - 3) < 1e-12);
});
test('edge trimming prevents crossing and is valid for short imported clips', () => {
  for (const fps of [24, 30]) for (const start of [0, .1, .333333, 1.123456789, 11.95])
    for (const span of [.01000001, .0100001, .04, .2]) for (const kind of ['start', 'end', 'move'])
      for (const delta of [-50, -.2, .01, .2, 50]) {
        const clip = { start, end: start + span }; if (clip.end > 12) continue;
        const next = editClip(clip, kind, delta, 12, fps);
        assert.doesNotThrow(() => patchLayer(demoProject(), 'logo', next));
        if (kind === 'move') assert(Math.abs(next.end - next.start - span) < 1e-12);
      }
  assert.throws(() => editClip({ start: 0, end: 2 }, 'invalid', 1, 12, 24));
});
test('fade handles quantize to frames, stay inside the clip and lengthen the fade-out when moved left', () => {
  const clip = { start: 2, end: 5, fadeIn: 0.5, fadeOut: 0.5 };
  assert.deepEqual(editFade(clip, 'fadeIn', .06, 24), { fadeIn: 0.5 + 1 / 24, fadeOut: 0.5 });
  assert.deepEqual(editFade(clip, 'fadeOut', -.06, 24), { fadeIn: 0.5, fadeOut: 0.5 + 1 / 24 });
  assert.deepEqual(editFade(clip, 'fadeOut', .06, 24), { fadeIn: 0.5, fadeOut: 0.5 - 1 / 24 });
  assert.deepEqual(editFade(clip, 'fadeIn', -12, 24), { fadeIn: 0, fadeOut: 0.5 }); assert.deepEqual(editFade(clip, 'fadeIn', 12, 24), { fadeIn: 2.5, fadeOut: 0.5 });
  assert.deepEqual(editFade(clip, 'fadeOut', -12, 24), { fadeIn: 0.5, fadeOut: 2.5 }); assert.deepEqual(editFade(clip, 'fadeOut', 12, 24), { fadeIn: 0.5, fadeOut: 0 });
  assert.throws(() => editFade(clip, 'fade', 1, 24), /Unknown fade/);
  for (const fps of [24, 30]) for (const kind of ['fadeIn', 'fadeOut']) for (const delta of [-50, -.2, .01, .2, 50]) {
    const next = editFade({ start: .1, end: .3, fadeIn: .05, fadeOut: .1 }, kind, delta, fps);
    const logo = patchLayer(demoProject(), 'logo', { start: .1, end: .3, ...next }).layers.find(l => l.id === 'logo');
    assert.deepEqual([logo.fadeIn, logo.fadeOut], [next.fadeIn, next.fadeOut]);
  }
});
test('timing and map changes use the same rendered positions and visibility windows', () => {
  const position = gridPlacement(25, 10, 10);
  let p = patchLayer(demoProject(), 'logo', { x: position.x, y: position.y, start: .5, end: 1.5 });
  p = patchLayer(p, 'logo', editClip(p.layers.find(l => l.id === 'logo'), 'move', .5, p.duration, p.fps));
  const l = p.layers.find(l => l.id === 'logo');
  assert.equal(layerAlpha(l, .9), 0); assert.equal(layerAlpha(l, 1.1), 1); assert.equal(layerAlpha(l, 2), 0);
  assert.match(stageMarkup(p), /left:22.5%;top:67.5%/);
});
test('ruler seeking maps pixels to frames and clamps the last visible frame', () => {
  const rect = { left: 100, width: 600 };
  assert.equal(timeAtPointer(400, rect, 12, 24), 6);
  assert.equal(timeAtPointer(0, rect, 12, 24), 0);
  assert.equal(timeAtPointer(900, rect, 12, 24), 12 - 1 / 24);
  assert.equal(timeAtPointer(102, rect, 12, 24), 1 / 24);
});
