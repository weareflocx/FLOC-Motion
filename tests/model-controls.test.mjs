import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as modelStyle from '../src/model-style.js';
import * as modelMetadata from '../src/model-metadata.js';
import * as motionTiming from '../src/motion-timing.js';
import * as easing from '../src/easing.js';

async function compile(file, name) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  return (await transform(source.replace(/^import .*;\n/gm, '').replaceAll('export function', 'function'), { loader: 'jsx' })).code + `\nthis.component = ${name};`;
}
const controls = (await Promise.all([
  compile('../src/editor/components/MotionTimingControls.jsx', 'CharacterControls'),
  compile('../src/editor/components/ModelMotionControls.jsx', 'ModelMotionControls'),
  compile('../src/editor/components/ModelControls.jsx', 'ModelControls')
])).join('\n');
const carouselControls = await compile('../src/editor/components/MotionControls.jsx', 'MotionControls');

function inspector(initial = {}, component = 'model') {
  let layer = { id: 'model', type: 'model', src: 'controls.glb', x: 0, y: 0, size: 100, offset: 0, loop: true, ...initial };
  const patches = [];
  let rightTab = component === 'animation' || component === 'carousel' ? 'animation' : 'composition';
  const context = {
    ...modelStyle, ...modelMetadata, ...motionTiming, ...easing,
    React: { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) },
    useCallback: callback => callback,
    useSyncExternalStore: (subscribe, snapshot) => snapshot(),
    UploadSimple: 'icon', OrientationControl: 'orientation', Color: 'color', Field: 'field', NumberField: 'number', Range: 'range', Section: 'section'
  };
  vm.createContext(context); vm.runInContext(controls + (component === 'carousel' ? carouselControls : ''), context);
  function nodes(node, disabled = false) {
    if (Array.isArray(node)) return node.flatMap(child => nodes(child, disabled));
    if (!node || typeof node !== 'object') return [];
    if (typeof node.type === 'function') return nodes(node.type({ ...node.props, children: node.children }), disabled);
    const blocked = disabled || node.props.disabled === true;
    return [{ ...node, blocked }, ...nodes(node.children, blocked)];
  }
  const render = () => nodes(context.component({ layer, count: 6, rightTab, onPick() {}, onPatch(id, patch) { assert.equal(id, layer.id); patches.push(patch); layer = { ...layer, ...patch }; } }));
  const find = label => render().find(node => node.props['aria-label'] === label || node.props.ariaLabel === label || node.props.label === label && ['range', 'color', 'number'].includes(node.type));
  const text = node => (node.children || []).flat(Infinity).map(child => typeof child === 'object' && child !== null ? text(child) : child ?? '').join('');
  const button = label => render().find(node => node.type === 'button' && text(node) === label);
  return {
    find, render, patches, button,
    click(label) { const node = button(label); assert.ok(node, label); assert.equal(node.blocked, false, label); node.props.onClick(); },
    get layer() { return layer; },
    setLayer(patch) { layer = { ...layer, ...patch }; },
    showTab(value) { rightTab = value; },
    change(label, value) { const node = find(label); assert.ok(node, label); assert.equal(node.blocked, false, label); node.props.onChange(node.type === 'select' ? { target: { value: String(value) } } : value); }
  };
}

test('material and shader transitions gate effective overrides without erasing preserved settings', () => {
  const h = inspector({ modelStyle: { color: '#445566', metalness: .7, motion: 'float', animationClip: -1 } });
  assert.equal(h.find('Material color').blocked, true);
  assert.equal(h.find('Metalness').blocked, true);
  h.change('Material mode', 'tint');
  assert.equal(h.find('Material color').blocked, false);
  assert.equal(h.find('Metalness').blocked, true);
  h.change('Material mode', 'replace'); h.change('Surface shader', 'toon');
  assert.equal(h.find('Metalness').blocked, true);
  assert.equal(h.find('Emissive intensity').blocked, false);
  h.change('Toon steps', 6);
  h.change('Surface shader', 'wireframe');
  assert.equal(h.find('Emissive intensity').blocked, true);
  assert.equal(h.find('Key intensity').blocked, true);
  h.change('Surface shader', 'fresnel');
  assert.equal(h.find('Metalness').blocked, false);
  h.change('Fresnel power', 5);
  assert.equal(h.layer.modelStyle.metalness, .7);
  assert.equal(h.layer.modelStyle.motion, 'float');
  assert.equal(h.layer.modelStyle.animationClip, -1);
  assert.equal(h.layer.modelStyle.fresnelPower, 5);
  assert.equal(Object.keys(h.patches.at(-1).modelStyle).length, Object.keys(modelStyle.DEFAULT_MODEL_STYLE).length);
});

