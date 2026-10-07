import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_NOISE, EFFECTS, effectLayer, noisePixels, newEffect, opticalWarpOffset } from '../src/effects.js';
import { demoProject, validateProject, patchLayer, duplicateLayer, reorderLayer, layerAlpha, linkFormats, switchFormat } from '../src/project.js';
import { fileLayer } from '../src/project.js';
import { createTools } from '../src/webmcp.js';

test('noise works on all visual types and round trips alongside existing shaders', () => {
  const source = demoProject();
  source.layers.push(fileLayer({ name: 'Image', src: '/demo/poster-1.svg' }, 12, 'image'), fileLayer({ name: 'Model', src: '/assets/00000000-0000-0000-0000-000000000000.glb' }, 12, 'model'), effectLayer('noise', 12));
  let project = validateProject(source);
  const original = structuredClone(project);
  for (const layer of project.layers.filter(layer => layer.type !== 'music')) project = patchLayer(project, layer.id, { effects: [{ type: 'noise' }, { ...DEFAULT_NOISE, mode: 'multi' }] });
  assert.deepEqual(source.layers[0].effects, undefined);
  assert.equal(project.layers[1].shader, original.layers[1].shader);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
  const copy = duplicateLayer(project, 'noise', 'noise-copy');
  assert.deepEqual(copy.layers.find(layer => layer.id === 'noise-copy').effects, project.layers.at(-1).effects);
  assert.equal(reorderLayer(copy, 'noise-copy', 'headline', 'below').layers.findIndex(layer => layer.id === 'noise-copy') + 1, reorderLayer(copy, 'noise-copy', 'headline', 'below').layers.findIndex(layer => layer.id === 'headline'));
  assert.deepEqual(switchFormat(linkFormats(project), 'portrait').layers.at(-1).effects, project.layers.at(-1).effects);
});

test('effect layers follow their timing, opacity and fades', () => {
  const layer = { ...effectLayer('noise', 12), start: 2, end: 6, opacity: 0.5, fadeIn: 1, fadeOut: 1 };
  for (const [time, alpha] of [[0, 0], [2, 0], [2.5, 0.25], [4, 0.5], [5.5, 0.25], [6, 0]]) assert.equal(layerAlpha(layer, time), alpha);
});

test('noise rejects unsafe settings, unsupported targets and edits to locked layers', () => {
  for (const patch of [{ type: 'shader' }, { mode: 'unknown' }, { opacity: 1.1 }, { density: -1 }, { sizeX: Infinity }, { sizeY: 2 }, { enabled: 'true' }, { animated: 1 }, { seed: 0.5 }, { color1: 'url(https://example.com)' }, { code: 'eval' }]) assert.throws(() => patchLayer(demoProject(), 'headline', { effects: [{ ...DEFAULT_NOISE, ...patch }] }), /Invalid noise/);
  assert.throws(() => patchLayer(demoProject(), 'music', { effects: [{ ...DEFAULT_NOISE }] }), /Unknown layer property/);
  assert.throws(() => patchLayer(demoProject(), 'headline', { effects: Array.from({ length: 9 }, () => ({ ...DEFAULT_NOISE })) }), /Invalid noise/);
  assert.throws(() => patchLayer(patchLayer(demoProject(), 'headline', { locked: true }), 'headline', { effects: [{ ...DEFAULT_NOISE }] }), /Unlock/);
  assert.throws(() => validateProject({ ...demoProject(), layers: [{ ...effectLayer('noise', 12), effects: [] }] }), /at least one/);
});

test('noise pixels are deterministic, static by default and reversible when animated', () => {
  const effect = { ...DEFAULT_NOISE, mode: 'multi' };
  const first = noisePixels(effect, 0);
  assert.deepEqual(noisePixels(effect, 8), first);
  const animated = { ...effect, animated: true };
  const frame = noisePixels(animated, 1);
  assert.notDeepEqual(noisePixels(animated, 2), frame);
  assert.deepEqual(noisePixels(animated, 1), frame);
  for (const patch of [{ density: 0 }, { opacity: 0 }, { enabled: false }]) {
    const pixels = noisePixels({ ...effect, ...patch }, 0);
    assert.equal(pixels.filter((_, index) => index % 4 === 3).some(alpha => alpha > 0), false);
  }
  const sparse = noisePixels({ ...effect, density: 0.25 }, 0);
  const covered = sparse.filter((_, index) => index % 4 === 3).filter(alpha => alpha > 0).length;
  assert.ok(covered > 3500 && covered < 4600);
  const mono = noisePixels({ ...DEFAULT_NOISE, color1: '#112233', opacity: 1 }, 0);
  assert.deepEqual([...mono.slice(0, 3)], [17, 34, 51]);
});

test('agents discover noise and edit it through the validated layer path', async () => {
  let project = demoProject();
  const tools = createTools({ get: () => project, set: value => { project = value; }, save: async () => {}, audit: () => {} });
  assert.deepEqual(JSON.parse(await tools.find(tool => tool.name === 'floc_list_effects').execute()).effects, EFFECTS);
  await tools.find(tool => tool.name === 'floc_update_layer').execute({ id: 'headline', patch: { effects: [{ type: 'noise' }] } });
  assert.deepEqual(project.layers.find(layer => layer.id === 'headline').effects, [{ ...DEFAULT_NOISE }]);
});

