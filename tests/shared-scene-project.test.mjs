import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { demoProject, blankProject, fileLayer, validateProject, patchScene, patchLayer, linkFormats, switchFormat, assertLocksRespected } from '../src/project.js';
import { migrateProject } from '../src/project-migrations.js';
import { captureState, evaluateChoreography } from '../src/choreography.js';
import { DEFAULT_SCENE, SPATIAL_LAYER_TYPES, normalizeScene, assertPlainSceneRecord } from '../src/scene-settings.js';
import { createTools } from '../src/webmcp.js';
import { parseProjectFile } from '../src/editor/project-import.js';

const layer = (project, id = 'headline') => project.layers.find(item => item.id === id);
const modelAsset = { name: 'Model', src: '/assets/12345678-1234-1234-1234-123456789012.glb' };

function legacyProject() {
  let project = validateProject(demoProject());
  project.layers.push(fileLayer(modelAsset, project.duration, 'model'));
  project = patchLayer(project, 'headline', { roll: 27, choreography: captureState(layer(project), 1.125, project.fps, { x: 23, opacity: .4 }, 'title') });
  project = patchLayer(project, 'carousel', { perspective: 62, tilt: -23, yaw: 34, choreography: captureState(layer(project, 'carousel'), 2, project.fps, { yaw: 61 }, 'cards') });
  project = linkFormats(project);
  project = patchLayer(switchFormat(project, 'portrait'), 'headline', { roll: -19, choreography: captureState(layer(switchFormat(project, 'portrait')), 1.125, project.fps, { x: 41, roll: -19 }, 'title') });
  project.version = 13;
  delete project.scene;
  const strip = (local, type) => {
    delete local.space; delete local.z;
    if (['text', 'logo', 'media'].includes(type)) { delete local.tilt; delete local.yaw; }
  };
  for (const item of project.layers) {
    if (!SPATIAL_LAYER_TYPES.includes(item.type)) continue;
    strip(item, item.type);
    for (const state of item.choreography) strip(state.values, item.type);
  }
  for (const snapshot of Object.values(project.linkedFormats.layouts)) {
    delete snapshot.scene;
    for (const [id, local] of Object.entries(snapshot.layers)) {
      const type = layer(project, id).type;
      if (!SPATIAL_LAYER_TYPES.includes(type)) continue;
      strip(local, type);
      for (const values of Object.values(local.choreography ?? {})) strip(values, type);
    }
  }
  return project;
}

test('v13 visual presentations and every linked pose migrate to Flat without changing authored values', async () => {
  const old = legacyProject(), before = structuredClone(old);
  const migrated = validateProject(old);
  assert.equal(migrated.version, 14);
  assert.deepEqual(migrated.scene, DEFAULT_SCENE);
  for (const source of old.layers) {
    const destination = layer(migrated, source.id);
    for (const [key, value] of Object.entries(source)) {
      if (key !== 'choreography') assert.deepEqual(destination[key], value, `${source.id}.${key}`);
      else for (const state of value) {
        const next = destination.choreography.find(item => item.id === state.id);
        assert.deepEqual([next.id, next.time, next.easing], [state.id, state.time, state.easing]);
        for (const [field, setting] of Object.entries(state.values)) assert.deepEqual(next.values[field], setting);
        assert.equal(next.values.z, 0);
      }
    }
    if (SPATIAL_LAYER_TYPES.includes(source.type)) { assert.equal(destination.space, 'flat'); assert.equal(destination.z, 0); }
  }
  for (const [format, snapshot] of Object.entries(old.linkedFormats.layouts)) {
    const next = migrated.linkedFormats.layouts[format];
    assert.deepEqual(next.scene, DEFAULT_SCENE);
    for (const [id, local] of Object.entries(snapshot.layers)) {
      for (const [key, value] of Object.entries(local)) {
        if (key !== 'choreography') assert.deepEqual(next.layers[id][key], value);
        else for (const [state, values] of Object.entries(value)) {
          for (const [field, setting] of Object.entries(values)) assert.deepEqual(next.layers[id].choreography[state][field], setting);
          assert.equal(next.layers[id].choreography[state].z, 0);
        }
      }
      if (SPATIAL_LAYER_TYPES.includes(layer(old, id).type)) assert.equal(next.layers[id].space, 'flat');
    }
  }
  assert.deepEqual(old, before);
  assert.deepEqual(validateProject(migrated), migrated);
  assert.deepEqual(migrateProject(migrated), migrated);
  const json = JSON.stringify(old);
  const imported = await parseProjectFile({ size: Buffer.byteLength(json), text: async () => json });
  assert.deepEqual(imported, migrated);
});

