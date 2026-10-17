import test from 'node:test';
import assert from 'node:assert/strict';
import { DEPTH_GAP, clampDepth, depthCounts, depthEditable, depthGuide, depthLabel, depthScale, nextDepth, outerDepth, sameDepthInfo, snapDepth } from '../src/editor/depth.js';

const wheel = { id: 'wheel', min: -30, max: 40, pieces: [{ min: -30, max: -10 }, { min: -20, max: 0 }, { min: 5, max: 15 }, { min: 20, max: 40 }] };
const plane = { id: 'logo', min: 60, max: 60, pieces: [{ min: 60, max: 60 }] };
const self = { id: 'title', min: 0, max: 0, pieces: [{ min: 0, max: 0 }] };

test('stops sit between consecutive piece centers, overlapping or not, and just outside every piece', () => {
  const guide = depthGuide([wheel, plane, self], 'title');
  assert.equal(guide.pieces.length, 5, 'the placed layer is excluded from its own guide');
  assert.deepEqual(guide.stops, [-30 - DEPTH_GAP, -15, 0, 20, 45, 60 + DEPTH_GAP]);
  assert.equal(guide.back, -35);
  assert.equal(guide.front, 65);
});

test('tilted cards whose depth ranges all overlap still give one stop per card', () => {
  const tilted = { id: 'wheel', min: -20, max: 30, pieces: [{ min: -20, max: 10 }, { min: -10, max: 20 }, { min: 0, max: 30 }] };
  const guide = depthGuide([tilted, self], 'title');
  assert.deepEqual(guide.stops, [-25, 0, 10, 35]);
  assert.equal(nextDepth(guide, 0, 1), 10, 'one step passes one card, not the whole wheel');
  assert.equal(depthLabel(guide, 10), 'In front of 2 · Behind 1');
  assert.equal(nextDepth(guide, -25, 1), 0);
  assert.equal(depthLabel(guide, 0), 'In front of 1 · Behind 2');
});

test('next front/back pass one piece per step and stay put beyond the last piece', () => {
  const guide = depthGuide([wheel, plane], 'title');
  assert.equal(nextDepth(guide, 0, 1), 20);
  assert.equal(nextDepth(guide, 20, 1), 45);
  assert.equal(nextDepth(guide, 0, -1), -15);
  assert.equal(nextDepth(guide, 8, -1), -15, 'inside a card, the next stop behind passes the card center behind it');
  assert.equal(nextDepth(guide, 65, 1), 65);
  assert.equal(nextDepth(guide, 80, 1), 80);
  assert.equal(outerDepth(guide, 0, 1), 65);
  assert.equal(outerDepth(guide, 0, -1), -35);
  const empty = depthGuide([self], 'title');
  assert.equal(nextDepth(empty, 12, 1), 12);
  assert.equal(outerDepth(empty, 12, -1), 12);
});

test('depth stays inside the project range and its 0.1 step', () => {
  assert.equal(clampDepth(1234), 1000);
  assert.equal(clampDepth(-1234), -1000);
  assert.equal(clampDepth(1.26), 1.3);
  const edge = depthGuide([{ id: 'far', min: 990, max: 999, pieces: [{ min: 990, max: 999 }] }]);
  assert.equal(edge.front, 1000);
  assert.equal(edge.back, 985);
});

test('snapping pulls toward stops and layer edges/centers within the threshold only', () => {
  const guide = depthGuide([wheel, plane], 'title');
  assert.equal(snapDepth(guide, 18.4, 2), 20);
  assert.equal(snapDepth(guide, 38.6, 2), 40, 'the wheel edge');
  assert.equal(snapDepth(guide, 5.5, 1), 5, 'the wheel center');
  assert.equal(snapDepth(guide, 59, 2), 60, 'a plane');
  assert.equal(snapDepth(guide, 25.3, 2), 25.3);
});

test('counts report the pieces in front of and behind the layer by their centers', () => {
  const guide = depthGuide([wheel, plane], 'title');
  assert.deepEqual(depthCounts(guide, 20), { inFront: 3, behind: 2 });
  assert.deepEqual(depthCounts(guide, -35), { inFront: 0, behind: 5 });
  assert.deepEqual(depthCounts(guide, 10), { inFront: 2, behind: 2 }, 'a piece centered at the layer is neither');
  assert.equal(depthLabel(guide, 65), 'In front of 5 · Behind 0');
});

test('only one visible, unlocked, depth-capable layer inside its time range is editable', () => {
  const layer = { type: 'text', visible: true, locked: false, start: 0, end: 5 };
  assert.equal(depthEditable(layer, 1), true);
  assert.equal(depthEditable({ ...layer, locked: true }, 1), false);
  assert.equal(depthEditable({ ...layer, visible: false }, 1), false);
  assert.equal(depthEditable(layer, 5), false);
  for (const type of ['background', 'music', 'effect']) assert.equal(depthEditable({ ...layer, type }, 1), false);
  for (const type of ['logo', 'media', 'model', 'carousel']) assert.equal(depthEditable({ ...layer, type }, 1), true);
});

test('the ruler scale fits every piece and the layer with a margin; equal reports compare equal', () => {
  const guide = depthGuide([wheel, plane], 'title');
  const { low, high } = depthScale(guide, [0]);
  assert.ok(low < -30 && high > 60);
  assert.deepEqual(depthScale(depthGuide([]), [0]), { low: -10, high: 10 });
  assert.equal(sameDepthInfo([wheel, plane], structuredClone([wheel, plane])), true);
  assert.equal(sameDepthInfo([wheel], [{ ...wheel, pieces: [...wheel.pieces.slice(1), { min: 20, max: 41 }] }]), false);
});

test('every step passes exactly one more piece center, even from beyond the outer stops', () => {
  const guide = depthGuide([wheel, plane], 'title');
  assert.deepEqual(guide.stops, [-35, -15, 0, 20, 45, 65]);
  assert.equal(nextDepth(guide, -100, 1), -15, 'from far behind, the first press passes the backmost card');
  assert.equal(nextDepth(guide, 100, -1), 45, 'from far in front, the first press passes the plane');
  assert.equal(nextDepth(guide, -100, -1), -100, 'already behind everything');
  assert.equal(nextDepth(guide, -32, -1), -32, 'between the back stop and the last piece nothing is left to pass');
  assert.equal(nextDepth(guide, 100, 1), 100);
  for (const [start, direction] of [[-100, 1], [-32, 1], [100, -1], [62, -1]]) {
    let z = start, counts = depthCounts(guide, z);
    for (let press = 0; press < 5; press++) {
      const next = nextDepth(guide, z, direction), after = depthCounts(guide, next);
      const passed = direction > 0 ? after.inFront - counts.inFront : after.behind - counts.behind;
      assert.equal(passed, 1, `press ${press + 1} from ${start} (${z} → ${next})`);
      z = next; counts = after;
    }
    assert.equal(nextDepth(guide, z, direction), z, 'beyond the last piece the depth stays');
  }
});