test('shared effects validate, stack and survive duplication and linked formats', () => {
  const project = patchLayer(demoProject(), 'headline', { effects: [{ type: 'blur', mode: 'progressive', direction: 'left', amount: 24 }, { type: 'monochrome', amount: .6 }, { type: 'noise' }] });
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
  assert.equal(project.layers.find(layer => layer.id === 'headline').effects[0].enabled, true);
  const duplicated = duplicateLayer(project, 'headline', 'copy');
  assert.deepEqual(duplicated.layers.find(layer => layer.id === 'copy').effects, project.layers.find(layer => layer.id === 'headline').effects);
  assert.deepEqual(switchFormat(linkFormats(project), 'portrait').layers.find(layer => layer.id === 'headline').effects, project.layers.find(layer => layer.id === 'headline').effects);
  for (const patch of [{ type: 'blur', amount: 49 }, { type: 'blur', amount: NaN }, { type: 'blur', enabled: null }, { type: 'blur', mode: 'unknown' }, { type: 'blur', direction: 'url(remote)' }, { type: 'monochrome', amount: 2 }, { type: 'monochrome', mode: 'progressive' }, { type: 'blur', code: 'eval' }]) assert.throws(() => patchLayer(project, 'headline', { effects: [patch] }), /Invalid/);
});

test('new adjustments target below and legacy Noise remains an overlay', () => {
  const old = effectLayer('old', 12);
  delete old.effectScope;
  const source = { ...demoProject(), layers: [...demoProject().layers, old, effectLayer('new', 12)] };
  const project = validateProject(source);
  assert.equal(project.layers.at(-2).effectScope, 'overlay');
  assert.equal(project.layers.at(-1).effectScope, 'below');
  assert.equal(source.layers.at(-2).effectScope, undefined);
  assert.throws(() => patchLayer(project, 'old', { effects: [{ type: 'blur' }] }), /only accept Noise/);
  const converted = patchLayer(project, 'old', { effectScope: 'below', effects: [{ type: 'blur', mode: 'progressive', direction: 'top' }] });
  assert.equal(converted.layers.at(-2).effects[0].mode, 'progressive');
  assert.throws(() => patchLayer(project, 'new', { effectScope: 'all' }), /Unknown effect scope/);
});

test('optical warp keeps the center native and progressively stretches both sides', () => {
  const effect = newEffect('optical-warp');
  assert.ok(opticalWarpOffset(effect, .5, 0).every(value => value === 0));
  assert.ok(opticalWarpOffset(effect, .5, 1).every(value => value === 0));
  const top = [0, .1, .25, .4, .5].map(x => opticalWarpOffset(effect, x, 0)[1]);
  assert.ok(top.every((value, i) => i === 0 || value < top[i - 1]));
  for (const x of [0, .1, .3, .5]) {
    assert.ok(Math.abs(opticalWarpOffset(effect, x, 0)[1] - opticalWarpOffset(effect, 1 - x, 0)[1]) < 1e-12);
    assert.ok(opticalWarpOffset(effect, x, .5)[1] === 0);
  }
  assert.ok(opticalWarpOffset({ ...effect, center: .3 }, .3, .2).every(value => value === 0));
  assert.ok(opticalWarpOffset({ ...effect, amount: 0 }, 0, 0).every(value => value === 0));
  assert.deepEqual(opticalWarpOffset({ ...effect, axis: 'vertical' }, 0, .1), [opticalWarpOffset(effect, .1, 0)[1], 0]);
});

test('optical warp validates on every visual layer and remains independent of carousel settings', () => {
  const source = demoProject();
  source.layers.push(fileLayer({ name: 'Image', src: '/demo/poster-1.svg' }, 12, 'image'), fileLayer({ name: 'Model', src: '/assets/00000000-0000-0000-0000-000000000000.glb' }, 12, 'model'), effectLayer('adjustment', 12));
  let project = validateProject(source);
  for (const layer of project.layers.filter(layer => layer.type !== 'music')) project = patchLayer(project, layer.id, { effects: [{ type: 'optical-warp' }, { type: 'monochrome', amount: .5 }] });
  assert.deepEqual(project.layers[1].shader, source.layers[1].shader);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
  assert.deepEqual(duplicateLayer(project, 'headline', 'copy').layers.find(layer => layer.id === 'copy').effects, project.layers.find(layer => layer.id === 'headline').effects);
  assert.deepEqual(switchFormat(linkFormats(project), 'portrait').layers.find(layer => layer.id === 'headline').effects, project.layers.find(layer => layer.id === 'headline').effects);
  for (const patch of [{ amount: -1 }, { amount: 1.01 }, { axis: 'diagonal' }, { center: 0 }, { center: 1 }, { center: NaN }, { center: '0.5' }, { enabled: 1 }, { code: 'shader' }]) assert.throws(() => patchLayer(project, 'headline', { effects: [{ ...newEffect('optical-warp'), ...patch }] }), /Invalid/);
});
