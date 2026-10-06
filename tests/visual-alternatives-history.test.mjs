import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { demoProject, patchLayer, validateProject, linkFormats, switchFormat } from '../src/project.js';
import { createStyleAlternatives, buildVisualAlternatives } from '../src/visual-alternatives.js';
import { historyShortcut } from '../src/editor/history-shortcut.js';

function editor() {
  const slots = [], writes = [], playback = [];
  let cursor = 0, blocked = false;
  const original = linkFormats(demoProject());
  const identity = { id: 'saved-study', updatedAt: '2026-10-04T08:00:00Z' };
  const context = {
    editorSession: () => ({ draftId: 'draft', compositionId: identity.id, remember() {} }), demoProject, patchLayer, validateProject, historyShortcut, createStyleAlternatives,
    request: async (url, options) => {
      if (options) { const body = JSON.parse(options.body); writes.push(body); return { revision: writes.length + 1, id: identity.id, updatedAt: `version-${writes.length}`, project: body.project, name: body.name }; }
      if (url === '/api/templates') return { templates: [{ ...identity, project: original, name: original.name }] };
      return { ...identity, project: original, name: original.name };
    },
    useCallback: fn => fn, useEffect() {},
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) { const i = cursor++; slots[i] ??= { value: typeof value === 'function' ? value() : value }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; }
  };
  vm.createContext(context);
  for (const [file, name] of [['useProject.js', 'useProject'], ['useVisualAlternatives.js', 'useVisualAlternatives']]) {
    const source = fs.readFileSync(new URL(`../src/editor/${file}`, import.meta.url), 'utf8');
    vm.runInContext(source.replace(/^import .*;\n/gm, '').replace(`export function ${name}`, `function ${name}`) + `\nthis.${name}Hook = ${name};`, context);
  }
  const render = () => {
    cursor = 0;
    const project = context.useProjectHook();
    const alternatives = context.useVisualAlternativesHook({ projectRef: project.projectRef, change: project.change, blocked, setPlaying: value => playback.push(value) });
    return { ...project, alternatives };
  };
  return { render, original, identity, writes, playback, block(value) { blocked = value; render(); } };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('comparison and cancel preserve saved identity, history, revision and content', async () => {
  const h = editor(); await h.render().reload();
  const before = plain(h.render().project);
  h.render().alternatives.explore();
  assert.equal(h.render().alternatives.proposal.alternatives.length, 3);
  assert.deepEqual(plain(h.render().project), before);
  assert.equal(h.render().history.length, 0);
  assert.equal(h.writes.length, 0);
  h.render().alternatives.close();
  assert.equal(h.render().alternatives.proposal, null);
  assert.deepEqual(plain(h.render().composition), h.identity);
  assert.deepEqual(plain(h.render().project), before);
  assert(h.playback.every(value => value === false));
});

test('a multi-layer alternative applies once, preserves identity and undo restores every linked layout', async () => {
  const h = editor(); await h.render().reload();
  const before = h.render().project;
  h.render().alternatives.explore();
  const candidate = h.render().alternatives.proposal.alternatives[1].project;
  h.render().alternatives.apply(1);
  assert.equal(h.render().alternatives.proposal, null);
  assert.equal(h.render().history.length, 1);
  assert.deepEqual(plain(h.render().project), candidate);
  assert.equal(h.render().composition.id, h.identity.id);
  await h.render().save();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].updatedAt, h.identity.updatedAt);
  h.render().undo();
  assert.deepEqual(plain(h.render().project), before);
  assert.deepEqual(switchFormat(h.render().project, 'portrait'), switchFormat(before, 'portrait'));
  h.render().redo();
  assert.deepEqual(plain(h.render().project), candidate);
  assert.throws(() => h.render().alternatives.apply(1), /changed/);
  assert.equal(h.render().history.length, 1);
});

test('pending comparisons, stale projects and unfinished canvas edits cannot apply or replace proposals', async () => {
  const h = editor(); await h.render().reload();
  h.block(true);
  assert.throws(() => h.render().alternatives.explore(), /current edit/);
  h.block(false); h.render().alternatives.explore();
  assert.throws(() => h.render().alternatives.explore(), /current comparison/);
  h.block(true);
  assert.throws(() => h.render().alternatives.apply(0), /current edit/);
  assert.equal(h.render().history.length, 0);
  h.block(false); h.render().patch('headline', { text: 'Changed while comparing' });
  assert.throws(() => h.render().alternatives.apply(0), /changed/);
  assert.equal(h.render().project.layers.find(layer => layer.id === 'headline').text, 'Changed while comparing');
  assert.equal(h.render().history.length, 1);
  h.render().alternatives.close();
  const old = createStyleAlternatives(h.original);
  assert.throws(() => h.render().alternatives.propose(old), /changed/);
  assert.equal(h.writes.length, 0);
});

test('native-agent proposals apply several validated patches through the same single history entry', async () => {
  const h = editor(); await h.render().reload();
  const base = h.render().project;
  const proposal = buildVisualAlternatives(base, { base, alternatives: [
    { name: 'Editorial', patches: [{ id: 'headline', patch: { size: 40, letterSpacing: 0.02 } }, { id: 'background', patch: { mode: 'procedural', pattern: 'grain' } }] },
    { name: 'Experimental', patches: [{ id: 'headline', patch: { textAlign: 'right' } }, { id: 'background', patch: { mode: 'procedural', pattern: 'mesh' } }] }
  ] });
  h.render().alternatives.propose(proposal);
  h.render().alternatives.apply(0);
  assert.equal(h.render().history.length, 1);
  assert.equal(h.render().project.layers.find(layer => layer.id === 'background').pattern, 'grain');
  assert.equal(h.render().project.layers.find(layer => layer.id === 'headline').size, 40);
});
