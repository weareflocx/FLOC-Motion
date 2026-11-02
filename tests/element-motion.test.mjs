import test from 'node:test';
import assert from 'node:assert/strict';
import { elementMotionAt, normalizeElementMotion } from '../src/element-motion.js';
import { demoProject, fileLayer, patchLayer, validateProject, linkFormats, switchFormat } from '../src/project.js';
import { dataFlowLayer } from '../src/data-flow-style.js';
import { MODEL_SHAPES } from '../src/model-shapes.js';
import { createTools } from '../src/webmcp.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const settings = () => normalizeElementMotion({ float: { enabled: true, amplitude: 3, duration: 4 }, spin: { enabled: true, duration: 4 }, pulse: { enabled: true, amplitude: .2, duration: 4 } });
const subject = elementMotion => ({ type: 'text', start: 2, elementMotion });

test('whole-element float, spin and pulse combine without changing the authored pose', () => {
  const layer = { ...subject(settings()), x: 23, y: 37, size: 40, roll: 15 }, before = structuredClone(layer);
  const value = elementMotionAt(layer, 3);
  close(value.offsetY, 3); close(value.offsetX, 0); close(value.rotation, 90); close(value.scale, 1.2);
  assert.deepEqual(layer, before);
  const sideways = subject(normalizeElementMotion({ float: { enabled: true, axis: 'x', amplitude: 7, duration: 4 } }));
  close(elementMotionAt(sideways, 3).offsetX, 7); close(elementMotionAt(sideways, 3).offsetY, 0);
  const disabled = subject(normalizeElementMotion({ float: { amplitude: 7 }, spin: { phase: .25 }, pulse: { amplitude: .4 } }));
  assert.deepEqual(elementMotionAt(disabled, 3), { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, active: false });
});

test('local time, phase, reverse, pause and repeated seeks reconstruct the same movement', () => {
  const layer = subject(settings()), initial = elementMotionAt(layer, 2), at = elementMotionAt(layer, 3);
  assert.deepEqual(elementMotionAt(layer, 6), initial, 'the common four-second cycle closes exactly');
  elementMotionAt(layer, 100); assert.deepEqual(elementMotionAt(layer, 3), at);
  assert.deepEqual(elementMotionAt({ ...layer, start: 0 }, 1), at);
  assert.deepEqual(elementMotionAt(layer, 0), initial);
  const reverse = subject(normalizeElementMotion(Object.fromEntries(Object.entries(settings()).map(([key, value]) => [key, { ...value, direction: -1 }]))));
  assert.deepEqual(elementMotionAt(reverse, 3), elementMotionAt(layer, 5));
  const paused = subject(normalizeElementMotion(Object.fromEntries(Object.entries(settings()).map(([key, value]) => [key, { ...value, direction: 0, phase: .25 }]))));
  assert.deepEqual(elementMotionAt(paused, 300), at, 'paused holds the configured initial phase');
  const neutralized = subject(normalizeElementMotion({ ...settings(), spin: { enabled: false }, float: { enabled: false }, pulse: { enabled: false } }));
  assert.equal(elementMotionAt(neutralized, 3).active, false);
});

