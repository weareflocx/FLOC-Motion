import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, validateProject, patchLayer, linkFormats, switchFormat, assertLocksRespected } from '../src/project.js';
import { captureState, capturedProperties, evaluateChoreography, mixColor } from '../src/choreography.js';
import { EASINGS, easeProgress, isCubicBezier } from '../src/easing.js';
import { MOTION_CURVES, motionEase } from '../src/motion-timing.js';
import { choreographyPatch } from '../src/editor/choreography-edit.js';
import { sceneUpdatePlan } from '../src/scene-update.js';

const layer = (project, id) => project.layers.find(entry => entry.id === id);
const near = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≠ ${expected}`);
const samples = Array.from({ length: 41 }, (_, i) => i / 40);
const pose = { x: 6, y: 6, size: 48, opacity: 1, roll: 0 };

// Choreography uses each curve at the default strength: the eases are cubic there.
const CUBIC = { linear: t => t, 'ease-in-out': t => t < 0.5 ? 4 * t ** 3 : 1 - (2 - 2 * t) ** 3 / 2, 'ease-in': t => t ** 3, 'ease-out': t => 1 - (1 - t) ** 3 };

function textProject(states, patch = {}) {
  const project = validateProject(demoProject());
  return patchLayer(project, 'headline', { ...patch, choreography: states });
}

test('choreography easings are the library curves at the default strength, shared with carousel curves', () => {
  for (const [name, curve] of Object.entries(CUBIC)) for (const t of samples) near(easeProgress(name, t), curve(t), 1e-12);
  assert.deepEqual(MOTION_CURVES.map(([id]) => id), ['native', ...EASINGS.map(easing => easing.id)]);
  for (const { id } of EASINGS) for (const t of samples) assert.equal(motionEase(t, { mode: 'continuous', action: 1, pause: 0, curve: id, intensity: 0.5 }), easeProgress(id, t), `${id} at ${t}`);
  const states = Object.keys(CUBIC).map((easing, index) => ({ id: easing, time: index, easing, values: { ...pose, x: 10 + index * 20 } }));
  const project = textProject(states);
  assert.deepEqual(layer(project, 'headline').choreography.map(state => state.easing), Object.keys(CUBIC));
  near(evaluateChoreography(layer(project, 'headline'), 1.5).x, 30 + 20 * CUBIC['ease-in'](0.5));
  near(evaluateChoreography(layer(project, 'headline'), 2.5).x, 50 + 20 * CUBIC['ease-out'](0.5));
});

test('choreography accepts every library curve and validated custom cubic béziers', () => {
  const names = EASINGS.map(easing => easing.id);
  assert.deepEqual(names, ['linear', 'ease-in-out', 'ease-in', 'ease-out', 'back', 'bounce', 'spring']);
  for (const easing of [...names, [0.25, 0.1, 0.25, 1], [0, -1, 1, 2.5]]) {
    const project = textProject([{ id: 'a', time: 0, easing: 'linear', values: pose }, { id: 'b', time: 2, easing, values: { ...pose, x: 50 } }]);
    for (const time of samples.map(t => t * 2)) assert(Number.isFinite(evaluateChoreography(layer(project, 'headline'), time).x));
  }
  for (const easing of [[1.2, 0, 0.5, 1], [-0.1, 0, 0.5, 1], [0.5, 0, 0.5], [0.5, 0, 0.5, 1, 0], [0.5, '0', 0.5, 1], [0.5, NaN, 0.5, 1], [0.2, 4, 0.5, 1], 'smooth', 'elastic', 'glide', 'native', null]) {
    assert.equal(isCubicBezier(easing), false);
    assert.throws(() => textProject([{ id: 'a', time: 0, easing, values: pose }]), /Unknown choreography easing/);
  }
  for (const t of samples) near(easeProgress([0, 0, 1, 1], t), t, 1e-6);
  // CSS `ease`: cubic-bezier(0.25, 0.1, 0.25, 1) passes 0.8024 at half time.
  near(easeProgress([0.25, 0.1, 0.25, 1], 0.5), 0.8024033877399112, 1e-5);
  const steep = samples.map(t => easeProgress([0.9, 0, 0.1, 1], t));
  assert(steep.every((value, i) => i === 0 || value >= steep[i - 1]));
  assert.equal(easeProgress([0.9, 0, 0.1, 1], 1), 1);
  assert(samples.some(t => easeProgress('back', t) > 1));
});

test('colors interpolate in linear RGB', () => {
  assert.equal(mixColor('#000000', '#ffffff', 0.5), '#bcbcbc');
  assert.equal(mixColor('#FF0000', '#0000ff', 0.5), '#bc00bc');
  assert.equal(mixColor('#123456', '#abcdef', 0), '#123456');
  assert.equal(mixColor('#123456', '#abcdef', 1), '#abcdef');
  const project = textProject([
    { id: 'a', time: 0, easing: 'linear', values: { ...pose, color: '#000000' } },
    { id: 'b', time: 2, easing: 'linear', values: { ...pose, color: '#ffffff' } }
  ]);
  assert.equal(evaluateChoreography(layer(project, 'headline'), 1).color, '#bcbcbc');
  assert.equal(layer(project, 'headline').color, '#ffffff');
});

test('a state that omits a property leaves it to the states that hold it, or to the layer', () => {
  let project = validateProject(demoProject());
  project = patchLayer(project, 'headline', { effects: [{ type: 'blur', enabled: true, amount: 8, mode: 'uniform', direction: 'bottom' }], letterSpacing: 0.1 });
  project = patchLayer(project, 'headline', { choreography: [
    { id: 'a', time: 0, easing: 'linear', values: { ...pose, color: '#000000', blurAmount: 0, lineHeight: 1 } },
    { id: 'b', time: 1, easing: 'linear', values: { ...pose, x: 40 } },
    { id: 'c', time: 4, easing: 'ease-in-out', values: { ...pose, color: '#ffffff', blurAmount: 40 } }
  ] });
  const headline = layer(project, 'headline');
  const at = time => evaluateChoreography(headline, time);
  // Color and blur pass state b by interpolating from a to c with c's easing.
  const progress = easeProgress('ease-in-out', 2 / 4);
  assert.equal(at(2).color, mixColor('#000000', '#ffffff', progress));
  near(at(2).effects[0].amount, 40 * progress);
  near(at(0.5).x, 23);
  // Only state a holds line height; nothing holds letter spacing.
  assert.equal(at(3).lineHeight, 1);
  assert.equal(at(3).letterSpacing, 0.1);
  assert.equal(headline.effects[0].amount, 8);
  assert.equal(at(9).effects[0].amount, 40);
  // Values for a removed effect remain valid and are ignored until it returns.
  const removed = patchLayer(project, 'headline', { effects: [] });
  assert.deepEqual(evaluateChoreography(layer(removed, 'headline'), 2).effects, []);
  assert.equal(layer(removed, 'headline').choreography[2].values.blurAmount, 40);
});

test('overshooting transitions stay inside each property’s bounds', () => {
  const project = textProject([
    { id: 'a', time: 0, easing: 'linear', values: { ...pose, opacity: 0, letterSpacing: -0.15 } },
    { id: 'b', time: 2, easing: 'spring', values: { ...pose, opacity: 1, letterSpacing: 0.5 } }
  ]);
  const values = samples.map(t => evaluateChoreography(layer(project, 'headline'), t * 2));
  assert(values.every(value => value.opacity >= 0 && value.opacity <= 1 && value.letterSpacing >= -0.15 && value.letterSpacing <= 0.5));
  assert(values.some(value => value.opacity === 1 && value.letterSpacing === 0.5));
});

test('new state values are validated by type and bounds', () => {
  const p = validateProject(demoProject());
  const bad = [
    ['headline', { color: 'white' }, /hex color/], ['headline', { color: '#fff' }, /hex color/], ['headline', { letterSpacing: 0.6 }, /State letterSpacing/],
    ['headline', { lineHeight: 0.2 }, /State lineHeight/], ['headline', { blurAmount: 49 }, /State blurAmount/], ['headline', { intensity: 0.5 }, /Invalid choreography values/],
    ['carousel', { intensity: 1.5 }, /State intensity/], ['carousel', { layerEffectIntensity: -0.1 }, /State layerEffectIntensity/], ['carousel', { color: '#ffffff' }, /Invalid choreography values/],
    ['logo', { noiseOpacity: 2 }, /State noiseOpacity/], ['logo', { letterSpacing: 0 }, /Invalid choreography values/]
  ];
  for (const [id, values, message] of bad) {
    const base = captureState(layer(p, id), 0, p.fps, {}, 'first');
    assert.throws(() => patchLayer(p, id, { choreography: [{ ...base[0], values: { ...base[0].values, ...values } }] }), message, id);
  }
  const carousel = captureState(layer(p, 'carousel'), 0, p.fps, { intensity: 1, layerEffectIntensity: 0, warpAmount: 0.4, monochromeAmount: 1 }, 'first');
  assert.doesNotThrow(() => patchLayer(p, 'carousel', { choreography: carousel }));
});

test('Save state captures every applicable property; pose edits capture only animated ones', () => {
  let p = patchLayer(validateProject(demoProject()), 'headline', { effects: [{ type: 'noise', enabled: true, mode: 'mono', sizeX: 1, sizeY: 1, linked: true, density: 1, opacity: 0.15, color1: '#000000', color2: '#ffffff', animated: false, seed: 42 }] });
  const headline = layer(p, 'headline');
  const plain = captureState(headline, 1, p.fps, {}, 'plain')[0];
  assert.deepEqual(Object.keys(plain.values).sort(), ['opacity', 'roll', 'size', 'x', 'y']);
  const full = captureState(headline, 1, p.fps, {}, 'full', { all: true })[0];
  assert.deepEqual(full.values, { x: 6, y: 6, opacity: 1, roll: 0, size: 48, color: '#ffffff', letterSpacing: -0.035, lineHeight: 0.98, noiseOpacity: 0.15 });
  assert.deepEqual(capturedProperties(full), ['Position', 'Size', 'Opacity', 'Rotation', 'Color', 'Letter spacing', 'Line height', 'Noise']);
  const carousel = captureState(layer(p, 'carousel'), 0, p.fps, {}, 'c', { all: true })[0];
  assert.equal(carousel.values.intensity, 0.35);
  assert.equal(carousel.values.layerEffectIntensity, 1);
  assert.equal(Object.hasOwn(carousel.values, 'blurAmount'), false);
  // Once a state holds color, later captures carry the evaluated color too.
  p = patchLayer(p, 'headline', { choreography: [full] });
  const next = captureState(layer(p, 'headline'), 3, p.fps, { x: 30 }, 'next');
  assert.equal(next[1].values.color, '#ffffff');
  assert.equal(Object.hasOwn(next[1].values, 'blurAmount'), false);
});

test('inspector edits keep static values static and edit held values at the playhead', () => {
  let p = textProject([{ id: 'a', time: 0, easing: 'linear', values: pose }, { id: 'b', time: 2, easing: 'linear', values: { ...pose, x: 40 } }],
    { effects: [{ type: 'blur', enabled: true, amount: 8, mode: 'uniform', direction: 'bottom' }] });
  let headline = layer(p, 'headline');
  assert.deepEqual(choreographyPatch(headline, { color: '#ff0000' }, 1, p.fps), { color: '#ff0000' });
  const staticBlur = [{ ...headline.effects[0], amount: 12 }];
  assert.deepEqual(choreographyPatch(headline, { effects: staticBlur }, 1, p.fps), { effects: staticBlur });
  p = patchLayer(p, 'headline', { choreography: headline.choreography.map(state => ({ ...state, values: { ...state.values, color: state.id === 'a' ? '#000000' : '#ffffff', blurAmount: state.id === 'a' ? 0 : 20 } })) });
  headline = layer(p, 'headline');
  // The effect controls send the displayed (evaluated) list.
  const displayed = evaluateChoreography(headline, 1);
  const edit = choreographyPatch(headline, { color: '#ff0000', effects: [{ ...displayed.effects[0], amount: 30, mode: 'progressive' }] }, 1, p.fps);
  assert.deepEqual(edit.effects, [{ ...headline.effects[0], mode: 'progressive' }]);
  p = patchLayer(p, 'headline', edit);
  headline = layer(p, 'headline');
  assert.equal(headline.color, '#ffffff');
  assert.equal(headline.effects[0].amount, 8);
  const middle = headline.choreography.find(state => state.time === 1);
  assert.equal(middle.values.color, '#ff0000');
  assert.equal(middle.values.blurAmount, 30);
  assert.equal(evaluateChoreography(headline, 1).effects[0].amount, 30);
  // Unchanged animated amounts do not create states.
  const toggle = choreographyPatch(headline, { effects: [{ ...evaluateChoreography(headline, 0.5).effects[0], direction: 'top' }] }, 0.5, p.fps);
  assert.equal(Object.hasOwn(toggle, 'choreography'), false);
  assert.equal(toggle.effects[0].amount, 8);
});

test('new state values are shared by linked formats while the pose stays local', () => {
  let p = textProject([
    { id: 'a', time: 0, easing: 'linear', values: { ...pose, color: '#000000', letterSpacing: 0 } },
    { id: 'b', time: 2, easing: [0.2, 0, 0.2, 1], values: { ...pose, x: 40, color: '#ffffff', letterSpacing: 0.2 } }
  ], { x: 40, y: 40 });
  p = linkFormats(p);
  let landscape = switchFormat(p, 'landscape');
  const cached = landscape.linkedFormats.layouts.landscape.layers.headline.choreography.b;
  assert.deepEqual(Object.keys(cached).sort(), ['roll', 'size', 'x', 'y']);
  const edited = structuredClone(layer(landscape, 'headline').choreography);
  edited[1].values.color = '#ff0000'; edited[1].values.letterSpacing = 0.3; edited[1].values.x = 70;
  landscape = patchLayer(landscape, 'headline', { choreography: edited });
  const square = switchFormat(landscape, 'square'), squareEnd = layer(square, 'headline').choreography[1];
  assert.deepEqual([squareEnd.values.color, squareEnd.values.letterSpacing, squareEnd.easing], ['#ff0000', 0.3, [0.2, 0, 0.2, 1]]);
  assert.notEqual(squareEnd.values.x, 70);
  assert.equal(layer(switchFormat(square, 'landscape'), 'headline').choreography[1].values.x, 70);
  // Locked layers: switching formats may move the pose, never shared values.
  const locked = patchLayer(square, 'headline', { locked: true });
  assert.doesNotThrow(() => assertLocksRespected(locked, switchFormat(locked, 'portrait'), { allow: ['format'] }));
  const recolored = structuredClone(locked);
  layer(recolored, 'headline').choreography[1].values.color = '#00ff00';
  assert.throws(() => assertLocksRespected(locked, recolored, { allow: ['format'] }), /Unlock/);
});

test('animated values update the scene in place; animating an effect amount refreshes effects', () => {
  const base = textProject([{ id: 'a', time: 0, easing: 'linear', values: pose }], { effects: [{ type: 'noise', enabled: true, mode: 'mono', sizeX: 1, sizeY: 1, linked: true, density: 1, opacity: 0.15, color1: '#000000', color2: '#ffffff', animated: false, seed: 42 }] });
  const state = layer(base, 'headline').choreography[0];
  const colored = patchLayer(base, 'headline', { choreography: [{ ...state, values: { ...state.values, color: '#ff0000', letterSpacing: 0.2 } }] });
  assert.deepEqual(sceneUpdatePlan(base, colored), { effects: false });
  const shader = patchLayer(base, 'carousel', { choreography: captureState(layer(base, 'carousel'), 0, base.fps, { intensity: 1, layerEffectIntensity: 0.5 }, 'c') });
  assert.deepEqual(sceneUpdatePlan(base, shader), { effects: false });
  const fading = patchLayer(base, 'headline', { choreography: [{ ...state, values: { ...state.values, noiseOpacity: 0.6 } }] });
  assert.deepEqual(sceneUpdatePlan(base, fading), { effects: true });
  const refaded = patchLayer(fading, 'headline', { choreography: [{ ...state, values: { ...state.values, noiseOpacity: 0.3 } }] });
  assert.deepEqual(sceneUpdatePlan(fading, refaded), { effects: false });
});
