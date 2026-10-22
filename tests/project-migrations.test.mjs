import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CURRENT_PROJECT_VERSION, migrateProject } from '../src/project-migrations.js';
import { blankProject, demoProject, fileLayer, validateProject } from '../src/project.js';
import { motionEase, sweepProgress } from '../src/motion-timing.js';
import { captureState } from '../src/choreography.js';
import { parseProjectFile } from '../src/editor/project-import.js';
import { createDraftStore } from '../server/draft-store.mjs';
import { createTemplateStore } from '../server/template-store.mjs';
import { database } from '../server/database.mjs';

const fixture = async name => {
  const stored = JSON.parse(await readFile(new URL(`./fixtures/projects/${name}.json`, import.meta.url), 'utf8'));
  // Frozen v13 expected outputs still guard every old content/timing migration.
  // The independent shared-scene regressions cover the v13→v14 cutover itself.
  return name.endsWith('.expected') ? validateProject(stored) : stored;
};
const LEGACY = ['v1-legacy-text', 'v1-legacy-defaults', 'v1-linked-formats', 'v1-junk-duplicate-ids'];

test('v8 models receive frozen source-material, lighting and animation defaults without changing other layers', () => {
  const source = fileLayer({ name: 'Legacy GLB', src: '/assets/12345678-1234-1234-1234-123456789012.glb' }, 12, 'model');
  delete source.modelStyle;
  Object.assign(source, { x: 33, y: 41, yaw: 28, tilt: -17, roll: 9, offset: 2, loop: false, opacity: 0.7 });
  const input = { ...demoProject(), version: 8, layers: [...demoProject().layers, source] }, before = structuredClone(input);
  const migrated = migrateProject(input), model = migrated.layers.at(-1);
  assert.deepEqual(model.modelStyle, {
    base: 'imported', color: '#ffffff', roughness: 0.5, metalness: 0, clearcoat: 0, iridescence: 0,
    emissive: '#000000', emissiveIntensity: 0,
    look: 'physical', glass: 'none', toonSteps: 4, fresnelColor: '#ffffff', fresnelIntensity: 0, fresnelPower: 3,
    environment: 'none', environmentIntensity: 1, environmentRotation: 0,
    ambientIntensity: 3, keyIntensity: 3, fillIntensity: 0, rimIntensity: 0, lightRotation: 0,
    motion: 'none', motionDuration: 6, motionSpeed: 1, motionAmplitude: 1,
    motionAxis: 'auto', motionSteps: 4, motionTiming: { mode: 'continuous', action: 1, pause: 0, curve: 'native', intensity: .5 },
    animationClip: 0, animationSpeed: 1,
    framing: 'fixed', zoom: 1, perspective: 38, motionSpace: 'euler',
    toneMapping: 'none', exposure: 1, keyColor: '#ffffff', fillColor: '#ffffff', rimColor: '#ffffff'
  });
  const { modelStyle, space, z, ...unchanged } = model;
  const { space: sourceSpace, z: sourceZ, ...oldSource } = source;
  assert.deepEqual(unchanged, oldSource);
  for (const layer of before.layers) {
    const after = migrated.layers.find(item => item.id === layer.id);
    for (const [key, value] of Object.entries(layer)) if (!['space', 'z', 'scene'].includes(key)) assert.deepEqual(after[key], value, `${layer.id} ${key}`);
  }
  assert.deepEqual(input, before);
  assert.deepEqual(validateProject(migrated), validateProject(input));
  assert.deepEqual(migrateProject(migrated), migrated);
  assert.equal(migrated.version, blankProject().version);
});

test('model migration preserves partial settings but never repairs invalid nested values', () => {
  const source = fileLayer({ name: 'GLB', src: '/assets/12345678-1234-1234-1234-123456789012.glb' }, 12, 'model');
  const input = { ...demoProject(), version: 8, layers: [{ ...source, modelStyle: { mode: 'tint', color: '#123456' } }] };
  const result = validateProject(input);
  assert.equal(result.layers[0].modelStyle.base, 'tinted');
  assert.equal(result.layers[0].modelStyle.color, '#123456');
  assert.equal(result.layers[0].modelStyle.keyIntensity, 3);
  for (const modelStyle of [null, [], new Date(0), new Map(), Object.create({ mode: 'replace' }), { [Symbol('shader')]: 'custom' }, 'chrome', { roughness: 2 }, { shader: 'void main() {}' }, { environmentUrl: 'https://example.com/a.hdr' }]) {
    assert.throws(() => validateProject({ ...input, layers: [{ ...source, modelStyle }] }), /3D/);
  }
});

