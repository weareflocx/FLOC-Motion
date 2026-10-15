import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { PROJECT_LIMITS, assertLocksRespected, blankProject, carouselImages, demoProject, fileLayer, duplicateLayer, linkFormats, patchLayer, patchTemplateContent, reorderLayer, resetFormat, resizeDuration, switchFormat, validateProject } from '../src/project.js';
import { getCatalogEntry, listCatalog } from '../src/catalog.js';
import { createStyleAlternatives } from '../src/visual-alternatives.js';
import { historyShortcut } from '../src/editor/history-shortcut.js';
import * as historyOps from '../src/editor/history.js';
import { createTools } from '../src/webmcp.js';

const layer = (project, id) => project.layers.find(item => item.id === id);
const replace = (project, id, fields) => ({ ...project, layers: project.layers.map(item => item.id === id ? { ...item, ...fields } : item) });
const locked = (...ids) => ids.reduce((p, id) => patchLayer(p, id, { locked: true }), validateProject(demoProject()));
const check = (previous, next, options) => assertLocksRespected(previous, validateProject(next), options);

function editor() {
  const slots = []; let cursor = 0, selected = 'headline';
  const context = {
    PROJECT_LIMITS, assertLocksRespected, blankProject, demoProject, patchLayer, validateProject, historyShortcut, createStyleAlternatives, duplicateLayer, reorderLayer, carouselImages, crypto: webcrypto, ...historyOps,
    editorSession: () => ({ draftId: 'draft', compositionId: null, remember() {} }),
    request: async () => { throw new Error('Offline'); },
    useCallback: fn => fn, useEffect() {},
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) { const i = cursor++; slots[i] ??= { value: typeof value === 'function' ? value() : value }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; }
  };
  vm.createContext(context);
  for (const file of ['useProject.js', 'useVisualAlternatives.js', 'useCompositionActions.js']) {
    const source = fs.readFileSync(new URL(`../src/editor/${file}`, import.meta.url), 'utf8');
    vm.runInContext(source.replace(/^import .*;\n/gm, '').replace(/export function /g, 'function '), context);
  }
  context.useProject().importDraft(demoProject());
  return () => {
    cursor = 0;
    const api = context.useProject();
    const alternatives = context.useVisualAlternatives({ projectRef: api.projectRef, change: api.change, setPlaying() {} });
    const actions = context.useCompositionActions({ project: api.projectRef.current, projectRef: api.projectRef, selected, setSelected(id) { selected = id; }, setLeftTab() {}, change: api.change });
    return { ...api, alternatives, actions };
  };
}

test('whole-project edits cannot restyle, retime, move or delete a locked layer', () => {
  const p = locked('carousel', 'headline');
  const preset = getCatalogEntry(listCatalog({ limit: 1 })[0].id).carouselPatch;
  const unlockedPreset = patchLayer(patchLayer(p, 'carousel', { locked: false }), 'carousel', preset);
  for (const [next, message] of [
    [replace(p, 'carousel', { stretch: 0.2 }), /Unlock “Carousel” before editing it/],
    [replace(p, 'carousel', { ...layer(unlockedPreset, 'carousel'), locked: true }), /Unlock “Carousel” before editing it/],
    [replace(p, 'carousel', { effects: [{ type: 'monochrome', enabled: true, amount: 1 }] }), /Unlock “Carousel” before editing it/],
    [replace(p, 'carousel', { start: 2 }), /Unlock “Carousel” before editing it/],
    [replace(p, 'carousel', { images: carouselImages(p, layer(p, 'carousel')).slice(1) }), /Unlock “Carousel” before editing it/],
    [{ ...p, images: p.images.slice(0, 2) }, /Unlock “Carousel” before editing it/],
    [replace(p, 'headline', { locked: false, text: 'Edited' }), /Unlock “Headline” before editing it/],
    [{ ...p, layers: p.layers.filter(item => item.id !== 'headline') }, /Unlock “Headline” before deleting it/],
    [{ ...p, layers: [p.layers[0], p.layers[2], p.layers[1], ...p.layers.slice(3)] }, /before reordering it/]
  ]) assert.throws(() => check(p, next), message);
});

