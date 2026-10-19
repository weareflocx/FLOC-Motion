import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { demoProject, FORMATS } from '../src/project.js';
import { canvasViewport } from '../src/editor/canvas-viewport.js';
import { DEFAULT_LAYOUT } from '../src/layout.js';
import { registerStageScene } from '../src/editor/layer-bounds.js';

const source = fs.readFileSync(new URL('../src/editor/Stage.jsx', import.meta.url), 'utf8');
const compiled = (await transform(source.replace(/^import .*;\n/gm, '').replace('export function', 'function'), { loader: 'jsx' })).code;

function workspace() {
  const slots = [], effects = [], patches = [], exits = [], elements = new Map();
  let cursor = 0, creations = 0, props;
  const rect = { left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000 };
  const node = () => ({ style: {}, listeners: new Map(), getBoundingClientRect: () => rect, contains: () => false, replaceChildren() {}, querySelector: () => null, querySelectorAll: () => [], focus() {}, setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {}, addEventListener(name, fn) { this.listeners.set(name, fn); }, removeEventListener(name, fn) { if (this.listeners.get(name) === fn) this.listeners.delete(name); } });
  const scene = { setOrientation() {}, setPlacement() {}, seek() {}, setResolution() {}, projectedBounds: () => null };
  const holder = node(), stage = node(), ring = node();
  const changed = (a, b) => !a || b.some((value, index) => !Object.is(value, a[index]));
  const context = {
    React: { createElement(type, attributes, ...children) {
      const element = { type, props: attributes ?? {}, children };
      const name = attributes?.className?.split(' ')[0];
      if (name) elements.set(name, element);
      if (attributes?.ref) attributes.ref.current = name === 'stage-holder' ? holder : name === 'stage' ? stage : ring;
      return element;
    } },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = { value }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; },
    useEffect(fn, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
    useSyncExternalStore: () => false, usePlaybackTime: () => 0,
    useCanvasInteraction: () => ({ ring: null, handlers: {} }),
    FORMATS, DEFAULT_LAYOUT, canvasViewport, registerStageScene,
    measureLayerBounds: () => [], selectionBounds: () => null,
    PlacementGuides() {}, ASSET_DRAG_TYPE: 'application/floc-asset',
    createResourceCache: () => ({}),
    createPreviewSession(callbacks) {
      creations++;
      const session = { current: null, request(project) { session.current = { project, scene, node: node() }; callbacks.activate(session.current); callbacks.onReady(true); }, dispose() { session.current = null; } };
      return session;
    },
    ResizeObserver: class { observe() {} disconnect() {} },
    window: { devicePixelRatio: 1 }, document: { activeElement: null }, queueMicrotask,
  };
  vm.createContext(context); vm.runInContext(compiled + '\nthis.Stage = Stage;', context);
  const project = demoProject(), before = JSON.stringify(project);
  props = { project, selected: null, selection: [], clock: { get: () => ({ time: 0, playing: false }), subscribe: () => () => {} }, positionPreview: null, onExitPan: () => exits.push(true), onPatch: (...args) => patches.push(args), onReady() {}, onError(message) { throw new Error(message); } };
  const render = (next = {}) => { cursor = 0; props = { ...props, ...next }; context.Stage(props); for (const effect of effects.splice(0)) effect(); return elements.get('stage-holder').props; };
  render();
  return { render, holder, stage, project, before, patches, exits, get creations() { return creations; }, unmount() { for (const slot of slots) slot?.cleanup?.(); } };
}

const pointer = (extra = {}) => ({ button: 0, pointerId: 1, clientX: 500, clientY: 500, preventDefault() {}, stopPropagation() {}, ...extra });
const key = name => ({ key: name, preventDefault() {}, stopPropagation() {} });

test('2D pan drags and nudges the canvas, cancellation restores the offset, and Escape exits without project edits', () => {
  const w = workspace();
  let handlers = w.render({ zoom: 2, panning: true });
  const start = w.stage.style.transform;
  handlers.onPointerDownCapture(pointer());
  handlers.onPointerMoveCapture(pointer({ clientX: 540, clientY: 520 }));
  handlers.onPointerCancelCapture(pointer());
  assert.equal(w.stage.style.transform, start, 'a cancelled drag restores the starting offset');
  handlers.onPointerDownCapture(pointer());
  handlers.onPointerMoveCapture(pointer({ clientX: 540, clientY: 520 }));
  handlers.onPointerUpCapture(pointer());
  assert.notEqual(w.stage.style.transform, start);
  const dragged = w.stage.style.transform;
  handlers.onKeyDownCapture(key('ArrowLeft'));
  assert.notEqual(w.stage.style.transform, dragged);
  handlers.onKeyDownCapture(key('Escape'));
  assert.deepEqual(w.exits, [true]);
  handlers = w.render({ panning: false });
  handlers.onKeyDownCapture(key('ArrowLeft'));
  assert.equal(w.holder.listeners.has('wheel'), false, 'the wheel is only captured while panning');
  assert.equal(w.creations, 1, 'panning reuses the mounted composition');
  assert.equal(JSON.stringify(w.project), w.before);
  assert.deepEqual(w.patches, []);
  w.unmount();
});