test('v9 models freeze neutral axis and rhythm without repairing malformed timing or mutating source', () => {
  const model = fileLayer({ name: 'V9 model', src: '/assets/12345678-1234-1234-1234-123456789012.glb' }, 12, 'model');
  delete model.modelStyle.motionAxis; delete model.modelStyle.motionSteps; delete model.modelStyle.motionTiming;
  delete model.modelStyle.framing; delete model.modelStyle.zoom; delete model.modelStyle.perspective; delete model.modelStyle.motionSpace;
  Object.assign(model.modelStyle, { motion: 'spin', motionDuration: 8, motionSpeed: -2 });
  const input = { ...demoProject(), version: 9, layers: [model] }, before = structuredClone(input);
  const migrated = migrateProject(input), style = migrated.layers[0].modelStyle;
  assert.deepEqual(style, { ...before.layers[0].modelStyle, motionAxis: 'auto', motionSteps: 4, motionTiming: { mode: 'continuous', action: 1, pause: 0, curve: 'native', intensity: .5 }, framing: 'fixed', zoom: 1, perspective: 38, motionSpace: 'euler' });
  assert.deepEqual(input, before);
  assert.deepEqual(validateProject(migrated), validateProject(input));
  assert.deepEqual(migrateProject(migrated), migrated);
  for (const motionTiming of [null, [], 'linear', { action: 0 }, { pause: NaN }, { curve: 'eval' }, { extra: true }]) {
    const invalid = { ...input, layers: [{ ...model, modelStyle: { ...model.modelStyle, motionTiming } }] };
    assert.deepEqual(migrateProject(invalid).layers[0].modelStyle.motionTiming, motionTiming);
    assert.throws(() => validateProject(invalid), /3D/);
  }
  for (const motionTiming of [Object.create({ curve: 'spring' }), { [Symbol('curve')]: 'spring' }, new Map(), new Date(0)]) {
    assert.throws(() => validateProject({ ...input, layers: [{ ...model, modelStyle: { ...model.modelStyle, motionTiming } }] }), /3D/);
  }
});

test('v10 models keep the fixed camera while new models fit their motion', () => {
  const model = fileLayer({ name: 'V10 model', src: '/assets/12345678-1234-1234-1234-123456789012.glb' }, 12, 'model');
  assert.equal(model.modelStyle.framing, 'fit');
  delete model.modelStyle.framing; delete model.modelStyle.zoom; delete model.modelStyle.perspective; delete model.modelStyle.motionSpace;
  Object.assign(model.modelStyle, { motion: 'pulse', mode: 'tint', color: '#335577' });
  const input = { ...demoProject(), version: 10, layers: [model] }, before = structuredClone(input);
  const migrated = migrateProject(input);
  const { mode, ...beforeStyle } = before.layers[0].modelStyle;
  assert.deepEqual(migrated.layers[0].modelStyle, { ...beforeStyle, base: 'tinted', framing: 'fixed', zoom: 1, perspective: 38, motionSpace: 'euler' });
  assert.deepEqual(input, before);
  assert.deepEqual(validateProject(migrated), validateProject(input));
  assert.deepEqual(migrateProject(migrated), migrated);
  for (const modelStyle of [{ framing: 'auto' }, { zoom: 0 }, { zoom: 4.01 }, { perspective: 14 }, { perspective: '38' }]) {
    assert.throws(() => validateProject({ ...migrated, layers: [{ ...model, modelStyle: { ...migrated.layers[0].modelStyle, ...modelStyle } }] }), /3D/);
  }
});

test('v11 models keep motion summed into the pose while new models use screen axes', () => {
  const model = fileLayer({ name: 'V11 model', src: '/assets/12345678-1234-1234-1234-123456789012.glb' }, 12, 'model');
  assert.equal(model.modelStyle.motionSpace, 'screen');
  delete model.modelStyle.motionSpace;
  Object.assign(model, { tilt: 30, yaw: 45 }); Object.assign(model.modelStyle, { motion: 'spin', motionAxis: 'y' });
  const input = { ...demoProject(), version: 11, layers: [model] }, before = structuredClone(input);
  const migrated = migrateProject(input);
  assert.deepEqual(migrated.layers[0].modelStyle, { ...before.layers[0].modelStyle, motionSpace: 'euler' });
  assert.deepEqual(input, before);
  assert.deepEqual(migrateProject(migrated), migrated);
  for (const motionSpace of ['world', 'local', '', null]) {
    assert.throws(() => validateProject({ ...migrated, layers: [{ ...model, modelStyle: { ...migrated.layers[0].modelStyle, motionSpace } }] }), /3D/);
  }
});

