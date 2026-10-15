import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { normalizeModelStyle, applyModelPreset, applyLightingPreset, selectedModelPreset, selectedLightingPreset, automaticModelMotion, resetModelMotion } from '../src/model-style.js';
import { getModelMetadata, registerModelMetadata, subscribeModelMetadata } from '../src/model-metadata.js';
import { DEFAULT_MOTION, MOTION_CURVES, motionEase } from '../src/motion-timing.js';

const close = (actual, expected) => { for (const key of Object.keys(expected).filter(key => Object.hasOwn(neutral, key))) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-10, `${key}: ${actual[key]} != ${expected[key]}`); };
const neutral = { rotationX: 0, rotationY: 0, rotationZ: 0, offsetX: 0, offsetY: 0, offsetZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 };

test('automatic model motion loops, reverses and freezes without accumulating pose', () => {
  for (const motion of ['spin', 'rock', 'float', 'pulse']) {
    const style = normalizeModelStyle({ motion, motionDuration: 4, motionSpeed: 1.5, motionAmplitude: .8 });
    const period = style.motionDuration / style.motionSpeed;
    close(automaticModelMotion(style, -3), neutral);
    close(automaticModelMotion(style, 0), neutral);
    close(automaticModelMotion(style, period), neutral);
    const quarter = automaticModelMotion(style, period / 4);
    close(automaticModelMotion(style, period * 3 + period / 4), quarter);
    automaticModelMotion(style, period * .9);
    close(automaticModelMotion(style, period / 4), quarter);
    close(automaticModelMotion({ ...style, motionSpeed: 0 }, 45), neutral);
    const reverse = automaticModelMotion({ ...style, motionSpeed: -style.motionSpeed }, period / 4);
    close(reverse, { rotationX: -quarter.rotationX, rotationY: -quarter.rotationY, rotationZ: -quarter.rotationZ, offsetX: -quarter.offsetX, offsetY: -quarter.offsetY, offsetZ: -quarter.offsetZ, scaleX: 2 - quarter.scaleX, scaleY: 2 - quarter.scaleY, scaleZ: 2 - quarter.scaleZ });
    if (motion === 'spin') assert.ok(quarter.rotationY > 1);
    if (motion === 'rock') assert.ok(quarter.rotationZ > .1);
    if (motion === 'float') assert.ok(quarter.offsetY > .1);
    if (motion === 'pulse') assert.ok(quarter.scaleX > 1.05 && quarter.scaleY > 1.05 && quarter.scaleZ > 1.05);
  }
});

test('material presets keep lighting, motion and embedded clip clocks; lighting presets keep the surface', () => {
  const original = normalizeModelStyle({ motion: 'spin', motionDuration: 8, motionAxis: 'x', motionSteps: 7, motionTiming: { mode: 'steps', action: .4, pause: .7, curve: 'spring', intensity: .9 }, animationClip: 3, animationSpeed: 2, keyIntensity: 6 });
  const chrome = applyModelPreset(original, 'chrome');
  assert.equal(chrome.mode, 'replace');
  assert.equal(chrome.metalness, 1);
  assert.equal(chrome.environment, original.environment, 'material presets keep the environment');
  assert.equal(chrome.keyIntensity, 6);
  assert.equal(selectedModelPreset(chrome), 'chrome');
  assert.equal(selectedModelPreset({ ...chrome, color: '#ff0040' }), 'custom');
  const restored = applyModelPreset({ ...chrome, shader: 'wireframe', environment: 'studio' }, 'original');
  assert.equal(restored.mode, 'original');
  assert.equal(restored.shader, 'standard');
  assert.equal(restored.environment, 'studio');
  assert.deepEqual([restored.motion, restored.motionDuration, restored.animationClip, restored.animationSpeed], ['spin', 8, 3, 2]);
  for (const key of ['motionAxis', 'motionSteps', 'motionTiming']) assert.deepEqual(restored[key], original[key]);
  assert.equal(selectedLightingPreset(restored), 'custom');
  const studio = applyLightingPreset(restored, 'studio');
  assert.deepEqual([studio.environment, studio.toneMapping, studio.keyIntensity, studio.mode, studio.shader], ['softbox', 'neutral', 1.6, 'original', 'standard']);
  assert.equal(selectedLightingPreset(studio), 'studio');
  const classic = applyLightingPreset(studio, 'classic');
  assert.deepEqual([classic.environment, classic.toneMapping, classic.keyIntensity, classic.keyColor], ['none', 'none', 3, '#ffffff']);
  assert.equal(selectedLightingPreset(classic), 'classic');
  for (const preset of ['stage', 'sunset', 'neon', 'classic-reflections']) assert.equal(selectedLightingPreset(applyLightingPreset(classic, preset)), preset);
  assert.throws(() => applyLightingPreset(studio, 'hdr'), /lighting preset/);
});

