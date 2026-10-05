import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, validateProject, patchLayer, layerAlpha, resizeDuration, duplicateLayer, fileLayer } from '../src/project.js';
import { CHOREOGRAPHY_EASINGS, choreographyFields, evaluateChoreography, captureState, stateAtTime, moveState } from '../src/choreography.js';
import { editClip } from '../src/editor-controls.js';
import { createTools } from '../src/webmcp.js';

const getLayer = (project, id = 'carousel') => project.layers.find(layer => layer.id === id);
const snapshot = (layer, patch = {}) => Object.fromEntries(Object.keys(choreographyFields(layer)).map(field => [field, Object.hasOwn(patch, field) ? patch[field] : layer[field] ?? 1]));
const state = (layer, id, time, patch = {}, easing = 'linear') => ({ id, time, easing, values: snapshot(layer, patch) });

test('version-one projects migrate visual defaults without changing legacy geometry or timing', () => {
  const raw = demoProject();
  const original = structuredClone(raw);
  const migrated = validateProject(raw);
  assert.deepEqual(raw, original);
  for (const layer of migrated.layers) {
    if (Object.keys(choreographyFields(layer)).length) {
      assert.equal(layer.opacity, 1);
      assert.deepEqual(layer.choreography, []);
      assert.equal(evaluateChoreography(layer, 7), layer);
      for (const field of ['x', 'y', 'size', 'start', 'end']) assert.equal(layer[field], getLayer(raw, layer.id)[field]);
    } else {
      assert.equal(Object.hasOwn(layer, 'opacity'), layer.type === 'background');
      if (layer.type === 'background') assert.equal(layer.opacity, 1);
      assert.equal(Object.hasOwn(layer, 'choreography'), false);
    }
  }
  assert.deepEqual(validateProject(migrated), migrated);
});

test('choreography snapshots use complete type-specific numeric fields and bounds', () => {
  const p = validateProject(demoProject());
  const model = fileLayer({ src: '/assets/12345678-1234-1234-1234-123456789012.glb', name: 'Model' }, 12, 'model');
  const media = fileLayer({ src: '/assets/12345678-1234-1234-1234-123456789012.png', name: 'Image' }, 12, 'media');
  for (const layer of [...p.layers.filter(l => Object.keys(choreographyFields(l)).length), model, media]) {
    const authored = { ...layer, choreography: [state(layer, 'first', 0), state(layer, 'last', 12)] };
    assert.doesNotThrow(() => validateProject({ ...p, layers: [authored] }));
    for (const [field, [min, max]] of Object.entries(choreographyFields(layer))) {
      for (const value of [min, max]) assert.doesNotThrow(() => validateProject({ ...p, layers: [{ ...authored, choreography: [state(layer, 'first', 0, { [field]: value })] }] }));
      for (const value of [min - 0.1, max + 0.1, NaN, Infinity, String(min)]) assert.throws(() => validateProject({ ...p, layers: [{ ...authored, choreography: [state(layer, 'first', 0, { [field]: value })] }] }), /State .* must be between/);
    }
  }
});

test('imports reject malformed states, unsupported fields, duplicate identities and unordered times', () => {
  const p = validateProject(demoProject()), layer = getLayer(p);
  const first = state(layer, 'first', 0);
  const malformed = [null, {}, 'states', [null], [{ ...first, id: '' }], [{ ...first, id: '  ' }], [{ ...first, id: 'x'.repeat(81) }], [{ ...first, time: -1 }], [{ ...first, time: 31 }], [{ ...first, time: NaN }], [{ ...first, time: Infinity }], [{ ...first, easing: 'script' }], [{ ...first, values: null }], [{ ...first, values: [] }], [{ ...first, values: { x: 50 } }], [{ ...first, values: { ...first.values, shader: 'wave' } }], [{ ...first, eval: 'code' }], [first, { ...first, time: 1 }], [first, { ...first, id: 'second' }], [state(layer, 'late', 4), first], Array.from({ length: 33 }, (_, i) => state(layer, `s${i}`, i * 0.1))];
  for (const choreography of malformed) assert.throws(() => patchLayer(p, layer.id, { choreography }));
  for (const id of ['background', 'music']) {
    for (const patch of [...(id === 'music' ? [{ opacity: 0.5 }] : []), { choreography: [] }, { choreography: [first] }]) {
      assert.throws(() => patchLayer(p, id, patch), /Unknown layer property/);
      const raw = structuredClone(p); Object.assign(getLayer(raw, id), patch);
      assert.throws(() => validateProject(raw), /Only visual layers|cannot have choreography/);
    }
  }
  const textState = state(getLayer(p, 'headline'), 'first', 0); textState.values.yaw = 20;
  assert.throws(() => patchLayer(p, 'headline', { choreography: [textState] }), /Invalid choreography values/);
});

