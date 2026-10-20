import test from 'node:test';
import assert from 'node:assert/strict';
import { createTools } from '../src/webmcp.js';
import { demoProject, fileLayer, patchLayer, validateProject } from '../src/project.js';
import { MAX_PROJECT_IMPORT_BYTES, parseProjectFile } from '../src/editor/project-import.js';
import { DEFAULT_MODEL_STYLE } from '../src/model-style.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('overlapping agent mutations serialize against the latest project', async () => {
  let project = demoProject(); const firstSave = deferred(); let saves = 0; const audits = [];
  const tools = createTools({ get: () => project, set: next => project = next, save: () => ++saves === 1 ? firstSave.promise : Promise.resolve(), audit: name => audits.push(name) });
  const carousel = tools.find(tool => tool.name === 'floc_set_carousel').execute({ speed: 30 });
  const output = tools.find(tool => tool.name === 'floc_set_output').execute({ duration: 15, fps: 30 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(saves, 1); firstSave.resolve(); await Promise.all([carousel, output]);
  assert.equal(project.layers.find(layer => layer.type === 'carousel').speed, 30);
  assert.equal(project.duration, 15); assert.equal(project.fps, 30); assert.equal(saves, 2);
  assert.deepEqual(audits, ['floc_set_carousel', 'floc_set_output']);
});

test('failed agent saves retain local state, reject the tool, and do not create an audit entry', async () => {
  let project = demoProject(), fail = true; const audits = [];
  const tools = createTools({ get: () => project, set: next => project = next, save: async () => { if (fail) throw Object.assign(new Error('Sign in again'), { status: 401 }); }, audit: name => audits.push(name) });
  const carousel = tools.find(tool => tool.name === 'floc_set_carousel');
  await assert.rejects(carousel.execute({ speed: 30 }), /Sign in again/);
  assert.equal(project.layers.find(layer => layer.type === 'carousel').speed, 30);
  assert.deepEqual(audits, []);
  fail = false; await tools.find(tool => tool.name === 'floc_set_output').execute({ fps: 30 });
  assert.equal(project.layers.find(layer => layer.type === 'carousel').speed, 30); assert.equal(project.fps, 30);
  assert.deepEqual(audits, ['floc_set_output']);
});

test('project import rejects oversized content before reading and validates bounded JSON', async () => {
  let reads = 0;
  await assert.rejects(parseProjectFile({ size: MAX_PROJECT_IMPORT_BYTES + 1, async text() { reads++; return '{}'; } }), /2 MB/);
  assert.equal(reads, 0);
  const source = JSON.stringify(demoProject());
  assert.equal((await parseProjectFile({ size: Buffer.byteLength(source), async text() { return source; } })).name, demoProject().name);
  await assert.rejects(parseProjectFile({ size: 1, async text() { return 'x'.repeat(MAX_PROJECT_IMPORT_BYTES + 1); } }), /2 MB/);
});

