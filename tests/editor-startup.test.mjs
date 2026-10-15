import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import * as projectOps from '../src/project.js';
import * as historyOps from '../src/editor/history.js';
import { editorSession } from '../src/editor/project-session.js';
import { historyShortcut } from '../src/editor/history-shortcut.js';

const source = fs.readFileSync(new URL('../src/editor/useProject.js', import.meta.url), 'utf8');
const compiled = source.replace(/^import .*;\n/gm, '').replace('export function useProject', 'function useProject');
const plain = value => JSON.parse(JSON.stringify(value));
const blank = () => projectOps.validateProject(projectOps.blankProject());
const previous = () => projectOps.validateProject({ ...projectOps.demoProject(), name: 'Earlier work' });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function storageFor(identity) {
  const values = new Map([['floc.editor.artist', JSON.stringify(identity)]]);
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

function server({ draft, composition } = {}) {
  const drafts = new Map(draft ? [['previous-draft', { project: draft, revision: 7 }]] : []);
  const templates = new Map(composition ? [[composition.id, composition]] : []);
  const requests = [], archives = new Map();
  let gate, failure;
  return {
    drafts, templates, requests, archives,
    deferArchive() { gate = deferred(); return gate; },
    failArchive(error) { failure = error; },
    async request(url, options = {}) {
      const method = options.method ?? 'GET';
      const body = options.body && JSON.parse(options.body);
      requests.push({ url, method, body });
      const archive = url.match(/^\/api\/drafts\/([^/]+)\/archive$/);
      if (archive && method === 'POST') {
        if (gate) { const waiting = gate; gate = null; await waiting.promise; }
        if (failure) { const error = failure; failure = null; throw error; }
        const row = drafts.get(archive[1]);
        if (!row) return { composition: null };
        const key = `${archive[1]}:${row.revision}`;
        if (!archives.has(key)) {
          const entry = { id: `archive-${archives.size + 1}`, name: row.project.name, project: plain(row.project), updatedAt: 'archived' };
          archives.set(key, entry); templates.set(entry.id, entry);
        }
        return { composition: archives.get(key) };
      }
      const match = url.match(/^\/api\/(drafts|templates)\/([^/]+)$/);
      assert(match, `Unexpected request: ${method} ${url}`);
      const [, kind, id] = match;
      if (method === 'GET') return kind === 'templates' ? templates.get(id) : drafts.get(id) ?? { project: blank(), revision: 0 };
      assert.equal(method, 'PUT');
      if (kind === 'drafts') {
        const row = { project: body.project, revision: (drafts.get(id)?.revision ?? 0) + 1 };
        drafts.set(id, row); return row;
      }
      const entry = { ...templates.get(id), ...body, id, updatedAt: 'saved' };
      templates.set(id, entry); return entry;
    }
  };
}

function editor(backend, storage) {
  const slots = [], effects = [], listeners = new Map(), timers = new Map();
  let cursor = 0, timerId = 0;
  const context = {
    ...projectOps, ...historyOps, historyShortcut, crypto: webcrypto,
    editorSession: userId => editorSession(userId, storage), request: backend.request,
    useCallback(fn, deps) {
      const i = cursor++, old = slots[i];
      if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) slots[i] = { deps, fn };
      return slots[i].fn;
    },
    useState(value) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value;
      return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useEffect(fn, deps) {
      const i = cursor++, old = slots[i];
      if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) {
        const effect = { deps };
        slots[i] = effect;
        effects.push(() => { old?.cleanup?.(); effect.cleanup = fn(); });
      }
    },
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    window: {
      addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
      removeEventListener(name, fn) { listeners.get(name)?.delete(fn); }
    }
  };
  vm.createContext(context);
  vm.runInContext(compiled + '\nthis.hook = useProject;', context);
  return {
    render() { cursor = 0; return context.hook({ userId: 'artist' }); },
    identity() { return JSON.parse(storage.getItem('floc.editor.artist')); },
    flushEffects() { for (const effect of effects.splice(0)) effect(); },
    async flushTimers() { const pending = [...timers.values()]; timers.clear(); for (const timer of pending) timer(); await Promise.resolve(); await Promise.resolve(); },
    dispatch(name) { for (const listener of listeners.get(name) ?? []) listener({ preventDefault() {} }); }
  };
}

