import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { editClip, editFade, timeAtPointer } from '../src/editor-controls.js';
import { fitFades } from '../src/project.js';
import { moveState, choreographyFields } from '../src/choreography.js';
import { LAYER_COLORS } from '../src/editor/layer-colors.js';

const source = fs.readFileSync(new URL('../src/timeline.jsx', import.meta.url), 'utf8');
const compiled = (await transform(source.replace(/^import .*;\n/gm, '').replace('export function', 'function'), { loader: 'jsx' })).code;

function timeline({ locked = false, time = 3, mode = 'choreography', width = 800 } = {}) {
  const slots = [], patches = [], seeks = [], selections = [];
  let cursor = 0;
  const layer = { id: 'title', type: 'text', name: 'Title', text: 'Hello', visible: true, locked, start: 2, end: 6, fadeIn: .2, fadeOut: .2,
    choreography: [{ id: 'a', time: 0 }, { id: 'b', time: 1 }, { id: 'c', time: 3 }].map(state => ({ ...state, easing: 'smooth', values: { x: 5, y: 5, size: 40, opacity: 1 } })) };
  const context = { React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) }, EyeSlash() {}, LockSimple() {}, DiamondsFour() {}, TimelineTimingControls() {}, editClip, editFade, timeAtPointer, fitFades, moveState, choreographyFields, LAYER_COLORS,
    useEffect() {},
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) { const i = cursor++; slots[i] ??= { value: value === 0 ? width : value }; return [slots[i].value, next => { slots[i].value = next; }]; } };
  vm.createContext(context); vm.runInContext(compiled + '\nthis.component = TimelineTracks;', context);
  let props = { project: { duration: 8, fps: 24, layers: [layer] }, time, mode, selected: layer.id, icons: { text() {} },
    onSelect(id) { selections.push(id); }, onSeek(value) { seeks.push(value); }, onCommit(id, patch) { patches.push({ id, patch }); } };
  const render = (next = {}) => { cursor = 0; props = { ...props, ...next }; return context.component(props); };
  const nodes = node => [node, ...(node?.children || []).flat(Infinity).flatMap(child => child && typeof child === 'object' ? nodes(child) : [])];
  const find = predicate => nodes(render()).find(node => predicate(node.props));
  const mark = id => find(p => p.className?.includes('choreography-mark') && p['aria-label'].includes({ a: '2.00', b: '3.00', c: '5.00' }[id]));
  const captures = new Set();
  const target = { focus() {}, closest: () => ({ getBoundingClientRect: () => ({ left: 0, width: 800 }) }), setPointerCapture(id) { captures.add(id); }, hasPointerCapture: id => captures.has(id), releasePointerCapture(id) { captures.delete(id); } };
  const event = (next = {}) => ({ button: 0, pointerId: 7, clientX: 300, currentTarget: target, preventDefault() {}, stopPropagation() {}, ...next });
  return { layer, render, find, mark, event, patches, seeks, selections };
}

test('state dragging previews timing and commits only once on release, then seeks the moved state', () => {
  const h = timeline(), mark = h.mark('b');
  mark.props.onPointerDown(h.event());
  mark.props.onPointerMove(h.event({ clientX: 350 }));
  assert.equal(h.patches.length, 0);
  const draft = h.find(p => p.className?.includes('choreography-mark') && p.className.includes('dragging'));
  assert.equal(draft.props.style.left, '43.75%');
  mark.props.onPointerUp(h.event({ clientX: 350 }));
  mark.props.onLostPointerCapture(h.event());
  assert.equal(h.patches.length, 1);
  assert.equal(h.patches[0].patch.choreography[1].time, 1.5);
  assert.deepEqual(h.seeks, [3.5]);
  mark.props.onClick(h.event({ detail: 1 }));
  assert.deepEqual(h.seeks, [3.5]);
});

test('inline timing and the choreography trigger target their own row', () => {
  const h = timeline({ mode: 'timing' }), opened = [];
  h.render({ onOpenControls: (...args) => opened.push(args) });
  const timing = h.find(p => p.layer?.id === 'title');
  const choreography = h.find(p => p['aria-label'] === 'Choreography for Title');
  timing.props.onFocus();
  timing.props.onPatch('title', { start: 3, end: 7 });
  choreography.props.onClick(h.event());
  assert.equal(opened[0][0], 'title');
  assert.deepEqual(h.selections, ['title']);
  assert.deepEqual(h.patches, [{ id: 'title', patch: { start: 3, end: 7 } }]);
  assert.equal(timing.props.layer.start, 2);
  assert.equal(timing.props.layer.end, 6);
  assert.equal(h.find(p => p['aria-label'] === 'Timing for Title'), undefined);
  h.render({ controlsLayerId: 'title', mode: 'choreography' });
  assert.equal(h.find(p => p['aria-label'] === 'Choreography for Title').props['aria-expanded'], true);
});

test('Escape, pointer cancellation and lost capture discard state timing drafts', () => {
  for (const cancel of ['escape', 'pointer', 'capture']) {
    const h = timeline(), mark = h.mark('b');
    mark.props.onPointerDown(h.event()); mark.props.onPointerMove(h.event({ clientX: 350 }));
    if (cancel === 'escape') mark.props.onKeyDown(h.event({ key: 'Escape' }));
    else mark.props[cancel === 'pointer' ? 'onPointerCancel' : 'onLostPointerCapture'](h.event());
    mark.props.onPointerUp(h.event());
    assert.equal(h.patches.length, 0); assert.equal(h.seeks.length, 0);
    assert.equal(h.mark('b').props.style.left, '37.5%');
  }
});