test('model settings reject code, remote resources, invalid clocks and invalid clip selectors', () => {
  for (const settings of [null, [], { shader: 'url(https://example.invalid/shader)' }, { environment: 'https://example.invalid/environment.hdr' }, { code: 'void main(){}' }, { color: 'red' }, { motionDuration: 0 }, { motionSpeed: Infinity }, { motionAmplitude: -.1 }, { animationClip: 1.5 }, { animationClip: -2 }, { animationSpeed: NaN }, { toonSteps: 2.5 }]) {
    assert.throws(() => normalizeModelStyle(settings));
  }
  const crossRealm = normalizeModelStyle(runInNewContext('({ motion: "spin", motionAxis: "x", motionTiming: { mode: "steps", action: .4 } })'));
  assert.deepEqual(crossRealm.motionTiming, { ...DEFAULT_MOTION, mode: 'steps', action: .4 });
  assert.equal(crossRealm.motionAxis, 'x');
});

test('all axes affect exactly their selected transform and reused samples clear stale motion', () => {
  const out = {};
  for (const motion of ['spin', 'rock', 'float', 'pulse']) for (const axis of ['x', 'y', 'z']) {
    const style = normalizeModelStyle({ motion, motionAxis: axis, motionDuration: 4 });
    assert.equal(automaticModelMotion(style, 1, out), out);
    const key = `${motion === 'spin' || motion === 'rock' ? 'rotation' : motion === 'float' ? 'offset' : 'scale'}${axis.toUpperCase()}`;
    assert.notEqual(out[key], neutral[key], `${motion}/${axis}`);
    for (const field of Object.keys(neutral).filter(field => field !== key)) assert.equal(out[field], neutral[field], `${motion}/${axis} clears ${field}`);
    assert.equal(Object.hasOwn(out, 'scale'), false, 'no retired scalar transform');
  }
  automaticModelMotion(normalizeModelStyle({ motion: 'none' }), 1, out);
  close(out, neutral);
});

test('Actions spin one eased sector then hold its endpoint with direction but without a rate multiplier', () => {
  const style = normalizeModelStyle({ motion: 'spin', motionAxis: 'x', motionSteps: 4, motionSpeed: 3, motionTiming: { mode: 'steps', action: .5, pause: .75, curve: 'ease-in', intensity: 1 } });
  close(automaticModelMotion(style, .25), { rotationX: motionEase(.5, style.motionTiming) * Math.PI / 2 });
  for (const time of [.5, .7, 1, 1.249]) close(automaticModelMotion(style, time), { rotationX: Math.PI / 2 });
  close(automaticModelMotion(style, 1.25), { rotationX: Math.PI / 2 });
  close(automaticModelMotion(style, 1.75), { rotationX: Math.PI });
  close(automaticModelMotion({ ...style, motionSpeed: .2, motionDuration: 30 }, .25), automaticModelMotion(style, .25));
  close(automaticModelMotion({ ...style, motionSpeed: -2 }, .25), { rotationX: -automaticModelMotion(style, .25).rotationX });
  close(automaticModelMotion({ ...style, motionSpeed: 0 }, 15), neutral);
  const first = automaticModelMotion(style, .25); automaticModelMotion(style, 100);
  close(automaticModelMotion(style, .25), first);
  for (const steps of [1, 3, 24]) close(automaticModelMotion({ ...style, motionSteps: steps }, .5), { rotationX: steps === 1 ? 0 : Math.PI * 2 / steps });
});

