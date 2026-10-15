import { DEFAULT_MOTION, normalizeMotion, evaluateMotionClock } from './motion-timing.js';

export const DEFAULT_MODEL_STYLE = Object.freeze({
  mode: 'original', color: '#ffffff', roughness: .5, metalness: 0, clearcoat: 0, iridescence: 0,
  emissive: '#000000', emissiveIntensity: 0,
  shader: 'standard', toonSteps: 4, fresnelColor: '#ffffff', fresnelIntensity: .5, fresnelPower: 3,
  environment: 'none', environmentIntensity: 1, environmentRotation: 0,
  ambientIntensity: 3, keyIntensity: 3, fillIntensity: 0, rimIntensity: 0, lightRotation: 0,
  motion: 'none', motionDuration: 6, motionSpeed: 1, motionAmplitude: 1,
  motionAxis: 'auto', motionSteps: 4, motionTiming: DEFAULT_MOTION,
  animationClip: 0, animationSpeed: 1,
  framing: 'fit', zoom: 1, perspective: 38
});
export const MODEL_MATERIAL_MODES = Object.freeze(['original', 'tint', 'replace']);
export const MODEL_SHADERS = Object.freeze(['standard', 'toon', 'fresnel', 'wireframe']);
export const MODEL_MOTIONS = Object.freeze(['none', 'spin', 'rock', 'float', 'pulse']);
export const MODEL_MOTION_AXES = Object.freeze(['auto', 'x', 'y', 'z']);
// Fit keeps the whole motion envelope in the layer; fixed is the pre-v11 camera.
export const MODEL_FRAMINGS = Object.freeze(['fit', 'fixed']);
// Pulse scales by up to 12% and Float moves by up to 0.2 normalized units at full amplitude.
export const MODEL_PULSE_SCALE = .12, MODEL_FLOAT_OFFSET = .2;
export const MODEL_STYLE_RANGES = Object.freeze({
  roughness: [0, 1], metalness: [0, 1], clearcoat: [0, 1], iridescence: [0, 1], emissiveIntensity: [0, 4],
  toonSteps: [2, 8], fresnelIntensity: [0, 2], fresnelPower: [1, 8],
  environmentIntensity: [0, 4], environmentRotation: [-180, 180],
  ambientIntensity: [0, 6], keyIntensity: [0, 10], fillIntensity: [0, 10], rimIntensity: [0, 10], lightRotation: [-180, 180],
  motionDuration: [.25, 300], motionSpeed: [-4, 4], motionAmplitude: [0, 1], motionSteps: [1, 24], animationClip: [-1, 65535], animationSpeed: [0, 4],
  zoom: [.25, 4], perspective: [15, 75]
});
const paintDefaults = Object.fromEntries(['mode', 'color', 'roughness', 'metalness', 'clearcoat', 'iridescence', 'emissive', 'emissiveIntensity'].map(key => [key, DEFAULT_MODEL_STYLE[key]]));
const paint = (color, roughness, metalness, clearcoat = 0, iridescence = 0) => Object.freeze({ ...paintDefaults, mode: 'replace', color, roughness, metalness, clearcoat, iridescence, shader: 'standard', environment: 'studio' });
export const MODEL_MATERIAL_PRESETS = Object.freeze([
  { id: 'original', name: 'Original', settings: Object.freeze({ ...paintDefaults, shader: 'standard', environment: 'none', ambientIntensity: 3, keyIntensity: 3, fillIntensity: 0, rimIntensity: 0, lightRotation: 0 }) },
  { id: 'matte', name: 'Matte', settings: paint('#ffffff', .9, 0) },
  { id: 'plastic', name: 'Plastic', settings: paint('#ffffff', .3, 0, .7) },
  { id: 'satin', name: 'Satin metal', settings: paint('#b8b8c0', .4, 1) },
  { id: 'chrome', name: 'Chrome', settings: paint('#e5e5e5', .08, 1) },
  { id: 'iridescent', name: 'Iridescent', settings: paint('#7f91a7', .2, 1, 0, 1) }
]);
export function normalizeModelStyle(input) {
  const prototype = input && typeof input === 'object' ? Object.getPrototypeOf(input) : null;
  const plain = prototype === null || (Object.getPrototypeOf(prototype) === null && Object.hasOwn(prototype, 'constructor') && typeof prototype.constructor === 'function' && Function.prototype.toString.call(prototype.constructor) === Function.prototype.toString.call(Object));
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input) || !plain || Object.getOwnPropertySymbols(input).length || Object.keys(input).some(key => !Object.hasOwn(DEFAULT_MODEL_STYLE, key)))) throw new Error('Invalid 3D model settings.');
  const value = { ...DEFAULT_MODEL_STYLE, ...input };
  if (!MODEL_MATERIAL_MODES.includes(value.mode) || !MODEL_SHADERS.includes(value.shader) || !MODEL_MOTIONS.includes(value.motion) || !MODEL_MOTION_AXES.includes(value.motionAxis) || !['none', 'studio'].includes(value.environment) || !MODEL_FRAMINGS.includes(value.framing)) throw new Error('Unknown 3D material, shader, environment, motion or framing.');
  for (const key of ['color', 'emissive', 'fresnelColor']) if (typeof value[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(value[key])) throw new Error('Invalid 3D model color.');
  for (const [key, [min, max]] of Object.entries(MODEL_STYLE_RANGES)) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max || (['toonSteps', 'motionSteps', 'animationClip'].includes(key) && !Number.isInteger(value[key]))) throw new Error(`Invalid 3D model ${key}.`);
  }
  try { value.motionTiming = normalizeMotion(value.motionTiming); }
  catch (error) { throw new Error(`Invalid 3D model motion timing: ${error.message}`); }
  return value;
}
export function applyModelPreset(style, id) {
  const preset = MODEL_MATERIAL_PRESETS.find(item => item.id === id);
  if (!preset) throw new Error('Unknown 3D material preset.');
  return normalizeModelStyle({ ...normalizeModelStyle(style), ...preset.settings });
}
export function selectedModelPreset(style) {
  const value = normalizeModelStyle(style);
  if (value.mode === 'original') return 'original';
  return MODEL_MATERIAL_PRESETS.find(preset => Object.keys(paintDefaults).every(key => value[key] === preset.settings[key]))?.id ?? 'custom';
}
export function resetModelMotion(style) {
  return normalizeModelStyle({
    ...normalizeModelStyle(style),
    motionDuration: 6, motionSpeed: 1, motionAmplitude: 1, motionAxis: 'auto', motionSteps: 4,
    motionTiming: { ...DEFAULT_MOTION }
  });
}
// Largest pose the automatic motion reaches beyond the authored one, for framing.
export function modelMotionReach(style) {
  return {
    scale: style.motion === 'pulse' ? 1 + style.motionAmplitude * MODEL_PULSE_SCALE : 1,
    offset: style.motion === 'float' ? style.motionAmplitude * MODEL_FLOAT_OFFSET : 0
  };
}
// Additive to the authored pose; clip playback uses its own clock and controls.
export function automaticModelMotion(style, elapsed, out = {}) {
  const timing = style.motionTiming;
  const count = timing.mode === 'steps' && style.motion === 'spin' ? style.motionSteps : 1;
  const local = Math.max(0, elapsed) * (timing.mode === 'steps' ? 1 : Math.abs(style.motionSpeed));
  evaluateMotionClock(timing, count, local, Math.sign(style.motionSpeed), style.motionDuration, 'model', out);
  const phase = (out.advance / count) % 1;
  const wave = Math.sin(phase * Math.PI * 2), amplitude = style.motionAmplitude;
  out.rotationX = out.rotationY = out.rotationZ = 0;
  out.offsetX = out.offsetY = out.offsetZ = 0;
  out.scaleX = out.scaleY = out.scaleZ = 1;
  const axis = style.motionAxis === 'auto' ? (style.motion === 'rock' ? 'z' : 'y') : style.motionAxis;
  if (style.motion === 'spin') {
    const turn = phase * Math.PI * 2;
    if (axis === 'x') out.rotationX = turn;
    else if (axis === 'y') out.rotationY = turn;
    else out.rotationZ = turn;
  } else if (style.motion === 'rock') {
    const angle = wave * amplitude * Math.PI / 9;
    if (axis === 'x') out.rotationX = angle;
    else if (axis === 'y') out.rotationY = angle;
    else out.rotationZ = angle;
  } else if (style.motion === 'float') {
    const offset = wave * amplitude * MODEL_FLOAT_OFFSET;
    if (axis === 'x') out.offsetX = offset;
    else if (axis === 'y') out.offsetY = offset;
    else out.offsetZ = offset;
  } else if (style.motion === 'pulse') {
    const scale = 1 + wave * amplitude * MODEL_PULSE_SCALE;
    if (style.motionAxis === 'auto' || axis === 'x') out.scaleX = scale;
    if (style.motionAxis === 'auto' || axis === 'y') out.scaleY = scale;
    if (style.motionAxis === 'auto' || axis === 'z') out.scaleZ = scale;
  }
  return out;
}