test('v12 models keep the classic light while new models start in the Studio preset', () => {
  const model = fileLayer({ name: 'V12 model', src: '/assets/12345678-1234-1234-1234-123456789012.glb' }, 12, 'model');
  assert.deepEqual([model.modelStyle.environment, model.modelStyle.toneMapping], ['softbox', 'neutral']);
  for (const key of ['toneMapping', 'exposure', 'keyColor', 'fillColor', 'rimColor']) delete model.modelStyle[key];
  Object.assign(model.modelStyle, { environment: 'studio', ambientIntensity: 3, keyIntensity: 3, fillIntensity: 0, rimIntensity: 0 });
  const input = { ...demoProject(), version: 12, layers: [model] }, before = structuredClone(input);
  const migrated = migrateProject(input);
  assert.deepEqual(migrated.layers[0].modelStyle, { ...before.layers[0].modelStyle, toneMapping: 'none', exposure: 1, keyColor: '#ffffff', fillColor: '#ffffff', rimColor: '#ffffff' });
  assert.deepEqual(input, before);
  assert.deepEqual(migrateProject(migrated), migrated);
  for (const modelStyle of [{ toneMapping: 'aces' }, { exposure: 0 }, { exposure: 4.5 }, { keyColor: 'white' }, { environment: 'https://example.com/a.hdr' }, { environment: 'room' }]) {
    assert.throws(() => validateProject({ ...migrated, layers: [{ ...model, modelStyle: { ...migrated.layers[0].modelStyle, ...modelStyle } }] }), /3D/);
  }
});

test('v14 material modes and shaders become independent base, look and glass with edge glow only from Fresnel', () => {
  const v14Model = (id, style) => {
    const model = { ...fileLayer({ name: id, src: '/assets/12345678-1234-1234-1234-123456789012.glb' }, 12, 'model'), id };
    const { base, look, glass, fresnelIntensity, ...rest } = model.modelStyle;
    return { ...model, modelStyle: { ...rest, ...style } };
  };
  const cases = {
    original: [{ mode: 'original', shader: 'standard', fresnelIntensity: .5 }, ['imported', 'physical', 'none', 0]],
    tint: [{ mode: 'tint', shader: 'toon', fresnelIntensity: 1.2 }, ['tinted', 'toon', 'none', 0]],
    replace: [{ mode: 'replace', shader: 'wireframe' }, ['custom', 'wireframe', 'none', 0]],
    fresnel: [{ mode: 'replace', shader: 'fresnel', fresnelIntensity: 1.5 }, ['custom', 'physical', 'none', 1.5]],
    'fresnel-default': [{ mode: 'replace', shader: 'fresnel' }, ['custom', 'physical', 'none', .5]],
    glass: [{ mode: 'replace', shader: 'glass', fresnelIntensity: .5 }, ['custom', 'physical', 'see-through', 0]],
    crystal: [{ mode: 'replace', shader: 'crystal' }, ['custom', 'physical', 'environment', 0]],
    refractive: [{ mode: 'tint', shader: 'refractive' }, ['tinted', 'physical', 'refractive', 0]],
    defaults: [{}, ['imported', 'physical', 'none', 0]]
  };
  const input = { ...demoProject(), version: 14, layers: Object.entries(cases).map(([id, [style]]) => v14Model(id, style)) }, before = structuredClone(input);
  const project = validateProject(input);
  assert.equal(project.version, CURRENT_PROJECT_VERSION);
  for (const [id, [, expected]] of Object.entries(cases)) {
    const style = project.layers.find(layer => layer.id === id).modelStyle;
    assert.deepEqual([style.base, style.look, style.glass, style.fresnelIntensity], expected, id);
    assert.equal(Object.hasOwn(style, 'mode') || Object.hasOwn(style, 'shader'), false, id);
  }
  assert.deepEqual(input, before);
  assert.deepEqual(validateProject(project), project, 'a migrated project is current');
  assert.throws(() => validateProject({ ...input, layers: [v14Model('plasma', { mode: 'replace', shader: 'plasma' })] }), /3D/);
});

test('v2 content labels become typed fields with deterministic unique ids', async () => {
  const input = await fixture('v2-content-fields'), before = structuredClone(input);
  const project = validateProject(input);
  const field = id => project.layers.find(l => l.id === id).contentField;
  // Layer order decides suffixes: the carousel is first, so it keeps the plain slug.
  assert.deepEqual(field('carousel'), { id: 'headline', label: 'Headline', required: false });
  assert.deepEqual(field('headline'), { id: 'headline-2', label: 'Headline', required: false });
  assert.deepEqual(field('subline'), { id: 'headline-3', label: 'Headline', required: false });
  assert.deepEqual(field('caption'), { id: 'cafe-creme', label: 'Café crème!', required: false });
  assert.deepEqual(field('music'), { id: 'soundtrack', label: 'Soundtrack', required: false });
  assert.equal(Object.hasOwn(project.layers.find(l => l.id === 'logo'), 'contentField'), false, 'a blank label declared nothing');
  assert.deepEqual(input, before);
  assert.deepEqual(validateProject(input), project, 'migration is deterministic');
  assert.deepEqual(validateProject(project), project, 'a migrated project is current');
  // Labels that v2 rejected still fail instead of being repaired.
  const broken = structuredClone(input); broken.layers.find(l => l.id === 'caption').contentField = 'A\nB';
  assert.throws(() => validateProject(broken), /Invalid content field name/);
  const misplaced = structuredClone(input); misplaced.layers.find(l => l.id === 'background').contentField = 'Backdrop';
  assert.throws(() => validateProject(misplaced), /cannot declare a content field/);
});

