import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { CAROUSEL_EFFECTS, SHADERS, demoProject, patchLayer, validateProject } from '../src/project.js';
import { createTools } from '../src/webmcp.js';
import { OPTICAL_WARP_SOURCE, activeWarps, createCarouselEffect } from '../src/carousel-effects.js';
import { captureState, evaluateChoreography } from '../src/choreography.js';
import { opticalWarpOffset } from '../src/effects.js';

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

// Records every draw of a renderer without a GPU. Render targets and shader
// programs are only allocated when drawn, so the pass chain runs as is.
function recordingRenderer({ float = true } = {}) {
  const gl = { RENDERBUFFER: 1, RGBA16F: 2, SRGB8_ALPHA8: 3, SAMPLES: 4, DEPTH_COMPONENT24: 5, getInternalformatParameter: () => [4] };
  let current = null;
  const draws = [];
  return {
    draws,
    getContext: () => gl,
    extensions: { has: () => float },
    getRenderTarget: () => current,
    setRenderTarget(target) { current = target; },
    render(scene) { draws.push({ target: current, material: scene.children[0]?.material ?? null }); }
  };
}
const carouselLayer = patch => validateProject(patchLayer(demoProject(), 'carousel', patch)).layers.find(layer => layer.type === 'carousel');
const sceneDraw = { children: [] };

test('the optical warp shader implements opticalWarpOffset exactly', () => {
  // Mechanical GLSL → JS translation of the shipped function, so the shader
  // formula cannot drift from the one the SVG maps and tests use.
  const source = OPTICAL_WARP_SOURCE
    .replace(/^float (\w+)\(([^)]*)\)/, (_, name, args) => `function ${name}(${args.replace(/\bfloat /g, '')})`)
    .replace(/\bfloat /g, 'const ')
    .replace(/\b(min|abs)\(/g, 'Math.$1(');
  const warpSource = vm.runInNewContext(`(${source})`, { Math });
  for (const axis of ['horizontal', 'vertical']) for (const center of [0.1, 0.35, 0.5, 0.9]) for (const amount of [0.01, 0.37, 0.5, 1]) {
    const effect = { type: 'optical-warp', enabled: true, amount, axis, center };
    for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
      const [x, y] = [i / 20, j / 20];
      const [dx, dy] = opticalWarpOffset(effect, x, y);
      const expected = axis === 'horizontal' ? y + dy : x + dx;
      const actual = axis === 'horizontal' ? warpSource(x, y, amount, center) : warpSource(y, x, amount, center);
      assert.ok(Math.abs(actual - expected) < 1e-12, `${axis} ${center} ${amount} (${x}, ${y}): ${actual} ≠ ${expected}`);
      assert.equal(axis === 'horizontal' ? dx : dy, 0);
    }
  }
});

test('carousels without an active warp or Paper effect keep the direct render', () => {
  const renderer = recordingRenderer();
  for (const effects of [[], [{ type: 'optical-warp', amount: 0 }], [{ type: 'optical-warp', enabled: false }], [{ type: 'monochrome' }]]) {
    assert.equal(createCarouselEffect(renderer, 64, 64, carouselLayer({ effects })), null);
  }
  assert.deepEqual(activeWarps(carouselLayer({ effects: [{ type: 'optical-warp' }, { type: 'optical-warp', amount: 0 }, { type: 'optical-warp', amount: 0.2, enabled: false }, { type: 'optical-warp', amount: 0.3 }] })), [0, 3]);
});

test('warps render in one pass after the Paper effect, in effect order, and bypass zero amounts', () => {
  const renderer = recordingRenderer();
  const layer = carouselLayer({ effects: [{ type: 'optical-warp', amount: 0.25, center: 0.3 }, { type: 'blur' }, { type: 'optical-warp', amount: 0.75, axis: 'vertical' }] });
  const chain = createCarouselEffect(renderer, 64, 32, layer);
  chain.render(sceneDraw, null, layer);
  assert.equal(renderer.draws.length, 2);
  assert.notEqual(renderer.draws[0].target, null);
  assert.equal(renderer.draws[1].target, null);
  const { uniforms } = renderer.draws[1].material;
  assert.equal(uniforms.u_image.value, renderer.draws[0].target.texture);
  // The last warp maps an output point first.
  assert.equal(uniforms.u_warpCount.value, 2);
  assert.deepEqual(uniforms.u_warps.value.slice(0, 2).map(warp => warp.toArray()), [[0.75, 0.5, 1], [0.25, 0.3, 0]]);
  renderer.draws.length = 0;
  chain.render(sceneDraw, null, { ...layer, effects: layer.effects.map(effect => ({ ...effect, amount: effect.type === 'optical-warp' ? 0 : effect.amount })) });
  assert.deepEqual(renderer.draws, [{ target: null, material: null }]);
  chain.dispose();

  const paper = carouselLayer({ layerEffect: 'halftone', layerEffectIntensity: 0.8, effects: [{ type: 'optical-warp' }] });
  const both = createCarouselEffect(renderer, 64, 32, paper);
  renderer.draws.length = 0;
  both.render(sceneDraw, null, paper);
  assert.equal(renderer.draws.length, 3);
  assert.match(renderer.draws[1].material.fragmentShader, /u_intensity/);
  assert.equal(renderer.draws[1].material.uniforms.u_image.value, renderer.draws[0].target.texture);
  assert.equal(renderer.draws[2].material.uniforms.u_image.value, renderer.draws[1].target.texture);
  assert.equal(renderer.draws[2].target, null);
  renderer.draws.length = 0;
  both.render(sceneDraw, null, { ...paper, effects: [{ ...paper.effects[0], amount: 0 }] });
  assert.equal(renderer.draws.length, 2);
  assert.equal(renderer.draws[1].target, null);
  // Paper edits reuse the chain; adding or removing a warp asks for a new one.
  assert.equal(both.update({ ...paper, halftoneSize: 0.6 }), true);
  assert.equal(both.update({ ...paper, effects: [] }), false);
  both.dispose();
});

test('animated warp amounts follow the choreography exactly without rebuilding the chain', () => {
  let project = patchLayer(demoProject(), 'carousel', { effects: [{ type: 'optical-warp', amount: 0 }] });
  project = patchLayer(project, 'carousel', { choreography: captureState(project.layers.find(layer => layer.id === 'carousel'), 0, project.fps, { warpAmount: 0 }, 'from') });
  project = patchLayer(project, 'carousel', { choreography: captureState(project.layers.find(layer => layer.id === 'carousel'), 2, project.fps, { warpAmount: 1 }, 'to') });
  const layer = project.layers.find(entry => entry.id === 'carousel');
  const renderer = recordingRenderer({ float: false });
  const chain = createCarouselEffect(renderer, 64, 64, layer);
  assert.ok(chain);
  for (const time of [0, 0.37, 1.234, 2]) {
    renderer.draws.length = 0;
    const sampled = evaluateChoreography(layer, time);
    assert.equal(chain.update(sampled), true);
    chain.render(sceneDraw, null, sampled);
    const amount = sampled.effects[0].amount;
    if (!amount) { assert.equal(renderer.draws.length, 1); continue; }
    assert.equal(renderer.draws[1].material.uniforms.u_warps.value[0].x, amount);
  }
  assert.notEqual(Math.round(evaluateChoreography(layer, 1.234).effects[0].amount * 100) / 100, evaluateChoreography(layer, 1.234).effects[0].amount);
  chain.dispose();
});
