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
  const slots = [], effects = [], views = [], patches = [], elements = new Map();
  let cursor = 0, creations = 0, props;
  const rect = { left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000 };
  const node = () => ({ style: {}, listeners: new Map(), getBoundingClientRect: () => rect, contains: () => false, replaceChildren() {}, querySelector: () => null, querySelectorAll: () => [], focus() {}, setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {}, addEventListener(name, fn) { this.listeners.set(name, fn); }, removeEventListener(name, fn) { if (this.listeners.get(name) === fn) this.listeners.delete(name); } });
  const scene = { setView(view) { views.push(view && { ...view }); }, setOrientation() {}, setPlacement() {}, seek() {}, setResolution() {}, projectedBounds: () => null };
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
  props = { project, selected: null, selection: [], clock: { get: () => ({ time: 0, playing: false }), subscribe: () => () => {} }, positionPreview: null, sceneView: null, onSceneViewChange(view) { props = { ...props, sceneView: view }; }, onPatch: (...args) => patches.push(args), onReady() {}, onError(message) { throw new Error(message); } };
  const render = (next = {}) => { cursor = 0; props = { ...props, ...next }; context.Stage(props); for (const effect of effects.splice(0)) effect(); return elements.get('stage-holder').props; };
  render();
  return { render, holder, project, before, views, patches, get view() { return props.sceneView; }, get creations() { return creations; }, unmount() { for (const slot of slots) slot?.cleanup?.(); } };
}

const neutralView = () => ({ yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 });
const pointer = (extra = {}) => ({ button: 0, pointerId: 1, clientX: 500, clientY: 500, preventDefault() {}, stopPropagation() {}, ...extra });

test('Explore orbit, pan and dolly are relative editor views; Escape restores the authored camera without project edits', () => {
  const w = workspace();
  let handlers = w.render({ sceneView: neutralView() });
  handlers.onPointerDownCapture(pointer());
  handlers.onPointerMoveCapture(pointer({ clientX: 600, clientY: 550 }));
  handlers.onPointerUpCapture(pointer());
  assert.deepEqual({ ...w.view }, { yaw: 30, pitch: 15, zoom: 1, panX: 0, panY: 0 });
  handlers = w.render();
  handlers.onPointerDownCapture(pointer({ shiftKey: true }));
  handlers.onPointerMoveCapture(pointer({ clientX: 600, clientY: 550, shiftKey: true }));
  handlers.onPointerUpCapture(pointer());
  assert.deepEqual({ ...w.view }, { yaw: 30, pitch: 15, zoom: 1, panX: -10, panY: 5 });
  handlers = w.render();
  w.holder.listeners.get('wheel')({ deltaY: -100, preventDefault() {}, stopPropagation() {} });
  assert(w.view.zoom > 1);
  handlers = w.render();
  handlers.onKeyDownCapture({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  w.render();
  assert.equal(w.view, null);
  assert.equal(w.views.at(-1), null);
  assert.equal(w.creations, 1, 'navigation reuses the mounted composition');
  assert.equal(JSON.stringify(w.project), w.before, 'saved/exported camera and composition remain unchanged');
  assert.deepEqual(w.patches, []);
  w.unmount();
});

test('cancelled exploration restores its starting view and explicit 2D pan never orbits', () => {
  const w = workspace();
  let handlers = w.render({ sceneView: neutralView() });
  handlers.onPointerDownCapture(pointer());
  handlers.onPointerMoveCapture(pointer({ clientX: 600 }));
  handlers.onPointerCancelCapture(pointer());
  assert.deepEqual({ ...w.view }, neutralView());
  handlers = w.render({ panning: true });
  handlers.onPointerDownCapture(pointer());
  handlers.onPointerMoveCapture(pointer({ clientX: 600 }));
  handlers.onPointerUpCapture(pointer());
  assert.deepEqual({ ...w.view }, neutralView());
  assert.equal(JSON.stringify(w.project), w.before);
  w.unmount();
});
