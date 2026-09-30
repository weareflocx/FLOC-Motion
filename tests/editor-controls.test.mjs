import test from 'node:test';
import assert from 'node:assert/strict';
import { placeElement, editClip, timeAtPointer } from '../src/editor-controls.js';
import { demoProject, patchLayer, layerAlpha } from '../src/project.js';
import { stageMarkup } from '../src/scene.js';

test('layout map clamps anchors and aligns element centers, with a snap bypass', () => {
  assert.deepEqual(placeElement(-10, 120, 10, 10, false), { x: 0, y: 95, guideX: null, guideY: null });
  assert.deepEqual(placeElement(44.7, 39.8, 10, 20), { x: 45, y: 40, guideX: 50, guideY: 50 });
  assert.deepEqual(placeElement(44.7, 39.8, 10, 20, false), { x: 44.7, y: 39.8, guideX: null, guideY: null });
  assert.equal(placeElement(84.7, 2, 10, 10).x, 85);
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
test('timing and map changes use the same rendered positions and visibility windows', () => {
  const position = placeElement(20, 70, 10, 10, false);
  let p = patchLayer(demoProject(), 'logo', { x: position.x, y: position.y, start: .5, end: 1.5 });
  p = patchLayer(p, 'logo', editClip(p.layers.find(l => l.id === 'logo'), 'move', .5, p.duration, p.fps));
  const l = p.layers.find(l => l.id === 'logo');
  assert.equal(layerAlpha(l, .9), 0); assert.equal(layerAlpha(l, 1.1), 1); assert.equal(layerAlpha(l, 2), 0);
  assert.match(stageMarkup(p), /left:20%;top:70%/);
});
test('ruler seeking maps pixels to frames and clamps the last visible frame', () => {
  const rect = { left: 100, width: 600 };
  assert.equal(timeAtPointer(400, rect, 12, 24), 6);
  assert.equal(timeAtPointer(0, rect, 12, 24), 0);
  assert.equal(timeAtPointer(900, rect, 12, 24), 12 - 1 / 24);
  assert.equal(timeAtPointer(102, rect, 12, 24), 1 / 24);
});
