import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { demoProject, FORMATS } from '../src/project.js';
import { canvasWheelSize, carouselPlacement, freePlacement, gridPlacement, nearestGridPoint, nudgePlacement } from '../src/editor-controls.js';
import { alignmentPlacement, DEFAULT_LAYOUT } from '../src/layout.js';
import { dragOrientation, wrapDegrees } from '../src/orientation.js';
import { captureState, evaluateChoreography } from '../src/choreography.js';
import { canvasMediaPlacement, centeredResize, layerResizeBounds, snapCenteredResize } from '../src/editor/canvas-resize.js';
import { nudgeAmount } from '../src/editor/nudge.js';

const source = fs.readFileSync(new URL('../src/editor/useCanvasInteraction.jsx', import.meta.url), 'utf8');
const compiled = (await transform(source.replace(/^import .*;\n/gm, '').replace('export function', 'function'), { loader: 'jsx' })).code;

function editor() {
  const slots = [], effects = [], timers = new Map(), patches = [], previews = [];
  let cursor = 0, timerId = 0, wheel, pending;
  const project = demoProject();
  const rect = { left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000 };
  const node = { dataset: { flocLayer: 'headline' }, style: { opacity: '1', left: '5%', top: '5%' },
    getBoundingClientRect: () => rect, classList: { toggle() {} }, setAttribute() {} };
  const root = { current: { getBoundingClientRect: () => rect, querySelectorAll: () => [node],
    addEventListener(name, fn) { if (name === 'wheel') wheel = fn; },
    removeEventListener(name, fn) { if (name === 'wheel' && wheel === fn) wheel = null; } } };
  const changed = (a, b) => !a || b.some((value, index) => !Object.is(value, a[index]));
  const context = { React: { createElement() {} }, FORMATS, canvasWheelSize, carouselPlacement, freePlacement,
    gridPlacement, nearestGridPoint, nudgePlacement, nudgeAmount, alignmentPlacement, DEFAULT_LAYOUT, dragOrientation, wrapDegrees, evaluateChoreography, canvasMediaPlacement, centeredResize, layerResizeBounds, snapCenteredResize,
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) { const i = cursor++; slots[i] ??= { value }; return [slots[i].value, next => { slots[i].value = next; }]; },
    useCallback(fn, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); }
  };
  vm.createContext(context); vm.runInContext(compiled + '\nthis.hook = useCanvasInteraction;', context);
  let props = { root, engine: { current: {} }, project, sceneKey: project, selected: 'headline', time: 1,
    onSelect() {}, onPatch(id, patch) { patches.push({ id, ...patch }); },
    onPreview(value) { previews.push(value); }, onPendingEdit(commit) { pending = commit; } };
  function render(next = {}) { cursor = 0; props = { ...props, ...next }; const result = context.hook(props); for (const effect of effects.splice(0)) effect(); return result; }
  const scroll = () => wheel({ clientX: 100, clientY: 100, deltaY: -100, preventDefault() {} });
  const flush = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
  const unmount = () => { for (const slot of slots) slot?.cleanup?.(); };
  render();
  return { render, scroll, flush, unmount, patches, previews, node, rect, project, timers, commit: () => pending?.() };
}

test('wheel changes are grouped into one edit and survive selecting another layer', () => {
  const h = editor(), original = h.project.layers.find(layer => layer.id === 'headline');
  h.scroll(); h.scroll(); assert.equal(h.patches.length, 0);
  h.render({ selected: 'logo' });
  assert.deepEqual(h.patches, [{ id: 'headline', size: canvasWheelSize(original, -100, canvasWheelSize(original, -100)) }]);
  h.flush(); assert.equal(h.patches.length, 1); h.unmount();
});

test('history can commit a pending resize synchronously without a later timer edit', () => {
  const h = editor(); h.scroll(); h.commit();
  assert.equal(h.patches.length, 1); assert.equal(h.timers.size, 0);
  h.flush(); assert.equal(h.patches.length, 1); h.unmount();
});