test('new layers are Spatial and Flat conversion retains independent camera settings', () => {
  const project = validateProject({ ...blankProject(), layers: [fileLayer(modelAsset, 12, 'model'), ...demoProject().layers] });
  for (const item of project.layers.filter(item => SPATIAL_LAYER_TYPES.includes(item.type))) assert.equal(item.space, 'spatial');
  const style = { ...layer(project, 'model').modelStyle, framing: 'fixed', zoom: 1.7, perspective: 63 };
  const flat = patchLayer(project, 'model', { space: 'flat', modelStyle: style });
  const converted = patchLayer(patchLayer(flat, 'model', { space: 'spatial', z: 67 }), 'model', { space: 'flat' });
  assert.deepEqual(layer(converted, 'model').modelStyle, style);
});

test('explicit spatial edits apply after migration for legacy in-memory layers and remain format-local', () => {
  const old = legacyProject(), before = structuredClone(old);
  const converted = patchLayer(old, 'headline', { space: 'spatial', z: 67, tilt: 31, yaw: -24 });
  assert.deepEqual(
    ['space', 'z', 'tilt', 'yaw'].map(key => layer(converted)[key]),
    ['spatial', 67, 31, -24]
  );
  assert(converted.layers.filter(item => SPATIAL_LAYER_TYPES.includes(item.type) && item.id !== 'headline').every(item => item.space === 'flat'));
  const square = switchFormat(converted, 'square');
  assert.equal(layer(square).space, 'flat');
  assert.equal(layer(square).z, 0);
  assert.deepEqual(switchFormat(square, converted.format), converted);
  const moved = patchLayer(old, 'model', { space: 'spatial', z: -46 });
  assert.equal(layer(moved, 'model').space, 'spatial');
  assert.equal(layer(moved, 'model').z, -46);
  assert.deepEqual(layer(moved, 'model').modelStyle, layer(old, 'model').modelStyle);
  assert.deepEqual(old, before);
});

test('scene camera, depth, graphic angles and keyframes stay format-local while content and modelStyle stay shared', () => {
  let project = linkFormats(validateProject({ ...demoProject(), layers: [...demoProject().layers, fileLayer(modelAsset, 12, 'model')] }));
  const square = structuredClone(project);
  project = switchFormat(project, 'portrait');
  project = patchScene(project, { camera: { projection: 'perspective', yaw: 35, targetZ: 20 } });
  project = patchLayer(project, 'headline', { space: 'flat', z: -45, tilt: 29, yaw: -17, text: 'Shared content', choreography: captureState(layer(project), 1, project.fps, { z: 90, tilt: 45 }, 'title') });
  const modelStyle = { ...layer(project, 'model').modelStyle, zoom: 1.8, perspective: 61, color: '#123456' };
  project = patchLayer(project, 'model', { modelStyle });
  const portrait = structuredClone(project);
  project = switchFormat(project, 'square');
  assert.deepEqual(project.scene, square.scene);
  for (const field of ['space', 'z', 'tilt', 'yaw']) assert.equal(layer(project)[field], layer(square)[field]);
  assert.equal(layer(project).text, 'Shared content');
  assert.deepEqual(layer(project, 'model').modelStyle, modelStyle);
  project = switchFormat(project, 'portrait');
  assert.deepEqual(project.scene, portrait.scene);
  assert.deepEqual(layer(project), layer(portrait));
  assert.equal(layer(project).choreography[0].values.z, 90);
  assert.equal(layer(project).choreography[0].values.tilt, 45);
});

