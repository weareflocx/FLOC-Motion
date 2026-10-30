import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { normalizeModelStyle, applyModelPreset, applyLightingPreset, selectedModelPreset, selectedLightingPreset, automaticModelMotion, resetModelMotion, MODEL_MATERIAL_PRESETS, MODEL_LIGHTING_PRESETS, MODEL_STYLE_RANGES } from '../src/model-style.js';
import { getModelMetadata, registerModelMetadata, subscribeModelMetadata } from '../src/model-metadata.js';
import { DEFAULT_MOTION, MOTION_CURVES, motionEase } from '../src/motion-timing.js';

const close = (actual, expected) => { for (const key of Object.keys(expected).filter(key => Object.hasOwn(neutral, key))) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-10, `${key}: ${actual[key]} != ${expected[key]}`); };
const neutral = { rotationX: 0, rotationY: 0, rotationZ: 0, offsetX: 0, offsetY: 0, offsetZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 };

test('liquid shape survives every preset while liquid surface resets independently', () => {
  const shape = { liquidRadius: 1.8, liquidInnerRadius: 1.2, liquidThickness: .3, liquidWarp: .8, liquidFrequency: 2.2, liquidOpen: 1, liquidClosed: .1, liquidDetail: 72, liquidDuration: 20, liquidEase: .13, liquidSpeed: -3 };
  const style = normalizeModelStyle({ ...shape, liquidReflectance: 3, liquidIorSpread: .4, liquidTint: '#Ab12Ef', motion: 'rock', environment: 'neon' });
  assert.deepEqual(normalizeModelStyle(JSON.parse(JSON.stringify(style))), style);
  for (const preset of MODEL_MATERIAL_PRESETS) {
    const next = applyModelPreset(style, preset.id);
    for (const [key, value] of Object.entries(shape)) assert.equal(next[key], value, `${preset.id}: ${key}`);
    assert.equal(next.liquidReflectance, 2.27);
    assert.equal(next.liquidIorSpread, .1);
    assert.equal(next.liquidTint, '#697077');
    assert.equal(next.environment, 'neon');
  }
  for (const preset of MODEL_LIGHTING_PRESETS) {
    const next = applyLightingPreset(style, preset.id);
    for (const [key, value] of Object.entries({ ...shape, liquidReflectance: 3, liquidIorSpread: .4, liquidTint: '#Ab12Ef' })) assert.equal(next[key], value);
  }
  for (const [key, value] of Object.entries(shape)) assert.equal(resetModelMotion(style)[key], value);
  const chrome = applyModelPreset(style, 'liquid-chrome');
  assert.equal(selectedModelPreset(chrome), 'liquid-chrome');
  assert.deepEqual([chrome.base, chrome.glass, chrome.color, chrome.roughness, chrome.ior, chrome.dispersion], ['custom', 'liquid', '#ffffff', .03, 1.45, .18]);
  assert.equal(selectedLightingPreset(applyLightingPreset(chrome, 'liquid-studio')), 'liquid-studio');
  for (const [key, [min, max]] of Object.entries(MODEL_STYLE_RANGES).filter(([key]) => key.startsWith('liquid'))) {
    for (const value of [min, max]) assert.equal(normalizeModelStyle({ [key]: value })[key], value);
    for (const value of [min - .01, max + .01, NaN, Infinity, '1', null]) assert.throws(() => normalizeModelStyle({ [key]: value }), undefined, key);
  }
  assert.throws(() => normalizeModelStyle({ liquidDetail: 56.5 }));
  for (const liquidTint of ['#fff', '#12345678', 'red', null]) assert.throws(() => normalizeModelStyle({ liquidTint }));
  assert.throws(() => normalizeModelStyle({ glass: 'liquid', look: 'toon' }));
  assert.throws(() => normalizeModelStyle({ glass: 'liquid', fresnelIntensity: .1 }));
});

