import test from 'node:test';
import assert from 'node:assert/strict';
import { createTools } from '../src/webmcp.js';
import { demoProject, fileLayer, patchLayer, validateProject } from '../src/project.js';
import { MAX_PROJECT_IMPORT_BYTES, parseProjectFile } from '../src/editor/project-import.js';
import { DEFAULT_MODEL_STYLE, MODEL_STYLE_RANGES } from '../src/model-style.js';
import { MORPHING_SPHERE_SRC, LIQUID_RIBBONS_SRC, MAGICAL_OCTAHEDRON_SRC } from '../src/model-shapes.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('octahedron tool edits enforce bounds and survive save/import and source replacement', async () => {
  let project = validateProject({ ...demoProject(), layers: [fileLayer({ name: 'Octahedron', src: MAGICAL_OCTAHEDRON_SRC }, 12, 'model')] });
  assert.equal(project.layers[0].modelStyle.motion, 'none');
  assert.equal(project.layers[0].modelStyle.base, 'imported');
  assert.equal(project.layers[0].modelStyle.glass, 'none');
  const saved = [];
  const tools = createTools({ get: () => project, set: next => { project = next; }, save: async () => saved.push(JSON.stringify(project)), audit() {} });
  const call = (name, args) => tools.find(tool => tool.name === name).execute(args);
  const update = changes => call('floc_update_layer', { id: 'model', patch: { modelStyle: { ...project.layers[0].modelStyle, ...changes } } });
  const imported = async source => parseProjectFile({ size: Buffer.byteLength(source), async text() { return source; } });
  const discovery = JSON.parse(await call('floc_list_effects'));
  assert.ok(discovery.model.shapes.some(shape => shape.src === MAGICAL_OCTAHEDRON_SRC));
  for (const [key, [min, max]] of Object.entries(MODEL_STYLE_RANGES).filter(([key]) => key.startsWith('octa'))) {
    for (const value of [min, max]) {
      await update({ [key]: value });
      assert.equal(project.layers[0].modelStyle[key], value);
      assert.deepEqual(await imported(saved.at(-1)), project);
    }
    for (const value of [min - .01, max + .01, '1', null, NaN, Infinity]) {
      const before = JSON.stringify(project), saves = saved.length;
      await assert.rejects(update({ [key]: value }));
      assert.equal(JSON.stringify(project), before);
      assert.equal(saved.length, saves);
      await assert.rejects(imported(JSON.stringify({ ...project, layers: [{ ...project.layers[0], modelStyle: { ...project.layers[0].modelStyle, [key]: value } }] })));
    }
  }
  for (const key of ['octaTint', 'octaFrontColor', 'octaBackColor']) {
    await update({ [key]: '#Ab12Ef' });
    await assert.rejects(update({ [key]: '#abc' }));
    assert.deepEqual(await imported(saved.at(-1)), project);
  }
  await assert.rejects(update({ octaSteps: 68.5 }));
  await update({ octaSpeed: 0, octaEvolution: -2, octaColorSpeed: 0, octaRotation: -.5 });
  const before = structuredClone(project.layers[0]);
  for (const src of ['/assets/12345678-1234-1234-1234-123456789012.glb', MAGICAL_OCTAHEDRON_SRC]) {
    await call('floc_update_layer', { id: 'model', patch: { src } });
    assert.deepEqual(project.layers[0].modelStyle, before.modelStyle);
    assert.equal(project.layers[0].tilt, before.tilt);
  }
});

