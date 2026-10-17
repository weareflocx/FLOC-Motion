import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { SCENE_DEPTH_RANGE } from '../src/scene-settings.js';
import * as depth from '../src/editor/depth.js';

const source = fs.readFileSync(new URL('../src/editor/components/DepthRuler.jsx', import.meta.url), 'utf8');
const compiled = (await transform(source.replace(/^import .*;\n/gm, '').replace('export function', 'function'), { loader: 'jsx' })).code;

const info = [
  { id: 'title', min: 0, max: 0, pieces: [{ min: 0, max: 0 }] },
  { id: 'wheel', min: -30, max: 40, pieces: [{ min: -30, max: -10, card: 0 }, { min: 5, max: 15, card: 1 }, { min: 20, max: 40, card: 2 }] },
  { id: 'logo', min: 60, max: 60, pieces: [{ min: 60, max: 60 }] }
];

// `pending` stands in for the canvas's pending Alt+wheel burst ({ id, z } previewed, not yet saved):
// onBegin(id) hands a burst on that layer over to the ruler, and commits any other burst first.
function ruler({ z = 0, pending = null } = {}) {
  const slots = [], effects = [], previews = [], patches = [], events = { begin: 0, gesture: 0 };
  let cursor = 0, tree, captured = null;
  const track = { getBoundingClientRect: () => ({ top: 0, height: 200 }), focus() {}, setPointerCapture(id) { captured = id; }, hasPointerCapture: id => captured === id, releasePointerCapture() { captured = null; } };
  const changed = (a, b) => !a || b.some((value, index) => !Object.is(value, a[index]));
  const context = {
    ...depth, SCENE_DEPTH_RANGE,
    React: { createElement(type, props, ...children) { if (props?.ref) props.ref.current = track; return { type, props: props ?? {}, children: children.flat(2) }; } },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) { const i = cursor++; slots[i] ??= { value }; return [slots[i].value, next => { slots[i].value = next; }]; },
    useEffect(fn, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); }
  };
  vm.createContext(context); vm.runInContext(compiled + '\nthis.DepthRuler = DepthRuler;', context);
  const layer = { id: 'title', name: 'Title', z };
  const props = { layer, z: pending?.id === 'title' ? pending.z : z, guide: depth.depthGuide(info, 'title'), names: { wheel: 'Wheel', logo: 'Logo' },
    onBegin(id = null) {
      events.begin++;
      const burst = pending; pending = null;
      if (!burst) return false;
      if (id === burst.id) return true;
      patches.push(burst); return false;
    },
    onPreview(value) { previews.push(value && { ...value }); }, onPatch(id, patch) { patches.push({ id, ...patch }); }, onGesture() { events.gesture++; } };
  const render = (next = {}) => { cursor = 0; Object.assign(props, next); tree = context.DepthRuler(props); for (const effect of effects.splice(0)) effect(); return tree; };
  const find = (node, test) => node && typeof node === 'object' ? test(node) ? node : node.children?.map(child => find(child, test)).find(Boolean) : null;
  const slider = () => find(render(), node => node.props.role === 'slider');
  const key = (name, extra = {}) => { const event = { key: name, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra }; slider().props.onKeyDown(event); return event; };
  const pointer = (name, clientY, extra = {}) => slider().props[name]({ button: 0, pointerId: 7, clientY, preventDefault() {}, ...extra });
  render();
  return { render, find, slider, key, pointer, previews, patches, events, unmount: () => slots.forEach(slot => slot?.cleanup?.()) };
}

test('the ruler is an accessible vertical slider describing the layer among the pieces', () => {
  const r = ruler({ z: 20 });
  const { props } = r.slider();
  assert.equal(props['aria-orientation'], 'vertical');
  assert.deepEqual([props['aria-valuemin'], props['aria-valuemax'], props['aria-valuenow']], [...SCENE_DEPTH_RANGE, 20]);
  assert.equal(props['aria-valuetext'], '20% · In front of 2 · Behind 2');
  const titles = [];
  r.find(r.render(), node => { if (node.props.title && node.props.role !== 'slider') titles.push(node.props.title); return false; });
  assert.deepEqual(titles, ['Wheel · piece 1', 'Wheel · piece 2', 'Wheel · piece 3', 'Logo']);
  r.unmount();
});

test('keys commit one edit each: arrows step, Page Up/Down pass one piece, Home/End go in front of or behind everything', () => {
  const r = ruler();
  const expected = [['ArrowUp', {}, 1], ['ArrowDown', { shiftKey: true }, -10], ['PageUp', {}, 20], ['PageDown', {}, -35], ['Home', {}, 65], ['End', {}, -35]];
  for (const [name, extra, z] of expected) {
    assert.equal(r.key(name, extra).defaultPrevented, true, name);
    assert.deepEqual(r.patches.at(-1), { id: 'title', z }, name);
  }
  assert.equal(r.patches.length, expected.length);
  assert.equal(r.events.begin, expected.length, 'pending canvas edits commit first');
  assert.equal(r.events.gesture, expected.length, 'each key shows the counts hint');
  assert.equal(r.key('ArrowUp', { metaKey: true }).defaultPrevented, false, 'modified keys stay with the global shortcuts');
  r.unmount();
});

test('dragging previews live, snaps to gaps unless Shift is held, commits once and Escape cancels', () => {
  const r = ruler();
  const { low, high } = depth.depthScale(depth.depthGuide(info, 'title'), [0, 0]);
  const yFor = value => (high - value) / (high - low) * 200;
  r.pointer('onPointerDown', yFor(17));
  assert.deepEqual(r.previews.at(-1), { id: 'title', z: 20 }, 'magnetic snap to the stop between card centers');
  r.pointer('onPointerMove', yFor(16), { shiftKey: true });
  assert.ok(Math.abs(r.previews.at(-1).z - 16) < 0.2, 'Shift moves freely next to a stop');
  r.pointer('onPointerUp', yFor(16), { shiftKey: true });
  assert.equal(r.patches.length, 1);
  assert.ok(Math.abs(r.patches[0].z - 16) < 0.2);
  assert.equal(r.previews.at(-1), null);

  r.pointer('onPointerDown', yFor(-20));
  r.key('Escape');
  r.pointer('onPointerUp', yFor(-20));
  assert.equal(r.patches.length, 1, 'Escape leaves the project unchanged');
  assert.equal(r.previews.at(-1), null);
  r.unmount();
});

test('a ruler removed mid-drag clears its preview', () => {
  const r = ruler();
  r.pointer('onPointerDown', 50);
  assert.notEqual(r.previews.at(-1), null);
  r.unmount();
  assert.equal(r.previews.at(-1), null);
});

test('a ruler key after Alt+wheel continues the previewed depth as one edit', () => {
  const r = ruler({ z: 0, pending: { id: 'title', z: 4 } });
  r.key('ArrowUp');
  assert.deepEqual(r.patches, [{ id: 'title', z: 5 }], 'one edit from the previewed depth; the wheel change is kept');
  r.unmount();
  const page = ruler({ z: 0, pending: { id: 'title', z: 4 } });
  page.key('PageUp');
  assert.deepEqual(page.patches, [{ id: 'title', z: 20 }]);
  page.unmount();
  // A burst on another layer is committed on its own; the ruler steps from its layer's depth.
  const other = ruler({ z: 0, pending: { id: 'logo', z: 9 } });
  other.key('ArrowUp');
  assert.deepEqual(other.patches, [{ id: 'logo', z: 9 }, { id: 'title', z: 1 }]);
  other.unmount();
});
