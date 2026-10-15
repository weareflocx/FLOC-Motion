import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { FORMATS, PROJECT_LIMITS, assertLocksRespected, blankProject, demoProject, duplicateLayer, linkFormats, patchLayer, reorderLayer, resetFormat, resizeDuration, switchFormat, unlinkFormats, validateProject } from '../src/project.js';
import { historyShortcut } from '../src/editor/history-shortcut.js';
import * as historyOps from '../src/editor/history.js';

const { diffProjects, pushHistory } = historyOps;
const offline = async () => ({ id: 'saved', name: 'Saved', updatedAt: 'date', project: demoProject(), revision: 1 });

function editor(request = offline) {
  const slots = []; let cursor = 0;
  const context = { editorSession: () => ({ draftId: 'draft', compositionId: null, remember() {} }), PROJECT_LIMITS, assertLocksRespected, blankProject, demoProject, patchLayer, validateProject, historyShortcut, ...historyOps, request, crypto: webcrypto,
    useCallback: fn => fn, useEffect: () => {},
    useRef: value => { const i = cursor++; return slots[i] ??= { current: value }; },
    useState: value => { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; }
  };
  vm.createContext(context);
  const source = fs.readFileSync(new URL('../src/editor/useProject.js', import.meta.url), 'utf8');
  vm.runInContext(source.replace(/^import .*;\n/gm, '').replace('export function useProject', 'function useProject') + '\nthis.hook = useProject;', context);
  context.hook().importDraft(demoProject());
  return () => { cursor = 0; return context.hook(); };
}

// A minimal library: saves overwrite entries and archiving a draft creates one.
function library(templates) {
  const drafts = new Map(); let archived = 0, revision = 0;
  return async (url, { method = 'GET', body } = {}) => {
    const data = body && JSON.parse(body);
    if (url === '/api/templates' && method === 'POST') {
      const entry = { id: `archived-${++archived}`, updatedAt: 'v0', name: data.name, project: data.project };
      templates.set(entry.id, entry); return entry;
    }
    const [, kind, id] = url.match(/^\/api\/(templates|drafts)\/(.+)$/);
    if (method === 'PUT' && kind === 'drafts') { drafts.set(id, data.project); return { revision: ++revision, composition: null }; }
    if (method === 'PUT') { const entry = { ...templates.get(id), name: data.name, project: data.project, updatedAt: `v${++revision}` }; templates.set(id, entry); return entry; }
    return kind === 'templates' ? templates.get(id) : { project: drafts.get(id) ?? demoProject(), revision };
  };
}

const same = (actual, expected) => { assert.deepEqual(actual, expected); assert.equal(JSON.stringify(actual), JSON.stringify(expected)); };
const text = api => api.projectRef.current.layers.find(layer => layer.id === 'headline').text;

test('undo and redo handle rapid calls and new edits invalidate redo', () => {
  const render = editor(); let api = render(); const initial = api.project.name;
  api.change({ ...api.projectRef.current, name: 'One' });
  api.change({ ...api.projectRef.current, name: 'Two' });
  api.undo(); api.undo(); assert.equal(api.projectRef.current.name, initial);
  api.redo(); api.redo(); assert.equal(api.projectRef.current.name, 'Two');
  api.undo(); api.change({ ...api.projectRef.current, name: 'Branch' }); api.redo();
  api = render(); assert.equal(api.project.name, 'Branch'); assert.equal(api.future.length, 0);
});

test('unchanged and invalid edits preserve redo; opening and reloading clear both stacks', async () => {
  const render = editor(); let api = render();
  api.change({ ...api.project, name: 'Edit' }); api.undo();
  api.change(api.projectRef.current); api.change({ ...api.projectRef.current, duration: -1 });
  api = render(); assert.equal(api.future.length, 1); assert.equal(api.history.length, 0);
  api.openComposition({ id: 'saved', updatedAt: 'date', name: 'Saved', project: demoProject() });
  api = render(); assert.equal(api.history.length, 0); assert.equal(api.future.length, 0);
  for (let i = 0; i < 205; i++) api.change({ ...api.projectRef.current, name: `Edit ${i}` });
  api = render(); assert.equal(api.history.length, 200);
  api.undo(); await api.reload(); api = render();
  assert.equal(api.history.length, 0); assert.equal(api.future.length, 0);
});

