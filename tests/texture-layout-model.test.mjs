import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProject, demoProject, validateProject, patchLayer, linkFormats, switchFormat, resetFormat, unlinkFormats, assertLocksRespected, FORMATS } from '../src/project.js';
import { CURRENT_PROJECT_VERSION, migrateProject } from '../src/project-migrations.js';
import { parseProjectFile } from '../src/editor/project-import.js';
import { createTools } from '../src/webmcp.js';
import { TEXTURE_LAYOUT_DEFAULTS, TEXTURE_LAYOUT_LIMITS, TEXTURE_LAYOUTS, TEXTURE_DISTRIBUTIONS } from '../src/texture-layout.js';

const fields = Object.keys(TEXTURE_LAYOUT_DEFAULTS);
const textures = ['settle', 'magnet', 'warp', 'pinch', 'pillars', 'sphere', 'twist', 'watch'];
const background = project => project.layers.find(layer => layer.type === 'background');
const settings = project => Object.fromEntries(fields.map(field => [field, background(project)[field]]));
const file = value => {
  const source = JSON.stringify(value);
  return { size: new Blob([source]).size, text: async () => source };
};
const importedPatch = (project, patch) => ({ ...project, layers: project.layers.map(layer => layer.type === 'background' ? { ...layer, ...patch } : layer) });
const agent = initial => {
  let project = initial;
  const tools = createTools({ get: () => project, set: next => { project = next; }, save: async () => {}, audit() {} });
  return { get: () => project, tool: name => tools.find(tool => tool.name === name) };
};

test('schema 17 migration and legacy import retain Original texture geometry settings', async () => {
  for (const pattern of textures) {
    const legacy = validateProject(importedPatch(blankProject(), { mode: 'procedural', pattern, patternSeed: 42, patternSpeed: -.75 }));
    legacy.version = 16;
    for (const field of fields) delete background(legacy)[field];
    const before = structuredClone(legacy);
    assert.deepEqual(migrateProject(legacy), { ...legacy, version: CURRENT_PROJECT_VERSION });
    const current = validateProject(legacy);
    assert.deepEqual(settings(current), TEXTURE_LAYOUT_DEFAULTS, pattern);
    const withoutLayout = structuredClone(current);
    for (const field of fields) delete background(withoutLayout)[field];
    assert.deepEqual(withoutLayout, { ...legacy, version: CURRENT_PROJECT_VERSION }, pattern);
    assert.deepEqual(await parseProjectFile(file(legacy)), current, pattern);
    assert.deepEqual(validateProject(JSON.parse(JSON.stringify(current))), current, pattern);
    assert.deepEqual(legacy, before, 'migration and import never mutate their input');
  }
  for (const version of [CURRENT_PROJECT_VERSION + 1, 99]) {
    const future = { ...blankProject(), version };
    assert.throws(() => validateProject(future), /newer version/);
    await assert.rejects(parseProjectFile(file(future)), /newer version/);
  }
});

test('selecting a first texture defaults to Adaptive but import and texture changes preserve explicit layout', async () => {
  for (const pattern of textures) {
    const selected = patchLayer(blankProject(), 'background', { mode: 'procedural', pattern });
    assert.equal(background(selected).textureLayout, 'adaptive');
    const imported = validateProject(importedPatch(blankProject(), { mode: 'procedural', pattern }));
    assert.equal(background(imported).textureLayout, 'original');
    assert.equal(background(patchLayer(imported, 'background', { pattern })).textureLayout, 'original');
    const explicit = patchLayer(blankProject(), 'background', { mode: 'procedural', pattern, textureLayout: 'fit' });
    assert.equal(background(explicit).textureLayout, 'fit');
    const other = textures.find(id => id !== pattern);
    assert.equal(background(patchLayer(explicit, 'background', { pattern: other })).textureLayout, 'fit');
    const original = patchLayer(explicit, 'background', { textureLayout: 'original' });
    assert.equal(background(patchLayer(original, 'background', { pattern: other })).textureLayout, 'original');
    const api = agent(blankProject());
    await api.tool('floc_update_layer').execute({ id: 'background', patch: { mode: 'procedural', pattern } });
    assert.equal(background(api.get()).textureLayout, 'adaptive');
  }
});