test('unlocked work around locked layers and lock or visibility toggles still pass', () => {
  const p = locked('carousel');
  assert.doesNotThrow(() => check(p, patchLayer(p, 'carousel', { visible: false })));
  assert.doesNotThrow(() => check(p, patchLayer(p, 'carousel', { locked: false })));
  assert.doesNotThrow(() => check(p, reorderLayer(p, 'signature', 'background', 'above')));
  assert.doesNotThrow(() => check(p, duplicateLayer(p, 'headline', 'copy')));
  assert.doesNotThrow(() => check(p, { ...p, layers: p.layers.filter(item => item.id !== 'headline') }));
  assert.doesNotThrow(() => check(p, patchLayer(p, 'headline', { text: 'Edited', x: 20 })));
  assert.throws(() => reorderLayer(p, 'carousel', 'headline'), /Unlock/);
});

test('documented composition-wide exceptions pass only for their own fields', () => {
  const p = locked('carousel', 'headline');
  const shorter = resizeDuration(p, 4);
  assert.equal(layer(shorter, 'headline').end, 4);
  assert.throws(() => check(p, shorter), /Unlock “Carousel” before editing it/);
  assert.deepEqual(check(p, shorter, { allow: ['timing'] }), shorter);
  assert.throws(() => check(p, replace(shorter, 'carousel', { speed: 40 }), { allow: ['timing'] }), /Unlock “Carousel”/);

  const content = patchLayer(patchLayer(validateProject(demoProject()), 'headline', { contentField: { id: 'headline', label: 'Headline', required: false } }), 'headline', { locked: true });
  const filled = patchTemplateContent(content, 'headline', 'NEW');
  assert.throws(() => check(content, filled), /Unlock “Headline”/);
  assert.doesNotThrow(() => check(content, filled, { allow: ['content'] }));
  assert.throws(() => check(content, replace(filled, 'headline', { size: 60 }), { allow: ['content'] }), /Unlock “Headline”/);

  const linked = patchLayer(patchLayer(linkFormats(validateProject(demoProject())), 'headline', { x: 20 }), 'headline', { locked: true });
  const portrait = switchFormat(linked, 'portrait');
  assert.notDeepEqual(layer(portrait, 'headline'), layer(linked, 'headline'));
  assert.throws(() => check(linked, portrait), /Unlock “Headline”/);
  assert.doesNotThrow(() => check(linked, portrait, { allow: ['format'] }));
  assert.throws(() => check(linked, replace(portrait, 'headline', { text: 'Other' }), { allow: ['format'] }), /Unlock “Headline”/);
  const adjusted = patchLayer(patchLayer(patchLayer(portrait, 'headline', { locked: false }), 'headline', { x: 40 }), 'headline', { locked: true });
  assert.throws(() => check(adjusted, resetFormat(adjusted)), /Unlock “Headline”/);
  assert.doesNotThrow(() => check(adjusted, resetFormat(adjusted), { allow: ['format'] }));
  assert.throws(() => assertLocksRespected(p, p, { allow: ['everything'] }), /Unknown lock exception/);
});

test('locked model timing, axes and sectors cannot change through patches or whole-project edits', () => {
  const model = fileLayer({ name: 'Model', src: '/assets/12345678-1234-1234-1234-123456789012.glb' }, 12, 'model');
  const project = patchLayer(validateProject({ ...demoProject(), layers: [model] }), 'model', { locked: true });
  for (const fields of [{ motionAxis: 'x' }, { motionSteps: 7 }, { motionTiming: { mode: 'steps', action: .4, pause: 1 } }]) {
    const modelStyle = { ...layer(project, 'model').modelStyle, ...fields };
    assert.throws(() => patchLayer(project, 'model', { modelStyle }), /Unlock/);
    assert.throws(() => check(project, replace(project, 'model', { modelStyle })), /Unlock/);
    assert.throws(() => check(project, replace(project, 'model', { modelStyle }), { allow: ['format'] }), /Unlock/);
  }
});