test('saved and linked projects retain independent element motion and internal animation settings', () => {
  const original = validateProject(demoProject());
  const model = fileLayer({ src: MODEL_SHAPES[0].src, name: 'Sculpture' }, 12, 'model');
  const media = fileLayer({ src: '/demo/poster-1.svg', name: 'Media' }, 12, 'media');
  let project = validateProject({ ...original, layers: [...original.layers, model, media, dataFlowLayer(12, 'dataflow')] });
  const ids = project.layers.filter(layer => ['text', 'logo', 'media', 'model', 'carousel', 'dataflow'].includes(layer.type)).map(layer => layer.id);
  for (const id of ids) project = patchLayer(project, id, { elementMotion: settings() });
  for (const id of ids) {
    const before = project.layers.find(layer => layer.id === id);
    project = patchLayer(project, id, { elementMotion: { float: { enabled: false } } });
    const after = project.layers.find(layer => layer.id === id);
    assert.equal(after.elementMotion.float.amplitude, 3);
    assert.deepEqual(after.elementMotion.spin, before.elementMotion.spin);
    assert.deepEqual(after.elementMotion.pulse, before.elementMotion.pulse);
    const { elementMotion: ignored, ...base } = after;
    const { elementMotion: previousMotion, ...previousBase } = before;
    assert.deepEqual(base, previousBase);
  }
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
  const linked = linkFormats(project), portrait = switchFormat(linked, 'portrait');
  for (const id of ids) assert.deepEqual(portrait.layers.find(layer => layer.id === id).elementMotion, project.layers.find(layer => layer.id === id).elementMotion);
  const old = { ...original, version: 15 }, migrated = validateProject(old);
  for (const source of old.layers) assert.deepEqual(migrated.layers.find(layer => layer.id === source.id), source, 'old projects keep their complete layer data');
});

test('project imports and patches reject unsupported, executable and out-of-bounds movement', () => {
  const project = validateProject(demoProject());
  const invalid = [null, [], { path: 'code' }, { spin: { script: 'code' } }, { spin: { duration: 0 } }, { spin: { phase: 1.01 } }, { float: { amplitude: 25.01 } }, { float: { axis: 'z' } }, { pulse: { amplitude: .51 } }, { float: { duration: Infinity } }, { pulse: { enabled: 1 } }, { spin: { direction: 2 } }];
  for (const elementMotion of invalid) {
    assert.throws(() => patchLayer(project, 'headline', { elementMotion }));
    const imported = structuredClone(project); imported.layers.find(layer => layer.id === 'headline').elementMotion = elementMotion;
    assert.throws(() => validateProject(imported));
  }
  for (const id of ['background', 'music']) assert.throws(() => patchLayer(project, id, { elementMotion: settings() }), /Unknown layer property/);
  const imported = structuredClone(project); imported.layers[0].elementMotion = settings();
  assert.throws(() => validateProject(imported), /Only positioned visual/);
  const locked = structuredClone(project); locked.layers.find(layer => layer.id === 'headline').locked = true;
  assert.throws(() => patchLayer(locked, 'headline', { elementMotion: settings() }), /Unlock/);
  let accessed = false;
  const dangerous = { spin: Object.defineProperty({}, 'enabled', { enumerable: true, get() { accessed = true; return true; } }) };
  assert.throws(() => patchLayer(project, 'headline', { elementMotion: dangerous })); assert.equal(accessed, false);
});

test('agent movement edits use the same bounded model and preserve unrelated operators', async () => {
  let project = validateProject(demoProject());
  const tools = createTools({ get: () => project, set: next => { project = next; }, save: async () => {}, audit() {} });
  const discovery = JSON.parse(await tools.find(tool => tool.name === 'floc_list_effects').execute());
  const update = tools.find(tool => tool.name === 'floc_update_layer');
  await update.execute({ id: 'headline', patch: { elementMotion: { float: { enabled: true, duration: 3 }, pulse: { enabled: true, amplitude: .12 } } } });
  await update.execute({ id: 'headline', patch: { elementMotion: { spin: { enabled: true, duration: 10 } } } });
  const layer = project.layers.find(layer => layer.id === 'headline');
  close(elementMotionAt(layer, .75).offsetY, 2);
  assert.equal(layer.elementMotion.pulse.amplitude, .12); assert.equal(layer.elementMotion.spin.duration, 10);
  assert.equal(discovery.elementMotion.schema.properties.float.properties.amplitude.maximum, 25);
  const saved = structuredClone(project);
  await assert.rejects(update.execute({ id: 'headline', patch: { elementMotion: { pulse: { duration: -.1 } } } }));
  assert.deepEqual(project, saved);
});