test('liquid agent discovery and save/import consume all bounded shape and material fields', async () => {
  let project = validateProject({ ...demoProject(), layers: [fileLayer({ name: 'Liquid', src: LIQUID_RIBBONS_SRC }, 12, 'model')] });
  const saved = [];
  const tools = createTools({ get: () => project, set: next => { project = next; }, save: async () => { saved.push(JSON.stringify(project)); }, audit() {} });
  const call = (name, args) => tools.find(tool => tool.name === name).execute(args);
  const update = changes => call('floc_update_layer', { id: 'model', patch: { modelStyle: { ...project.layers[0].modelStyle, ...changes } } });
  const imported = async source => parseProjectFile({ size: Buffer.byteLength(source), async text() { return source; } });
  const discovery = JSON.parse(await call('floc_list_effects'));
  assert.ok(discovery.model.shapes.some(shape => shape.src === LIQUID_RIBBONS_SRC));
  const properties = tools.find(tool => tool.name === 'floc_update_layer').inputSchema.properties.patch.properties.modelStyle.properties;
  assert.equal(properties.liquidDetail.type, 'integer');
  assert.ok(properties.glass.enum.includes('liquid'));
  assert.ok(properties.environment.enum.includes('liquid'));
  for (const [key, [min, max]] of Object.entries(MODEL_STYLE_RANGES).filter(([key]) => key.startsWith('liquid'))) {
    assert.deepEqual([properties[key].minimum, properties[key].maximum], [min, max]);
    for (const value of [min, DEFAULT_MODEL_STYLE[key], max]) {
      await update({ [key]: value });
      assert.equal(project.layers[0].modelStyle[key], value);
      assert.deepEqual(await imported(saved.at(-1)), project);
    }
    for (const value of [min - .01, max + .01, '1', null, NaN, Infinity]) {
      await assert.rejects(update({ [key]: value }));
      const source = JSON.stringify({ ...project, layers: [{ ...project.layers[0], modelStyle: { ...project.layers[0].modelStyle, [key]: value } }] });
      await assert.rejects(imported(source));
    }
  }
  await update({ liquidTint: '#Ab12Ef', liquidOpen: 1, liquidClosed: .1 });
  assert.equal(project.layers[0].modelStyle.liquidTint, '#Ab12Ef');
  assert.deepEqual(await imported(saved.at(-1)), project);
  for (const changes of [{ liquidDetail: 56.5 }, { liquidTint: '#fff' }, { glass: 'liquid', look: 'toon' }]) await assert.rejects(update(changes));
  const style = structuredClone(project.layers[0].modelStyle);
  for (const src of ['/assets/12345678-1234-1234-1234-123456789012.glb', LIQUID_RIBBONS_SRC]) {
    await call('floc_update_layer', { id: 'model', patch: { src } });
    assert.deepEqual(project.layers[0].modelStyle, style);
  }
});

