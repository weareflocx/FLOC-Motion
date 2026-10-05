import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = fs.readFileSync(new URL('../src/editor/components/TimelineControlsPopover.jsx', import.meta.url), 'utf8');
const compiled = (await transform(source.replace(/^import .*;\n/gm, '').replace(/export /g, ''), { loader: 'jsx' })).code;

function popover({ connected = true, top = 600, viewportWidth = 900 } = {}) {
  const slots = [], effects = [], documentListeners = new Map(), windowListeners = new Map();
  let cursor = 0, shown = false, closes = 0, focus = 0, anchorFocus = 0, observer;
  const anchor = { isConnected: connected, getBoundingClientRect: () => ({ left: 700, top, bottom: top + 26 }), focus() { anchorFocus++; } };
  const panel = { offsetWidth: 360, offsetHeight: 200, style: {}, showPopover() { shown = true; }, hidePopover() { shown = false; }, matches() { return shown; }, focus() { focus++; } };
  const context = {
    React: { createElement(type, props, ...children) { if (props?.ref) props.ref.current = panel; return { type, props: props || {}, children }; } },
    X() {},
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useLayoutEffect(effect, dependencies) { const index = cursor++; if (!slots[index] || dependencies.some((value, i) => value !== slots[index][i])) { slots[index] = dependencies; effects.push(effect); } },
    ResizeObserver: class { constructor(callback) { observer = this; this.callback = callback; } observe() {} disconnect() { this.disconnected = true; } },
    window: { innerWidth: viewportWidth, innerHeight: 800, addEventListener(type, callback) { windowListeners.set(type, callback); }, removeEventListener(type) { windowListeners.delete(type); } },
    document: { addEventListener(type, callback) { documentListeners.set(type, callback); }, removeEventListener(type) { documentListeners.delete(type); } }
  };
  vm.createContext(context); vm.runInContext(compiled + '\nthis.component = TimelineControlsPopover;', context);
  let props = { anchor, layer: { id: 'title', name: 'Title' }, onClose() { closes++; } };
  const render = (next = {}) => { cursor = 0; props = { ...props, ...next }; return context.component(props); };
  const result = render();
  const cleanup = effects.shift()?.();
  return { result, render, panel, anchor, documentListeners, windowListeners, context, cleanup, observer: () => observer, counts: () => ({ shown, closes, focus, anchorFocus }), effects };
}

test('row popover stays within the viewport and repositions when its controls grow', () => {
  const h = popover();
  assert.equal(h.panel.style.left, '528px');
  assert.equal(h.panel.style.top, '392px');
  h.panel.offsetHeight = 300;
  h.observer().callback();
  assert.equal(h.panel.style.top, '292px');
  assert.equal(h.counts().shown, true);
  h.cleanup();
  assert.equal(h.counts().shown, false);
  assert.equal(h.documentListeners.size, 0);
  assert.equal(h.windowListeners.size, 0);
  assert.equal(h.observer().disconnected, true);
});

test('editing controls does not reopen or steal focus; Escape restores the row trigger', () => {
  const h = popover();
  h.render({ layer: { id: 'title', name: 'Title', opacity: .5 } });
  assert.equal(h.effects.length, 0);
  assert.equal(h.counts().focus, 1);
  let prevented = false;
  h.result.props.onKeyDown({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.equal(prevented, true);
  assert.equal(h.counts().anchorFocus, 1);
  assert.equal(h.counts().closes, 1);
});

test('scrolling the timeline dismisses its popover while scrolling the popover itself keeps it open', () => {
  const h = popover({ top: 40 });
  assert.equal(h.panel.style.top, '74px');
  const scroll = h.documentListeners.get('scroll');
  scroll({ target: { contains: () => false } });
  assert.equal(h.counts().closes, 0);
  scroll({ target: { contains: () => true } });
  assert.equal(h.counts().closes, 1);
  const disconnected = popover({ connected: false });
  assert.equal(disconnected.counts().shown, false);
  assert.equal(disconnected.counts().closes, 1);
});