test('oscillating Actions complete a full cycle then hold rest; continuous curves shape full cycles', () => {
  for (const motion of ['rock', 'float', 'pulse']) {
    const style = normalizeModelStyle({ motion, motionDuration: 2, motionTiming: { mode: 'steps', action: 1, pause: 1 } });
    assert.notDeepEqual(automaticModelMotion(style, .25), automaticModelMotion(style, .75));
    for (const time of [1, 1.3, 1.999, 2]) close(automaticModelMotion(style, time), neutral);
    close(automaticModelMotion(style, 2.25), automaticModelMotion(style, .25));
    close(automaticModelMotion({ ...style, motionSteps: 24, motionSpeed: .2 }, .25), automaticModelMotion(style, .25));
    close(automaticModelMotion({ ...style, motionSpeed: 0 }, .25), neutral);
    const reverse = automaticModelMotion({ ...style, motionSpeed: -2 }, .25);
    close(reverse, {
      ...neutral,
      rotationZ: motion === 'rock' ? -Math.PI / 9 : 0,
      offsetY: motion === 'float' ? -.2 : 0,
      scaleX: motion === 'pulse' ? .88 : 1,
      scaleY: motion === 'pulse' ? .88 : 1,
      scaleZ: motion === 'pulse' ? .88 : 1
    });
  }
  for (const [curve] of MOTION_CURVES) {
    const style = normalizeModelStyle({ motion: 'spin', motionDuration: 4, motionTiming: { curve, intensity: 1 } });
    const expected = motionEase(.23, style.motionTiming);
    close(automaticModelMotion(style, .92), { rotationY: expected % 1 * Math.PI * 2 });
  }
  const spring = normalizeModelStyle({ motion: 'spin', motionTiming: { mode: 'steps', action: 1, pause: 1, curve: 'spring', intensity: 1 } });
  const time = Array.from({ length: 99 }, (_, index) => (index + 1) / 100).find(t => motionEase(t, spring.motionTiming) > 1);
  assert.ok(time !== undefined);
  assert.ok(automaticModelMotion(spring, time).rotationY > Math.PI / 2, 'spring overshoots the sector instead of clamping');
  close(automaticModelMotion(spring, 1), { rotationY: Math.PI / 2 });
});

test('reset preserves selected motion, material, lights and clips while restoring fresh neutral timing', () => {
  const style = normalizeModelStyle({ motion: 'pulse', mode: 'replace', color: '#123456', keyIntensity: 7, animationClip: 2, animationSpeed: .4, motionDuration: 12, motionSpeed: -3, motionAmplitude: .2, motionAxis: 'z', motionSteps: 11, motionTiming: { mode: 'steps', action: .3, pause: 2, curve: 'back', intensity: 1 } });
  const before = structuredClone(style), reset = resetModelMotion(style);
  assert.deepEqual(reset, normalizeModelStyle({ ...style, motionDuration: 6, motionSpeed: 1, motionAmplitude: 1, motionAxis: 'auto', motionSteps: 4, motionTiming: DEFAULT_MOTION }));
  assert.notEqual(reset.motionTiming, DEFAULT_MOTION);
  assert.notEqual(reset.motionTiming, resetModelMotion(style).motionTiming);
  assert.deepEqual(style, before);
});

test('continuous native auto transforms match the v9 formulas over positive, reverse and paused clocks', () => {
  for (const motion of ['none', 'spin', 'rock', 'float', 'pulse']) for (const speed of [-4, -1.5, 0, .3, 4]) for (const elapsed of [-1, 0, .127, 1, 6, 103.9]) {
    const style = normalizeModelStyle({ motion, motionSpeed: speed, motionDuration: 6, motionAmplitude: .7 });
    const phase = Math.max(0, elapsed) * speed / 6 % 1, wave = Math.sin(phase * Math.PI * 2);
    const scale = motion === 'pulse' ? 1 + wave * .7 * .12 : 1;
    close(automaticModelMotion(style, elapsed), { ...neutral, rotationY: motion === 'spin' ? phase * Math.PI * 2 : 0, rotationZ: motion === 'rock' ? wave * .7 * Math.PI / 9 : 0, offsetY: motion === 'float' ? wave * .7 * .2 : 0, scaleX: scale, scaleY: scale, scaleZ: scale });
  }
});

test('model clip metadata survives overlapping preview scenes and is released after the final scene', () => {
  const src = '/assets/model-metadata-fixture.glb';
  const first = { clips: [{ index: 0, name: 'Original clip', duration: 2 }], unlit: true };
  const observed = [];
  const unsubscribe = subscribeModelMetadata(src, () => observed.push(getModelMetadata(src)?.clips[0]?.name ?? null));
  assert.equal(getModelMetadata(src), null);
  const releaseA = registerModelMetadata(src, first);
  const releaseB = registerModelMetadata(src, { ...first });
  assert.equal(getModelMetadata(src), first, 'snapshot stays stable while the source is shared');
  releaseA(); releaseA();
  assert.equal(getModelMetadata(src)?.clips[0].name, 'Original clip');
  releaseB();
  assert.equal(getModelMetadata(src), null);
  assert.deepEqual(observed, ['Original clip', null]);
  unsubscribe();
});
