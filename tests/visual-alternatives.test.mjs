import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, linkFormats, patchLayer, switchFormat, validateProject } from '../src/project.js';
import { buildVisualAlternatives, createStyleAlternatives, visualAlternativePreview } from '../src/visual-alternatives.js';
import { createTools } from '../src/webmcp.js';

const request = (base, alternatives) => ({ base, alternatives });
const option = (name, id = 'headline', patch = { color: '#ff0000' }) => ({ name, patches: [{ id, patch }] });

test('builds two or three private validated alternatives against the exact current base', () => {
  const current = demoProject(), before = structuredClone(current);
  const result = buildVisualAlternatives(current, request(structuredClone(current), [option('Editorial'), option('Bold', 'headline', { color: '#00ff00' })]));
  assert.equal(result.base, current);
  assert.deepEqual(current, before);
  assert.equal(result.alternatives.length, 2);
  assert.equal(result.alternatives[0].project.layers.find(layer => layer.id === 'headline').color, '#ff0000');
  assert.equal(result.alternatives[1].project.layers.find(layer => layer.id === 'headline').color, '#00ff00');
  assert.notEqual(result.alternatives[0].project, current);
});

test('rejects stale bases, malformed batches, no-ops and duplicate designs atomically', () => {
  const current = demoProject(), stale = patchLayer(current, 'headline', { color: '#ff0000' });
  assert.throws(() => buildVisualAlternatives(current, request(stale, [option('A'), option('B', 'headline', { color: '#00ff00' })])), /stale/);
  assert.throws(() => buildVisualAlternatives(current, request(current, [option('A')])), /two or three/);
  assert.throws(() => buildVisualAlternatives(current, request(current, [option('A', 'headline', { color: '#ffffff' }), option('B')])), /does not change/);
  assert.throws(() => buildVisualAlternatives(current, request(current, [option('A'), option('B')])), /distinct/);
  const duplicateLayer = { name: 'A', patches: [{ id: 'headline', patch: { color: '#ff0000' } }, { id: 'headline', patch: { size: 60 } }] };
  assert.throws(() => buildVisualAlternatives(current, request(current, [duplicateLayer, option('B', 'headline', { color: '#00ff00' })])), /once/);
  assert.deepEqual(current, demoProject());
});

test('accepts only bounded visual fields on existing unlocked non-music layers', () => {
  const current = demoProject(), valid = name => buildVisualAlternatives(current, request(current, [option(name), option(`${name} 2`, 'headline', { color: '#00ff00' })]));
  assert.equal(valid('Safe').alternatives.length, 2);
  for (const [id, patch] of [
    ['headline', { text: 'Changed content' }], ['headline', { start: 2 }], ['headline', { src: '/demo/poster-1.svg' }],
    ['carousel', { images: [] }], ['carousel', { template: 'sphere' }], ['headline', { choreography: [] }], ['music', { volume: 0.2 }], ['missing', { opacity: 0.5 }]
  ]) assert.throws(() => buildVisualAlternatives(current, request(current, [option('Bad', id, patch), option('Good', 'headline', { color: '#00ff00' })])));
  const locked = patchLayer(current, 'headline', { locked: true });
  assert.throws(() => buildVisualAlternatives(locked, request(locked, [option('Bad'), option('Good', 'signature', { color: '#00ff00' })])), /Unlock/);
  const hidden = patchLayer(current, 'headline', { visible: false });
  assert.throws(() => buildVisualAlternatives(hidden, request(hidden, [option('Bad'), option('Good', 'signature', { color: '#00ff00' })])), /Show the layer/);
  assert.throws(() => buildVisualAlternatives(current, request(current, [option('Bad', 'logo', { color: '#ff0000' }), option('Good', 'headline', { color: '#00ff00' })])), /Only visual logo/);
  assert.throws(() => buildVisualAlternatives(current, request(current, [option('Bad', 'headline', { size: 999 }), option('Good', 'headline', { color: '#00ff00' })])), /Font size/);
});

test('carousel appearance proposals preserve its authored motion and variant', () => {
  const current = patchLayer(demoProject(), 'carousel', {
    motionVariant: 'bloom',
    motion: { mode: 'steps', action: 0.7, pause: 1.2, curve: 'bounce', intensity: 0.65 }
  });
  const before = current.layers.find(layer => layer.id === 'carousel');
  const result = buildVisualAlternatives(current, request(current, [
    option('Monochrome', 'carousel', { shader: 'mono', intensity: 0.25 }),
    option('Glass', 'carousel', { layerEffect: 'fluted-glass', layerEffectIntensity: 0.6 })
  ]));
  for (const { project } of result.alternatives) {
    const carousel = project.layers.find(layer => layer.id === 'carousel');
    assert.deepEqual(carousel.motion, before.motion);
    assert.equal(carousel.motionVariant, 'bloom');
  }
});