test('texture layout enums, ranges and manual integer counts use one validation path for human, import and agent edits', async () => {
  const base = validateProject(blankProject());
  const invalid = [
    ['textureLayout', ['cover', '', null, 1]],
    ['textureDistribution', ['density', '', null, 1]],
    ['textureDensity', [.249, 2.001, NaN, Infinity, '1', null]],
    ['textureColumns', [0, 65, 1.5, NaN, Infinity, '24', null]],
    ['textureRows', [0, 65, 1.5, NaN, Infinity, '18', null]],
    ['textureElementSize', [.249, 1.501, NaN, Infinity, '1', null]],
    ['textureMargin', [-.001, .251, NaN, Infinity, '0.05', null]]
  ];
  for (const [field, values] of invalid) for (const value of values) {
    const patch = { [field]: value }, label = `${field}: ${String(value)}`;
    assert.throws(() => patchLayer(base, 'background', patch), undefined, label);
    assert.throws(() => validateProject(importedPatch(base, patch)), undefined, label);
    await assert.rejects(parseProjectFile(file(importedPatch(base, patch))), undefined, label);
    const api = agent(base);
    await assert.rejects(api.tool('floc_update_layer').execute({ id: 'background', patch }), undefined, label);
    assert.deepEqual(api.get(), base, 'a failed agent edit never changes the project');
  }
  for (const textureLayout of TEXTURE_LAYOUTS) for (const textureDistribution of TEXTURE_DISTRIBUTIONS) {
    for (const end of [0, 1]) {
      const patch = { textureLayout, textureDistribution, textureDensity: TEXTURE_LAYOUT_LIMITS.density[end],
        textureColumns: TEXTURE_LAYOUT_LIMITS.count[end], textureRows: TEXTURE_LAYOUT_LIMITS.count[1 - end],
        textureElementSize: TEXTURE_LAYOUT_LIMITS.elementSize[end], textureMargin: TEXTURE_LAYOUT_LIMITS.margin[end] };
      const changed = patchLayer(base, 'background', patch);
      assert.deepEqual(settings(changed), patch);
      assert.deepEqual(await parseProjectFile(file(changed)), changed);
      const api = agent(base);
      await api.tool('floc_update_layer').execute({ id: 'background', patch });
      assert.deepEqual(api.get(), changed);
    }
  }
  assert.throws(() => patchLayer(demoProject(), 'headline', { textureDensity: 1 }), /Unknown layer property/);
});

test('texture layout fields are static and remain shared through linked format edits and resets', () => {
  const patch = { textureLayout: 'fit', textureDistribution: 'manual', textureDensity: 1.4,
    textureColumns: 37, textureRows: 11, textureElementSize: .65, textureMargin: .12 };
  let project = linkFormats(patchLayer(blankProject(), 'background', { mode: 'procedural', pattern: 'settle' }));
  project = patchLayer(switchFormat(project, 'portrait'), 'background', patch);
  for (const format of Object.keys(FORMATS)) {
    project = switchFormat(project, format);
    assert.deepEqual(settings(project), patch, format);
    assert.deepEqual(settings(resetFormat(project)), patch, `${format} reset`);
    for (const snapshot of Object.values(project.linkedFormats.layouts)) {
      for (const field of fields) assert.equal(Object.hasOwn(snapshot.layers.background, field), false, field);
    }
  }
  assert.deepEqual(settings(unlinkFormats(project)), patch);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
  for (const field of fields) {
    const state = { id: 'state', time: 0, easing: 'linear', values: { [field]: patch[field] } };
    assert.throws(() => patchLayer(project, 'background', { choreography: [state] }), /Invalid choreography values/, field);
  }
});

test('locks protect shared texture settings even when format exceptions are allowed', async () => {
  const base = patchLayer(blankProject(), 'background', { mode: 'procedural', pattern: 'warp', locked: true });
  const patch = { textureLayout: 'fit', textureDistribution: 'manual', textureDensity: 1.2,
    textureColumns: 9, textureRows: 7, textureElementSize: .5, textureMargin: .1 };
  for (const field of fields) {
    const change = { [field]: patch[field] };
    assert.throws(() => patchLayer(base, 'background', change), /Unlock/, field);
    const edited = validateProject(importedPatch(base, change));
    assert.throws(() => assertLocksRespected(base, edited), /Unlock/, field);
    assert.throws(() => assertLocksRespected(base, edited, { allow: ['format'] }), /Unlock/, field);
    const api = agent(base);
    await assert.rejects(api.tool('floc_update_layer').execute({ id: 'background', patch: change }), /Unlock/, field);
  }
});

