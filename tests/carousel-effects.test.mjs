import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, patchLayer, validateProject } from '../src/project.js';
import { createTools } from '../src/webmcp.js';
import { EFFECTS, MAX_EFFECTS, newEffect } from '../src/effects.js';

test('carousels accept every catalog effect without changing other layers', () => {
  const original = demoProject();
  for (const { id } of EFFECTS) {
    const next = patchLayer(original, 'carousel', { effects: [newEffect(id)] });
    assert.equal(next.layers[1].effects[0].type, id);
    assert.deepEqual(next.images, original.images);
    assert.deepEqual(next.layers.filter(layer => layer.type !== 'carousel'), validateProject(original).layers.filter(layer => layer.type !== 'carousel'));
    assert.deepEqual(validateProject(JSON.parse(JSON.stringify(next))), next);
  }
  const full = patchLayer(original, 'carousel', { effects: EFFECTS.map(({ id }, i) => newEffect(id, i)) });
  assert.equal(full.layers[1].effects.length, MAX_EFFECTS);
  assert.throws(() => patchLayer(full, 'carousel', { effects: [...full.layers[1].effects, newEffect('blur')] }), /at most/);
});

test('carousel stretch is validated and the retired card shader fields are rejected', () => {
  assert.equal(validateProject(demoProject()).layers[1].stretch, 0);
  assert.equal(patchLayer(demoProject(), 'carousel', { stretch: 0.7 }).layers[1].stretch, 0.7);
  for (const stretch of [-0.1, 1.1, NaN, Infinity, '0.5']) assert.throws(() => patchLayer(demoProject(), 'carousel', { stretch }), /Edge stretch/);
  for (const patch of [{ shader: 'wave' }, { intensity: 0.5 }, { tint: '#ff0000' }]) assert.throws(() => patchLayer(demoProject(), 'carousel', patch), /Unknown layer property/);
  for (const type of ['https://shaders.com/custom', 'eval', 'mono']) assert.throws(() => patchLayer(demoProject(), 'carousel', { effects: [{ type }] }));
  const locked = patchLayer(demoProject(), 'carousel', { locked: true });
  assert.throws(() => patchLayer(locked, 'carousel', { effects: [newEffect('halftone')] }), /Unlock/);
});

test('agents discover the one effect catalog and edit carousel effects through validated tools', async () => {
  let project = demoProject(), saves = 0;
  const tools = createTools({ get: () => project, set: next => { project = next; }, save: async () => saves++, audit: () => {} });
  const call = (name, args) => tools.find(tool => tool.name === name).execute(args);
  const listed = JSON.parse(await call('floc_list_effects'));
  assert.deepEqual(listed.effects, EFFECTS);
  assert.equal(Object.hasOwn(listed, 'shaders'), false);
  assert.equal(tools.some(tool => tool.name.includes('shader')), false);
  for (const { id } of EFFECTS) {
    await call('floc_update_layer', { id: 'carousel', patch: { effects: [newEffect(id)], stretch: 0.4 } });
    assert.equal(project.layers[1].effects[0].type, id);
    assert.equal(project.layers[1].stretch, 0.4);
  }
  assert.equal(saves, EFFECTS.length);
  await assert.rejects(call('floc_update_layer', { id: 'carousel', patch: { effects: [{ type: 'unknown' }] } }));
  assert.equal(saves, EFFECTS.length);
});