test('resizing an animated layer starts from its evaluated size at the playhead', () => {
  const h = editor(), layer = h.project.layers.find(item => item.id === 'headline');
  layer.choreography = captureState(layer, 0, 24, { size: 24 }, 'start');
  layer.choreography = captureState(layer, 2, 24, { size: 96 }, 'end');
  h.render(); h.scroll(); h.flush();
  assert.equal(h.patches.length, 1);
  assert.equal(h.patches[0].size, canvasWheelSize(evaluateChoreography(layer, 1), -100));
  h.unmount();
});

test('Escape and unmount cancel pending wheel edits', () => {
  for (const cancel of ['escape', 'unmount']) {
    const h = editor(); h.scroll();
    if (cancel === 'escape') h.render().handlers.onKeyDown({ key: 'Escape', preventDefault() {} });
    else h.unmount();
    h.flush(); assert.equal(h.patches.length, 0); assert.equal(h.previews.at(-1), null);
    if (cancel === 'escape') h.unmount();
  }
});

test('clicking empty workspace deselects without changing the project', () => {
  for (const point of [[1100, 500], [900, 900]]) {
    const h = editor(), selections = [];
    h.node.getBoundingClientRect = () => ({ left: 100, top: 100, right: 300, bottom: 300, width: 200, height: 200 });
    const { handlers } = h.render({ onSelect: id => selections.push(id) });
    handlers.onPointerDown({ button: 0, clientX: point[0], clientY: point[1], target: { closest: () => null } });
    assert.deepEqual(selections, [null]);
    assert.equal(h.patches.length, 0);
    assert.equal(h.previews.at(-1), null);
    h.unmount();
  }
});

test('deselecting commits a pending wheel resize exactly once', () => {
  const h = editor(), selections = [];
  const { handlers } = h.render({ onSelect: id => selections.push(id) });
  h.scroll();
  handlers.onPointerDown({ button: 0, clientX: 1100, clientY: 500, target: { closest: () => null } });
  assert.equal(selections.at(-1), null);
  assert.equal(h.patches.length, 1);
  assert.equal(h.timers.size, 0);
  h.flush(); assert.equal(h.patches.length, 1);
  h.unmount();
});

test('Escape cancels an edit first and deselects only when no gesture is pending', () => {
  const h = editor(), selections = [];
  const { handlers } = h.render({ onSelect: id => selections.push(id) });
  h.scroll(); selections.length = 0;
  handlers.onKeyDown({ key: 'Escape', preventDefault() {} });
  assert.deepEqual(selections, []);
  assert.equal(h.patches.length, 0);
  handlers.onKeyDown({ key: 'Escape', preventDefault() {} });
  assert.deepEqual(selections, [null]);
  h.unmount();
});

test('loading a new scene cancels old drafts and blocks wheel, pointer and keyboard edits', () => {
  const h = editor(); h.scroll();
  const { handlers } = h.render({ enabled: false, project: { ...h.project, format: 'portrait' } });
  h.scroll();
  handlers.onPointerDown({ button: 0, target: { closest() { throw new Error('disabled hit testing'); } } });
  handlers.onKeyDown({ key: 'ArrowRight', target: { closest() { throw new Error('disabled keyboard editing'); } } });
  h.flush(); assert.equal(h.patches.length, 0); assert.equal(h.node.tabIndex, -1);
  h.render({ enabled: true }); h.scroll(); h.flush();
  assert.equal(h.patches.length, 1); assert.equal(h.node.tabIndex, 0); h.unmount();
});
test('dragging uses the displayed frame size at different zoom levels and commits once', () => {
  for (const width of [300, 1080, 2160]) {
    const h = editor();
    Object.assign(h.rect, { left: 100, top: 100, width, height: width, right: 100 + width, bottom: 100 + width });
    h.node.getBoundingClientRect = () => ({ left: 100 + width * 0.05, top: 100 + width * 0.05, right: 100 + width * 0.25, bottom: 100 + width * 0.1, width: width * 0.2, height: width * 0.05 });
    h.node.focus = () => {};
    const target = { setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} };
    const event = { button: 0, pointerId: 1, clientX: 100 + width * 0.1, clientY: 100 + width * 0.075, target: { closest: () => null }, currentTarget: target, preventDefault() {} };
    const { handlers } = h.render();
    handlers.onPointerDown(event);
    handlers.onPointerMove({ ...event, clientX: event.clientX + width * 0.1, shiftKey: true });
    assert.equal(h.patches.length, 0);
    handlers.onPointerUp(event);
    assert.equal(h.patches.length, 1);
    assert.equal(h.patches[0].id, 'headline');
    assert(Math.abs(h.patches[0].x - 15) < 1e-8);
    assert.equal(h.patches[0].y, 5);
    h.unmount();
  }
});