test('agent discovers installed model controls and saves canonical validated edits without bypassing locks or local sources', async () => {
  let project = validateProject({ ...demoProject(), layers: [fileLayer({ name: 'Model', src: '/assets/12345678-1234-1234-1234-123456789012.glb' }, 12, 'model')] });
  const saved = [], audited = [];
  const tools = createTools({
    get: () => project,
    set: next => { project = next; },
    save: async () => { saved.push(JSON.stringify(project)); },
    audit: name => audited.push(name)
  });
  const call = (name, args) => tools.find(tool => tool.name === name).execute(args);
  const discovery = JSON.parse(await call('floc_list_effects'));
  assert.deepEqual(discovery.model.defaults, DEFAULT_MODEL_STYLE);
  assert.deepEqual(discovery.model.materialPresets.map(preset => preset.id), ['original', 'matte', 'plastic', 'ceramic', 'lacquer', 'rubber', 'chrome', 'satin', 'gold', 'rose-gold', 'copper', 'brushed-aluminium', 'brushed-gold', 'gunmetal', 'iridescent', 'holographic', 'titanium', 'oil-slick', 'pearl', 'velvet', 'clear-glass', 'frosted-glass', 'tinted-glass', 'smoked-glass', 'bubble', 'refractive-clear', 'refractive-frosted', 'refractive-prism', 'prism', 'diamond', 'frosted-crystal']);
  assert.ok(discovery.model.materialPresets.every(preset => ['basic', 'metal', 'iridescent', 'fabric', 'see-through', 'refractive', 'environment'].includes(preset.family)));
  assert.deepEqual([discovery.model.bases, discovery.model.looks, discovery.model.glass], [['imported', 'tinted', 'custom'], ['physical', 'toon', 'wireframe'], ['none', 'see-through', 'refractive', 'environment']]);
  assert.deepEqual(discovery.model.refractionSamples, [4, 8, 16]);
  assert.deepEqual(discovery.model.refractionResolutions, [256, 512, 1024, 2048]);
  assert.deepEqual(discovery.model.environments, ['none', 'studio', 'softbox', 'stage', 'sunset', 'neon']);
  assert.deepEqual(discovery.model.toneMappings, ['none', 'neutral', 'agx']);
  assert.deepEqual(discovery.model.motions, ['none', 'spin', 'rock', 'float', 'pulse']);
  assert.deepEqual(discovery.model.motionAxes, ['auto', 'x', 'y', 'z']);
  assert.deepEqual(discovery.model.motionTiming.defaults, DEFAULT_MODEL_STYLE.motionTiming);
  const modelSchema = tools.find(tool => tool.name === 'floc_update_layer').inputSchema.properties.patch.properties.modelStyle;
  assert.equal(modelSchema.additionalProperties, false);
  assert.deepEqual(modelSchema.properties.motionAxis.enum, ['auto', 'x', 'y', 'z']);
  assert.deepEqual(['type', 'minimum', 'maximum'].map(key => modelSchema.properties.motionSteps[key]), ['integer', 1, 24]);
  assert.equal(modelSchema.properties.motionTiming.additionalProperties, false);
  assert.deepEqual(modelSchema.properties.motionTiming.properties.curve.enum, discovery.model.motionTiming.curves.map(([id]) => id));
  assert.deepEqual(modelSchema.properties.refractionSamples.enum, [4, 8, 16]);
  assert.deepEqual(modelSchema.properties.refractionResolution.enum, [256, 512, 1024, 2048]);
  assert.equal(modelSchema.properties.refractionSamples.type, 'integer');
  assert.equal(modelSchema.properties.refractionResolution.type, 'integer');
  for (const preset of discovery.model.materialPresets) {
    await call('floc_update_layer', { id: 'model', patch: { modelStyle: preset.settings } });
    const snapshot = JSON.parse(saved.at(-1));
    assert.deepEqual(snapshot, validateProject(snapshot));
    assert.deepEqual(snapshot.layers[0].modelStyle, { ...DEFAULT_MODEL_STYLE, ...preset.settings });
    assert.equal(snapshot.layers[0].modelStyle.base, preset.id === 'original' ? 'imported' : 'custom');
  }
  await call('floc_update_layer', { id: 'model', patch: { modelStyle: { glass: 'refractive', refractionThickness: 2, refractionSamples: 16, refractionResolution: 2048 } } });
  const refractiveSource = saved.at(-1);
  const refractiveImport = await parseProjectFile({ size: Buffer.byteLength(refractiveSource), async text() { return refractiveSource; } });
  assert.deepEqual([refractiveImport.layers[0].modelStyle.glass, refractiveImport.layers[0].modelStyle.refractionThickness, refractiveImport.layers[0].modelStyle.refractionSamples, refractiveImport.layers[0].modelStyle.refractionResolution], ['refractive', 2, 16, 2048]);
  for (const settings of [{ refractionThickness: -1 }, { refractionThickness: 2.1 }, { refractionSamples: 12 }, { refractionSamples: '8' }, { refractionResolution: 768 }, { refractionResolution: '1024' }]) {
    const source = JSON.stringify({ ...refractiveImport, layers: [{ ...refractiveImport.layers[0], modelStyle: { ...refractiveImport.layers[0].modelStyle, ...settings } }] });
    await assert.rejects(parseProjectFile({ size: Buffer.byteLength(source), async text() { return source; } }));
  }
  await call('floc_update_layer', { id: 'model', patch: { modelStyle: { look: 'wireframe', motion: 'spin', motionSpeed: -2, motionAxis: 'x', motionSteps: 7, motionTiming: { mode: 'steps', action: .4, pause: .8, curve: 'back', intensity: .9 }, animationClip: -1 } } });
  assert.equal(project.layers[0].modelStyle.look, 'wireframe');
  assert.equal(project.layers[0].modelStyle.motionSpeed, -2);
  assert.equal(project.layers[0].modelStyle.animationClip, -1);
  assert.equal(project.layers[0].modelStyle.base, 'imported', 'omitted partial settings normalize to canonical defaults');
  assert.equal(project.layers[0].modelStyle.motionAxis, 'x');
  assert.equal(project.layers[0].modelStyle.motionSteps, 7);
  assert.deepEqual(project.layers[0].modelStyle.motionTiming, { mode: 'steps', action: .4, pause: .8, curve: 'back', intensity: .9 });
  const before = structuredClone(project), saves = saved.length, audits = audited.length;
  for (const patch of [
    { modelStyle: { environment: 'https://example.com/a.hdr' } },
    { modelStyle: { fragmentShader: 'void main() {}' } },
    { modelStyle: { roughness: -0.01 } },
    { modelStyle: { ambientIntensity: '3' } },
    { modelStyle: { animationClip: 0.5 } },
    { modelStyle: { refractionThickness: 2.1 } },
    { modelStyle: { refractionThickness: NaN } },
    { modelStyle: { refractionSamples: 12 } },
    { modelStyle: { refractionSamples: '8' } },
    { modelStyle: { refractionResolution: 768 } },
    { modelStyle: { refractionResolution: '1024' } },
    { modelStyle: null },
    { modelStyle: { motionAxis: 'xy' } }, { modelStyle: { motionSteps: 2.5 } },
    { modelStyle: { motionTiming: { action: 0 } } }, { modelStyle: { motionTiming: { curve: 'custom' } } },
    { modelStyle: { motionTiming: { extra: true } } }, { modelStyle: { motionTiming: { [Symbol('curve')]: 'spring' } } },
    { src: 'https://example.com/a.glb' }
  ]) await assert.rejects(call('floc_update_layer', { id: 'model', patch }));
  assert.deepEqual(project, before);
  assert.equal(saved.length, saves);
  assert.equal(audited.length, audits);
  project = patchLayer(project, 'model', { locked: true });
  for (const modelStyle of [{ base: 'custom' }, { motionAxis: 'z' }, { motionSteps: 12 }, { motionTiming: { mode: 'steps', action: .3 } }]) await assert.rejects(call('floc_update_layer', { id: 'model', patch: { modelStyle } }), /Unlock/);
  assert.equal(saved.length, saves);
  const source = saved.at(-1);
  const imported = await parseProjectFile({ size: Buffer.byteLength(source), async text() { return source; } });
  assert.deepEqual(imported, before);
});