function assertBlank(api) {
  assert.deepEqual(plain(api.project), plain(blank()));
  assert.equal(api.composition, null);
  assert.equal(api.history.length, 0);
  assert.equal(api.future.length, 0);
}

test('startup never opens, archives or updates the remembered saved composition', async () => {
  const entry = { id: 'saved-composition', name: 'Saved work', project: previous(), updatedAt: 'original' };
  const backend = server({ draft: previous(), composition: entry });
  const storage = storageFor({ draftId: 'previous-draft', compositionId: entry.id });
  const h = editor(backend, storage);
  assertBlank(h.render());
  assert.equal(h.render().loaded, false);
  const result = await h.render().startFresh();
  assert.deepEqual(plain(result), plain(blank()));
  assertBlank(h.render());
  assert.equal(h.render().loaded, true);
  assert.equal(h.render().status, 'New document');
  assert.notEqual(h.identity().draftId, 'previous-draft');
  assert.equal(h.identity().compositionId, null);
  assert.deepEqual(backend.requests, []);
  assert.deepEqual(backend.templates.get(entry.id), entry);
});

test('startup archives the persisted draft before rotating identity and exposes a clean blank document', async () => {
  const persisted = previous(), backend = server({ draft: persisted });
  const storage = storageFor({ draftId: 'previous-draft', compositionId: null });
  const h = editor(backend, storage), gate = backend.deferArchive();
  const starting = h.render().startFresh();
  await Promise.resolve();
  assert.equal(h.identity().draftId, 'previous-draft');
  assert.equal(h.render().loaded, false);
  assertBlank(h.render());
  gate.resolve(); await starting;
  assert.notEqual(h.identity().draftId, 'previous-draft');
  assert.equal(h.render().loaded, true);
  assertBlank(h.render());
  assert.deepEqual(backend.requests.map(({ url, method }) => [method, url]), [['POST', '/api/drafts/previous-draft/archive']]);
  assert.deepEqual(backend.drafts.get('previous-draft'), { project: persisted, revision: 7 });
  assert.deepEqual([...backend.archives.values()][0].project, persisted);
  assert.equal([...backend.archives.values()][0].name, persisted.name);
});

test('same-tab reopening rotates again without saving or archiving untouched blank work', async () => {
  const backend = server(), storage = storageFor({ draftId: 'previous-draft', compositionId: null });
  const first = editor(backend, storage);
  await first.render().startFresh();
  first.render(); first.flushEffects();
  await first.flushTimers();
  const firstId = first.identity().draftId;
  const reopened = editor(backend, storage);
  await reopened.render().startFresh();
  reopened.render(); reopened.flushEffects();
  await reopened.flushTimers();
  assertBlank(reopened.render());
  assert.notEqual(reopened.identity().draftId, firstId);
  assert.equal(backend.archives.size, 0);
  assert.equal(backend.drafts.size, 0);
  assert.deepEqual(backend.requests.map(({ method, url }) => [method, url]), [
    ['POST', '/api/drafts/previous-draft/archive'], ['POST', `/api/drafts/${firstId}/archive`]
  ]);
});

test('failed preservation retains the recoverable identity and retry archives before rotation', async () => {
  const persisted = previous(), backend = server({ draft: persisted });
  const storage = storageFor({ draftId: 'previous-draft', compositionId: null });
  const h = editor(backend, storage);
  backend.failArchive(new Error('Preservation unavailable'));
  await assert.rejects(h.render().startFresh(), /Preservation unavailable/);
  assert.deepEqual(h.identity(), { draftId: 'previous-draft', compositionId: null });
  assert.equal(h.render().loaded, false);
  assert.equal(h.render().status, 'Open failed');
  assert.match(h.render().error, /Preservation unavailable/);
  assertBlank(h.render());
  assert.deepEqual(backend.drafts.get('previous-draft'), { project: persisted, revision: 7 });
  await h.render().startFresh();
  assert.notEqual(h.identity().draftId, 'previous-draft');
  assert.equal(h.render().loaded, true);
  assert.equal(h.render().error, '');
  assert.equal(backend.archives.size, 1);
  assert.equal(backend.requests.length, 2);
  assert(backend.requests.every(item => item.method === 'POST' && item.url === '/api/drafts/previous-draft/archive'));
});