test('morph sphere agent discovery, saves and imports enforce shape bounds and preserve source replacements', async () => {
  let project = validateProject({ ...demoProject(), layers: [fileLayer({ name: 'Model', src: MORPHING_SPHERE_SRC }, 12, 'model')] });
  const saved = [];
  const tools = createTools({ get: () => project, set: next => { project = next; }, save: async () => { saved.push(JSON.stringify(project)); }, audit() {} });
  const call = (name, args) => tools.find(tool => tool.name === name).execute(args);
  const update = modelStyle => call('floc_update_layer', { id: 'model', patch: { modelStyle } });
  const imported = async source => parseProjectFile({ size: Buffer.byteLength(source), async text() { return source; } });
  const discovery = JSON.parse(await call('floc_list_effects'));
  assert.ok(discovery.model.shapes.some(shape => shape.src === MORPHING_SPHERE_SRC));
  const properties = tools.find(tool => tool.name === 'floc_update_layer').inputSchema.properties.patch.properties.modelStyle.properties;
  assert.equal(properties.morphDetail.type, 'integer');
  const ranges = {
    morphAmplitude: [0, .35, .75], morphWarp: [0, .6, 1.5], morphFrequency: [1, 6.25, 10],
    morphFalloff: [1, 1.2, 1.6], morphDetail: [1, 10, 16], morphContrast: [.2, .6, 2], morphSpeed: [-4, 0, 1, 4]
  };
  for (const [key, values] of Object.entries(ranges)) {
    assert.deepEqual([properties[key].minimum, properties[key].maximum], [values[0], values.at(-1)]);
    for (const value of values) {
      await update({ ...project.layers[0].modelStyle, [key]: value });
      assert.equal(project.layers[0].modelStyle[key], value);
      assert.deepEqual(await imported(saved.at(-1)), project);
    }
  }
  const colors = ['morphColor1', 'morphColor2', 'morphColor3', 'morphColor4'];
  for (const key of colors) {
    await update({ ...project.layers[0].modelStyle, [key]: '#Ab12Ef' });
    assert.equal(project.layers[0].modelStyle[key], '#Ab12Ef');
    assert.deepEqual(await imported(saved.at(-1)), project);
  }
  const style = structuredClone(project.layers[0].modelStyle);
  for (const src of ['/assets/12345678-1234-1234-1234-123456789012.glb', MORPHING_SPHERE_SRC]) {
    await call('floc_update_layer', { id: 'model', patch: { src } });
    assert.deepEqual(project.layers[0].modelStyle, style);
    assert.deepEqual(await imported(saved.at(-1)), project);
  }
  const before = structuredClone(project), count = saved.length;
  const invalid = [
    ...Object.entries(ranges).flatMap(([key, values]) => [values[0] - .01, values.at(-1) + .01, '1', null, NaN, Infinity].map(value => ({ [key]: value }))),
    ...colors.flatMap(key => ['#fff', '#12345678', 'red', '#gg0000', null, 123456].map(value => ({ [key]: value }))),
    { morphDetail: 2.5 }
  ];
  for (const settings of invalid) {
    await assert.rejects(update(settings));
    const source = JSON.stringify({ ...before, layers: [{ ...before.layers[0], modelStyle: { ...style, ...settings } }] });
    await assert.rejects(imported(source));
  }
  assert.deepEqual(project, before);
  assert.equal(saved.length, count);
});

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
  const modelSchema = tools.find(tool => tool.name === 'floc_update_layer').inputSchema.properties.patch.properties.modelStyle;
  assert.equal(modelSchema.additionalProperties, false);
  assert.deepEqual(['type', 'minimum', 'maximum'].map(key => modelSchema.properties.motionSteps[key]), ['integer', 1, 24]);
  assert.equal(modelSchema.properties.motionTiming.additionalProperties, false);
  assert.deepEqual(modelSchema.properties.motionTiming.properties.curve.enum, discovery.model.motionTiming.curves.map(([id]) => id));
  assert.equal(modelSchema.properties.refractionSamples.type, 'integer');
  assert.equal(modelSchema.properties.refractionResolution.type, 'integer');
  for (const preset of discovery.model.materialPresets) {
    await call('floc_update_layer', { id: 'model', patch: { modelStyle: preset.settings } });
    const snapshot = JSON.parse(saved.at(-1));
    assert.deepEqual(snapshot, validateProject(snapshot));
    assert.deepEqual(snapshot.layers[0].modelStyle, { ...DEFAULT_MODEL_STYLE, ...preset.settings });
    assert.equal(snapshot.layers[0].modelStyle.base, preset.id === 'original' ? 'imported' : 'custom');
  }
  const referenceMaterial = discovery.model.materialPresets.find(preset => preset.id === 'holographic-glass');
  const referenceLighting = discovery.model.lightingPresets.find(preset => preset.id === 'holographic-studio');
  await call('floc_update_layer', { id: 'model', patch: { modelStyle: {
    ...referenceMaterial.settings, ...referenceLighting.settings, color: '#aabbcc', holographicScale: 2.7, motion: 'spin', motionSpeed: -1
  } } });
  const referenceSource = saved.at(-1);
  const referenceImport = await parseProjectFile({ size: Buffer.byteLength(referenceSource), async text() { return referenceSource; } });
  assert.deepEqual(referenceImport.layers[0].modelStyle, project.layers[0].modelStyle);
  assert.deepEqual(
    ['glass', 'environment', 'toneMapping', 'exposure', 'color', 'holographicIntensity', 'holographicScale', 'motion', 'motionSpeed'].map(key => referenceImport.layers[0].modelStyle[key]),
    ['holographic', 'holographic', 'aces', 1.2, '#aabbcc', .23, 2.7, 'spin', -1]
  );
  await call('floc_update_layer', { id: 'model', patch: { modelStyle: { glass: 'refractive', refractionThickness: 2, refractionSamples: 16, refractionResolution: 2048 } } });
  const refractiveSource = saved.at(-1);
  const refractiveImport = await parseProjectFile({ size: Buffer.byteLength(refractiveSource), async text() { return refractiveSource; } });
  assert.deepEqual([refractiveImport.layers[0].modelStyle.glass, refractiveImport.layers[0].modelStyle.refractionThickness, refractiveImport.layers[0].modelStyle.refractionSamples, refractiveImport.layers[0].modelStyle.refractionResolution], ['refractive', 2, 16, 2048]);
  for (const settings of [{ refractionThickness: -1 }, { refractionThickness: 2.1 }, { refractionSamples: 12 }, { refractionSamples: '8' }, { refractionResolution: 768 }, { refractionResolution: '1024' }, { holographicIntensity: 1.1 }, { holographicScale: 0 }, { holographicSpeed: -1.1 }, { holographicSweep: 2.1 }]) {
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
    { modelStyle: { holographicIntensity: -0.01 } },
    { modelStyle: { holographicScale: NaN } },
    { modelStyle: { holographicSpeed: 1.01 } },
    { modelStyle: { holographicSweep: '0.6' } },
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

test('quantum agent saves and project imports roundtrip bounded fields and reject invalid crystal settings', async () => {
  let project = validateProject({ ...demoProject(), layers: [fileLayer({ name: 'Model', src: '/assets/12345678-1234-1234-1234-123456789012.glb' }, 12, 'model')] });
  const saved = [];
  const tools = createTools({ get: () => project, set: next => { project = next; }, save: async () => { saved.push(JSON.stringify(project)); }, audit() {} });
  const update = modelStyle => tools.find(tool => tool.name === 'floc_update_layer').execute({ id: 'model', patch: { modelStyle } });
  const imported = async source => parseProjectFile({ size: Buffer.byteLength(source), async text() { return source; } });
  const ranges = {
    quantumIntensity: [0, 1, 2], quantumScale: [1, 2.13, 3], quantumDepth: [0, .65, 2],
    quantumSpeed: [-4, 0, 1, 4], quantumMorphSpeed: [0, 1, 5], quantumRim: [0, 4]
  };
  for (const [key, values] of Object.entries(ranges)) {
    for (const value of values) {
      await update({ glass: 'quantum', [key]: value });
      assert.equal(project.layers[0].modelStyle[key], value);
      assert.deepEqual(await imported(saved.at(-1)), project);
    }
  }
  for (const key of ['quantumColor1', 'quantumColor2', 'quantumColor3']) {
    await update({ glass: 'quantum', [key]: '#Ab12Ef' });
    assert.equal(project.layers[0].modelStyle[key], '#Ab12Ef');
    assert.deepEqual(await imported(saved.at(-1)), project);
  }
  const before = structuredClone(project), saveCount = saved.length;
  const invalid = [
    ...Object.entries(ranges).flatMap(([key, values]) => [values[0] - .01, values.at(-1) + .01, '1', null, NaN, Infinity].map(value => ({ [key]: value }))),
    ...['quantumColor1', 'quantumColor2', 'quantumColor3'].flatMap(key => ['#fff', '#12345678', 'red', '#gg0000', null, 123456].map(value => ({ [key]: value }))),
    { glass: 'quantum', look: 'toon' }, { glass: 'quantum', fresnelIntensity: .1 }
  ];
  for (const settings of invalid) {
    await assert.rejects(update(settings));
    const source = JSON.stringify({ ...before, layers: [{ ...before.layers[0], modelStyle: { ...before.layers[0].modelStyle, ...settings } }] });
    await assert.rejects(imported(source));
  }
  assert.deepEqual(project, before);
  assert.equal(saved.length, saveCount);
});