test('editor changes, alternatives and layer drops respect locks; undo and import stay exempt', () => {
  const render = editor();
  let api = render();
  api.patch('carousel', { speed: 30 });
  api.patch('carousel', { locked: true });
  api = render();
  const before = api.projectRef.current;
  assert.equal(api.change(replace(before, 'carousel', { speed: 60 })), null);
  api = render();
  assert.match(api.error, /Unlock “Carousel” before editing it/);
  assert.equal(api.projectRef.current, before);
  assert.equal(api.history.length, 2);

  const candidate = replace(before, 'carousel', { stretch: 0.5 });
  api.alternatives.propose({ base: before, alternatives: [{ name: 'Locked', project: candidate }, { name: 'Other', project: patchLayer(before, 'headline', { size: 60 }) }] });
  assert.throws(() => render().alternatives.apply(0), /could not be applied/);
  assert.equal(render().projectRef.current, before);
  render().alternatives.apply(1);
  assert.equal(layer(render().projectRef.current, 'headline').size, 60);
  assert.equal(layer(render().projectRef.current, 'carousel').stretch, 0);

  render().actions.dropLayer('carousel', 'logo', 'above');
  assert.deepEqual(render().projectRef.current.layers.map(item => item.id), before.layers.map(item => item.id));
  render().actions.dropLayer('signature', 'background', 'above');
  assert.equal(render().projectRef.current.layers[1].id, 'signature');
  assert.equal(render().change(resizeDuration(render().projectRef.current, 6), { allow: ['timing'] }).duration, 6);
  assert.equal(layer(render().projectRef.current, 'carousel').end, 6);

  render().undo();
  assert.equal(layer(render().projectRef.current, 'carousel').end, 12);
  assert.equal(layer(render().projectRef.current, 'carousel').locked, true);
  render().redo();
  assert.equal(layer(render().projectRef.current, 'carousel').end, 6);
  const imported = replace(demoProject(), 'carousel', { speed: 5 });
  assert.throws(() => check(render().projectRef.current, imported), /Unlock “Carousel”/);
  assert.equal(layer(render().importDraft(imported), 'carousel').speed, 5);
});

test('agent mutations keep locks and forward explicit output exceptions to the editor', async () => {
  let p = patchLayer(patchLayer(linkFormats(validateProject(demoProject())), 'headline', { locked: true }), 'carousel', { locked: true }), saves = 0;
  const forwarded = [];
  const tools = createTools({ get: () => p, set: (next, locks) => { forwarded.push(locks); p = assertLocksRespected(p, next, locks); }, save: async () => saves++, audit() {} });
  const call = (name, args) => tools.find(tool => tool.name === name).execute(args);
  for (const [name, args] of [['floc_update_layer', { id: 'headline', patch: { text: 'Agent' } }], ['floc_set_carousel', { speed: 30 }], ['floc_apply_preset', { id: listCatalog({ limit: 1 })[0].id }]]) {
    await assert.rejects(() => call(name, args), /Unlock/);
  }
  assert.equal(saves, 0);
  await call('floc_set_output', { duration: 6, format: 'portrait', fps: 30 });
  assert.deepEqual(forwarded.at(-1), { allow: ['timing', 'format'] });
  assert.equal(p.format, 'portrait'); assert.equal(layer(p, 'headline').end, 6); assert.equal(layer(p, 'headline').locked, true);
  await call('floc_add_text', { text: 'Agent text' });
  assert.deepEqual(forwarded.at(-1), {});
  assert.equal(saves, 2);
});