test('state keyboard edits use frames, respect neighbors and support deletion', () => {
  for (const [key, shiftKey, expected] of [['ArrowRight', false, 25 / 24], ['ArrowLeft', true, 14 / 24], ['Home', false, 1 / 24], ['End', false, 71 / 24]]) {
    const h = timeline(); h.mark('b').props.onKeyDown(h.event({ key, shiftKey }));
    assert.equal(h.patches.length, 1); assert.equal(h.patches[0].patch.choreography[1].time, expected);
    assert.equal(h.seeks[0], 2 + expected);
  }
  for (const key of ['Delete', 'Backspace']) {
    const h = timeline(); h.mark('b').props.onKeyDown(h.event({ key }));
    assert.deepEqual(h.patches[0].patch.choreography.map(state => state.id), ['a', 'c']);
  }
});

test('clicking or pressing Enter on a state seeks its exact time without committing an edit', () => {
  const h = timeline({ time: 3.5 }), mark = h.mark('b');
  assert.equal(mark.props['aria-current'], 'step');
  mark.props.onPointerDown(h.event()); mark.props.onPointerUp(h.event()); mark.props.onClick(h.event({ detail: 1 }));
  mark.props.onClick(h.event({ detail: 0 }));
  assert.equal(h.patches.length, 0); assert.deepEqual(h.seeks, [3, 3]);
});

test('locked states remain selectable and seekable but cannot be dragged, nudged or removed', () => {
  const h = timeline({ locked: true }), mark = h.mark('b');
  mark.props.onPointerDown(h.event()); mark.props.onPointerMove(h.event({ clientX: 350 })); mark.props.onPointerUp(h.event());
  for (const key of ['ArrowRight', 'Home', 'End', 'Delete', 'Backspace']) mark.props.onKeyDown(h.event({ key }));
  mark.props.onClick(h.event({ detail: 1 }));
  assert.equal(h.patches.length, 0); assert.deepEqual(h.seeks, [3]); assert(h.selections.includes('title'));
});

test('state marks follow clip movement drafts and disappear beyond a trimmed span', () => {
  const h = timeline({ mode: 'timing' });
  const clip = h.find(p => p['aria-label'] === 'Move Title clip');
  clip.props.onPointerDown(h.event()); clip.props.onPointerMove(h.event({ clientX: 400 }));
  assert.equal(h.find(p => p.layer?.id === 'title').props.layer.start, 3);
  assert.equal(h.find(p => p.layer?.id === 'title').props.layer.end, 7);
  assert.equal(h.find(p => p['aria-label']?.includes('Title state at 4.00')).props.style.left, '50%');
  clip.props.onPointerCancel(h.event());
  const trim = h.find(p => p['aria-label'] === 'Trim end of Title');
  trim.props.onPointerDown(h.event()); trim.props.onPointerMove(h.event({ clientX: 100 }));
  assert.equal(h.find(p => p['aria-label']?.includes('Title state at 5.00')), undefined);
  assert.equal(h.patches.length, 0);
});


test('Timing markers are passive and preserve clip gestures; Choreography reserves selected row for states', () => {
  const h = timeline({ mode: 'timing' });
  assert.equal(h.mark('b').type, 'span');
  assert.equal(h.find(p => p['aria-label'] === 'Move Title clip').props.disabled, false);
  h.render({ mode: 'choreography' });
  assert.equal(h.mark('b').type, 'button');
  assert.equal(h.find(p => p['aria-label'] === 'Move Title clip').props.disabled, true);
});

test('crowded states remain passive instead of overlapping state hit targets', () => {
  const h = timeline({ width: 100 });
  assert.equal(h.mark('a').type, 'span');
  assert.equal(h.mark('b').type, 'span');
  assert.equal(h.mark('c').type, 'button');
});

test('changing editing mode or selected layer cancels a pending gesture before release', () => {
  for (const next of [{ mode: 'timing' }, { selected: 'different' }]) {
    const h = timeline(), mark = h.mark('b');
    mark.props.onPointerDown(h.event());
    mark.props.onPointerMove(h.event({ clientX: 350 }));
    h.render(next);
    mark.props.onPointerUp(h.event());
    assert.equal(h.patches.length, 0);
    assert.equal(h.seeks.length, 0);
  }
});

test('state selection uses the choreography context callback rather than clip selection', () => {
  const h = timeline(), selections = [];
  h.render({ onSelectState: id => selections.push(id) });
  h.mark('b').props.onClick(h.event({ detail: 0 }));
  assert.deepEqual(selections, ['title']);
  assert.deepEqual(h.selections, []);
});


test('an active state drag keeps its captured button near neighbors and falls back after release', () => {
  const h = timeline(), mark = h.mark('b');
  mark.props.onPointerDown(h.event());
  mark.props.onPointerMove(h.event({ clientX: 220 }));
  const active = h.find(p => p.className?.includes('choreography-mark') && p.className.includes('dragging'));
  assert.equal(active.type, 'button');
  assert.equal(typeof active.props.onPointerUp, 'function');
  assert.equal(h.patches.length, 0);
  active.props.onPointerUp(h.event({ clientX: 220 }));
  active.props.onLostPointerCapture(h.event());
  assert.equal(h.patches.length, 1);
  assert.equal(h.patches[0].patch.choreography[1].time, 5 / 24);
  assert.deepEqual(h.seeks, [2 + 5 / 24]);
  h.layer.choreography = h.patches[0].patch.choreography;
  const crowded = h.find(p => p['aria-label'] === 'Title state at 2.21 seconds');
  assert.equal(crowded.type, 'span');
  assert(crowded.props.className.includes('passive'));
});