test('ordinary records from another realm validate projects, cameras and layer patches', () => {
  const source = demoProject();
  const project = linkFormats(patchLayer(source, 'headline', {
    choreography: captureState(layer(source), 1, source.fps, { z: 35 }, 'title')
  }));
  const foreign = runInNewContext('JSON.parse(json)', { json: JSON.stringify(project) });
  assert.notEqual(Object.getPrototypeOf(foreign), Object.prototype);
  assert.equal(assertPlainSceneRecord(foreign), foreign);
  assert.deepEqual(validateProject(foreign), project);

  const scenePatch = runInNewContext('({ camera: Object.freeze({ yaw: 22, zoom: 1.5 }) })');
  assert.deepEqual(patchScene(foreign, scenePatch), patchScene(project, { camera: { yaw: 22, zoom: 1.5 } }));
  assert.deepEqual(normalizeScene(scenePatch), normalizeScene({ camera: { yaw: 22, zoom: 1.5 } }));
  const layerPatch = runInNewContext('({ z: 27, tilt: -12 })');
  assert.deepEqual(patchLayer(foreign, 'headline', layerPatch), patchLayer(project, 'headline', { z: 27, tilt: -12 }));
  const nullPrototypePatch = runInNewContext('Object.assign(Object.create(null), { z: 27 })');
  assert.equal(assertPlainSceneRecord(nullPrototypePatch), nullPrototypePatch);
  assert.deepEqual(patchLayer(foreign, 'headline', nullPrototypePatch), patchLayer(project, 'headline', { z: 27 }));
});

test('foreign legacy motion records migrate before their curve names are validated', () => {
  const project = validateProject(demoProject());
  project.version = 5;
  const carousel = layer(project, 'carousel');
  carousel.motion = { ...carousel.motion, curve: 'smooth', intensity: .7 };
  carousel.motionBaseline.motion = { ...carousel.motionBaseline.motion, curve: 'elastic', intensity: .8 };
  const foreign = runInNewContext('JSON.parse(json)', { json: JSON.stringify(project) });
  assert.deepEqual(validateProject(foreign), validateProject(project));
});

test('foreign exotic and forged prototypes and unsafe descriptors reject without invoking getters', () => {
  const project = linkFormats(demoProject()), before = structuredClone(project);
  const fixture = runInNewContext(`(() => {
    let reads = 0;
    const forgedPrototype = Object.create(null, Object.getOwnPropertyDescriptors(Object.prototype));
    const constructorAccessor = Object.create(null, {
      constructor: { get() { reads++; return Object; }, configurable: true }
    });
    function FakeObject() {}
    FakeObject.prototype = Object.create(null);
    Object.defineProperty(FakeObject.prototype, 'constructor', { value: FakeObject, writable: true, configurable: true });
    FakeObject.toString = () => { reads++; return Function.prototype.toString.call(Object); };
    return {
      records: [
        [], new Map(), new Date(), new (class Custom {})(),
        Object.create({ yaw: 20 }), Object.create(Object.create(null)),
        Object.create(Object.assign(Object.create(null), { constructor: Object })),
        Object.create(forgedPrototype), Object.create(constructorAccessor), new FakeObject(),
        { [Symbol('yaw')]: 20 },
        JSON.parse('{"__proto__":{}}'), { constructor: Object }, { prototype: {} },
        Object.defineProperty({}, 'yaw', { value: 20 }),
        Object.defineProperty({}, 'yaw', { get() { reads++; return 20; }, enumerable: true })
      ],
      reads: () => reads
    };
  })()`);
  for (const record of fixture.records) {
    assert.throws(() => assertPlainSceneRecord(record), /Invalid scene settings/);
    assert.throws(() => validateProject(record), /Invalid project/);
    assert.throws(() => patchScene(project, record), /Invalid scene patch/);
    assert.throws(() => patchScene(project, { camera: record }), /Invalid scene camera/);
    assert.throws(() => patchLayer(project, 'headline', record), /Invalid layer patch/);
    assert.throws(() => validateProject({ ...project, scene: { camera: record } }), /Invalid scene camera/);
    assert.throws(() => validateProject({ ...project, layers: [...project.layers, record] }), /Invalid layer/);
    const cached = structuredClone(project);
    cached.linkedFormats.layouts.portrait.scene.camera = record;
    assert.throws(() => validateProject(cached), /Invalid linked format object/);
  }
  assert.equal(fixture.reads(), 0);
  assert.deepEqual(project, before);
});