test('rotation handle previews one text edit, commits on release and cancels with Escape', () => {
  for (const cancel of [false, true]) {
    const h = editor(); h.node.focus = () => {};
    const target = { setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} };
    const event = { button: 0, pointerId: 1, clientX: 700, clientY: 500,
      target: { closest: selector => selector === '[data-canvas-ring]' ? {} : null }, currentTarget: target, preventDefault() {} };
    const { handlers } = h.render();
    handlers.onPointerDown(event);
    handlers.onPointerMove({ ...event, clientX: 500, clientY: 700 });
    assert.equal(h.patches.length, 0);
    assert.equal(h.previews.at(-1).roll, 90);
    if (cancel) handlers.onKeyDown({ key: 'Escape', preventDefault() {} });
    handlers.onPointerUp(event);
    assert.equal(h.patches.length, cancel ? 0 : 1);
    if (!cancel) assert.equal(h.patches[0].roll, 90);
    h.unmount();
  }
});

test('Alt-arrow rotates visual layers and respects locks', () => {
  const h = editor();
  const target = { closest: selector => selector === '[data-floc-layer]' ? h.node : null };
  const event = { key: 'ArrowRight', altKey: true, target, preventDefault() {} };
  h.render().handlers.onKeyDown(event);
  assert.equal(h.patches.at(-1).roll, 1);
  h.project.layers.find(l => l.id === 'headline').locked = true;
  h.render().handlers.onKeyDown(event);
  assert.equal(h.patches.length, 1);
  h.unmount();
});

test('selected background drags in both directions without safe-area clamping', () => {
  const h = editor(); h.node.dataset.flocLayer = 'background'; h.node.focus = () => {};
  Object.assign(h.project.layers[0], { x: 0, y: 0, roll: 0 });
  h.project.layers.slice(1).forEach(l => l.visible = false);
  const target = { setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} };
  const event = { button: 0, pointerId: 1, clientX: 500, clientY: 500, target: { closest: () => null }, currentTarget: target, preventDefault() {} };
  const { handlers } = h.render({ selected: 'background' });
  handlers.onPointerDown(event);
  handlers.onPointerMove({ ...event, clientX: 400, clientY: 550 });
  handlers.onPointerUp(event);
  assert.equal(h.patches[0].x, -10);
  assert.equal(h.patches[0].y, 5);
  h.unmount();
});

test('moving rotated text preserves its anchor instead of jumping to its bounding box', () => {
  const h = editor();
  Object.assign(h.project.layers.find(l => l.id === 'headline'), { x: 20, y: 25, roll: 30 });
  Object.assign(h.node.style, { left: '20%', top: '25%' }); h.node.focus = () => {};
  h.node.getBoundingClientRect = () => ({ left: 150, top: 200, right: 450, bottom: 350, width: 300, height: 150 });
  const target = { setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} };
  const event = { button: 0, pointerId: 1, clientX: 250, clientY: 250, target: { closest: () => null }, currentTarget: target, preventDefault() {} };
  const { handlers } = h.render();
  handlers.onPointerDown(event);
  handlers.onPointerMove({ ...event, clientX: 300, clientY: 280, shiftKey: true });
  handlers.onPointerUp(event);
  assert.equal(h.patches[0].x, 25);
  assert.equal(h.patches[0].y, 28);
  h.unmount();
});