test('poses interpolate position, size, opacity and direct orientation with destination easing', () => {
  const layer = getLayer(validateProject(demoProject()));
  const from = state(layer, 'start', 0, { x: 10, y: 20, size: 0.5, opacity: 0, tilt: -65, yaw: -170, roll: 170 }, 'ease-in');
  const to = state(layer, 'end', 4, { x: 90, y: 80, size: 2.5, opacity: 1, tilt: 65, yaw: 170, roll: -170 });
  const expected = { linear: 0.25, smooth: 0.15625, 'ease-in': 0.0625, 'ease-out': 0.4375 };
  for (const [easing] of CHOREOGRAPHY_EASINGS) {
    const authored = { ...layer, start: 2, end: 8, choreography: [from, { ...to, easing }] };
    const pose = evaluateChoreography(authored, 3);
    for (const field of Object.keys(choreographyFields(layer))) assert.equal(pose[field], from.values[field] + (to.values[field] - from.values[field]) * expected[easing]);
    assert.equal(pose.template, authored.template);
    assert.equal(evaluateChoreography(authored, 1).x, 10);
    assert.equal(evaluateChoreography(authored, 6).x, 90);
    assert.equal(evaluateChoreography(authored, 9).x, 90);
  }
  assert.equal(evaluateChoreography({ ...layer, choreography: [from, to] }, 2).yaw, 0);
});

test('seeking in arbitrary order does not mutate authored poses or retain motion state', () => {
  const layer = getLayer(validateProject(demoProject()));
  const authored = { ...layer, choreography: [state(layer, 'a', 1, { x: 10 }), state(layer, 'b', 7, { x: 90 }, 'smooth')] };
  const before = structuredClone(authored);
  const expected = new Map([0, 1, 2, 4, 7, 9].map(time => [time, evaluateChoreography(authored, time)]));
  for (const time of [7, 0, 4, 9, 1, 2, 4, 0]) assert.deepEqual(evaluateChoreography(authored, time), expected.get(time));
  assert.deepEqual(authored, before);
});

test('animated opacity multiplies fades and respects visibility and clip boundaries', () => {
  const layer = getLayer(validateProject(demoProject()), 'logo');
  const authored = { ...layer, start: 2, end: 6, fadeIn: 1, fadeOut: 1, opacity: 0.9, choreography: [state(layer, 'a', 0, { opacity: 0.2 }), state(layer, 'b', 4, { opacity: 0.6 })] };
  assert.equal(layerAlpha(authored, 2.5), 0.125);
  assert.equal(layerAlpha(authored, 4), 0.4);
  assert.ok(Math.abs(layerAlpha(authored, 5.5) - 0.275) < 1e-12);
  assert.equal(layerAlpha(authored, 1.99), 0);
  assert.equal(layerAlpha(authored, 6), 0);
  assert.equal(layerAlpha({ ...authored, visible: false }, 4), 0);
  assert.equal(layerAlpha({ ...layer, fadeIn: 0, fadeOut: 0, opacity: 0.3 }, 4), 0.3);
});