test('unsafe and malformed spatial inputs reject before cloning or mutation', () => {
  const project = validateProject(demoProject()), before = structuredClone(project);
  for (const camera of [null, [], new Map(), new Date(), Object.create({ yaw: 20 }), { [Symbol('yaw')]: 20 }, { zoom: NaN }, { yaw: Infinity }, { pitch: 86 }, { targetZ: -1001 }, { projection: 'ortho' }, { navigation: true }, JSON.parse('{"__proto__":{}}'), { get yaw() { throw new Error('Accessor was executed'); } }]) {
    assert.throws(() => patchScene(project, { camera }));
    assert.throws(() => validateProject({ ...project, scene: { camera } }));
  }
  for (const patch of [{ space: null }, { space: 'legacy' }, { z: NaN }, { z: 1001 }, { tilt: 181 }, { yaw: '0' }, { roll: null }, { [Symbol('z')]: 2 }, Object.create({ z: 2 })]) assert.throws(() => patchLayer(project, 'headline', patch));
  for (const id of ['background', 'music']) for (const patch of [{ space: 'spatial' }, { z: 1 }, { tilt: 1 }, { yaw: 1 }]) {
    assert.throws(() => patchLayer(project, id, patch));
    assert.throws(() => validateProject({ ...project, layers: project.layers.map(item => item.id === id ? { ...item, ...patch } : item) }));
  }
  const linked = linkFormats(project);
  linked.linkedFormats.layouts.portrait.scene.camera.zoom = Infinity;
  assert.throws(() => validateProject(linked));
  assert.deepEqual(project, before);
});

test('camera property names inherited from Object.prototype reject through every authored boundary', async () => {
  const project = linkFormats(demoProject()), before = structuredClone(project);
  let saves = 0;
  const tools = createTools({ get: () => project, set() { throw new Error('Invalid camera reached mutation'); }, save: async () => saves++, audit() {} });
  const cameraTool = tools.find(tool => tool.name === 'floc_set_scene_camera');
  for (const key of ['toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__defineGetter__', '__lookupGetter__']) {
    const camera = { [key]: 1 };
    assert.throws(() => normalizeScene({ camera }), /Unknown scene camera property/);
    assert.throws(() => patchScene(project, { camera }), /Unknown scene camera property/);
    assert.throws(() => validateProject({ ...project, scene: { camera } }), /Unknown scene camera property/);
    const cached = structuredClone(project);
    cached.linkedFormats.layouts.portrait.scene.camera[key] = 1;
    assert.throws(() => validateProject(cached), /Unknown scene camera property/);
    const json = JSON.stringify({ ...project, scene: { camera } });
    await assert.rejects(parseProjectFile({ size: Buffer.byteLength(json), text: async () => json }), /Unknown scene camera property/);
    await assert.rejects(cameraTool.execute(camera), /Unknown scene camera property/);
  }
  assert.equal(saves, 0);
  assert.deepEqual(project, before);
});