test('v3 retired carousels map to their closest remaining family with valid variants', async () => {
  const input = await fixture('v3-retired-carousels'), before = structuredClone(input);
  const project = validateProject(input);
  const carousel = id => project.layers.find(l => l.id === id);
  const original = id => input.layers.find(l => l.id === id);
  assert.deepEqual([carousel('depth').template, carousel('depth').motionVariant], ['showcase', 'default']);
  assert.deepEqual([carousel('arc').template, carousel('arc').motionVariant], ['wheel', 'rock']);
  assert.deepEqual([carousel('nested-rise').template, carousel('nested-rise').motionVariant], ['zoom-through', 'default']);
  assert.deepEqual([carousel('kept').template, carousel('kept').motionVariant], ['circular', 'bloom']);
  // Everything else the carousel saved survives the family change.
  for (const id of ['depth', 'arc', 'nested-rise']) {
    for (const key of ['speed', 'gap', 'tilt', 'cardCount', 'cardAspect', 'loopDuration', 'size', 'x', 'y', 'fade', 'images', 'motion'])
      assert.deepEqual(carousel(id)[key], original(id)[key], `${id} ${key}`);
  }
  assert.equal(carousel('nested-rise').zoomRotation, 0, 'validation fills the new family defaults');
  // Linked layouts keep each carousel's per-format framing.
  for (const [format, snapshot] of Object.entries(input.linkedFormats.layouts)) {
    assert.deepEqual(project.linkedFormats.layouts[format].layout, snapshot.layout);
    for (const [id, local] of Object.entries(snapshot.layers)) for (const [key, value] of Object.entries(local)) assert.deepEqual(project.linkedFormats.layouts[format].layers[id][key], value, `${format} ${id} ${key}`);
  }
  assert.deepEqual(input, before, 'stored data is not rewritten');
  assert.deepEqual(validateProject(input), project, 'migration is deterministic');
  assert.deepEqual(validateProject(project), project, 'a migrated project is current');
  assert.deepEqual(migrateProject(project), project, 'v4 carousels are left alone');
});

test('v3 retired carousels reset variants the new family lacks', async () => {
  const input = await fixture('v3-retired-carousels');
  for (const layer of input.layers) if (layer.type === 'carousel') layer.motionVariant = { depth: 'queue', arc: 'ring', 'nested-rise': 'right', kept: 'bloom' }[layer.id];
  const carousel = id => migrateProject(input).layers.find(l => l.id === id);
  assert.equal(carousel('depth').motionVariant, 'queue', 'a variant the target family has is kept');
  assert.equal(carousel('arc').motionVariant, 'rock', 'Arc always becomes the rocking wheel');
  assert.equal(carousel('nested-rise').motionVariant, 'default');
  assert.equal(carousel('kept').motionVariant, 'bloom');
  delete input.layers.find(l => l.id === 'nested-rise').motionVariant;
  assert.equal(Object.hasOwn(carousel('nested-rise'), 'motionVariant'), false, 'a missing variant is left to validation defaults');
  // A current file cannot name a retired family.
  assert.throws(() => validateProject({ ...input, version: CURRENT_PROJECT_VERSION }), /Unknown carousel/);
});

test('v4 Twist carousels become Flip (single panel) or a Horizontal strip (ribbon)', () => {
  const demo = demoProject(), carousel = demo.layers.find(l => l.type === 'carousel');
  const twist = (id, motionVariant) => ({ ...carousel, id, template: 'twist', motionVariant, gap: 0.37, size: 1.1, speed: 24 });
  const input = { ...demo, version: 4, layers: [demo.layers[0], twist('single', 'single'), twist('ribbon', 'ribbon'), twist('default', 'default')] };
  const before = structuredClone(input);
  const project = validateProject(input);
  const layer = id => project.layers.find(l => l.id === id);
  assert.deepEqual(['single', 'ribbon', 'default'].map(id => [layer(id).template, layer(id).motionVariant]), [['flip', 'default'], ['horizontal', 'strip'], ['flip', 'default']]);
  for (const id of ['single', 'ribbon']) assert.deepEqual([layer(id).gap, layer(id).size, layer(id).speed], [0.37, 1.1, 24], `${id} keeps its settings`);
  assert.deepEqual(input, before, 'stored data is not rewritten');
  assert.deepEqual(validateProject(project), project, 'a migrated project is current');
  assert.throws(() => validateProject({ ...input, version: CURRENT_PROJECT_VERSION }), /Unknown carousel/);
});

