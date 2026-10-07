import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { demoProject, patchLayer, validateProject } from '../src/project.js';

const source = fs.readFileSync(new URL('../src/editor/useEditorShortcuts.js', import.meta.url), 'utf8');
const actions = fs.readFileSync(new URL('../src/editor/useCompositionActions.js', import.meta.url), 'utf8');
const projectHook = fs.readFileSync(new URL('../src/editor/useProject.js', import.meta.url), 'utf8');

function editor({ blocked = false, selected = 'headline', locked = false, modal = false } = {}) {
  const slots = []; let cursor = 0, listen = false;
  let playing = false, listener, cleanup, prevented = 0, api;
  const context = {
    demoProject, patchLayer, validateProject,
    editorSession: () => ({ draftId: 'draft' }),
    useCallback: fn => fn,
    useEffect(fn) { if (listen) cleanup = fn(); },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    window: {
      addEventListener(name, fn) { assert.equal(name, 'keydown'); listener = fn; },
      removeEventListener(name, fn) { assert.equal(name, 'keydown'); assert.equal(fn, listener); listener = null; }
    },
    document: { querySelector: () => modal ? {} : null }
  };
  vm.createContext(context);
  for (const code of [source, actions, projectHook]) vm.runInContext(code.replace(/^import .*;\n/gm, '').replace(/export function /g, 'function '), context);
  function render() {
    cursor = 0; listen = false; api = context.useProject();
    const { removeText } = context.useCompositionActions({ project: api.projectRef.current, projectRef: api.projectRef, selected,
      change: api.change,
      setSelected(id) { selected = id; }
    });
    listen = true;
    context.useEditorShortcuts({ blocked, projectRef: api.projectRef, selected, removeLayer: removeText,
      setPlaying(next) { playing = typeof next === 'function' ? next(playing) : next; }
    });
  }
  render();
  if (locked) { api.patch('headline', { locked: true }); render(); }
  return {
    press(key, extra = {}) { listener({ key, preventDefault() { prevented++; }, ...extra }); render(); },
    undo() { api.undo(); render(); },
    get playing() { return playing; }, get prevented() { return prevented; },
    get project() { return api.projectRef.current; }, get selected() { return selected; },
    close() { cleanup(); assert.equal(listener, null); }
  };
}

test('Space toggles playback once per press and consumes repeat events without toggling', () => {
  const h = editor();
  h.press(' '); assert.equal(h.playing, true);
  h.press(' ', { repeat: true }); assert.equal(h.playing, true);
  h.press(' '); assert.equal(h.playing, false);
  assert.equal(h.prevented, 3);
  h.close();
});

test('Delete and Backspace use layer removal, pause playback and support undo', () => {
  for (const key of ['Delete', 'Backspace']) {
    const h = editor(), before = h.project;
    h.press(' '); h.press(key);
    assert.equal(h.playing, false);
    assert.equal(h.project.layers.some(layer => layer.id === 'headline'), false);
    assert.equal(h.selected, before.layers.find(layer => layer.id !== 'headline').id);
    h.press(key, { repeat: true }); assert.equal(h.project.layers.length, before.layers.length - 1);
    h.undo(); assert.deepEqual(h.project, before);
  }
});

test('locked, absent and deselected layers cannot be removed', () => {
  for (const options of [{ locked: true }, { selected: null }, { selected: 'missing' }]) {
    const h = editor(options), before = h.project;
    h.press('Delete'); h.press('Backspace');
    assert.equal(h.project, before);
  }
});

test('fields, dialogs, composition input, modifiers and locally handled keys retain control', () => {
  for (const options of [{ blocked: true }, { modal: true }, {}]) {
    const variants = options.blocked || options.modal ? [{}] : [
      { defaultPrevented: true }, { isComposing: true }, { metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true },
      { target: { isContentEditable: true } },
      ...['input', 'textarea', 'select', '[role="textbox"]', '[role="dialog"]', '[aria-modal="true"]'].map(selector => ({ target: { closest: query => query.includes(selector) ? {} : null } }))
    ];
    for (const extra of variants) {
      const h = editor(options), before = h.project;
      for (const key of [' ', 'Delete', 'Backspace']) h.press(key, extra);
      assert.equal(h.playing, false); assert.equal(h.project, before); assert.equal(h.prevented, 0);
    }
  }
});

test('Space retains native button and link activation while Delete still removes a layer', () => {
  for (const selector of ['button', 'a[href]', '[role="button"]']) {
    const h = editor(), target = { closest: query => query.includes(selector) ? {} : null };
    h.press(' ', { target }); assert.equal(h.playing, false); assert.equal(h.prevented, 0);
    h.press('Delete', { target }); assert.equal(h.project.layers.some(layer => layer.id === 'headline'), false);
  }
});

test('Space works with canvas, layer selection or playback focus without repeat activation', () => {
  for (const selector of ['.stage-holder', '.layer-select', '.canvas-play']) {
    const h = editor(), target = { closest: query => query.includes('button') || query.includes(selector) ? {} : null };
    h.press(' ', { target }); assert.equal(h.playing, true);
    h.press(' ', { target, repeat: true }); assert.equal(h.playing, true);
    h.press(' ', { target }); assert.equal(h.playing, false);
    assert.equal(h.prevented, 3);
  }
});