test('concurrent initialization and the mount effect share one preservation operation', async () => {
  const backend = server({ draft: previous() }), storage = storageFor({ draftId: 'previous-draft', compositionId: null });
  const h = editor(backend, storage), gate = backend.deferArchive();
  const first = h.render().startFresh(), second = h.render().startFresh();
  h.flushEffects();
  await Promise.resolve();
  assert.equal(backend.requests.length, 1);
  assert.equal(h.identity().draftId, 'previous-draft');
  gate.resolve();
  const [one, two] = await Promise.all([first, second]);
  assert.deepEqual(plain(one), plain(two));
  assert.equal(backend.requests.length, 1);
  assert.equal(backend.archives.size, 1);
  const identity = h.identity();
  await h.render().startFresh();
  assert.deepEqual(h.identity(), identity);
});

test('session restoration retries failed startup and never resets edits in a hydrated document', async () => {
  const backend = server({ draft: previous() }), storage = storageFor({ draftId: 'previous-draft', compositionId: null });
  const h = editor(backend, storage);
  backend.failArchive(new Error('Sign in required'));
  await assert.rejects(h.render().startFresh(), /Sign in required/);
  h.render(); h.flushEffects();
  h.dispatch('floc-session-restored');
  await h.render().startFresh();
  const identity = h.identity();
  h.render().change({ ...h.render().project, name: 'Active edits' });
  assert.equal(h.render().history.length, 1);
  h.dispatch('floc-session-restored');
  await h.render().startFresh();
  assert.equal(h.render().project.name, 'Active edits');
  assert.equal(h.render().history.length, 1);
  assert.deepEqual(h.identity(), identity);
  assert.equal(backend.requests.filter(item => item.url.endsWith('/archive')).length, 2);
});

test('explicit reload reads the current draft rather than starting another blank document', async () => {
  const backend = server({ draft: previous() }), storage = storageFor({ draftId: 'previous-draft', compositionId: null });
  const h = editor(backend, storage);
  await h.render().startFresh();
  const identity = h.identity(), current = previous();
  current.name = 'Current draft from server';
  backend.drafts.set(identity.draftId, { project: current, revision: 3 });
  h.render().change({ ...h.render().project, name: 'Discarded local edit' });
  await h.render().reload();
  assert.deepEqual(plain(h.render().project), plain(current));
  assert.deepEqual(h.identity(), identity);
  assert.equal(h.render().history.length, 0);
  assert.deepEqual(backend.requests.at(-1), { method: 'GET', url: `/api/drafts/${identity.draftId}`, body: undefined });
  assert.equal(backend.requests.filter(item => item.url.endsWith('/archive')).length, 1);
});

test('opening a library composition does not save or archive the untouched startup blank', async () => {
  const entry = { id: 'chosen-composition', name: 'Chosen work', project: previous(), updatedAt: 'original' };
  const backend = server({ composition: entry }), storage = storageFor({ draftId: 'previous-draft', compositionId: null });
  const h = editor(backend, storage);
  await h.render().startFresh();
  const startupId = h.identity().draftId;
  await h.render().openSavedComposition(entry);
  assert.equal(h.render().composition.id, entry.id);
  assert.equal(h.render().project.name, entry.name);
  assert.deepEqual(plain(h.render().project.layers), plain(entry.project.layers));
  assert.equal(h.identity().compositionId, entry.id);
  assert.equal(h.render().history.length, 0);
  assert.equal(backend.drafts.has(startupId), false);
  assert.equal(backend.archives.size, 0);
  assert.equal(backend.templates.size, 1);
  assert.deepEqual(backend.requests.map(({ method, url }) => [method, url]), [
    ['POST', '/api/drafts/previous-draft/archive'], ['GET', `/api/templates/${entry.id}`]
  ]);
});