test('v5 progress curves and choreography easings become their closest v6 curve and strength', () => {
  const demo = demoProject(), carousel = demo.layers.find(l => l.type === 'carousel'), headline = demo.layers.find(l => l.id === 'headline');
  // [v5 curve, v5 intensity, v6 curve, v6 strength]
  const curves = [
    ['smooth', 1, 'ease-in-out', 0.35], ['natural', 0.5, 'ease-in-out', 0.175], ['slow', 1, 'ease-in-out', 0.5],
    ['ease-in', 1, 'ease-in', 0.25], ['ease-out', 0.6, 'ease-out', 0.15], ['glide', 0.8, 'ease-out', 0.4], ['vive', 1, 'ease-out', 1],
    ['back', 1, 'back', 0.4], ['bounce', 0.65, 'bounce', 0.65], ['elastic', 0.3, 'spring', 0.3],
    ['linear', 0.7, 'linear', 0.7], ['native', 0.2, 'native', 0.2],
    // At intensity 0 every v5 curve showed the family's Original motion.
    ['smooth', 0, 'native', 0.5], ['linear', 0, 'native', 0.5]
  ];
  const motion = (curve, intensity, mode = 'steps') => ({ mode, action: 1, pause: 0.5, curve, intensity });
  const layers = curves.map(([curve, intensity], i) => ({ ...carousel, id: `curve-${i}`, motion: motion(curve, intensity), motionBaseline: { name: 'Original motion', speed: 18, loopDuration: 0, motion: motion(curve, intensity, 'continuous') } }));
  // Sweep Reveal always drew Glide as its own symmetric wipe; Window Push's Glide was its Original ease-out.
  const sweep = { ...carousel, id: 'sweep', template: 'sweep-reveal', motionVariant: 'right', motion: { ...motion('glide', 1, 'continuous'), action: 1.7, pause: 0 } };
  const push = { ...carousel, id: 'push', template: 'window-push', motionVariant: 'right', motion: { ...motion('glide', 1, 'continuous'), action: 1.2, pause: 0 } };
  const easings = [['linear', 'linear'], ['smooth', 'ease-in-out'], ['natural', 'ease-in-out'], ['slow', 'ease-in-out'], ['ease-in', 'ease-in'], ['ease-out', 'ease-out'],
    ['glide', 'ease-out'], ['vive', 'ease-out'], ['back', 'back'], ['bounce', 'bounce'], ['elastic', 'spring'], [[0.25, 0.1, 0.25, 1], [0.25, 0.1, 0.25, 1]]];
  const states = values => easings.map(([easing], i) => ({ id: `s${i}`, time: i * 0.5, easing, values }));
  const text = { ...headline, choreography: states({ x: 10, y: 10, size: 40, opacity: 1, roll: 0 }) };
  const animated = { ...carousel, id: 'animated', choreography: [{ id: 'a', time: 0, easing: 'elastic', values: { x: 50, y: 54, size: 1.35, opacity: 1, tilt: -12, yaw: 0, roll: -26 } }] };
  const input = { ...demo, version: 5, layers: [demo.layers[0], ...layers, sweep, push, text, animated] };
  const before = structuredClone(input);
  const project = validateProject(input);
  const layer = id => project.layers.find(l => l.id === id);
  curves.forEach(([from, intensity, curve, strength], i) => {
    for (const settings of [layer(`curve-${i}`).motion, layer(`curve-${i}`).motionBaseline.motion]) assert.deepEqual([settings.curve, settings.intensity], [curve, strength], `${from} at ${intensity}`);
  });
  assert.deepEqual(layer('headline').choreography.map(state => state.easing), easings.map(([, easing]) => easing));
  assert.equal(layer('animated').choreography[0].easing, 'spring');
  assert.deepEqual([layer('sweep').motion.curve, layer('push').motion.curve, layer('push').motion.intensity], ['native', 'ease-out', 0.5]);
  // Full-intensity Glide (in both wipes), Slow and Vive were exactly the curves they become.
  for (let t = 0; t <= 1; t += 1 / 64) {
    assert.ok(Math.abs(sweepProgress(t, layer('sweep').motion) - (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)) < 1e-12);
    assert.ok(Math.abs(motionEase(t, layer('push').motion) - (1 - (1 - t) ** 3)) < 1e-12);
    assert.ok(Math.abs(motionEase(t, layer('curve-2').motion) - (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)) < 1e-12);
    assert.ok(Math.abs(motionEase(t, layer('curve-6').motion) - (1 - (1 - t) ** 5)) < 1e-12);
  }
  assert.deepEqual(input, before, 'stored data is not rewritten');
  assert.deepEqual(validateProject(project), project, 'a migrated project is current');
  assert.deepEqual(migrateProject(project), project, 'migration is idempotent');
  // A current file cannot name a retired curve.
  assert.throws(() => validateProject({ ...input, version: CURRENT_PROJECT_VERSION }), /Unknown rhythm or curve/);
  assert.throws(() => validateProject({ ...demo, layers: [demo.layers[0], text] }), /Unknown choreography easing/);
});