test('oversized media can move past both canvas edges with safe margins enabled', () => {
  const h = editor();
  const layer = h.project.layers.find(l => l.id === 'headline');
  Object.assign(layer, { type: 'media', x: -20, y: -40, size: 100 });
  h.project.layout = { enabled: true, marginX: 5, marginY: 5, guides: true };
  Object.assign(h.node.style, { left: '-20%', top: '-40%' }); h.node.focus = () => {};
  h.node.getBoundingClientRect = () => ({ left: -200, top: -400, right: 800, bottom: 1100, width: 1000, height: 1500 });
  const target = { setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} };
  const event = { button: 0, pointerId: 1, clientX: 250, clientY: 250, target: { closest: () => null }, currentTarget: target, preventDefault() {} };
  const { handlers } = h.render();
  handlers.onPointerDown(event);
  handlers.onPointerMove({ ...event, clientX: 150, clientY: 350 });
  handlers.onPointerUp(event);
  assert.equal(h.patches[0].x, -30);
  assert.equal(h.patches[0].y, -30);
  handlers.onKeyDown({ key: 'ArrowLeft', target: { closest: () => null }, preventDefault() {} });
  assert(h.patches[1].x < -20);
  assert.equal(h.patches[1].y, -40);
  h.unmount();
});

test('custom small and big nudges move every positioned layer in composition pixels', () => {
  for (const type of ['text', 'logo', 'media', 'model', 'background', 'carousel']) {
    const h = editor();
    Object.assign(h.project.layers.find(l => l.id === 'headline'), { type, x: 25, y: 25, size: 20 });
    Object.assign(h.node.style, { left: '25%', top: '25%' });
    h.node.getBoundingClientRect = () => ({ left: 250, top: 250, right: 350, bottom: 350, width: 100, height: 100 });
    const { handlers } = h.render({ nudge: { small: 3, big: 12 } });
    for (const shiftKey of [false, true]) handlers.onKeyDown({ key: 'ArrowRight', shiftKey, target: { closest: () => null }, preventDefault() {} });
    assert(Math.abs(h.patches[0].x - (25 + 3 / 1080 * 100)) < 1e-6, type);
    assert(Math.abs(h.patches[1].x - (25 + 12 / 1080 * 100)) < 1e-6, type);
    assert.equal(h.patches[1].y, 25);
    assert.equal(h.patches[1].tilt, undefined);
    h.unmount();
  }
});

test('handles and Command/Control-dragging object corners preserve the center and Escape cancels', () => {
  for (const gesture of ['handle', 'metaKey', 'ctrlKey']) for (const cancel of [false, true]) {
    const h = editor();
    Object.assign(h.project.layers.find(l => l.id === 'headline'), { type: 'media', x: 25, y: 25, size: 20 });
    Object.assign(h.node.style, { left: '25%', top: '25%' });
    Object.assign(h.node, { offsetWidth: 200, offsetHeight: 300, focus() {} });
    h.node.getBoundingClientRect = () => ({ left: 250, top: 250, right: 450, bottom: 550, width: 200, height: 300 });
    // The DOM measurements use composition pixels, independent of preview zoom.
    const frame = { clientWidth: 1000, clientHeight: 1000, getBoundingClientRect: () => h.rect, querySelectorAll: () => [h.node], addEventListener() {}, removeEventListener() {} };
    const target = { setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} };
    const event = { button: 0, pointerId: 1, clientX: 450, clientY: 550, [gesture]: true, target: { closest: selector => gesture === 'handle' && selector === '[data-canvas-resize]' ? {} : null }, currentTarget: target, preventDefault() {} };
    const { handlers } = h.render({ root: { current: frame } });
    handlers.onPointerDown(event);
    handlers.onPointerMove({ ...event, clientX: 550, clientY: 700 });
    assert.equal(h.previews.at(-1).size, 40);
    assert.equal(h.previews.at(-1).x, 15);
    assert.equal(h.previews.at(-1).y, 10);
    assert.equal(h.patches.length, 0);
    if (cancel) handlers.onKeyDown({ key: 'Escape', preventDefault() {} });
    handlers.onPointerUp(event);
    assert.equal(h.patches.length, cancel ? 0 : 1);
    h.unmount();
  }
});