test('history drops the oldest entries beyond its byte budget', () => {
  const base = validateProject(demoProject());
  let past = [];
  for (let i = 0; i < 30; i++) past = pushHistory(past, diffProjects(base, { ...base, name: `Edit ${i}` }), { entries: 200, bytes: 2000 });
  assert(past.length > 1 && past.length < 30);
  assert(past.reduce((sum, entry) => sum + entry.bytes, 0) <= 2000);
  assert.equal(past.at(-1).ops[0].b, 'Edit 29');
});

test('layer insertions and moves are stored by id instead of rewriting neighbouring layers', () => {
  const base = validateProject(demoProject());
  const inserted = diffProjects(base, duplicateLayer(base, 'carousel', 'carousel-copy'));
  assert.deepEqual(inserted.map(op => op.t), ['order']);
  assert.deepEqual(inserted[0].items.map(item => item.id), ['carousel-copy']);
  const moved = diffProjects(base, reorderLayer(base, 'signature', 'background', 'above'));
  assert.deepEqual(moved.map(op => [op.t, op.items.length]), [['order', 0]]);
});

function mulberry32(seed) {
  return () => {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const pick = (random, list) => list[Math.floor(random() * list.length)];
const edits = [
  (p, r) => [patchLayer(p, pick(r, p.layers.filter(layer => layer.type === 'text')).id, { text: `Text ${Math.floor(r() * 1000)}` })],
  (p, r) => [patchLayer(p, pick(r, p.layers).id, { x: Math.round(r() * 100), y: Math.round(r() * 100) })],
  (p, r) => { const layer = pick(r, p.layers); return [patchLayer(p, layer.id, { visible: !layer.visible })]; },
  (p, r) => { const layer = pick(r, p.layers); return [patchLayer(p, layer.id, { locked: !layer.locked })]; },
  (p, r) => [duplicateLayer(p, pick(r, p.layers).id, `copy-${Math.floor(r() * 1e6)}`)],
  (p, r) => [reorderLayer(p, pick(r, p.layers).id, pick(r, p.layers).id, r() < 0.5 ? 'above' : 'below')],
  (p, r) => { const layer = pick(r, p.layers); return [{ ...p, layers: p.layers.filter(item => item.id !== layer.id) }]; },
  (p, r) => [resizeDuration(p, 4 + Math.round(r() * 16)), { allow: ['timing'] }],
  (p, r) => [r() < 0.5 ? linkFormats(p) : unlinkFormats(p), { allow: ['format'] }],
  (p, r) => [switchFormat(p, pick(r, Object.keys(FORMATS))), { allow: ['format'] }],
  p => [resetFormat(p), { allow: ['format'] }],
  (p, r) => [{ ...p, name: `Name ${Math.floor(r() * 100)}`, fps: pick(r, [24, 25, 30, 60]) }],
  (p, r) => [{ ...p, images: p.images.filter((_, i) => i !== Math.floor(r() * p.images.length)) }],
  (p, r) => [{ ...p, images: [...p.images].sort(() => r() - 0.5) }]
];

test('undoing and redoing random real edits restores every validated snapshot exactly', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const render = editor(); let api = render(); const random = mulberry32(seed);
    const snapshots = [api.projectRef.current];
    for (let step = 0; step < 160; step++) {
      let edit;
      try { edit = pick(random, edits)(api.projectRef.current, random); } catch { continue; }
      const result = api.change(...edit);
      if (result && result !== snapshots.at(-1)) snapshots.push(result);
    }
    assert(snapshots.length > 60, `seed ${seed} produced ${snapshots.length} snapshots`);
    api = render(); assert.equal(api.history.length, snapshots.length - 1);
    for (let i = snapshots.length - 2; i >= 0; i--) { api.undo(); same(api.projectRef.current, snapshots[i]); }
    api = render(); assert.equal(api.history.length, 0);
    for (let i = 1; i < snapshots.length; i++) { api.redo(); same(api.projectRef.current, snapshots[i]); }
    api = render(); assert.equal(api.future.length, 0);
  }
});