test('preset changes preserve independent motion and clip settings and Original restores legacy light rig', () => {
  const h = inspector({ modelStyle: { motion: 'rock', motionSpeed: -2, animationClip: 2, animationSpeed: .5, fillIntensity: 5 } });
  h.change('Material preset', 'chrome');
  assert.equal(h.layer.modelStyle.environment, 'studio');
  assert.equal(h.layer.modelStyle.motionSpeed, -2);
  assert.equal(h.layer.modelStyle.animationClip, 2);
  h.change('Material preset', 'original');
  assert.equal(h.layer.modelStyle.mode, 'original');
  assert.equal(h.layer.modelStyle.environment, 'none');
  assert.equal(h.layer.modelStyle.fillIntensity, 0);
  assert.equal(h.layer.modelStyle.animationSpeed, .5);
});

test('metadata distinguishes loading, static, missing clips and source changes without silently selecting a clip', () => {
  const h = inspector({ src: 'metadata-a.glb', modelStyle: { animationClip: 4 } }, 'animation');
  const releaseA = modelMetadata.registerModelMetadata('metadata-a.glb', { clips: [{ index: 0, name: '<untrusted clip>', duration: 2 }], unlit: true });
  const releaseB = modelMetadata.registerModelMetadata('metadata-b.glb', { clips: [], unlit: false });
  try {
    assert.equal(h.find('Embedded clip').blocked, false);
    assert.ok(h.render().some(node => node.props.role === 'alert'));
    assert.equal(h.layer.modelStyle.animationClip, 4);
    h.change('Embedded clip', 0);
    assert.equal(h.find('Embedded clip speed').blocked, false);
    h.setLayer({ src: 'metadata-b.glb' });
    assert.equal(h.find('Embedded clip').blocked, true);
    assert.equal(h.find('Embedded clip speed').blocked, true);
    assert.equal(h.render().some(node => node.props.role === 'alert'), false);
    h.setLayer({ modelStyle: { ...h.layer.modelStyle, animationClip: 3 } });
    assert.equal(h.find('Embedded clip').blocked, false);
    assert.ok(h.render().some(node => node.props.role === 'alert'));
    h.change('Embedded clip', -1);
    assert.equal(h.render().some(node => node.props.role === 'alert'), false);
  } finally { releaseA(); releaseB(); }
});

test('an unavailable clip list still permits disabling an invalid embedded selection', () => {
  const h = inspector({ src: 'failed-selection.glb', modelStyle: { animationClip: 7, motion: 'float' } }, 'animation');
  h.change('Embedded clip', -1);
  assert.equal(h.layer.modelStyle.animationClip, -1);
  assert.equal(h.layer.modelStyle.motion, 'float');
  assert.equal(h.find('Embedded clip speed').blocked, true);
});

test('automatic motion and embedded playback dependencies remain independent', () => {
  const release = modelMetadata.registerModelMetadata('motion-controls.glb', { clips: [{ index: 0, name: 'Loop', duration: 3 }], unlit: false });
  try {
    const h = inspector({ src: 'motion-controls.glb' }, 'animation');
    assert.equal(h.find('Motion cycle duration'), undefined);
    h.change('Automatic motion', 'spin');
    assert.equal(h.find('Motion cycle duration').blocked, false);
    assert.equal(h.find('Motion amplitude'), undefined);
    h.change('Speed multiplier', 2);
    h.change('Motion direction', -1);
    h.change('Embedded clip', -1);
    assert.equal(h.find('Embedded clip speed').blocked, true);
    assert.equal(h.layer.modelStyle.motion, 'spin');
    h.change('Automatic motion', 'pulse');
    assert.equal(h.find('Motion amplitude').blocked, false);
    assert.equal(h.layer.modelStyle.animationClip, -1);
    assert.equal(h.layer.modelStyle.motionSpeed, -2);
  } finally { release(); }
});

test('environment controls preserve reflection settings while incompatible shaders disable them', () => {
  const h = inspector();
  assert.equal(h.find('Environment intensity').blocked, true);
  h.change('Reflection environment', 'studio');
  h.change('Environment intensity', 1.7);
  h.change('Environment rotation', -35);
  h.change('Surface shader', 'toon');
  assert.equal(h.find('Environment intensity').blocked, true);
  h.change('Surface shader', 'standard');
  assert.equal(h.find('Environment intensity').blocked, false);
  assert.equal(h.layer.modelStyle.environmentIntensity, 1.7);
  assert.equal(h.layer.modelStyle.environmentRotation, -35);
});