test('morph shape defaults validate independently and survive surface, lighting and motion resets', () => {
  const defaults = { morphAmplitude: .35, morphWarp: .6, morphFrequency: 6, morphFalloff: 1.2, morphDetail: 10, morphContrast: .6, morphSpeed: 1, morphColor1: '#002aff', morphColor2: '#0040ff', morphColor3: '#4400ff', morphColor4: '#330aff' };
  const shape = { morphAmplitude: .72, morphWarp: 1.3, morphFrequency: 8.2, morphFalloff: 1.5, morphDetail: 16, morphContrast: 1.7, morphSpeed: -3, morphColor1: '#Ab12Ef', morphColor2: '#112233', morphColor3: '#445566', morphColor4: '#778899' };
  for (const [key, value] of Object.entries(defaults)) assert.equal(normalizeModelStyle()[key], value, key);
  const style = normalizeModelStyle({ ...shape, motion: 'spin', motionSpeed: -2, animationSpeed: .5 });
  assert.deepEqual(normalizeModelStyle(JSON.parse(JSON.stringify(style))), style);
  for (const id of ['original', 'chrome', 'holographic-glass', 'quantum-crystal']) {
    const applied = applyModelPreset(style, id);
    assert.equal(selectedModelPreset(applied), id);
    for (const [key, value] of Object.entries(shape)) assert.equal(applied[key], value, key);
  }
  for (const applied of [applyLightingPreset(style, 'sunset'), resetModelMotion(style)]) {
    for (const [key, value] of Object.entries(shape)) assert.equal(applied[key], value, key);
  }
  assert.throws(() => normalizeModelStyle({ morphDetail: 2.5 }));
});

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
  assert.equal(chrome.base, 'custom');
  assert.equal(chrome.metalness, 1);
  assert.equal(chrome.environment, original.environment, 'material presets keep the environment');
  assert.equal(chrome.keyIntensity, 6);
  assert.equal(selectedModelPreset(chrome), 'chrome');
  assert.equal(selectedModelPreset({ ...chrome, color: '#ff0040' }), 'custom');
  const restored = applyModelPreset({ ...chrome, look: 'wireframe', environment: 'studio' }, 'original');
  assert.equal(restored.base, 'imported');
  assert.deepEqual([restored.look, restored.glass, restored.fresnelIntensity], ['physical', 'none', 0]);
  assert.equal(selectedModelPreset(restored), 'original');
  assert.equal(selectedModelPreset({ ...restored, look: 'toon' }), 'custom', 'An imported base with another look is not the Original preset');
  assert.equal(selectedModelPreset({ ...restored, fresnelIntensity: .5 }), 'custom', 'An imported base with edge glow is not the Original preset');
  assert.equal(restored.environment, 'studio');
  assert.deepEqual([restored.motion, restored.motionDuration, restored.animationClip, restored.animationSpeed], ['spin', 8, 3, 2]);
  for (const key of ['motionAxis', 'motionSteps', 'motionTiming']) assert.deepEqual(restored[key], original[key]);
  assert.equal(selectedLightingPreset(restored), 'custom');
  const studio = applyLightingPreset(restored, 'studio');
  assert.deepEqual([studio.environment, studio.toneMapping, studio.keyIntensity, studio.base, studio.look], ['softbox', 'neutral', 1.6, 'imported', 'physical']);
  assert.equal(selectedLightingPreset(studio), 'studio');
  const classic = applyLightingPreset(studio, 'classic');
  assert.deepEqual([classic.environment, classic.toneMapping, classic.keyIntensity, classic.keyColor], ['none', 'none', 3, '#ffffff']);
  assert.equal(selectedLightingPreset(classic), 'classic');
  for (const preset of ['stage', 'sunset', 'neon', 'classic-reflections']) assert.equal(selectedLightingPreset(applyLightingPreset(classic, preset)), preset);
  assert.throws(() => applyLightingPreset(studio, 'hdr'), /lighting preset/);
});

