import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as projectOps from '../src/project.js';
import * as historyOps from '../src/editor/history.js';
import * as selectionOps from '../src/editor/selection.js';
import * as arrangeOps from '../src/editor/arrange.js';
import * as boundsOps from '../src/editor/layer-bounds.js';
import * as distributeOps from '../src/editor/distribute.js';
import * as choreographyOps from '../src/choreography.js';
import { safeArea } from '../src/layout.js';
import { BRAND } from '../src/brand.js';
import { captureState, evaluateChoreography } from '../src/choreography.js';
import { applyArrangement } from '../src/editor/arrange.js';
import { DISTRIBUTE_LAYOUTS, defaultDistribution, distributionTargets } from '../src/editor/distribute.js';

const near = (actual, expected, message, tolerance = 1e-4) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ''} expected ${expected}, got ${actual}`);
const settings = (layout, options = {}, common = {}) => ({ ...defaultDistribution(), layout, safeArea: false, center: { x: 50, y: 50 }, ...common, [layout]: { ...defaultDistribution()[layout], ...options } });
// Target boxes in composition pixels: each member keeps its measured size.
function boxes(rects, result, format) {
  const [width, height] = projectOps.FORMATS[format];
  return result.targets.map(target => {
    const rect = rects.find(item => item.id === target.id);
    return { id: target.id, x: target.cx / 100 * width, y: target.cy / 100 * height, w: rect.width / 100 * width, h: rect.height / 100 * height, roll: target.roll };
  });
}
const mixed = [
  { id: 'a', x: 10, y: 10, width: 10, height: 10 },
  { id: 'b', x: 40, y: 30, width: 20, height: 5 },
  { id: 'c', x: 70, y: 60, width: 5, height: 20 }
];

test('layouts expose their defaults', () => {
  assert.deepEqual(Object.keys(DISTRIBUTE_LAYOUTS), ['line', 'grid', 'circle', 'arc']);
  const defaults = defaultDistribution();
  assert.equal(defaults.layout, 'line');
  assert.equal(defaults.order, 'layers');
  assert.equal(defaults.safeArea, true);
  assert.deepEqual([defaults.line.angle, defaults.line.spacing, defaults.circle.startAngle, defaults.arc.startAngle, defaults.arc.endAngle], [0, 4, -90, 200, 340]);
  assert.throws(() => distributionTargets(mixed, { layout: 'spiral' }), /Unknown distribution layout/);
});

test('a line keeps equal gaps between visible edges for mixed sizes at any angle', () => {
  const unit = 1080 / 100;
  for (const angle of [0, 90, 30, -135]) {
    const result = distributionTargets(mixed, settings('line', { angle, spacing: 4 }), { format: 'landscape' });
    const placed = boxes(mixed, result, 'landscape');
    const radians = angle * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
    const extent = box => Math.abs(box.w * cos) + Math.abs(box.h * sin);
    const along = placed.map(box => (box.x - 960) * cos + (box.y - 540) * sin);
    for (let i = 1; i < placed.length; i++) {
      near(along[i] - along[i - 1] - (extent(placed[i]) + extent(placed[i - 1])) / 2, 4 * unit, `gap at ${angle}°`);
      near((placed[i].x - 960) * sin - (placed[i].y - 540) * cos, 0, 'members stay on the line');
    }
    near(along[0] - extent(placed[0]) / 2, -(along.at(-1) + extent(placed.at(-1)) / 2), 'the line is centered');
  }
});

test('a grid sizes columns and rows from their largest member and keeps the gaps', () => {
  const rects = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, x: i * 15, y: 10, width: 5 + i, height: 4 + i }));
  const result = distributionTargets(rects, settings('grid', { gapX: 2, gapY: 3 }), { format: 'square' });
  const placed = boxes(rects, result, 'square');
  const columns = [...new Set(placed.map(box => box.x.toFixed(4)))], rows = [...new Set(placed.map(box => box.y.toFixed(4)))];
  assert.deepEqual([columns.length, rows.length], [3, 2], 'five members default to three columns');
  const unit = 10.8, colWidth = c => Math.max(...placed.filter((_, i) => i % 3 === c).map(box => box.w));
  for (let c = 1; c < 3; c++) near(placed[c].x - placed[c - 1].x, (colWidth(c) + colWidth(c - 1)) / 2 + 2 * unit, `column ${c}`);
  const rowHeight = r => Math.max(...placed.filter((_, i) => Math.floor(i / 3) === r).map(box => box.h));
  near(placed[3].y - placed[0].y, (rowHeight(0) + rowHeight(1)) / 2 + 3 * unit, 'row gap');
  near(placed[0].y, placed[2].y, 'cells in a row share a center line');
  const two = boxes(rects, distributionTargets(rects, settings('grid', { columns: 2 }), { format: 'square' }), 'square');
  assert.equal(new Set(two.map(box => box.y.toFixed(4))).size, 3, 'two columns need three rows');
});

test('a circle spaces members evenly from the top, clockwise, and stays round in every format', () => {
  const rects = Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, x: i * 10, y: 20, width: 4, height: 4 }));
  for (const format of ['landscape', 'portrait']) {
    const result = distributionTargets(rects, settings('circle', { radius: 30 }), { format });
    const [width, height] = projectOps.FORMATS[format];
    const angles = boxes(rects, result, format).map(box => {
      near(Math.hypot(box.x - width / 2, box.y - height / 2), 324, `${format}: radius in pixels`);
      return Math.atan2(box.y - height / 2, box.x - width / 2) * 180 / Math.PI;
    });
    angles.forEach((angle, i) => near(((angle - (-90 + i * 60)) % 360 + 540) % 360 - 180, 0, `${format}: member ${i} angle`));
    assert.equal(result.radius, 30);
  }
});

test('the default circle radius keeps neighbours apart and is at least 15%', () => {
  const small = Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, x: i * 10, y: 0, width: 2, height: 2 }));
  assert.equal(distributionTargets(small, settings('circle'), { format: 'square' }).radius, 15);
  const big = Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, x: i * 5, y: 0, width: 20, height: 12 }));
  const result = distributionTargets(big, settings('circle'), { format: 'square' });
  assert.ok(result.radius > 15);
  const placed = boxes(big, result, 'square');
  placed.forEach((box, i) => {
    const next = placed[(i + 1) % placed.length];
    assert.ok(Math.abs(box.x - next.x) >= box.w - 1e-6 || Math.abs(box.y - next.y) >= box.h - 1e-6, `neighbours ${i} and ${(i + 1) % placed.length} do not overlap`);
  });
  assert.ok(result.radius > distributionTargets(big.map(rect => ({ ...rect, width: 10, height: 6 })), settings('circle'), { format: 'square' }).radius, 'larger members need a larger ring');
});

test('an arc spans both end angles and centers its visible bounds on the selection by default', () => {
  const rects = Array.from({ length: 3 }, (_, i) => ({ id: `r${i}`, x: 20 + i * 20, y: 40, width: 6, height: 6 }));
  const result = distributionTargets(rects, settings('arc', { radius: 25 }), { format: 'landscape' });
  const angles = boxes(rects, result, 'landscape').map(box => Math.atan2(box.y - 540, box.x - 960) * 180 / Math.PI);
  [-160, -90, -20].forEach((expected, i) => near(angles[i], expected, `arc member ${i}`));
  const auto = distributionTargets(rects, { ...settings('arc', { radius: 25 }), center: null }, { format: 'landscape' });
  near(auto.bounds.x + auto.bounds.width / 2, 43, 'bounds center x');
  near(auto.bounds.y + auto.bounds.height / 2, 43, 'bounds center y');
  assert.ok(auto.center.y > auto.bounds.y + auto.bounds.height, 'the circle center sits below the upper arc');
  assert.equal(result.handleAngle, 270);
});

test('orders follow the selection, the current position, or its reverse', () => {
  const rects = [{ id: 'a', x: 70, y: 10, width: 5, height: 5 }, { id: 'b', x: 10, y: 10, width: 5, height: 5 }, { id: 'c', x: 40, y: 10, width: 5, height: 5 }];
  const leftToRight = order => distributionTargets(rects, settings('line', {}, { order }), { format: 'square' }).targets.sort((p, q) => p.cx - q.cx).map(target => target.id);
  assert.deepEqual(leftToRight('layers'), ['a', 'b', 'c']);
  assert.deepEqual(leftToRight('position'), ['b', 'c', 'a']);
  assert.deepEqual(leftToRight('reverse'), ['c', 'b', 'a']);
});

test('circle and arc orientation set absolute rolls; other layouts keep rotation', () => {
  const rects = Array.from({ length: 4 }, (_, i) => ({ id: `r${i}`, x: i * 10, y: 10, width: 4, height: 2 }));
  const rolls = orientation => distributionTargets(rects, settings('circle', { radius: 30, orientation }), { format: 'square' }).targets.map(target => target.roll);
  assert.deepEqual(rolls('tangent'), [0, 90, -180, -90]);
  assert.deepEqual(rolls('center'), [-180, -90, 0, 90]);
  assert.deepEqual(rolls('none'), [undefined, undefined, undefined, undefined]);
  assert.ok(distributionTargets(rects, settings('line'), { format: 'square' }).targets.every(target => !('roll' in target)));
  const arc = distributionTargets(rects.slice(0, 2), settings('arc', { radius: 30, orientation: 'center', startAngle: 180, endAngle: 360 }), { format: 'square' });
  assert.deepEqual(arc.targets.map(target => target.roll), [90, -90]);
});

test('the safe area moves the whole arrangement inside, or keeps it centered and reports it does not fit', () => {
  const layout = { enabled: true, marginX: 5, marginY: 5, guides: true };
  const near_edge = { ...settings('line'), safeArea: true, center: { x: 5, y: 50 } };
  const fitted = distributionTargets(mixed, near_edge, { format: 'landscape', layout });
  assert.equal(fitted.fits, true);
  near(fitted.bounds.x, 5, 'flush with the left margin');
  const free = distributionTargets(mixed, { ...near_edge, safeArea: false }, { format: 'landscape', layout });
  assert.ok(free.bounds.x < 0, 'without the option the line may leave the frame');
  const wide = distributionTargets(mixed, { ...near_edge, line: { angle: 0, spacing: 50 } }, { format: 'landscape', layout });
  assert.equal(wide.fits, false);
  near(wide.bounds.x + wide.bounds.width / 2, 50, 'kept centered in the safe area');
  const frame = distributionTargets(mixed, { ...near_edge, center: { x: 0, y: 50 } }, { format: 'landscape' });
  near(frame.bounds.x, 0, 'no margins: the frame is the limit');
});

// Workspace harness: real project validation and history; a stub scene measures boxes.
const strip = code => code.replace(/^import .*;\n/gm, '').replace(/export function /g, 'function ');
const read = file => fs.readFileSync(new URL(`../src/editor/${file}`, import.meta.url), 'utf8');
function workspace({ pointer } = {}) {
  const slots = []; let cursor = 0, notices = [];
  const context = { ...choreographyOps, ...projectOps, ...historyOps, ...selectionOps, ...arrangeOps, ...boundsOps, ...distributeOps, safeArea, BRAND,
    effectLayer() {}, editorSession: () => ({ draftId: 'draft', compositionId: null, remember() {} }), crypto: { randomUUID: () => 'id' },
    useCallback: fn => fn, useEffect() {},
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; } };
  const code = ['choreography-edit.js', 'useProject.js', 'useCompositionActions.js'].map(file => strip(read(file))).join('\n');
  const { useProject, useCompositionActions } = new Function(...Object.keys(context), `${code}\nreturn { useProject, useCompositionActions };`)(...Object.values(context));
  let api, actions;
  const render = () => { cursor = 0; api = useProject(); actions = useCompositionActions({ project: api.projectRef.current, projectRef: api.projectRef, selected: null, change: api.change, report: message => notices.push(message), setSelected() {}, setSelection() {} }); };
  render();
  api.importDraft(projectOps.demoProject());
  render();
  const boxesById = { headline: [10, 6, 40, 10], signature: [70, 90, 20, 5], logo: [87, 6, 7, 7], carousel: [30, 40, 30, 20] };
  const nodes = Object.entries(boxesById).map(([id, [x, y]]) => ({ dataset: { flocLayer: id }, style: { left: `${x}%`, top: `${y}%` } }));
  const root = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }), querySelectorAll: () => nodes };
  boundsOps.registerStageScene(root, {
    projectedBounds: id => boxesById[id] ? { x: boxesById[id][0], y: boxesById[id][1], width: boxesById[id][2], height: boxesById[id][3] } : null,
    projectPointer: pointer ?? ((u, v) => ({ x: u * 100, y: v * 100, z: 0 }))
  });
  return { root, render, notices, get api() { return api; }, get actions() { return actions; }, get project() { return api.projectRef.current; } };
}
const ids = ['headline', 'signature', 'logo'];
const layer = (w, id) => w.project.layers.find(item => item.id === id);

test('a preview plan never edits the project; Apply is one undoable change through patchLayer', () => {
  const w = workspace(), before = w.project;
  const plan = w.actions.distributeLayers(settings('line'), ids, 1, w.root);
  assert.equal(w.project, before);
  assert.equal(w.api.history.length, 0);
  assert.deepEqual(Object.keys(plan.preview.layers), ids);
  assert.equal(plan.preview.distribution.layout, 'line');
  const result = w.actions.distributeLayers(settings('line'), ids, 1, w.root, { commit: true, snapshot: plan.snapshot }); w.render();
  assert.equal(w.api.history.length, 1);
  for (const move of result.moves) assert.deepEqual([layer(w, move.id).x, layer(w, move.id).y], [move.x, move.y]);
  // The stub projection is 1:1 in canvas percent: the authored x moves by the visible-center displacement.
  const headline = plan.targets.find(target => target.id === 'headline');
  near(layer(w, 'headline').x, before.layers.find(item => item.id === 'headline').x + headline.cx - 30, 'headline moves by the visible-center displacement');
  w.api.undo(); w.render();
  assert.deepEqual(w.project, before);
});

test('a keyframed layer shifts every state by the same offset without gaining a state', () => {
  const w = workspace();
  const headline = layer(w, 'headline');
  let choreography = captureState(headline, 0, 24, { x: 6, y: 6, roll: 170 }, 'start');
  choreography = captureState({ ...headline, choreography }, 4, 24, { x: 40, y: 20, roll: -170 }, 'end');
  w.api.patch('headline', { choreography }); w.render();
  const states = layer(w, 'headline').choreography, history = w.api.history.length;
  const before = evaluateChoreography(layer(w, 'headline'), 2);
  const result = w.actions.distributeLayers(settings('circle', { radius: 20, orientation: 'center' }), ids, 2, w.root, { commit: true }); w.render();
  assert.equal(w.api.history.length, history + 1);
  const moved = layer(w, 'headline'), move = result.moves.find(item => item.id === 'headline');
  assert.equal(moved.choreography.length, states.length, 'no state is added');
  assert.deepEqual(moved.choreography.map(state => state.id), states.map(state => state.id));
  const pose = evaluateChoreography(moved, 2);
  near(pose.x, move.x, 'the playhead pose reaches the target x');
  near(pose.y, move.y, 'the playhead pose reaches the target y');
  near(moved.choreography[1].values.x - moved.choreography[0].values.x, 34, 'the animation keeps its x travel');
  near(moved.choreography[1].values.y - moved.choreography[0].values.y, 14, 'the animation keeps its y travel');
  const turn = distributeOps.wrapRoll(result.moves.find(item => item.id === 'headline').roll - before.roll);
  assert.equal(result.moves.find(item => item.id === 'headline').roll, -180, 'the top member faces down toward the center');
  assert.deepEqual(moved.choreography.map(state => state.values.roll), [distributeOps.wrapRoll(170 + turn), distributeOps.wrapRoll(-170 + turn)], 'every state turns by the same wrapped amount');
  assert.ok(moved.choreography.every(state => state.values.roll >= -180 && state.values.roll <= 180));
});

test('orientation turns every layer the same way on screen despite different roll conventions', () => {
  const w = workspace();
  // Circle order: headline at the top, carousel at the right, signature at the bottom, logo at the left.
  const result = w.actions.distributeLayers(settings('circle', { radius: 20, orientation: 'tangent' }), ['headline', 'carousel', 'signature', 'logo'], 1, w.root, { commit: true }); w.render();
  const roll = id => result.moves.find(move => move.id === id).roll;
  assert.equal(roll('headline'), 0);
  assert.equal(roll('carousel'), -90, 'Three.js layers store a clockwise screen turn as negative roll');
  assert.equal(Math.abs(roll('signature')), 180);
  assert.equal(roll('logo'), -90, 'CSS layers store a clockwise screen turn as positive roll');
  assert.equal(layer(w, 'carousel').roll, -90);
});

test('a layer held back by its position range is reported instead of silently breaking the spacing', () => {
  const w = workspace();
  // A wide line in a square frame pushes the carousel center below its 10% limit.
  const plan = w.actions.distributeLayers(settings('line', { spacing: 40 }, { safeArea: true }), ['carousel', 'headline', 'signature', 'logo'], 1, w.root);
  assert.equal(plan.fits, false);
  // The carousel stops at its 10% center limit and the signature text at its 95% left edge.
  assert.deepEqual(plan.limited.map(layer => layer.id), ['carousel', 'signature']);
  assert.equal(plan.preview.layers.signature.x, 95);
  assert.equal(plan.preview.layers.carousel.x, 10);
  assert.deepEqual(w.actions.distributeLayers(settings('line', { spacing: 1 }), ['headline', 'signature'], 1, w.root).limited, []);
});

test('locked, hidden and off-playhead layers are excluded and listed', () => {
  const w = workspace();
  w.api.patch('logo', { locked: true }); w.render();
  const locked = layer(w, 'logo');
  const plan = w.actions.distributeLayers(settings('line'), ids, 1, w.root, { commit: true }); w.render();
  assert.deepEqual(plan.targets.map(target => target.id), ['headline', 'signature']);
  assert.deepEqual(plan.excluded, [{ id: 'logo', name: 'Studio mark', reason: 'locked' }]);
  assert.deepEqual(layer(w, 'logo'), locked);
  w.api.patch('signature', { visible: false }); w.render();
  assert.equal(w.actions.distributeLayers(settings('line'), ids, 1, w.root), null, 'one movable layer cannot be distributed');
  assert.match(w.notices.at(-1), /two or more unlocked layers/);
  assert.deepEqual(selectionOps.excludedLayers(w.project, ids, 1).map(item => item.reason), ['hidden', 'locked']);
  w.api.patch('signature', { visible: true, start: 5 }); w.render();
  assert.deepEqual(selectionOps.excludedLayers(w.project, ids, 1).map(item => item.reason), ['not at the playhead', 'locked']);
});

test('unmeasured layers are reported instead of guessed', () => {
  const w = workspace(), before = w.project;
  const root = { ...w.root };
  boundsOps.registerStageScene(root, { projectedBounds: id => id === 'logo' ? null : { x: 10, y: 10, width: 5, height: 5 }, projectPointer: (u, v) => ({ x: u * 100, y: v * 100 }) });
  assert.equal(w.actions.distributeLayers(settings('line'), ids, 1, root, { commit: true }), null);
  assert.match(w.notices.at(-1), /Show the selected layers on the canvas/);
  assert.equal(w.project, before);
});

test('Spatial layers convert the screen displacement through the projection', () => {
  // The logo's depth plane moves half as far as the screen pointer.
  const w = workspace({ pointer: (u, v, id) => id === 'logo' ? { x: u * 50, y: v * 50, z: 0 } : { x: u * 100, y: v * 100, z: 0 } });
  const plan = w.actions.distributeLayers(settings('grid', { columns: 3 }), ids, 1, w.root);
  const target = plan.targets.find(item => item.id === 'logo'), move = plan.moves.find(item => item.id === 'logo');
  near(move.x - 87, (target.cx - 90.5) / 2, 'x follows the projected plane');
  near(move.y - 6, (target.cy - 9.5) / 2, 'y follows the projected plane');
});

test('applyArrangement rotates a static layer and leaves unchanged layers untouched', () => {
  const project = projectOps.validateProject(projectOps.demoProject());
  const logo = project.layers.find(item => item.id === 'logo');
  const next = applyArrangement(project, [{ id: 'logo', x: 20, y: 30, roll: 190 }, { id: 'signature', x: 77, y: 92 }], 0);
  const placed = next.layers.find(item => item.id === 'logo');
  assert.deepEqual([placed.x, placed.y, placed.roll], [20, 30, -170]);
  assert.deepEqual(next.layers.find(item => item.id === 'signature'), project.layers.find(item => item.id === 'signature'));
  assert.equal(applyArrangement(project, [{ id: 'logo', x: logo.x, y: logo.y }], 0), project);
});
