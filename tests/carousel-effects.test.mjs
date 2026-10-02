import test from 'node:test';
import assert from 'node:assert/strict';
import { CAROUSEL_EFFECTS, SHADERS, demoProject, patchLayer, validateProject } from '../src/project.js';
import { createTools } from '../src/webmcp.js';

test('legacy projects retain their card shader and migrate with the layer effect off', () => {
  const raw = patchLayer(demoProject(), 'carousel', { shader: 'elastic', intensity: 0.7 });
  for (const field of ['layerEffect', 'layerEffectIntensity', 'halftoneSize', 'ditheringSize', 'ditheringSteps', 'glassSize', 'glassDistortion']) delete raw.layers[1][field];
  const original = structuredClone(raw);
  const migrated = validateProject(raw);
  assert.deepEqual(raw, original);
  assert.equal(migrated.layers[1].shader, 'elastic');
  assert.equal(migrated.layers[1].intensity, 0.7);
  assert.equal(migrated.layers[1].layerEffect, 'none');
  assert.equal(migrated.layers[1].layerEffectIntensity, 1);
  assert.equal(migrated.layers[1].halftoneSize, 0.35);
  assert.equal(migrated.layers[1].ditheringSize, 0.35);
  assert.equal(migrated.layers[1].ditheringSteps, 4);
  assert.equal(migrated.layers[1].glassSize, 0.35);
  assert.equal(migrated.layers[1].glassDistortion, 0.5);
  assert.deepEqual(validateProject(migrated), migrated);
  assert.equal(patchLayer(raw, 'carousel', { layerEffect: 'halftone' }).layers[1].shader, 'elastic');
});

test('whole-carousel effects combine with every existing card shader without changing other layers', () => {
  for (const shader of SHADERS) for (const effect of CAROUSEL_EFFECTS.filter(effect => effect.id !== 'none')) {
    const original = patchLayer(demoProject(), 'carousel', { shader: shader.id, intensity: 0.7 });
    const next = patchLayer(original, 'carousel', { layerEffect: effect.id, layerEffectIntensity: 0.8, halftoneSize: 0.45, ditheringSize: 0.5, ditheringSteps: 3, glassSize: 0.6, glassDistortion: 0.7 });
    assert.equal(next.layers[1].shader, shader.id);
    assert.equal(next.layers[1].intensity, 0.7);
    assert.deepEqual(next.images, original.images);
    assert.deepEqual(next.layers.filter(layer => layer.type !== 'carousel'), original.layers.filter(layer => layer.type !== 'carousel'));
    const off = patchLayer(next, 'carousel', { layerEffect: 'none' });
    assert.equal(off.layers[1].shader, shader.id);
    assert.equal(off.layers[1].halftoneSize, 0.45);
    assert.equal(off.layers[1].ditheringSize, 0.5);
    assert.equal(off.layers[1].ditheringSteps, 3);
    assert.equal(off.layers[1].glassSize, 0.6);
    assert.equal(off.layers[1].glassDistortion, 0.7);
    assert.deepEqual(validateProject(JSON.parse(JSON.stringify(next))), next);
  }
});

test('layer effects reject remote code, invalid parameters and edits to locked layers', () => {
  for (const layerEffect of ['https://shaders.com/custom', 'eval', false]) assert.throws(() => patchLayer(demoProject(), 'carousel', { layerEffect }), /Unknown carousel layer effect/);
  for (const field of ['layerEffectIntensity', 'halftoneSize', 'ditheringSize', 'glassSize', 'glassDistortion']) {
    for (const value of [-0.1, 1.1, NaN, Infinity, '0.5']) assert.throws(() => patchLayer(demoProject(), 'carousel', { [field]: value }), /must be between/);
  }
  for (const value of [0, 8, 2.5, NaN, Infinity, '4']) assert.throws(() => patchLayer(demoProject(), 'carousel', { ditheringSteps: value }), /Dithering color steps/);
  assert.throws(() => patchLayer(demoProject(), 'headline', { layerEffect: 'halftone' }), /Unknown layer property/);
  const locked = patchLayer(demoProject(), 'carousel', { locked: true });
  assert.throws(() => patchLayer(locked, 'carousel', { layerEffect: 'halftone' }), /Unlock/);
});

test('agents discover and edit the layer effect through existing validated tools', async () => {
  let project = demoProject(), saves = 0;
  const tools = createTools({ get: () => project, set: next => { project = next; }, save: async () => saves++, audit: () => {} });
  const call = (name, args) => tools.find(tool => tool.name === name).execute(args);
  const listed = JSON.parse(await call('floc_list_effects'));
  assert.deepEqual(listed.shaders, SHADERS);
  assert.deepEqual(listed.carouselEffects, CAROUSEL_EFFECTS);
  await call('floc_set_shader', { shader: 'wave', intensity: 0.6 });
  for (const effect of CAROUSEL_EFFECTS.filter(effect => effect.id !== 'none')) {
    await call('floc_update_layer', { id: 'carousel', patch: { layerEffect: effect.id, layerEffectIntensity: 0.7, halftoneSize: 0.4, ditheringSize: 0.5, ditheringSteps: 3, glassSize: 0.6, glassDistortion: 0.7 } });
    assert.equal(project.layers[1].shader, 'wave');
    assert.equal(project.layers[1].layerEffect, effect.id);
  }
  assert.equal(saves, CAROUSEL_EFFECTS.length);
  await assert.rejects(call('floc_update_layer', { id: 'carousel', patch: { layerEffect: 'unknown' } }));
  assert.equal(saves, CAROUSEL_EFFECTS.length);
});