test('model settings reject code, remote resources, invalid clocks and invalid clip selectors', () => {
  for (const settings of [null, [], { look: 'url(https://example.invalid/shader)' }, { environment: 'https://example.invalid/environment.hdr' }, { code: 'void main(){}' }, { color: 'red' }, { motionDuration: 0 }, { motionSpeed: Infinity }, { motionAmplitude: -.1 }, { animationClip: 1.5 }, { animationClip: -2 }, { animationSpeed: NaN }, { toonSteps: 2.5 }, { mode: 'replace' }, { shader: 'standard' }]) {
    assert.throws(() => normalizeModelStyle(settings));
  }
  assert.throws(() => normalizeModelStyle({ look: 'toon', glass: 'see-through' }), /glass needs the Physical look/);
  assert.throws(() => normalizeModelStyle({ look: 'wireframe', fresnelIntensity: .5 }), /edge glow needs the Physical look without glass/);
  assert.throws(() => normalizeModelStyle({ glass: 'refractive', fresnelIntensity: .5 }), /edge glow needs the Physical look without glass/);
  assert.equal(normalizeModelStyle({ look: 'physical', glass: 'none', fresnelIntensity: .5 }).fresnelIntensity, .5);
  const crossRealm = normalizeModelStyle(runInNewContext('({ motion: "spin", motionAxis: "x", motionTiming: { mode: "steps", action: .4 } })'));
  assert.deepEqual(crossRealm.motionTiming, { ...DEFAULT_MOTION, mode: 'steps', action: .4 });
  assert.equal(crossRealm.motionAxis, 'x');
});

test('refraction accepts only canonical bounded thickness and discrete quality settings', () => {
  const seeThrough = normalizeModelStyle({ glass: 'see-through', glassOpacity: .35, roughness: .2 });
  assert.deepEqual([seeThrough.glass, seeThrough.glassOpacity, seeThrough.roughness], ['see-through', .35, .2]);
  assert.deepEqual([seeThrough.refractionThickness, seeThrough.refractionSamples, seeThrough.refractionResolution], [.5, 8, 1024]);
  for (const refractionThickness of [0, .5, 2]) for (const refractionSamples of [4, 8, 16]) for (const refractionResolution of [256, 512, 1024, 2048]) {
    const settings = { glass: 'refractive', refractionThickness, refractionSamples, refractionResolution };
    const style = normalizeModelStyle(settings);
    for (const [key, value] of Object.entries(settings)) assert.equal(style[key], value);
    assert.deepEqual(normalizeModelStyle(JSON.parse(JSON.stringify(style))), style);
  }
  for (const [key, values] of Object.entries({
    refractionThickness: [-.01, 2.01, Infinity, NaN, '.5', null],
    refractionSamples: [0, 5, 7.5, 12, 32, '8', null],
    refractionResolution: [0, 257, 768, 1024.5, 4096, '1024', null]
  })) for (const value of values) assert.throws(() => normalizeModelStyle({ [key]: value }), new RegExp(key));
});

test('refractive presets select true refraction and preserve all nonsurface settings', () => {
  const original = normalizeModelStyle({ environment: 'neon', exposure: 2, motion: 'rock', motionAxis: 'z', animationClip: -1, zoom: 1.7, perspective: 52 });
  for (const id of ['refractive-clear', 'refractive-frosted', 'refractive-prism']) {
    const style = applyModelPreset(original, id);
    assert.equal(style.glass, 'refractive');
    assert.deepEqual([style.base, style.look], ['custom', 'physical']);
    assert.equal(selectedModelPreset(style), id);
    for (const key of ['environment', 'exposure', 'motion', 'motionAxis', 'animationClip', 'zoom', 'perspective']) assert.equal(style[key], original[key]);
    assert.deepEqual([style.refractionSamples, style.refractionResolution], [8, 1024]);
    assert.equal(selectedModelPreset({ ...style, refractionSamples: 16 }), 'custom');
    const lighting = applyLightingPreset(style, 'sunset');
    for (const key of ['look', 'glass', 'roughness', 'ior', 'dispersion', 'refractionThickness', 'refractionSamples', 'refractionResolution']) assert.equal(lighting[key], style[key]);
  }
  assert.equal(applyModelPreset(original, 'clear-glass').glass, 'see-through');
  assert.equal(applyModelPreset(original, 'prism').glass, 'environment');
});