test('v6 pattern density becomes v7 pattern size with the same feature size', () => {
  const demo = demoProject(), background = demo.layers.find(l => l.type === 'background');
  const scales = [0.25, 0.5, 0.72, 1, 1.65, 2.5, 4];
  const layers = scales.map((patternScale, i) => ({ ...background, id: `pattern-${i}`, mode: 'procedural', pattern: 'grid', patternColor: '#ffffff', patternScale, patternIntensity: 0.35, patternSpeed: 0.2, patternSeed: 1 }));
  // Media backgrounds without pattern fields keep the default size.
  const input = { ...demo, version: 6, layers: [background, ...layers] };
  const before = structuredClone(input);
  const project = validateProject(input);
  scales.forEach((scale, i) => assert.ok(Math.abs(project.layers.find(l => l.id === `pattern-${i}`).patternScale - 1 / scale) < 1e-12, String(scale)));
  assert.equal(project.layers[0].patternScale, 1);
  assert.deepEqual(input, before, 'stored data is not rewritten');
  assert.deepEqual(migrateProject(project), project, 'migration is idempotent');
});


test('v7 carousel shaders and finishes join the shared stack in render order', () => {
  const demo = validateProject(demoProject()), base = demo.layers.find(layer => layer.type === 'carousel');
  const legacy = (id, shader, layerEffect, fields = {}) => ({ ...base, id, effects: [{ type: 'noise', enabled: true, mode: 'mono', sizeX: 1, sizeY: 1, linked: true, density: 1, opacity: 0.15, color1: '#000000', color2: '#ffffff', animated: false, seed: 42 }], shader, intensity: 0.6, tint: '#ff3b1f', layerEffect, layerEffectIntensity: 0.7, halftoneSize: 0.2, ditheringSize: 0.3, ditheringSteps: 3, glassSize: 0.4, glassDistortion: 0.8, ...fields });
  const wave = legacy('wave', 'wave', 'halftone');
  wave.choreography = captureState(wave, 1, demo.fps, {}, 'wave-state', { all: true });
  wave.choreography[0].values.intensity = 0.25; wave.choreography[0].values.layerEffectIntensity = 0.45;
  const layers = [wave, legacy('duo', 'duotone', 'dithering'), legacy('chromatic', 'chromatic', 'fluted-glass'), legacy('elastic', 'elastic', 'none'), legacy('plain', 'none', 'none')];
  const input = { ...demo, version: 7, layers: [demo.layers[0], ...layers] }, before = structuredClone(input);
  const project = validateProject(input), byId = id => project.layers.find(layer => layer.id === id);
  assert.deepEqual(byId('wave').effects.map(({ type }) => type), ['wave', 'halftone', 'noise']);
  assert.deepEqual(byId('wave').effects.slice(0, 2), [{ type: 'wave', enabled: true, amount: 0.6, size: 0.5, speed: 1 }, { type: 'halftone', enabled: true, amount: 0.7, size: 0.2 }]);
  assert.deepEqual(byId('duo').effects.slice(0, 2), [{ type: 'duotone', enabled: true, amount: 0.6, shadow: '#282828', highlight: '#ff3b1f' }, { type: 'dithering', enabled: true, amount: 0.7, size: 0.3, steps: 3 }]);
  assert.deepEqual(byId('chromatic').effects.slice(0, 2), [{ type: 'chromatic', enabled: true, amount: 0.6, animated: true }, { type: 'fluted-glass', enabled: true, amount: 0.7, size: 0.4, distortion: 0.8 }]);
  assert.equal(byId('elastic').stretch, 0.6); assert.deepEqual(byId('elastic').effects.map(({ type }) => type), ['noise']);
  assert.equal(byId('plain').stretch, 0); assert.deepEqual(byId('plain').effects.map(({ type }) => type), ['noise']);
  assert.equal(byId('wave').choreography[0].values.waveAmount, 0.25);
  assert.equal(byId('wave').choreography[0].values.halftoneAmount, 0.45);
  for (const layer of project.layers.filter(layer => layer.type === 'carousel')) for (const field of ['shader', 'intensity', 'tint', 'layerEffect', 'layerEffectIntensity', 'halftoneSize', 'ditheringSize', 'ditheringSteps', 'glassSize', 'glassDistortion']) assert.equal(Object.hasOwn(layer, field), false, `${layer.id} ${field}`);
  assert.deepEqual(input, before, 'stored data is not rewritten');
  assert.deepEqual(migrateProject(project), project, 'migration is idempotent');
});