test('locked local framing and depth keyframes cannot be mutated through inactive caches', () => {
  const project = patchLayer(linkFormats(demoProject()), 'headline', { locked: true });
  for (const patch of [{ space: 'flat' }, { z: 20 }, { tilt: 30 }]) assert.throws(() => patchLayer(project, 'headline', patch), /Unlock/);
  const forged = structuredClone(project);
  forged.linkedFormats.layouts.portrait.layers.headline.z = 20;
  assert.throws(() => assertLocksRespected(project, validateProject(forged)), /Unlock/);
  assert.doesNotThrow(() => assertLocksRespected(project, switchFormat(project, 'portrait'), { allow: ['format'] }));
  assert.doesNotThrow(() => assertLocksRespected(project, patchScene(project, { camera: { yaw: 23 } })));
});

test('depth and graphic orientation keyframes seek deterministically and stay bounded', () => {
  let project = validateProject(demoProject());
  const first = captureState(layer(project), 0, project.fps, { z: -200, tilt: -60, yaw: -80 }, 'first');
  const last = captureState({ ...layer(project), choreography: first }, 4, project.fps, { z: 200, tilt: 60, yaw: 80 }, 'last').map(state => ({ ...state, easing: 'linear' }));
  project = patchLayer(project, 'headline', { choreography: last });
  const source = layer(project), before = structuredClone(source);
  for (const time of [4, 0, 2, 1, 2]) {
    const pose = evaluateChoreography(source, time);
    assert.equal(pose.z, -200 + time * 100);
    assert.equal(pose.tilt, -60 + time * 30);
    assert.equal(pose.yaw, -80 + time * 40);
  }
  for (const z of [1001, NaN, '1', null]) assert.throws(() => patchLayer(project, 'headline', { choreography: [{ ...last[0], values: { ...last[0].values, z } }] }));
  assert.deepEqual(source, before);
});

test('agent scene edits serialize, validate, preserve locks and never persist editor navigation', async () => {
  let project = patchLayer(linkFormats(demoProject()), 'headline', { locked: true });
  let saves = 0;
  const tools = createTools({ get: () => project, set: next => { project = next; }, save: async () => saves++, audit() {} });
  const call = (name, args) => tools.find(tool => tool.name === name).execute(args);
  const discovery = JSON.parse(await call('floc_list_effects'));
  assert(discovery.scene.layerTypes.includes('text'));
  await Promise.all([call('floc_set_scene_camera', { yaw: 12 }), call('floc_set_scene_camera', { zoom: 1.5 })]);
  assert.equal(project.scene.camera.yaw, 12);
  assert.equal(project.scene.camera.zoom, 1.5);
  assert.equal(saves, 2);
  const before = structuredClone(project);
  await assert.rejects(call('floc_update_layer', { id: 'headline', patch: { z: 20 } }), /Unlock/);
  for (const camera of [{ zoom: Infinity }, { orbit: { yaw: 45 } }, { projection: 'side' }, { targetX: 1001 }]) await assert.rejects(call('floc_set_scene_camera', camera));
  assert.deepEqual(project, before);
  assert.equal(saves, 2);
  await call('floc_add_text', { text: 'A Spatial plane', z: 35, tilt: 16 });
  assert.equal(project.layers.at(-1).space, 'spatial');
  assert.equal(project.layers.at(-1).z, 35);
  const canonical = validateProject({ ...project, sceneView: { yaw: 70 }, layers: project.layers.map(item => ({ ...item, editorView: true })) });
  assert.equal(Object.hasOwn(canonical, 'sceneView'), false);
  assert(canonical.layers.every(item => !Object.hasOwn(item, 'editorView')));
  assert.deepEqual(JSON.parse(JSON.stringify(canonical)), canonical);
  assert.deepEqual(normalizeScene({ camera: { yaw: 10 } }).camera.targetX, DEFAULT_SCENE.camera.targetX);
});
