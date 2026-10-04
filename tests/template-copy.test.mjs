import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { demoProject, patchLayer, validateProject } from '../src/project.js';
import { captureState } from '../src/choreography.js';
import { historyShortcut } from '../src/editor/history-shortcut.js';

const source = fs.readFileSync(new URL('../src/editor/useProject.js', import.meta.url), 'utf8');
const compiled = (await transform(source.replace(/^import .*;\n/gm, '').replace('export function', 'function'))).code;
const plain = value => JSON.parse(JSON.stringify(value));

function editor() {
  const slots = [], requests = [];
  let cursor = 0, revision = 4, create, saveFailure;
  const current = validateProject({ ...demoProject(), name: 'Current composition' });
  const identity = { id: 'current-composition', updatedAt: '2026-10-04T01:00:00Z' };
  const changed = (a, b) => !a || b.some((value, index) => !Object.is(value, a[index]));
  const context = {
    demoProject, patchLayer, validateProject, historyShortcut,
    request: async (url, options) => {
      const body = options?.body && JSON.parse(options.body);
      requests.push({ url, method: options?.method || 'GET', body });
      if (url === '/api/project' && !options) return { project: current, revision, composition: identity };
      if (url === '/api/templates' && !options) return { templates: [{ ...identity, name: current.name, project: current }] };
      if (url === '/api/templates') {
        if (create) await create;
        return { id: 'new-composition', updatedAt: '2026-10-04T02:00:00Z', name: body.name, project: body.project };
      }
      if (url === '/api/project' && options.method === 'PUT') {
        if (saveFailure) { const failure = saveFailure; saveFailure = null; throw failure; }
        return { revision: ++revision, composition: body.composition };
      }
      throw new Error(`Unexpected request: ${url}`);
    },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) {
      const i = cursor++;
      slots[i] ??= { value: typeof value === 'function' ? value() : value };
      return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }];
    },
    useCallback(fn, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    // Hydration is explicit below; saves exercise the same callback autosave uses.
    useEffect() { cursor++; }
  };
  vm.createContext(context);
  vm.runInContext(compiled + '\nthis.hook = useProject;', context);
  const render = () => { cursor = 0; return context.hook(); };
  const deferCreate = () => {
    let resolve, reject;
    create = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { resolve, reject };
  };
  return { render, requests, deferCreate, current, identity, failNextSave: error => { saveFailure = error; } };
}

test('copying another template keeps the current identity until creation succeeds and preserves source design', async () => {
  const h = editor();
  await h.render().reload();
  const template = demoProject();
  template.name = 'Stored source';
  const headline = template.layers.find(layer => layer.id === 'headline');
  headline.text = 'Source headline'; headline.contentField = 'Headline'; headline.locked = true;
  headline.choreography = captureState(headline, 0, template.fps, { size: 36 }, 'intro');
  headline.choreography = captureState(headline, 2, template.fps, { size: 72 }, 'hero');
  const before = structuredClone(template);
  const pending = h.deferCreate();
  const saving = h.render().saveCopy('  New content edition  ', template);
  await Promise.resolve();
  assert.deepEqual(plain(h.render().project), h.current);
  assert.deepEqual(plain(h.render().composition), h.identity);
  assert.equal(h.requests.filter(item => item.method === 'PUT').length, 0);
  pending.resolve();
  await saving;
  const copied = h.render();
  assert.equal(copied.composition.id, 'new-composition');
  assert.equal(copied.project.name, 'New content edition');
  assert.deepEqual(plain(copied.project.layers.find(layer => layer.id === 'headline')), validateProject(template).layers.find(layer => layer.id === 'headline'));
  assert.deepEqual(template, before);
  copied.patch('signature', { text: 'Only the copy changes' });
  await h.render().save();
  const saves = h.requests.filter(item => item.method === 'PUT');
  assert.equal(saves.length, 2);
  assert(saves.every(item => item.body.composition.id === 'new-composition'));
  assert.equal(saves[1].body.project.layers.find(layer => layer.id === 'signature').text, 'Only the copy changes');
  assert.deepEqual(template, before);
  assert.equal(h.current.layers.find(layer => layer.id === 'signature').text, demoProject().layers.find(layer => layer.id === 'signature').text);
});

test('a failed copy creation leaves the current project and linked identity intact', async () => {
  const h = editor();
  await h.render().reload();
  const before = plain(h.render().project);
  const pending = h.deferCreate();
  const saving = h.render().saveCopy('Unavailable copy', demoProject());
  pending.reject(new Error('Library unavailable'));
  await assert.rejects(saving, /Library unavailable/);
  assert.deepEqual(plain(h.render().project), before);
  assert.deepEqual(plain(h.render().composition), h.identity);
  assert.equal(h.requests.filter(item => item.method === 'PUT').length, 0);
});

test('saveCopy without a source still snapshots the current project and links its new entry', async () => {
  const h = editor();
  await h.render().reload();
  h.render().patch('headline', { text: 'Current unsaved headline' });
  const before = plain(h.render().project);
  await h.render().saveCopy('Current copy');
  const created = h.requests.find(item => item.method === 'POST').body;
  assert.deepEqual(created.project, { ...before, name: 'Current copy' });
  assert.equal(h.render().composition.id, 'new-composition');
  assert.equal(h.render().project.layers.find(layer => layer.id === 'headline').text, 'Current unsaved headline');
});

test('invalid source projects are rejected before creating or switching a composition', async () => {
  const h = editor();
  await h.render().reload();
  await assert.rejects(h.render().saveCopy('Invalid source', { ...demoProject(), duration: -1 }));
  assert.equal(h.requests.some(item => item.method === 'POST'), false);
  assert.deepEqual(plain(h.render().project), h.current);
  assert.deepEqual(plain(h.render().composition), h.identity);
});

test('a created copy remains successful when linking the draft fails and retry saves the same identity', async () => {
  const h = editor();
  await h.render().reload();
  h.failNextSave(new Error('Draft save unavailable'));
  const entry = await h.render().saveCopy('Persisted copy', demoProject());
  assert.equal(entry.id, 'new-composition');
  assert.equal(h.render().composition.id, entry.id);
  assert.equal(h.render().project.name, 'Persisted copy');
  assert.equal(h.render().status, 'Save failed');
  assert.equal(h.render().error, 'Draft save unavailable');
  assert.equal(h.requests.filter(item => item.method === 'POST').length, 1);
  await h.render().save();
  assert.equal(h.requests.filter(item => item.method === 'POST').length, 1);
  const saves = h.requests.filter(item => item.method === 'PUT');
  assert.equal(saves.length, 2);
  assert(saves.every(item => item.body.composition.id === entry.id));
  assert.equal(h.render().status, 'All changes saved');
  assert.equal(h.render().error, '');
});