test('keeps choreography and content assets while linked local fields remain format-specific', () => {
  let current = linkFormats(demoProject());
  current = patchLayer(current, 'headline', { choreography: [{ id: 'beat', time: 1, easing: 'linear', values: { x: 15, y: 8, size: 52, opacity: 0.8 } }] });
  current = patchLayer(switchFormat(current, 'portrait'), 'headline', { x: 19, color: '#ffffff' });
  const before = structuredClone(current), proposal = buildVisualAlternatives(current, request(current, [
    option('Local type', 'headline', { x: 21, lineHeight: 1.3 }),
    option('Shared color', 'headline', { color: '#00ff00' })
  ]));
  const local = proposal.alternatives[0].project;
  assert.deepEqual(local.images, before.images);
  assert.deepEqual(local.layers.find(layer => layer.id === 'headline').choreography, before.layers.find(layer => layer.id === 'headline').choreography);
  assert.equal(local.layers.find(layer => layer.id === 'headline').x, 21);
  assert.notEqual(switchFormat(local, 'square').layers.find(layer => layer.id === 'headline').x, 21);
  const shared = switchFormat(proposal.alternatives[1].project, 'square');
  assert.equal(shared.layers.find(layer => layer.id === 'headline').color, '#00ff00');
  assert.deepEqual(current, before);
});

test('curated alternatives are useful, distinct, local and leave the source untouched', () => {
  const current = demoProject(), before = structuredClone(current);
  const validated = validateProject(current);
  const result = createStyleAlternatives(current);
  assert.deepEqual(result.alternatives.map(item => item.name), ['Editorial', 'Bold', 'Experimental']);
  assert.equal(new Set(result.alternatives.map(item => JSON.stringify(item.project))).size, 3);
  for (const { project } of result.alternatives) {
    assert.deepEqual(project.images, current.images);
    assert.deepEqual(project.layers.map(layer => [layer.id, layer.start, layer.end]), current.layers.map(layer => [layer.id, layer.start, layer.end]));
    assert.deepEqual(project.layers.find(layer => layer.id === 'carousel').choreography, validated.layers.find(layer => layer.id === 'carousel').choreography);
    assert.deepEqual(project.layers.filter(layer => Object.hasOwn(layer, 'opacity')).map(layer => layer.opacity), validated.layers.filter(layer => Object.hasOwn(layer, 'opacity')).map(layer => layer.opacity));
  }
  assert.deepEqual(current, before);
});

test('preview mutes music and guides only in its clone', () => {
  const current = demoProject(), before = structuredClone(current);
  current.layout = { enabled: true, guides: true, marginX: 6, marginY: 6 };
  const preview = visualAlternativePreview(current);
  assert.equal(preview.layout.guides, false);
  assert.equal(preview.layers.find(layer => layer.type === 'music').visible, false);
  assert.equal(current.layout.guides, true);
  assert.equal(current.layers.find(layer => layer.type === 'music').visible, true);
  assert.deepEqual({ ...current, layout: before.layout }, before);
});

test('agent proposals open selection without mutating, saving or requesting export', async () => {
  const current = demoProject(), before = structuredClone(current);
  let sets = 0, saves = 0, exports = 0, received;
  const tools = createTools({
    get: () => current, set: () => sets++, save: async () => saves++, audit() {}, requestExport: () => exports++,
    proposeAlternatives: async proposal => { received = proposal; }, exportStatus: () => ({ state: 'idle' })
  });
  const tool = tools.find(item => item.name === 'floc_propose_alternatives');
  const result = JSON.parse(await tool.execute(request(structuredClone(current), [option('Editorial'), option('Bold', 'headline', { color: '#00ff00' })])));
  assert.deepEqual(result, { state: 'awaiting_selection', names: ['Editorial', 'Bold'] });
  assert.equal(received.base, current);
  assert.deepEqual(current, before);
  assert.deepEqual([sets, saves, exports], [0, 0, 0]);
  const unavailable = createTools({ get: () => current, audit() {} }).find(item => item.name === 'floc_propose_alternatives');
  await assert.rejects(unavailable.execute(request(current, [option('A'), option('B', 'headline', { color: '#00ff00' })])), /not connected/);
});