test('Actions uses signed direction without a hidden rate and preserves continuous duration and curve choices', () => {
  for (const speed of [-2.75, 3.5, 0]) {
    const h = inspector({ modelStyle: { motion: 'spin', motionSpeed: speed, motionDuration: 12, motionAxis: 'x', motionTiming: { curve: 'bounce', intensity: .8 } } }, 'animation');
    h.click('Actions');
    assert.equal(h.layer.modelStyle.motionSpeed, Math.sign(speed));
    assert.equal(h.find('Speed multiplier'), undefined);
    assert.equal(h.find('Motion cycle duration'), undefined);
    h.change('Action', .75);
    h.change('Pause', 1.25);
    h.change('Steps per turn', 8);
    const summary = h.render().find(node => node.type === 'p' && node.children.join('').includes('45° per action'));
    assert.ok(summary);
    assert.equal(h.layer.modelStyle.motionSteps, 8);
    h.change('Motion direction', -1);
    assert.equal(h.layer.modelStyle.motionSpeed, -1);
    h.click('Continuous');
    assert.equal(h.find('Action'), undefined);
    assert.equal(h.find('Steps per turn'), undefined);
    assert.equal(h.find('Motion cycle duration').props.value, 12);
    assert.equal(h.find('Speed multiplier').props.value, 1);
    assert.equal(h.layer.modelStyle.motionTiming.curve, 'bounce');
    assert.equal(h.layer.modelStyle.motionTiming.intensity, .8);
    assert.equal(h.layer.modelStyle.motionAxis, 'x');
    assert.equal(h.layer.modelStyle.motionTiming.pause, 1.25);
  }
});

test('type, axis and disabled-motion transitions retain rhythm while exposing only effective dependencies', () => {
  const h = inspector({ modelStyle: { motion: 'spin', motionAxis: 'z', motionTiming: { mode: 'steps', action: .5, pause: 2, curve: 'spring', intensity: .7 } } }, 'animation');
  assert.ok(h.find('Steps per turn'));
  h.change('Automatic motion', 'float');
  assert.equal(h.find('Steps per turn'), undefined);
  assert.equal(h.find('Motion amplitude').blocked, false);
  h.change('Motion amplitude', .6);
  h.change('Motion axis', 'y');
  h.change('Automatic motion', 'none');
  assert.equal(h.find('Motion axis'), undefined);
  assert.equal(h.find('Action'), undefined);
  assert.equal(h.button('Spring'), undefined);
  h.change('Automatic motion', 'pulse');
  assert.equal(h.find('Motion axis').props.value, 'y');
  assert.equal(h.find('Action').props.value, .5);
  assert.equal(h.button('Actions').props['aria-pressed'], true);
  assert.equal(h.button('Spring').props['aria-pressed'], true);
  assert.equal(h.layer.modelStyle.motionAmplitude, .6);
  assert.equal(h.layer.modelStyle.motionTiming.pause, 2);
});

test('curve selection and strength update the real progress graph, with overshoot left visible', () => {
  const h = inspector({ modelStyle: { motion: 'rock' } }, 'animation');
  const graph = () => h.render().find(node => node.type === 'path' && node.props.className === 'motion-curve-path').props.d;
  const native = graph();
  h.click('Spring');
  assert.equal(h.button('Spring').props['aria-pressed'], true);
  assert.notEqual(graph(), native);
  const spring = graph();
  h.change('Curve springiness', 95);
  assert.notEqual(graph(), spring);
  assert.equal(h.layer.modelStyle.motionTiming.intensity, .95);
  const coordinates = [...graph().matchAll(/[ML]([\d.-]+),([\d.-]+)/g)].map(match => [Number(match[1]), Number(match[2])]);
  assert.ok(coordinates.some(([, y]) => y < 24), 'Spring overshoot must not be clipped');
  assert.ok(Math.abs(coordinates[37][1] - (110 - motionTiming.motionEase(.37, h.layer.modelStyle.motionTiming) * 86)) < 1e-9);
  h.click('Linear');
  assert.equal(h.find('Curve springiness'), undefined);
  assert.equal(h.layer.modelStyle.motionTiming.intensity, .95);
  h.click('Bounce');
  assert.equal(h.find('Curve bounciness').props.value, 95);
});

