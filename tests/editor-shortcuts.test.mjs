import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { PROJECT_LIMITS, assertLocksRespected, blankProject, demoProject, patchLayer, validateProject } from '../src/project.js';
import * as historyOps from '../src/editor/history.js';
import * as selectionOps from '../src/editor/selection.js';

const source = fs.readFileSync(new URL('../src/editor/useEditorShortcuts.js', import.meta.url), 'utf8');
const actions = fs.readFileSync(new URL('../src/editor/useCompositionActions.js', import.meta.url), 'utf8');
const projectHook = fs.readFileSync(new URL('../src/editor/useProject.js', import.meta.url), 'utf8');

function editor({ blocked = false, selected = 'headline', selection, locked = false, modal = false } = {}) {
  const slots = []; let cursor = 0, listen = false;
  let playing = false, listener, cleanup, prevented = 0, api, palette = 0, selectAll = 0, notices = [];
  const context = {
    PROJECT_LIMITS, assertLocksRespected, blankProject, demoProject, patchLayer, validateProject, crypto: webcrypto, ...historyOps, ...selectionOps,
    editorSession: () => ({ draftId: 'draft', compositionId: null, remember() {} }),
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
    const { removeText, removeLayers } = context.useCompositionActions({ project: api.projectRef.current, projectRef: api.projectRef, selected,
      change: api.change, report: message => notices.push(message),
      setSelected(id) { selected = id; selection = undefined; },
      setSelection(ids) { selection = ids; selected = ids.at(-1) ?? null; }
    });
    listen = true;
    context.useEditorShortcuts({ blocked, projectRef: api.projectRef, selected, selection, removeLayer: removeText, removeLayers,
      onSelectAll() { selectAll++; }, onOpenPalette() { palette++; }, onCollapseSelection() { selection = undefined; },
      setPlaying(next) { playing = typeof next === 'function' ? next(playing) : next; }
    });
  }
  render();
  api.importDraft(demoProject());
  render();
  if (locked) { api.patch('headline', { locked: true }); render(); }
  return {
    press(key, extra = {}) { listener({ key, preventDefault() { prevented++; }, ...extra }); render(); },
    undo() { api.undo(); render(); },
    get playing() { return playing; }, get prevented() { return prevented; },
    get project() { return api.projectRef.current; }, get selected() { return selected; }, get selection() { return selection; },
    get palette() { return palette; }, get selectAll() { return selectAll; }, get notices() { return notices; }, get history() { return api.history; },
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

test('locked, background, absent and deselected layers cannot be removed', () => {
  for (const options of [{ locked: true }, { selected: 'background' }, { selected: null }, { selected: 'missing' }]) {
    const h = editor(options), before = h.project;
    h.press('Delete'); h.press('Backspace');
    assert.equal(h.project, before);
  }
});

test('deleting a mixed selection keeps the editable background and undo restores only removed content', () => {
  const h = editor({ selected: 'background', selection: ['background', 'headline'] }), before = h.project;
  h.press('Delete');
  assert.deepEqual(h.project.layers.find(layer => layer.id === 'background'), before.layers[0]);
  assert.equal(h.project.layers.some(layer => layer.id === 'headline'), false);
  assert.deepEqual([...h.selection], ['background']);
  h.undo();
  assert.deepEqual(h.project, before);
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

test('⌘K / Ctrl+K opens the command palette even from fields, but not over another dialog', () => {
  for (const modifier of ['metaKey', 'ctrlKey']) {
    const h = editor(), field = { closest: query => query.includes('input') ? {} : null };
    h.press('k', { [modifier]: true }); h.press('K', { [modifier]: true, target: field }); h.press('k', { [modifier]: true, repeat: true });
    assert.equal(h.palette, 2); assert.equal(h.prevented, 3);
  }
  for (const options of [{ modal: true }, {}]) {
    const h = editor(options);
    h.press('k', { metaKey: true, ...(options.modal ? {} : { target: { closest: query => query.includes('[role="dialog"]') ? {} : null } }) });
    assert.equal(h.palette, 0); assert.equal(h.prevented, 0);
  }
  const h = editor({ blocked: true }); h.press('k', { metaKey: true }); assert.equal(h.palette, 0);
});

test('⌘A / Ctrl+A selects all layers outside text fields and keeps native select-all inside them', () => {
  const h = editor();
  h.press('a', { metaKey: true }); h.press('a', { ctrlKey: true });
  assert.equal(h.selectAll, 2);
  h.press('a', { metaKey: true, target: { closest: query => query.includes('textarea') ? {} : null } });
  h.press('a', { metaKey: true, altKey: true });
  assert.equal(h.selectAll, 2); assert.equal(h.prevented, 2);
});

test('Escape clears a multi-selection to its primary layer and leaves single selections alone', () => {
  const h = editor({ selection: ['logo', 'headline'], selected: 'headline' });
  h.press('Escape'); assert.equal(h.selection, undefined); assert.equal(h.selected, 'headline'); assert.equal(h.prevented, 1);
  h.press('Escape'); assert.equal(h.prevented, 1);
});

test('Delete removes every unlocked selected layer as one undoable change and reports locked ones', () => {
  const h = editor({ selection: ['logo', 'signature', 'headline'], selected: 'headline' });
  const before = h.project;
  h.press('Delete');
  assert.deepEqual(h.project.layers.map(layer => layer.id), before.layers.filter(layer => !['logo', 'signature', 'headline'].includes(layer.id)).map(layer => layer.id));
  assert.equal(h.history.length, 1);
  assert.deepEqual(h.selection, [before.layers[0].id]);
  h.undo(); assert.deepEqual(h.project, before);

  const locked = editor({ selection: ['logo', 'headline'], selected: 'headline', locked: true });
  const original = locked.project;
  locked.press('Backspace');
  assert.equal(locked.project.layers.some(layer => layer.id === 'logo'), false);
  assert.equal(locked.project.layers.find(layer => layer.id === 'headline').locked, true);
  assert.deepEqual(locked.selection, ['headline']);
  assert.match(locked.notices.at(-1), /skipped the locked layer “.+”/);
  locked.undo(); assert.deepEqual(locked.project, original);
});