test('holographic settings roundtrip bounded values and reject invalid inputs', () => {
  const ranges = {
    holographicIntensity: [0, .35, 1], holographicScale: [.1, 1.4, 6],
    holographicSpeed: [-1, 0, .08, 1], holographicSweep: [0, .6, 2]
  };
  for (const [key, values] of Object.entries(ranges)) {
    for (const value of values) {
      const style = normalizeModelStyle({ glass: 'holographic', [key]: value });
      assert.equal(style[key], value);
      assert.deepEqual(normalizeModelStyle(JSON.parse(JSON.stringify(style))), style);
    }
    for (const value of [values[0] - .01, values.at(-1) + .01, Infinity, NaN, '0', null]) {
      assert.throws(() => normalizeModelStyle({ [key]: value }), new RegExp(key));
    }
  }
  assert.throws(() => normalizeModelStyle({ look: 'toon', glass: 'holographic' }), /Physical look/);
  assert.throws(() => normalizeModelStyle({ glass: 'holographic', fresnelIntensity: .2 }), /edge glow/);
});

test('holographic preset resets its surface while preserving lighting and motion', () => {
  const original = normalizeModelStyle({ environment: 'neon', exposure: 2, keyIntensity: 4, motion: 'rock', motionSpeed: -2, animationClip: -1, zoom: 1.7 });
  const style = applyModelPreset(original, 'holographic-glass');
  assert.equal(selectedModelPreset(style), 'holographic-glass');
  assert.deepEqual([style.base, style.glass, style.color, style.roughness, style.ior, style.dispersion, style.holographicIntensity], ['custom', 'holographic', '#ffffff', .02, 1.67, .11, .23]);
  const edited = normalizeModelStyle({ ...style, holographicIntensity: .9, holographicScale: 3, holographicSpeed: 0, holographicSweep: 0 });
  assert.equal(selectedModelPreset(edited), 'custom');
  const lit = applyLightingPreset(edited, 'sunset');
  const keys = ['holographicIntensity', 'holographicScale', 'holographicSpeed', 'holographicSweep'];
  for (const key of keys) assert.equal(lit[key], edited[key], key);
  for (const id of ['holographic-glass', 'chrome', 'original', 'refractive-clear', 'prism']) {
    const reset = applyModelPreset(edited, id);
    assert.equal(selectedModelPreset(reset), id);
    assert.deepEqual(keys.map(key => reset[key]), [id === 'holographic-glass' ? .23 : .35, 1.4, .08, .6]);
    for (const key of ['environment', 'exposure', 'keyIntensity', 'motion', 'motionSpeed', 'animationClip', 'zoom']) assert.equal(reset[key], original[key], key);
  }
});

test('quantum preset resets every crystal surface setting without changing lighting or motion', () => {
  const original = normalizeModelStyle({ environment: 'neon', exposure: 2, keyIntensity: 4, motion: 'rock', motionSpeed: -2, animationClip: -1, zoom: 1.7 });
  const preset = applyModelPreset(original, 'quantum-crystal');
  assert.equal(selectedModelPreset(preset), 'quantum-crystal');
  assert.deepEqual([preset.base, preset.glass, preset.color, preset.roughness, preset.ior, preset.dispersion], ['custom', 'quantum', '#ffffff', .08, 1.5, .22]);
  const changes = { quantumIntensity: 2, quantumScale: 3, quantumDepth: 0, quantumSpeed: -4, quantumMorphSpeed: 5, quantumRim: 4, quantumColor1: '#aabbcc', quantumColor2: '#112233', quantumColor3: '#445566' };
  const edited = normalizeModelStyle({ ...preset, ...changes });
  assert.equal(selectedModelPreset(edited), 'custom');
  const lit = applyLightingPreset(edited, 'sunset');
  for (const key of Object.keys(changes)) assert.equal(lit[key], edited[key], key);
  for (const id of ['quantum-crystal', 'holographic-glass', 'chrome', 'original', 'refractive-clear', 'prism']) {
    const reset = applyModelPreset(edited, id);
    assert.equal(selectedModelPreset(reset), id);
    for (const key of Object.keys(changes)) assert.equal(reset[key], preset[key], key);
    for (const key of ['environment', 'exposure', 'keyIntensity', 'motion', 'motionSpeed', 'animationClip', 'zoom']) assert.equal(reset[key], original[key], key);
  }
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
  const style = normalizeModelStyle({ motion: 'pulse', base: 'custom', color: '#123456', keyIntensity: 7, animationClip: 2, animationSpeed: .4, motionDuration: 12, motionSpeed: -3, motionAmplitude: .2, motionAxis: 'z', motionSteps: 11, motionTiming: { mode: 'steps', action: .3, pause: 2, curve: 'back', intensity: 1 } });
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