test('Reset motion preserves model appearance, authored pose, embedded playback and selected motion', () => {
  const initial = {
    x: 18, y: -8, size: 84, tilt: 31, yaw: -25, roll: 9, offset: 2.5, loop: false,
    modelStyle: { mode: 'replace', shader: 'fresnel', color: '#123456', keyIntensity: 5, environment: 'studio', animationClip: 3, animationSpeed: .65, motion: 'pulse', motionAxis: 'z', motionSteps: 12, motionDuration: 24, motionSpeed: -3, motionAmplitude: .2, motionTiming: { mode: 'steps', action: .25, pause: 4, curve: 'back', intensity: .9 } }
  };
  const h = inspector(initial, 'animation');
  h.click('Reset motion');
  assert.equal(h.layer.modelStyle.motion, 'pulse');
  assert.equal(h.layer.modelStyle.motionDuration, 6);
  assert.equal(h.layer.modelStyle.motionSpeed, 1);
  assert.equal(h.layer.modelStyle.motionAmplitude, 1);
  assert.equal(h.layer.modelStyle.motionAxis, 'auto');
  assert.equal(h.layer.modelStyle.motionSteps, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(h.layer.modelStyle.motionTiming)), motionTiming.DEFAULT_MOTION);
  for (const key of ['mode', 'shader', 'color', 'keyIntensity', 'environment', 'animationClip', 'animationSpeed']) assert.equal(h.layer.modelStyle[key], initial.modelStyle[key], key);
  for (const key of ['x', 'y', 'size', 'tilt', 'yaw', 'roll', 'offset', 'loop']) assert.equal(h.layer[key], initial[key], key);
  assert.deepEqual(Object.keys(h.patches.at(-1)), ['modelStyle']);
  assert.equal(h.find('Action'), undefined);
  assert.equal(h.button('Original').props['aria-pressed'], true);
});

test('shared controls preserve carousel-native graph families and action rhythm reset baseline', () => {
  const baseline = { motion: { mode: 'steps', action: .8, pause: .6, curve: 'bounce', intensity: .75 }, speed: -24, loopDuration: 9 };
  for (const template of ['flip', 'window-push', 'sweep-reveal']) {
    const h = inspector({ template, speed: 18, loopDuration: 6, motion: { ...motionTiming.DEFAULT_MOTION }, motionBaseline: baseline, transitionTurn: 90 }, 'carousel');
    const points = () => h.render().find(node => node.type === 'path' && node.props.className === 'motion-curve-path').props.d;
    const sampleY = () => Number([...points().matchAll(/[ML]([\d.-]+),([\d.-]+)/g)][25][2]);
    const expected = template === 'flip' ? easing.smoothProgress(.25) : template === 'window-push' ? 1 - .75 ** 3 : motionTiming.sweepProgress(.25);
    assert.ok(Math.abs(sampleY() - (110 - expected * 86)) < 1e-9, template);
    h.click('Actions');
    assert.equal(h.layer.speed, 18, 'carousel Actions must retain its own speed behavior');
    h.change('Action', 1.5);
    h.change('Pause', .25);
    h.change('Motion direction', -1);
    assert.equal(h.layer.speed, -18);
    if (template === 'flip') assert.ok(Math.abs(sampleY() - (110 - .25 * 86)) < 1e-9, 'flip Actions uses linear native progress');
    h.click('Spring');
    h.change('Curve springiness', 90);
    h.click('Reset motion');
    assert.deepEqual(JSON.parse(JSON.stringify(h.layer.motion)), baseline.motion);
    assert.equal(h.layer.speed, baseline.speed);
    assert.equal(h.layer.loopDuration, baseline.loopDuration);
    assert.equal(h.button('Actions').props['aria-pressed'], true);
    assert.equal(h.find('Action').props.value, .8);
    assert.equal(h.button('Bounce').props['aria-pressed'], true);
  }
});

test('model tabs separate appearance and animation without losing movement settings', () => {
  const h = inspector();
  assert.ok(h.find('Material preset'));
  assert.equal(h.find('Automatic motion'), undefined);
  h.showTab('animation');
  assert.equal(h.find('Material preset'), undefined);
  h.change('Automatic motion', 'spin');
  h.change('Motion axis', 'x');
  h.click('Actions');
  h.showTab('composition');
  assert.ok(h.find('Material preset'));
  assert.ok(h.find('Position X'));
  h.showTab('animation');
  assert.equal(h.find('Motion axis').props.value, 'x');
  assert.equal(h.button('Actions').props['aria-pressed'], true);
});