test('capture saves evaluated complete poses and updates the same frame identity and easing', () => {
  const layer = getLayer(validateProject(demoProject()));
  const authored = { ...layer, start: 2, end: 8, choreography: [state(layer, 'a', 0, { x: 10 }), state(layer, 'b', 4, { x: 90 }, 'ease-out')] };
  const captured = captureState(authored, 4.01, 24, { y: 60 }, 'middle');
  const middle = captured[1];
  assert.equal(middle.time, 2);
  assert.equal(middle.values.x, 70);
  assert.equal(middle.values.y, 60);
  assert.equal(middle.easing, 'smooth');
  assert.deepEqual(Object.keys(middle.values).sort(), Object.keys(choreographyFields(layer)).sort());
  const updated = captureState({ ...authored, choreography: captured.map(s => s.id === 'middle' ? { ...s, easing: 'ease-in' } : s) }, 4.015, 24, { size: 2 }, 'unused');
  assert.equal(updated.length, 3);
  assert.equal(updated[1].id, 'middle');
  assert.equal(updated[1].easing, 'ease-in');
  assert.equal(updated[1].values.size, 2);
  assert.equal(stateAtTime({ ...authored, choreography: updated }, 4.015, 24), updated[1]);
  assert.equal(stateAtTime(authored, 5, 24), undefined);
  assert.deepEqual(captureState({ ...layer, choreography: [] }, -10, 24, {}, 'first').map(s => s.time), [0]);
  assert.deepEqual(captureState({ ...layer, start: 3, end: 3.02, choreography: [] }, 20, 24, {}, 'first').map(s => s.time), [0]);
  assert.throws(() => captureState(layer, 2, 24, { speed: 2 }), /Invalid choreography values/);
});

test('imported off-frame states retain their ordering when captured or dragged', () => {
  const layer = getLayer(validateProject(demoProject()));
  const authored = { ...layer, choreography: [state(layer, 'a', 0.99), state(layer, 'b', 1.01), state(layer, 'c', 2.01)] };
  const captured = captureState(authored, 1, 24, { x: 60 });
  assert.deepEqual(captured.map(s => [s.id, s.time]), [['a', 0.99], ['b', 1.01], ['c', 2.01]]);
  assert.equal(captured[0].values.x, 60);
  assert.doesNotThrow(() => patchLayer(validateProject(demoProject()), layer.id, { choreography: captured }));
  const moved = moveState(authored, 'b', 0, 24);
  assert.equal(moved[1].time, 25 / 24);
  assert(moved[1].time > moved[0].time);
  assert.notEqual(Math.round(moved[1].time * 24), Math.round(moved[0].time * 24));
});

test('states sharing a rounded frame retain exact identities after changing frame rate', () => {
  const p = validateProject(demoProject()), layer = getLayer(p);
  const authored = patchLayer({ ...p, fps: 60 }, layer.id, { start: 2.1, choreography: [state(layer, 'a', 59 / 60, { x: 20 }), state(layer, 'b', 1, { x: 80 }, 'ease-out')] });
  const changed = getLayer(validateProject({ ...authored, fps: 24 }));
  for (const selected of changed.choreography) {
    assert.equal(stateAtTime(changed, changed.start + selected.time, 24), selected);
    const captured = captureState(changed, changed.start + selected.time, 24, { x: 60 }, 'unused');
    const updated = captured.find(s => s.id === selected.id);
    assert.equal(updated.values.x, 60);
    assert.equal(updated.time, selected.time);
    assert.equal(updated.easing, selected.easing);
    assert.deepEqual(captured.find(s => s.id !== selected.id), changed.choreography.find(s => s.id !== selected.id));
  }
});

test('clicking adjacent imported times edits their exact states before frame quantization', () => {
  const layer = getLayer(validateProject(demoProject()));
  const authored = { ...layer, start: 0.3, choreography: [state(layer, 'a', 0.99, { x: 20 }), state(layer, 'b', 1.01, { x: 80 }, 'ease-in')] };
  for (const selected of authored.choreography) {
    assert.equal(stateAtTime(authored, authored.start + selected.time, 24), selected);
    const captured = captureState(authored, authored.start + selected.time, 24, { x: 60 }, 'unused');
    assert.equal(captured.find(s => s.id === selected.id).values.x, 60);
    assert.deepEqual(captured.find(s => s.id !== selected.id), authored.choreography.find(s => s.id !== selected.id));
  }
  assert.equal(stateAtTime(authored, authored.start + 1, 24), authored.choreography[0]);
  assert.equal(captureState(authored, authored.start + 1, 24, { x: 60 })[0].values.x, 60);
});

