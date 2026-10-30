import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProject, validateProject, patchLayer, linkFormats, switchFormat, resizeDuration } from '../src/project.js';
import { DEFAULT_DATA_FLOW, DATA_FLOW_RANGES, dataFlowLayer } from '../src/data-flow-style.js';
import { captureState, evaluateChoreography } from '../src/choreography.js';
import { newEffect } from '../src/effects.js';
import { createTools } from '../src/webmcp.js';

const projectWithFlow = () => validateProject({ ...blankProject(), layers: [dataFlowLayer(12, 'flow')] });

test('Data flow validates a closed procedural style and never accepts sources or model settings', () => {
  const project = projectWithFlow();
  assert.equal(project.layers[0].space, 'flat');
  assert.deepEqual(project.layers[0].flowStyle, DEFAULT_DATA_FLOW);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
  for (const patch of [{ src: '' }, { src: '/demo/poster-1.svg' }, { modelStyle: {} }, { flowStyle: { unknown: 1 } }, { flowStyle: null }, { flowStyle: { seed: 1.5 } }, { flowStyle: { lineColor: '#fff' } }, { flowStyle: { spread: 10, pinchWidth: 11 } }, { x: -1001 }, { y: 1001 }, { size: 1 }]) {
    assert.throws(() => validateProject({ ...project, layers: [{ ...project.layers[0], ...patch }] }));
    assert.throws(() => patchLayer(project, 'flow', patch));
  }
  const background = blankProject();
  assert.throws(() => validateProject({ ...background, layers: [{ ...background.layers[0], flowStyle: {} }] }));
  const styled = Object.create({ seed: 1 });
  assert.throws(() => patchLayer(project, 'flow', { flowStyle: styled }));
  for (const [key, [min, max]] of Object.entries(DATA_FLOW_RANGES)) {
    for (const value of [min, max]) {
      const flowStyle = { ...DEFAULT_DATA_FLOW, [key]: value, ...(key === 'pinchWidth' ? { spread: 100 } : {}) };
      assert.equal(patchLayer(project, 'flow', { flowStyle }).layers[0].flowStyle[key], value);
    }
    for (const value of [min - 1, max + 1, NaN, Infinity, '1']) assert.throws(() => patchLayer(project, 'flow', { flowStyle: { ...DEFAULT_DATA_FLOW, [key]: value } }));
  }
});

test('Data flow consumes effects, fades, full-pose choreography and locks', () => {
  let project = patchLayer(projectWithFlow(), 'flow', { effects: [newEffect('blur')], opacity: .8, fadeIn: .5, fadeOut: .5, x: -1000, y: 1000, size: 500, z: 100, tilt: 20, yaw: 30, roll: 40 });
  const flow = project.layers[0];
  const first = captureState(flow, 0, 24, {}, 'first', { all: true })[0];
  const last = captureState({ ...flow, x: 0, z: 200, yaw: 90, opacity: .4 }, 4, 24, {}, 'last', { all: true })[0];
  project = patchLayer(project, 'flow', { choreography: [first, last] });
  const evaluated = evaluateChoreography(project.layers[0], 4);
  assert.equal(evaluated.x, 0);
  assert.equal(evaluated.z, 200);
  assert.equal(evaluated.yaw, 90);
  assert.equal(evaluated.opacity, .4);
  assert.deepEqual(evaluated.flowStyle, DEFAULT_DATA_FLOW);
  assert.equal(evaluated.effects[0].type, 'blur');
  project = patchLayer(project, 'flow', { locked: true });
  assert.throws(() => patchLayer(project, 'flow', { flowStyle: { speed: 2 } }), /Unlock/);
  assert.equal(patchLayer(project, 'flow', { visible: false }).layers[0].visible, false);
  assert.equal(resizeDuration(project, 6).layers[0].end, 6);
});

test('Data flow style stays shared while presentation and pose stay format-local', () => {
  let project = linkFormats(projectWithFlow());
  project = switchFormat(project, 'portrait');
  project = patchLayer(project, 'flow', { space: 'spatial', x: 12, y: 18, size: 70, z: 90, tilt: 15, yaw: 25, roll: 35, flowStyle: { ...DEFAULT_DATA_FLOW, speed: -2, seed: 12 } });
  const portrait = structuredClone(project.layers[0]);
  project = switchFormat(project, 'square');
  assert.equal(project.layers[0].space, 'flat');
  assert.equal(project.layers[0].x, 0);
  assert.equal(project.layers[0].z, 0);
  assert.equal(project.layers[0].flowStyle.speed, -2);
  project = patchLayer(project, 'flow', { flowStyle: { ...project.layers[0].flowStyle, noise: 4 } });
  project = switchFormat(project, 'portrait');
  for (const key of ['space', 'x', 'y', 'size', 'z', 'tilt', 'yaw', 'roll']) assert.equal(project.layers[0][key], portrait[key]);
  assert.equal(project.layers[0].flowStyle.noise, 4);
  assert.equal(project.layers[0].flowStyle.seed, 12);
});

test('WebMCP creates, updates and saves Data flow through reversible mutations', async () => {
  let project = validateProject(blankProject());
  const saved = [];
  const tools = createTools({ get: () => project, set: next => { project = next; }, save: async () => { saved.push(JSON.stringify(project)); }, audit() {} });
  const call = (name, args) => tools.find(tool => tool.name === name).execute(args);
  await call('floc_add_data_flow', { flowStyle: { seed: 99 } });
  const flow = project.layers.at(-1);
  assert.equal(flow.type, 'dataflow');
  assert.equal(flow.space, 'flat');
  assert.equal(flow.end, project.duration);
  assert.equal(flow.flowStyle.seed, 99);
  assert.equal(project.layers[0].type, 'background');
  await call('floc_update_layer', { id: flow.id, patch: { space: 'spatial', z: 80, flowStyle: { ...flow.flowStyle, speed: 0 } } });
  assert.equal(project.layers.at(-1).flowStyle.speed, 0);
  assert.deepEqual(validateProject(JSON.parse(saved.at(-1))), project);
  for (const args of [{ src: '' }, { modelStyle: {} }, { flowStyle: { unknown: true } }]) await assert.rejects(call('floc_add_data_flow', args));
  await call('floc_update_layer', { id: flow.id, patch: { locked: true } });
  const saves = saved.length;
  await assert.rejects(call('floc_update_layer', { id: flow.id, patch: { flowStyle: { speed: 1 } } }), /Unlock/);
  assert.equal(saved.length, saves);
});
