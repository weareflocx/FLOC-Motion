import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as projectOps from '../src/project.js';
import * as historyOps from '../src/editor/history.js';
import * as selectionOps from '../src/editor/selection.js';
import * as arrangeOps from '../src/editor/arrange.js';
import * as boundsOps from '../src/editor/layer-bounds.js';
import { safeArea } from '../src/layout.js';
import { BRAND } from '../src/brand.js';
import * as choreographyOps from '../src/choreography.js';
import { captureState, evaluateChoreography } from '../src/choreography.js';
import { alignDeltas, distributeDeltas, groupPositions } from '../src/editor/arrange.js';
import { rangeSelection, selectAllIds, toggleSelection, transformableLayers } from '../src/editor/selection.js';

const strip = code => code.replace(/^import .*;\n/gm, '').replace(/export function /g, 'function ');
const read = file => fs.readFileSync(new URL(`../src/editor/${file}`, import.meta.url), 'utf8');

test('selection toggles, ranges from the anchor in list order and keeps the clicked layer primary', () => {
  assert.deepEqual(toggleSelection(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggleSelection(['a', 'b'], 'a'), ['b']);
  const order = ['logo', 'signature', 'headline', 'carousel', 'background'];
  assert.deepEqual(rangeSelection(order, 'signature', 'carousel'), ['signature', 'headline', 'carousel']);
  assert.deepEqual(rangeSelection(order, 'carousel', 'logo'), ['carousel', 'headline', 'signature', 'logo']);
  assert.deepEqual(rangeSelection(order, 'missing', 'logo'), ['logo']);
});

test('the selection hook extends Shift ranges from the last plain or toggle click and prunes removed layers', async () => {
  const slots = []; let cursor = 0, effects = [];
  const context = { ...selectionOps,
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useCallback: fn => fn, useEffect: fn => effects.push(fn) };
  vm.createContext(context); vm.runInContext(strip(read('useSelection.js')), context);
  const order = ['logo', 'signature', 'headline', 'carousel'];
  let layers = order.map(id => ({ id }));
  const render = () => { cursor = 0; effects = []; const api = context.useSelection({ layers, initial: 'carousel' }); effects.forEach(fn => fn()); cursor = 0; return context.useSelection({ layers, initial: 'carousel' }); };
  let api = render();
  api.selectLayer('signature'); api = render();
  api.selectLayer('carousel', 'range', order); api = render();
  assert.deepEqual([...api.selection], ['signature', 'headline', 'carousel']); assert.equal(api.selected, 'carousel');
  api.selectLayer('logo', 'range', order); api = render();
  assert.deepEqual([...api.selection], ['signature', 'logo'], 'a second Shift-click re-spans from the same anchor');
  api.selectLayer('carousel', 'toggle'); api = render();
  assert.deepEqual([...api.selection], ['signature', 'logo', 'carousel']);
  layers = layers.filter(layer => layer.id !== 'logo'); api = render();
  assert.deepEqual([...api.selection], ['signature', 'carousel']);
  layers = [{ id: 'other' }]; api = render();
  assert.deepEqual([...api.selection], ['other'], 'a fully removed selection falls back to the first layer, as before');
});

test('select all and group transforms take unlocked, visible, positionable layers on the playhead', () => {
  const project = projectOps.validateProject(projectOps.demoProject());
  project.layers.find(layer => layer.id === 'logo').locked = true;
  project.layers.find(layer => layer.id === 'signature').visible = false;
  assert.deepEqual(selectAllIds(project, 1), ['carousel', 'headline']);
  assert.deepEqual(transformableLayers(project, ['background', 'music', 'logo', 'signature', 'headline'], 1).map(layer => layer.id), ['headline']);
  project.layers.find(layer => layer.id === 'headline').start = 2;
  assert.deepEqual(selectAllIds(project, 1), ['carousel']);
});

test('alignment and distribution move measured boxes, and group offsets respect every member limit', () => {
  const rects = [{ id: 'a', x: 10, y: 6, width: 40, height: 10 }, { id: 'b', x: 70, y: 90, width: 20, height: 5 }, { id: 'c', x: 87, y: 6, width: 7, height: 7 }];
  assert.deepEqual(alignDeltas(rects, 'left').map(d => d.dx), [0, -60, -77]);
  assert.deepEqual(alignDeltas(rects, 'right').map(d => d.dx), [44, 4, 0]);
  assert.deepEqual(alignDeltas(rects, 'middle').map(d => d.dy), [39.5, -42, 41]);
  assert.deepEqual(alignDeltas([rects[0]], 'center', safeArea({ enabled: true, marginX: 5, marginY: 5 })).map(d => d.dx), [20]);
  const spaced = distributeDeltas(rects, 'horizontal');
  assert.deepEqual(spaced.map(d => [d.id, d.dx]), [['a', 0], ['b', -11.5], ['c', 0]]);
  assert.deepEqual(distributeDeltas(rects.slice(0, 2), 'vertical'), []);
  assert.throws(() => alignDeltas(rects, 'diagonal'), /Unknown alignment/);
  const members = [{ id: 't', type: 'text', start: { x: 90, y: 50 } }, { id: 'c', type: 'carousel', start: { x: 50, y: 50 } }, { id: 'm', type: 'media', start: { x: 400, y: 0 } }];
  assert.deepEqual(groupPositions(members, 20, -60).map(({ x, y }) => [x, y]), [[95, 10], [55, 10], [405, -40]]);
});

function workspace({ layout } = {}) {
  const slots = []; let cursor = 0, selection = [], notices = [];
  const context = { ...choreographyOps, ...projectOps, ...historyOps, ...selectionOps, ...arrangeOps, ...boundsOps, safeArea, BRAND,
    effectLayer() {}, editorSession: () => ({ draftId: 'draft' }), crypto: { randomUUID: () => `copy-${slots.length}-${cursor++}` },
    useCallback: fn => fn, useEffect() {},
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; } };
  vm.createContext(context);
  for (const file of ['choreography-edit.js', 'useProject.js', 'useCompositionActions.js']) vm.runInContext(strip(read(file)), context);
  let api, actions;
  const render = () => { cursor = 0; api = context.useProject(); actions = context.useCompositionActions({ project: api.projectRef.current, projectRef: api.projectRef, selected: selection.at(-1), change: api.change, report: message => notices.push(message), setSelected(id) { selection = [id]; }, setSelection(ids) { selection = ids; } }); };
  render();
  if (layout) { api.change({ ...api.projectRef.current, layout }); render(); }
  // Rendered boxes in a 1000 px frame: headline is offset from its stored x like rotated text.
  const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const nodes = [
    { dataset: { flocLayer: 'headline' }, style: { left: '6%', top: '6%' }, getBoundingClientRect: () => box(100, 60, 400, 100) },
    { dataset: { flocLayer: 'signature' }, style: { left: '77%', top: '92%' }, getBoundingClientRect: () => box(700, 900, 200, 50) },
    { dataset: { flocLayer: 'logo' }, style: { left: '87%', top: '6%' }, getBoundingClientRect: () => box(870, 60, 70, 70) }
  ];
  const root = { getBoundingClientRect: () => box(0, 0, 1000, 1000), querySelectorAll: () => nodes };
  return { root, render, notices, get api() { return api; }, get actions() { return actions; }, get project() { return api.projectRef.current; }, get selection() { return selection; } };
}

