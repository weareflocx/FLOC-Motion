import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { demoProject, patchLayer, validateProject } from '../src/project.js';
import { historyShortcut } from '../src/editor/history-shortcut.js';

function editor() {
  const slots = []; let cursor = 0;
  const context = { editorSession: () => ({ draftId: 'draft', compositionId: null, remember() {} }), demoProject, patchLayer, validateProject, historyShortcut,
    request: async () => ({ id: 'saved', name: 'Saved', updatedAt: 'date', project: demoProject(), revision: 1 }),
    useCallback: fn => fn, useEffect: () => {},
    useRef: value => { const i = cursor++; return slots[i] ??= { current: value }; },
    useState: value => { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; }
  };
  vm.createContext(context);
  const source = fs.readFileSync(new URL('../src/editor/useProject.js', import.meta.url), 'utf8');
  vm.runInContext(source.replace(/^import .*;\n/gm, '').replace('export function useProject', 'function useProject') + '\nthis.hook = useProject;', context);
  return () => { cursor = 0; return context.hook(); };
}

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
  for (let i = 0; i < 25; i++) api.change({ ...api.projectRef.current, name: `Edit ${i}` });
  api = render(); assert.equal(api.history.length, 20);
  api.undo(); await api.reload(); api = render();
  assert.equal(api.history.length, 0); assert.equal(api.future.length, 0);
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