test('each composition keeps its undo and redo stacks while switching in the session', async () => {
  const templates = new Map(['a', 'b'].map(id => [id, { id, updatedAt: 'v0', name: id.toUpperCase(), project: demoProject() }]));
  const render = editor(library(templates)); let api = render();
  await api.reload();
  const original = text(api);
  api.patch('headline', { text: 'Draft edit' });
  await api.openSavedComposition(templates.get('a'));
  api = render(); assert.equal(api.history.length, 0);
  const openedA = api.projectRef.current;
  api.patch('headline', { text: 'A1' }); api.patch('headline', { text: 'A2' }); api.undo();
  await api.openSavedComposition(templates.get('b'));
  api = render(); assert.deepEqual([api.history.length, api.future.length], [0, 0]);
  api.patch('headline', { text: 'B1' });
  await api.openSavedComposition(templates.get('a'));
  api = render(); assert.deepEqual([api.history.length, api.future.length], [1, 1]);
  api.redo(); assert.equal(text(api), 'A2');
  api.undo(); api.undo(); same(api.projectRef.current, openedA);

  // The draft archived on the first switch reopens with its own history.
  await api.openSavedComposition(templates.get('archived-1'));
  api = render(); assert.equal(api.history.length, 1);
  api.undo(); assert.equal(text(api), original);

  // A composition changed elsewhere since it was left starts over.
  templates.set('b', { ...templates.get('b'), project: patchLayer(validateProject(templates.get('b').project), 'headline', { text: 'Elsewhere' }) });
  await api.openSavedComposition(templates.get('b'));
  api = render(); assert.deepEqual([api.history.length, api.future.length, text(api)], [0, 0, 'Elsewhere']);

  api.patch('headline', { text: 'Before import' });
  api.importDraft(demoProject());
  api = render(); assert.deepEqual([api.history.length, api.future.length], [0, 0]);
});

test('shortcuts support Mac and Windows and preserve editing and dialogs', () => {
  const base = { key: 'z', metaKey: true };
  assert.equal(historyShortcut(base), 'undo');
  assert.equal(historyShortcut({ ...base, key: 'Z', shiftKey: true }), 'redo');
  assert.equal(historyShortcut({ key: 'z', ctrlKey: true }), 'undo');
  assert.equal(historyShortcut({ key: 'y', ctrlKey: true }), 'redo');
  for (const extra of [{ altKey: true }, { isComposing: true }, { defaultPrevented: true }, { target: { isContentEditable: true } }, { target: { closest: () => ({}) } }]) assert.equal(historyShortcut({ ...base, ...extra }), null);
  assert.equal(historyShortcut({ key: 'z' }), null);
});

test('undo commits a pending canvas resize before reverting it, and redo restores it', () => {
  const render = editor(); let api = render();
  const original = api.project.layers.find(layer => layer.id === 'headline').size;
  let commits = 0;
  api.setCanvasEdit(() => {
    api.setCanvasEdit(null); commits++;
    api.patch('headline', { size: original + 2 });
  });
  api = render(); assert.equal(api.canvasEditing, true); assert.equal(api.history.length, 0);
  api.undo();
  assert.equal(api.projectRef.current.layers.find(layer => layer.id === 'headline').size, original);
  api.redo();
  assert.equal(api.projectRef.current.layers.find(layer => layer.id === 'headline').size, original + 2);
  api = render(); assert.equal(api.canvasEditing, false); assert.equal(commits, 1);
});