test('align and distribute use the rendered bounds, commit one undoable change and keep locked anchors still', () => {
  const ids = ['headline', 'signature', 'logo'];
  const w = workspace(), before = w.project;
  w.actions.arrangeLayers('left', ids, 1, w.root); w.render();
  const at = id => w.project.layers.find(layer => layer.id === id);
  assert.deepEqual([at('headline').x, at('signature').x, at('logo').x], [6, 17, 10]);
  assert.equal(w.api.history.length, 1);
  w.api.undo(); w.render(); assert.deepEqual(w.project, before);

  w.actions.arrangeLayers('horizontal', ids, 1, w.root); w.render();
  assert.deepEqual([at('headline').x, at('signature').x, at('logo').x], [6, 65.5, 87]);
  w.api.undo(); w.render();

  w.api.patch('logo', { locked: true }); w.render();
  w.actions.arrangeLayers('right', ids, 1, w.root); w.render();
  assert.deepEqual([at('headline').x, at('signature').x, at('logo').x], [50, 81, 87], 'the locked logo anchors the right edge');
  assert.equal(w.api.history.length, 2);
});

test('one selected layer aligns to the canvas, or to the safe area when margins are on', () => {
  for (const [layout, expected] of [[undefined, 26], [{ enabled: true, marginX: 5, marginY: 5, guides: true }, 1]]) {
    const w = workspace({ layout });
    w.actions.arrangeLayers(layout ? 'left' : 'center', ['headline'], 1, w.root); w.render();
    assert.equal(w.project.layers.find(layer => layer.id === 'headline').x, expected);
  }
  const w = workspace(), before = w.project;
  w.actions.arrangeLayers('left', ['music'], 1, w.root);
  assert.equal(w.project, before); assert.match(w.notices.at(-1), /Show the selected layers on the canvas/);
});