test('Command-drag inside an image moves it without resizing or invalid center math', () => {
  const h = editor();
  Object.assign(h.project.layers.find(l => l.id === 'headline'), { type: 'media', x: 25, y: 25, size: 20 });
  Object.assign(h.node.style, { left: '25%', top: '25%' });
  Object.assign(h.node, { offsetWidth: 200, offsetHeight: 300, focus() {} });
  h.node.getBoundingClientRect = () => ({ left: 250, top: 250, right: 450, bottom: 550, width: 200, height: 300 });
  const frame = { clientWidth: 1000, clientHeight: 1000, getBoundingClientRect: () => h.rect, querySelectorAll: () => [h.node], addEventListener() {}, removeEventListener() {} };
  const target = { setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} };
  const event = { button: 0, pointerId: 1, clientX: 350, clientY: 400, metaKey: true, target: { closest: () => null }, currentTarget: target, preventDefault() {} };
  const { handlers } = h.render({ root: { current: frame } });
  handlers.onPointerDown(event);
  handlers.onPointerMove({ ...event, clientX: 400, clientY: 420 });
  handlers.onPointerUp(event);
  assert.equal(h.patches[0].x, 30);
  assert.equal(h.patches[0].y, 27);
  assert.equal(h.patches[0].size, undefined);
  h.unmount();
});

test('corner drag shows both height guides and releases past the edge; Shift bypasses the magnet', () => {
  for (const shiftKey of [false, true]) {
    const h = editor();
    Object.assign(h.project.layers.find(l => l.id === 'headline'), { type: 'media', x: 30, y: 25, size: 40 });
    Object.assign(h.node.style, { left: '30%', top: '25%' });
    Object.assign(h.node, { offsetWidth: 400, offsetHeight: 500, focus() {} });
    h.node.getBoundingClientRect = () => ({ left: 300, top: 250, right: 700, bottom: 750, width: 400, height: 500 });
    const frame = { clientWidth: 1000, clientHeight: 1000, getBoundingClientRect: () => h.rect, querySelectorAll: () => [h.node], addEventListener() {}, removeEventListener() {} };
    const target = { setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} };
    const event = { button: 0, pointerId: 1, clientX: 700, clientY: 750, shiftKey, target: { closest: selector => selector === '[data-canvas-resize]' ? {} : null }, currentTarget: target, preventDefault() {} };
    const { handlers } = h.render({ root: { current: frame } });
    handlers.onPointerDown(event);
    handlers.onPointerMove({ ...event, clientX: 898, clientY: 997.5 });
    const preview = h.previews.at(-1);
    assert(Math.abs(preview.size - (shiftKey ? 79.6 : 80)) < 1e-8);
    if (!shiftKey) assert.equal(preview.guides.filter(g => g.axis === 'y' && [0, 100].includes(g.value)).length, 2);
    handlers.onPointerMove({ ...event, clientX: 915, clientY: 1018.75 });
    assert.equal(h.previews.at(-1).size, 83);
    handlers.onPointerUp(event);
    assert.equal(h.patches.length, 1);
    assert.equal(h.patches[0].size, 83);
    assert.equal(h.patches[0].guides, undefined);
    h.unmount();
  }
});