test('v7 invalid carousel effect settings are rejected instead of sanitized', () => {
  const demo = validateProject(demoProject()), carousel = demo.layers.find(layer => layer.type === 'carousel');
  const input = { ...demo, version: 7, layers: [demo.layers[0], { ...carousel, shader: 'runtime-glsl', intensity: 0.35, tint: '#0000ff', layerEffect: 'none' }] };
  assert.throws(() => validateProject(input), /Invalid v7 carousel effect settings/);
  input.layers[1].shader = 'none'; input.layers[1].ditheringSteps = 2.5;
  assert.throws(() => validateProject(input), /Invalid v7 carousel effect settings/);
});
test('legacy v1 fixtures migrate to the output the pre-migration validator produced', async () => {
  for (const name of LEGACY) {
    const input = await fixture(name), before = structuredClone(input);
    const project = validateProject(input);
    assert.deepEqual(project, await fixture(`${name}.expected`), name);
    assert.deepEqual(input, before, `${name} input must not be mutated`);
    assert.equal(project.version, CURRENT_PROJECT_VERSION);
  }
});

test('legacy text entrances become fades and rise only in the v1 step', async () => {
  const project = validateProject(await fixture('v1-legacy-text'));
  const text = id => project.layers.find(l => l.id === id);
  assert.deepEqual(['fadeIn', 'fadeOut', 'rise'].map(key => text('fade')[key]), [0.45, 0.25, false]);
  assert.deepEqual(['fadeIn', 'fadeOut', 'rise'].map(key => text('none')[key]), [0, 0, false]);
  assert.deepEqual(['fadeIn', 'fadeOut', 'rise'].map(key => text('explicit')[key]), [1, 0.25, false]);
  assert(project.layers.every(l => !Object.hasOwn(l, 'animation')));
  const rise = text('rise');
  assert(rise.rise && Math.abs(rise.fadeIn + rise.fadeOut - 0.5) < 1e-9, 'legacy ramps still fit short layers');
  // A current-version file never carries the legacy field; it is dropped, not converted.
  const current = validateProject({ ...demoProject(), layers: demoProject().layers.map(l => l.id === 'headline' ? { ...l, fadeIn: 0, animation: 'rise' } : l) });
  assert.deepEqual([current.layers[2].fadeIn, current.layers[2].rise, Object.hasOwn(current.layers[2], 'animation')], [0, false, false]);
  const invalid = await fixture('v1-legacy-text'); invalid.layers[0].animation = 'spin';
  assert.throws(() => validateProject(invalid), /Unknown text style/);
});

test('migrating and validating a current project is a no-op', async () => {
  for (const name of LEGACY) {
    const current = await fixture(`${name}.expected`), before = structuredClone(current);
    const migrated = migrateProject(current);
    assert.deepEqual(migrated, current, name); assert.notEqual(migrated, current);
    assert.deepEqual(validateProject(current), current, name);
    assert.deepEqual(current, before);
  }
  const demo = validateProject(demoProject());
  assert.deepEqual(validateProject(demo), demo);
  // Only v1 files predate the safe layout; a current file must carry it.
  const unlaid = demoProject(); delete unlaid.layout;
  assert.throws(() => validateProject(unlaid), /Invalid layout settings/);
  assert.deepEqual(validateProject({ ...unlaid, version: 1 }).layout, demo.layout);
});

test('newer, missing and invalid versions fail clearly', () => {
  assert.throws(() => validateProject({ ...demoProject(), version: CURRENT_PROJECT_VERSION + 1 }), { message: 'This project was created by a newer version of FLOC Motion.' });
  const unversioned = demoProject(); delete unversioned.version;
  assert.throws(() => validateProject(unversioned), { message: 'Project version is missing.' });
  for (const bad of [0, -1, 1.5, '2', null, NaN]) assert.throws(() => validateProject({ ...demoProject(), version: bad }), { message: 'Invalid project version.' }, String(bad));
  for (const bad of [null, undefined, 'project', [], 7]) assert.throws(() => validateProject(bad), { message: 'Invalid project.' });
});