test('a group move edits animated layers at the playhead in the same single history entry', () => {
  const w = workspace();
  const animated = w.project.layers.find(layer => layer.id === 'headline');
  let choreography = captureState(animated, 0, 24, { x: 6 }, 'start');
  choreography = captureState({ ...animated, choreography }, 4, 24, { x: 40 }, 'end');
  w.api.patch('headline', { choreography }); w.render();
  const history = w.api.history.length;
  w.actions.positionLayers([{ id: 'headline', x: 30, y: 20 }, { id: 'logo', x: 80, y: 20 }], 2); w.render();
  assert.equal(w.api.history.length, history + 1);
  const headline = w.project.layers.find(layer => layer.id === 'headline');
  assert.equal(evaluateChoreography(headline, 2).x, 30);
  assert.equal(evaluateChoreography(headline, 4).x, 40, 'other keyframes keep their values');
  assert.deepEqual([w.project.layers.find(layer => layer.id === 'logo').x, w.project.layers.find(layer => layer.id === 'logo').y], [80, 20]);
});

test('group duplicate, lock and visibility are single changes that skip or report locked layers', () => {
  const w = workspace();
  w.api.patch('logo', { locked: true }); w.render();
  const count = w.project.layers.length, history = w.api.history.length;
  w.actions.duplicateLayers(['headline', 'signature', 'logo']); w.render();
  assert.equal(w.project.layers.length, count + 2);
  assert.equal(w.api.history.length, history + 1);
  assert.deepEqual(w.selection.map(id => w.project.layers.find(layer => layer.id === id).name), ['Headline copy', 'Signature copy']);
  assert.match(w.notices.at(-1), /Duplicate skipped the locked layer/);

  w.actions.setLayersFlag(['headline', 'logo'], 'locked'); w.render();
  assert.deepEqual(['headline', 'logo'].map(id => w.project.layers.find(layer => layer.id === id).locked), [true, true]);
  w.actions.setLayersFlag(['headline', 'logo'], 'locked'); w.render();
  assert.deepEqual(['headline', 'logo'].map(id => w.project.layers.find(layer => layer.id === id).locked), [false, false]);
  w.api.patch('logo', { locked: true }); w.render();
  w.actions.setLayersFlag(['headline', 'logo'], 'visible'); w.render();
  assert.deepEqual(['headline', 'logo'].map(id => w.project.layers.find(layer => layer.id === id).visible), [false, false], 'visibility toggles locked members too');
  w.api.undo(); w.render();
  assert.deepEqual(['headline', 'logo'].map(id => w.project.layers.find(layer => layer.id === id).visible), [true, true]);
});

test('layer list clicks select, ⌘/Ctrl-click toggles and Shift-click requests a range in list order', async () => {
  const code = (await transform(strip(read('components/LayerList.jsx')), { loader: 'jsx' })).code;
  const elements = [];
  const context = { React: { createElement(type, props, ...children) { const node = { type, props: props ?? {}, children }; elements.push(node); return node; }, Fragment: 'fragment' },
    useState: value => [value, () => {}], useRef: value => ({ current: value }), IconButton: 'IconButton', LAYER_COLORS: {}, PROJECT_LIMITS: projectOps.PROJECT_LIMITS, TEMPLATES: projectOps.TEMPLATES,
    Copy: 'i', DotsSixVertical: 'i', Eye: 'i', EyeSlash: 'i', LockSimple: 'i', LockSimpleOpen: 'i', PencilSimple: 'i', Trash: 'i' };
  vm.createContext(context); vm.runInContext(`${code}\nthis.LayerList = LayerList;`, context);
  const calls = [];
  const project = projectOps.validateProject(projectOps.demoProject());
  context.LayerList({ project, selection: ['headline', 'logo'], icons: new Proxy({}, { get: () => 'icon' }), onSelect: (...args) => calls.push(args) });
  const buttons = elements.filter(node => node.props.className === 'layer-select');
  const button = id => buttons.find(node => node.props['aria-label'].includes(project.layers.find(layer => layer.id === id).name) || node.props.title === project.layers.find(layer => layer.id === id).text);
  assert.deepEqual(buttons.map(node => node.props['aria-pressed']), [...project.layers].reverse().map(layer => ['headline', 'logo'].includes(layer.id)));
  button('carousel').props.onClick({});
  button('carousel').props.onClick({ metaKey: true });
  button('carousel').props.onClick({ ctrlKey: true });
  button('carousel').props.onClick({ shiftKey: true });
  const order = [...project.layers].reverse().map(layer => layer.id);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['carousel'], ['carousel', 'toggle', order], ['carousel', 'toggle', order], ['carousel', 'range', order]]);
});