test('state dragging quantizes frames and prevents collisions or crossing clip boundaries', () => {
  const layer = getLayer(validateProject(demoProject()));
  const authored = { ...layer, end: 6, choreography: [state(layer, 'a', 0), state(layer, 'b', 2), state(layer, 'c', 4)] };
  assert.equal(moveState(authored, 'b', 0, 24)[1].time, 1 / 24);
  assert.equal(moveState(authored, 'b', 9, 24)[1].time, 95 / 24);
  assert.equal(moveState(authored, 'c', 9, 24)[2].time, 6);
  assert.equal(moveState(authored, 'b', 2.11, 24)[1].time, 51 / 24);
  const crowded = { ...authored, choreography: [state(layer, 'a', 0), state(layer, 'b', 0.01), state(layer, 'c', 0.02)] };
  assert.equal(moveState(crowded, 'b', 4, 24), crowded.choreography);
  assert.throws(() => moveState(authored, 'unknown', 3, 24), /State not found/);
  assert.throws(() => moveState(authored, 'b', NaN, 24), /finite/);
});

test('clip moves shift choreography in absolute time and trimming preserves authored states', () => {
  let p = validateProject(demoProject());
  let layer = getLayer(p, 'logo');
  p = patchLayer(p, layer.id, { start: 1, end: 7, choreography: [state(layer, 'a', 0, { x: 10 }), state(layer, 'b', 6, { x: 70 })] });
  layer = getLayer(p, 'logo');
  const pose = evaluateChoreography(layer, 3).x;
  const moved = getLayer(patchLayer(p, layer.id, editClip(layer, 'move', 2, p.duration, p.fps)), layer.id);
  assert.equal(evaluateChoreography(moved, 5).x, pose);
  assert.deepEqual(moved.choreography, layer.choreography);
  const trimmed = getLayer(patchLayer(p, layer.id, { end: 3 }), layer.id);
  assert.deepEqual(trimmed.choreography, layer.choreography);
  assert.equal(evaluateChoreography(trimmed, 2).x, 20);
  const shorter = getLayer(resizeDuration(p, 3), layer.id);
  assert.deepEqual(shorter.choreography, layer.choreography);
  assert.equal(getLayer(resizeDuration(resizeDuration(p, 3), 12), layer.id).choreography[1].time, 6);
});

test('duplicate layers preserve independent state snapshots and locks prevent choreography edits', () => {
  const p = validateProject(demoProject()), layer = getLayer(p);
  const authored = patchLayer(p, layer.id, { opacity: 0.7, choreography: [state(layer, 'first', 0)] });
  const duplicate = duplicateLayer(authored, layer.id, 'copy');
  assert.deepEqual(getLayer(duplicate, 'copy').choreography, getLayer(authored).choreography);
  assert.equal(getLayer(duplicate, 'copy').opacity, 0.7);
  getLayer(duplicate, 'copy').choreography[0].values.x = 20;
  assert.equal(getLayer(duplicate).choreography[0].values.x, layer.x);
  assert.equal(getLayer(authored).choreography[0].values.x, layer.x);
  const locked = patchLayer(authored, layer.id, { locked: true });
  for (const patch of [{ choreography: [] }, { opacity: 0.2 }, { locked: false, choreography: [] }]) assert.throws(() => patchLayer(locked, layer.id, patch), /Unlock/);
});

test('WebMCP choreography edits pass shared validation and rejected edits never save', async () => {
  let p = validateProject(demoProject()), saves = 0;
  const tools = createTools({ get: () => p, set: next => { p = next; }, save: async () => saves++, audit() {} });
  const update = patch => tools.find(tool => tool.name === 'floc_update_layer').execute({ id: 'carousel', patch });
  const layer = getLayer(p);
  await update({ choreography: [state(layer, 'first', 0), state(layer, 'last', 8, { opacity: 0.5 })] });
  assert.equal(saves, 1);
  assert.equal(layerAlpha(getLayer(p), 4), 0.75);
  await assert.rejects(update({ choreography: [state(layer, 'first', 0, { opacity: 2 })] }), /State opacity/);
  assert.equal(saves, 1);
  await update({ locked: true });
  await assert.rejects(update({ opacity: 0 }), /Unlock/);
  assert.equal(saves, 2);
});