test('unknown keys are stripped for every version while misplaced known fields still fail', async () => {
  const project = demoProject();
  project.exportedBy = 'elsewhere'; project.images[0].thumbnail = '/demo/poster-1.svg';
  Object.assign(project.layers[0], { size: 3, text: 'stale' });
  Object.assign(project.layers[1], { volume: 1, editorState: { open: true } });
  Object.assign(project.layers[2], { src: '/demo/poster-2.svg', images: [] });
  Object.assign(project.layers[5], { x: 4, fadeIn: 1 });
  const p = validateProject(project), clean = validateProject(demoProject());
  assert.deepEqual(p, clean);
  for (const [id, patch, message] of [
    ['music', { opacity: 0.5 }, /Only visual layers accept opacity/],
    ['music', { choreography: [] }, /cannot have choreography/],
    ['headline', { effectScope: 'overlay' }, /Only effect layers declare effect scope/],
    ['background', { contentField: 'Backdrop' }, /cannot declare a content field/],
    ['music', { effects: [] }, /Only visual layers accept effects/]
  ]) {
    const input = demoProject(); Object.assign(input.layers.find(l => l.id === id), patch);
    assert.throws(() => validateProject(input), message, `${id} ${Object.keys(patch)}`);
  }
});

test('image IDs must be nonempty and unique within each list; v1 repairs them deterministically', async () => {
  for (const id of ['', '   ', 'demo-1']) {
    const project = demoProject(); project.images[0].id = id;
    assert.throws(() => validateProject(project), /Image IDs must be nonempty and unique/, JSON.stringify(id));
    const carousel = demoProject(); carousel.layers[1].images = [{ id: 'a', src: '/demo/poster-1.svg', name: 'A' }, { id: id || 'a', src: '/demo/poster-2.svg', name: 'B' }];
    if (id !== 'demo-1') assert.throws(() => validateProject(carousel), /Image IDs must be nonempty and unique/);
  }
  // The same card may appear in separate lists (duplicated carousels copy their cards).
  const shared = demoProject(); shared.layers[1].images = structuredClone(shared.images);
  assert.doesNotThrow(() => validateProject(shared));
  const legacy = await fixture('v1-junk-duplicate-ids');
  const repaired = validateProject(legacy);
  assert.deepEqual(repaired.images.map(i => i.id), ['image-2', 'image-2-2', 'image-3', 'image-4']);
  assert.deepEqual(repaired.layers.find(l => l.type === 'carousel').images.map(i => i.id), ['a', 'image-2', 'a-2', 'image-4']);
  assert.deepEqual(repaired.images.map(i => i.src), legacy.images.map(i => i.src), 'card order is preserved');
  assert.deepEqual(validateProject(legacy), repaired, 'repair is deterministic');
});

test('importing a project file migrates it and reports newer files', async () => {
  const file = value => { const source = JSON.stringify(value); return { size: source.length, text: async () => source }; };
  assert.deepEqual(await parseProjectFile(file(await fixture('v1-legacy-text'))), await fixture('v1-legacy-text.expected'));
  await assert.rejects(parseProjectFile(file({ ...demoProject(), version: CURRENT_PROJECT_VERSION + 1 })), { message: 'This project was created by a newer version of FLOC Motion.' });
});

test('stores return migrated drafts and templates without rewriting them on read', async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'floc-migrations-'));
  try {
    const legacy = await fixture('v1-legacy-text'), expected = await fixture('v1-legacy-text.expected');
    const draftId = '11111111-1111-4111-8111-111111111111', templateId = '22222222-2222-4222-8222-222222222222';
    const draftFile = path.join(data, 'drafts', `${draftId}.json`), templateFile = path.join(data, 'templates', `${templateId}.json`);
    await mkdir(path.dirname(draftFile)); await mkdir(path.dirname(templateFile));
    await writeFile(draftFile, JSON.stringify({ project: legacy, revision: 3 }));
    await writeFile(templateFile, JSON.stringify({ id: templateId, name: 'Legacy', tags: [], project: legacy, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }));
    const draftBytes = await readFile(draftFile, 'utf8'), templateBytes = await readFile(templateFile, 'utf8');

    const drafts = createDraftStore(data), templates = createTemplateStore(data);
    assert.deepEqual(await drafts.read(draftId), { project: expected, revision: 3 });
    assert.deepEqual((await templates.read(templateId)).project, expected);
    assert.deepEqual((await templates.list())[0].project, expected);
    // Reads never rewrite stored rows; the legacy JSON files stay untouched as a backup.
    const db = database(data), stored = (table, id) => JSON.parse(db.prepare(`SELECT project FROM ${table} WHERE id = ?`).get(id).project);
    assert.deepEqual(stored('drafts', draftId), legacy); assert.deepEqual(stored('templates', templateId), legacy);

    await drafts.update(draftId, { revision: 3, project: legacy });
    assert.deepEqual([stored('drafts', draftId), (await drafts.read(draftId)).revision], [expected, 4]);
    await templates.update(templateId, { name: 'Renamed' });
    assert.deepEqual(stored('templates', templateId), expected, 'a metadata save writes the migrated project');
    assert.equal(await readFile(draftFile, 'utf8'), draftBytes);
    assert.equal(await readFile(templateFile, 'utf8'), templateBytes);
  } finally { await rm(data, { recursive: true, force: true }); }
});
