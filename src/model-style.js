import { DEFAULT_MOTION, normalizeMotion, evaluateMotionClock } from './motion-timing.js';

// New models start with the Studio lighting preset; migrations freeze older looks.
const STUDIO_LIGHTING = Object.freeze({
  environment: 'softbox', environmentIntensity: 1, environmentRotation: 0, toneMapping: 'neutral', exposure: 1,
  ambientIntensity: .4, keyIntensity: 1.6, fillIntensity: .4, rimIntensity: 1.2, lightRotation: 0,
  keyColor: '#ffffff', fillColor: '#dfe7ff', rimColor: '#ffffff'
});
export const DEFAULT_MODEL_STYLE = Object.freeze({
  base: 'imported', color: '#ffffff', roughness: .5, metalness: 0, clearcoat: 0, iridescence: 0,
  emissive: '#000000', emissiveIntensity: 0,
  // Custom-surface details. With equal film bounds three.js uses the 400 nm film it always
  // did, and the others are its own defaults, so older projects render unchanged.
  clearcoatRoughness: 0, sheen: 0, sheenColor: '#ffffff', sheenRoughness: 1, anisotropy: 0, anisotropyRotation: 0,
  iridescenceIOR: 1.3, iridescenceThicknessMin: 400, iridescenceThicknessMax: 400,
  // Glass only: index of refraction, how much of the tinted body covers the layers
  // below (See-through) and the spectral spread of refracted light (Refractive, Environment).
  ior: 1.5, glassOpacity: .08, dispersion: 0,
  refractionThickness: .5, refractionSamples: 8, refractionResolution: 1024,
  look: 'physical', glass: 'none', toonSteps: 4,
  // Edge glow (Physical look without glass) is off at zero intensity.
  fresnelColor: '#ffffff', fresnelIntensity: 0, fresnelPower: 3,
  ...STUDIO_LIGHTING,
  motion: 'none', motionDuration: 6, motionSpeed: 1, motionAmplitude: 1,
  motionAxis: 'auto', motionSpace: 'screen', motionSteps: 4, motionTiming: DEFAULT_MOTION,
  animationClip: 0, animationSpeed: 1,
  framing: 'fit', zoom: 1, perspective: 38
});
// Where the surface comes from: the imported materials, those multiplied by color, or a custom surface.
export const MODEL_BASES = Object.freeze(['imported', 'tinted', 'custom']);
// How the surface is lit: physically based, banded toon light, or unlit edges.
export const MODEL_LOOKS = Object.freeze(['physical', 'toon', 'wireframe']);
// Physical look only. see-through reveals lower layers without bending; refractive bends and
// blurs the actual lower-layer composition; environment refracts the model's own reflection
// environment and is opaque.
export const MODEL_GLASS = Object.freeze(['none', 'see-through', 'refractive', 'environment']);
export const MODEL_REFRACTION_SAMPLES = Object.freeze([4, 8, 16]);
export const MODEL_REFRACTION_RESOLUTIONS = Object.freeze([256, 512, 1024, 2048]);
export const MODEL_MOTIONS = Object.freeze(['none', 'spin', 'rock', 'float', 'pulse']);
export const MODEL_MOTION_AXES = Object.freeze(['auto', 'x', 'y', 'z']);
// Screen turns and moves about the view's axes; object about the model's own
// posed axes; euler is the pre-v12 sum of motion and pose angles.
export const MODEL_MOTION_SPACES = Object.freeze(['screen', 'object', 'euler']);
// Generated reflection environments ('studio' is the pre-v13 room); see model-environment.js.
export const MODEL_ENVIRONMENTS = Object.freeze(['none', 'studio', 'softbox', 'stage', 'sunset', 'neon']);
// none is the pre-v13 output: lighting clips at white instead of rolling off.
export const MODEL_TONE_MAPPINGS = Object.freeze(['none', 'neutral', 'agx']);
const MODEL_COLOR_KEYS = ['color', 'emissive', 'sheenColor', 'fresnelColor', 'keyColor', 'fillColor', 'rimColor'];
// Fit keeps the whole motion envelope in the layer; fixed is the pre-v11 camera.
export const MODEL_FRAMINGS = Object.freeze(['fit', 'fixed']);
// Pulse scales by up to 12% and Float moves by up to 0.2 normalized units at full amplitude.
export const MODEL_PULSE_SCALE = .12, MODEL_FLOAT_OFFSET = .2;
export const MODEL_STYLE_RANGES = Object.freeze({
  roughness: [0, 1], metalness: [0, 1], clearcoat: [0, 1], iridescence: [0, 1], emissiveIntensity: [0, 4],
  clearcoatRoughness: [0, 1], sheen: [0, 1], sheenRoughness: [0, 1], anisotropy: [0, 1], anisotropyRotation: [-180, 180],
  iridescenceIOR: [1, 2.5], iridescenceThicknessMin: [0, 1200], iridescenceThicknessMax: [0, 1200],
  ior: [1, 2.5], glassOpacity: [0, 1], dispersion: [0, 1],
  refractionThickness: [0, 2],
  toonSteps: [2, 8], fresnelIntensity: [0, 2], fresnelPower: [1, 8],
  environmentIntensity: [0, 4], environmentRotation: [-180, 180], exposure: [.25, 4],
  ambientIntensity: [0, 6], keyIntensity: [0, 10], fillIntensity: [0, 10], rimIntensity: [0, 10], lightRotation: [-180, 180],
  motionDuration: [.25, 300], motionSpeed: [-4, 4], motionAmplitude: [0, 1], motionSteps: [1, 24], animationClip: [-1, 65535], animationSpeed: [0, 4],
  zoom: [.25, 4], perspective: [15, 75]
});
const SURFACE_KEYS = ['base', 'color', 'roughness', 'metalness', 'clearcoat', 'iridescence', 'emissive', 'emissiveIntensity',
  'clearcoatRoughness', 'sheen', 'sheenColor', 'sheenRoughness', 'anisotropy', 'anisotropyRotation', 'iridescenceIOR', 'iridescenceThicknessMin', 'iridescenceThicknessMax',
  'ior', 'glassOpacity', 'dispersion', 'refractionThickness', 'refractionSamples', 'refractionResolution', 'look', 'glass', 'fresnelIntensity'];
const paintDefaults = Object.fromEntries(SURFACE_KEYS.map(key => [key, DEFAULT_MODEL_STYLE[key]]));
// Material presets set the surface only; lighting presets set the environment and rig.
// Metal colors are the measured linear reflectance of each metal, written in sRGB.
const surface = settings => Object.freeze({ ...paintDefaults, base: 'custom', ...settings });
const iridescent = (iridescenceIOR, iridescenceThicknessMin, iridescenceThicknessMax) => ({ iridescence: 1, iridescenceIOR, iridescenceThicknessMin, iridescenceThicknessMax });
export const MODEL_MATERIAL_FAMILIES = Object.freeze([['basic', 'Basics'], ['metal', 'Metals'], ['iridescent', 'Iridescent'], ['fabric', 'Fabric'], ['see-through', 'See-through glass'], ['refractive', 'Refractive glass'], ['environment', 'Environment glass']]);
export const MODEL_MATERIAL_PRESETS = Object.freeze([
  { id: 'original', name: 'Original', family: 'basic', settings: Object.freeze({ ...paintDefaults }) },
  { id: 'matte', name: 'Matte', family: 'basic', settings: surface({ roughness: .9 }) },
  { id: 'plastic', name: 'Gloss plastic', family: 'basic', settings: surface({ color: '#f4f4f2', roughness: .28, clearcoat: 1, clearcoatRoughness: .06 }) },
  { id: 'ceramic', name: 'Ceramic', family: 'basic', settings: surface({ color: '#f2efe8', roughness: .22, clearcoat: 1, clearcoatRoughness: .04 }) },
  { id: 'lacquer', name: 'Candy lacquer', family: 'basic', settings: surface({ color: '#d1002e', roughness: .35, metalness: .6, clearcoat: 1, clearcoatRoughness: .02 }) },
  { id: 'rubber', name: 'Rubber', family: 'basic', settings: surface({ color: '#26262a', roughness: .72 }) },
  { id: 'chrome', name: 'Mirror chrome', family: 'metal', settings: surface({ color: '#c4c5c4', roughness: .03, metalness: 1 }) },
  { id: 'satin', name: 'Satin steel', family: 'metal', settings: surface({ color: '#c4c5c4', roughness: .35, metalness: 1, anisotropy: .5 }) },
  { id: 'gold', name: 'Polished gold', family: 'metal', settings: surface({ color: '#ffe39d', roughness: .14, metalness: 1 }) },
  { id: 'rose-gold', name: 'Rose gold', family: 'metal', settings: surface({ color: '#fdd4c4', roughness: .18, metalness: 1 }) },
  { id: 'copper', name: 'Copper', family: 'metal', settings: surface({ color: '#fad1c2', roughness: .26, metalness: 1 }) },
  { id: 'brushed-aluminium', name: 'Brushed aluminium', family: 'metal', settings: surface({ color: '#f5f6f6', roughness: .32, metalness: 1, anisotropy: .9 }) },
  { id: 'brushed-gold', name: 'Brushed gold', family: 'metal', settings: surface({ color: '#ffe39d', roughness: .3, metalness: 1, anisotropy: .9 }) },
  { id: 'gunmetal', name: 'Gunmetal', family: 'metal', settings: surface({ color: '#6f6f73', roughness: .28, metalness: 1, clearcoat: .8, clearcoatRoughness: .1 }) },
  { id: 'iridescent', name: 'Iridescent metal', family: 'iridescent', settings: surface({ color: '#dfe3ea', roughness: .2, metalness: 1, ...iridescent(1.33, 200, 800) }) },
  { id: 'holographic', name: 'Holographic foil', family: 'iridescent', settings: surface({ color: '#7f86a0', roughness: .2, metalness: 1, ...iridescent(1.5, 300, 600) }) },
  { id: 'titanium', name: 'Anodized titanium', family: 'iridescent', settings: surface({ color: '#9099b8', roughness: .22, metalness: 1, ...iridescent(1.33, 380, 480) }) },
  { id: 'oil-slick', name: 'Oil slick', family: 'iridescent', settings: surface({ color: '#08080a', roughness: .3, metalness: .6, ...iridescent(1.7, 250, 800) }) },
  { id: 'pearl', name: 'Pearl', family: 'iridescent', settings: surface({ color: '#f3eee6', roughness: .32, clearcoat: 1, sheen: .6, sheenColor: '#ffd8ef', ...iridescent(1.45, 300, 650), iridescence: .55 }) },
  { id: 'velvet', name: 'Velvet', family: 'fabric', settings: surface({ color: '#5c0f2e', roughness: .85, sheen: 1, sheenRoughness: .45, sheenColor: '#ff8fbd' }) },
  { id: 'clear-glass', name: 'Clear glass', family: 'see-through', settings: surface({ glass: 'see-through', roughness: .04, glassOpacity: .04 }) },
  { id: 'frosted-glass', name: 'Frosted glass', family: 'see-through', settings: surface({ glass: 'see-through', color: '#f2f5f8', roughness: .55, glassOpacity: .45 }) },
  { id: 'tinted-glass', name: 'Tinted glass', family: 'see-through', settings: surface({ glass: 'see-through', color: '#3d9bff', roughness: .05, glassOpacity: .35 }) },
  { id: 'smoked-glass', name: 'Smoked glass', family: 'see-through', settings: surface({ glass: 'see-through', color: '#18181b', roughness: .08, glassOpacity: .5 }) },
  { id: 'bubble', name: 'Soap bubble', family: 'see-through', settings: surface({ glass: 'see-through', roughness: 0, metalness: .2, ior: 1.33, glassOpacity: 0, ...iridescent(1.33, 250, 850) }) },
  { id: 'refractive-clear', name: 'Clear refraction', family: 'refractive', settings: surface({ glass: 'refractive', roughness: .04, ior: 1.5, refractionThickness: .5 }) },
  { id: 'refractive-frosted', name: 'Frosted refraction', family: 'refractive', settings: surface({ glass: 'refractive', color: '#f2f5f8', roughness: .45, ior: 1.5, refractionThickness: .6 }) },
  { id: 'refractive-prism', name: 'Prismatic refraction', family: 'refractive', settings: surface({ glass: 'refractive', roughness: .02, ior: 1.6, dispersion: .6, refractionThickness: .75 }) },
  { id: 'prism', name: 'Prism', family: 'environment', settings: surface({ glass: 'environment', roughness: 0, ior: 1.6, dispersion: .6 }) },
  { id: 'diamond', name: 'Diamond', family: 'environment', settings: surface({ glass: 'environment', roughness: 0, ior: 2.42, dispersion: 1 }) },
  { id: 'frosted-crystal', name: 'Frosted crystal', family: 'environment', settings: surface({ glass: 'environment', color: '#eef3f7', roughness: .4, ior: 1.5, dispersion: .2 }) }
]);
const classic = Object.freeze({
  environment: 'none', environmentIntensity: 1, environmentRotation: 0, toneMapping: 'none', exposure: 1,
  ambientIntensity: 3, keyIntensity: 3, fillIntensity: 0, rimIntensity: 0, lightRotation: 0,
  keyColor: '#ffffff', fillColor: '#ffffff', rimColor: '#ffffff'
});
// Each lighting preset sets every environment, tone and light key, nothing else.
export const MODEL_LIGHTING_PRESETS = Object.freeze([
  { id: 'studio', name: 'Studio', settings: STUDIO_LIGHTING },
  { id: 'stage', name: 'Dark stage', settings: Object.freeze({ ...STUDIO_LIGHTING, environment: 'stage', exposure: 1.1, ambientIntensity: .1, keyIntensity: 2.2, fillIntensity: 0, rimIntensity: 2.5, fillColor: '#ffffff' }) },
  { id: 'sunset', name: 'Sunset', settings: Object.freeze({ ...STUDIO_LIGHTING, environment: 'sunset', ambientIntensity: .2, keyIntensity: 1.5, fillIntensity: .4, rimIntensity: 1, keyColor: '#ffb070', fillColor: '#4060ff', rimColor: '#ff8040' }) },
  { id: 'neon', name: 'Neon', settings: Object.freeze({ ...STUDIO_LIGHTING, environment: 'neon', ambientIntensity: .05, keyIntensity: 0, fillIntensity: 1.5, rimIntensity: 1.5, fillColor: '#ff2d9a', rimColor: '#2dd5ff' }) },
  { id: 'classic', name: 'Classic', settings: classic },
  { id: 'classic-reflections', name: 'Classic reflections', settings: Object.freeze({ ...classic, environment: 'studio' }) }
]);
export function normalizeModelStyle(input) {
  const prototype = input && typeof input === 'object' ? Object.getPrototypeOf(input) : null;
  const plain = prototype === null || (Object.getPrototypeOf(prototype) === null && Object.hasOwn(prototype, 'constructor') && typeof prototype.constructor === 'function' && Function.prototype.toString.call(prototype.constructor) === Function.prototype.toString.call(Object));
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input) || !plain || Object.getOwnPropertySymbols(input).length || Object.keys(input).some(key => !Object.hasOwn(DEFAULT_MODEL_STYLE, key)))) throw new Error('Invalid 3D model settings.');
  const value = { ...DEFAULT_MODEL_STYLE, ...input };
  if (!MODEL_BASES.includes(value.base) || !MODEL_LOOKS.includes(value.look) || !MODEL_GLASS.includes(value.glass) || !MODEL_MOTIONS.includes(value.motion) || !MODEL_MOTION_AXES.includes(value.motionAxis) || !MODEL_MOTION_SPACES.includes(value.motionSpace) || !MODEL_ENVIRONMENTS.includes(value.environment) || !MODEL_TONE_MAPPINGS.includes(value.toneMapping) || !MODEL_FRAMINGS.includes(value.framing)) throw new Error('Unknown 3D surface base, look, glass, environment, tone mapping, motion or framing.');
  for (const key of MODEL_COLOR_KEYS) if (typeof value[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(value[key])) throw new Error('Invalid 3D model color.');
  for (const [key, [min, max]] of Object.entries(MODEL_STYLE_RANGES)) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max || (['toonSteps', 'motionSteps', 'animationClip'].includes(key) && !Number.isInteger(value[key]))) throw new Error(`Invalid 3D model ${key}.`);
  }
  if (!MODEL_REFRACTION_SAMPLES.includes(value.refractionSamples)) throw new Error('Invalid 3D model refractionSamples.');
  if (!MODEL_REFRACTION_RESOLUTIONS.includes(value.refractionResolution)) throw new Error('Invalid 3D model refractionResolution.');
  if (value.iridescenceThicknessMin > value.iridescenceThicknessMax) throw new Error('Invalid 3D model iridescence thickness: the minimum exceeds the maximum.');
  if (value.look !== 'physical' && value.glass !== 'none') throw new Error('3D model glass needs the Physical look.');
  if (value.fresnelIntensity > 0 && (value.look !== 'physical' || value.glass !== 'none')) throw new Error('3D model edge glow needs the Physical look without glass.');
  try { value.motionTiming = normalizeMotion(value.motionTiming); }
  catch (error) { throw new Error(`Invalid 3D model motion timing: ${error.message}`); }
  return value;
}
function applyPreset(presets, style, id, kind) {
  const preset = presets.find(item => item.id === id);
  if (!preset) throw new Error(`Unknown 3D ${kind} preset.`);
  return normalizeModelStyle({ ...normalizeModelStyle(style), ...preset.settings });
}
export const applyModelPreset = (style, id) => applyPreset(MODEL_MATERIAL_PRESETS, style, id, 'material');
export const applyLightingPreset = (style, id) => applyPreset(MODEL_LIGHTING_PRESETS, style, id, 'lighting');
export function selectedModelPreset(style) {
  const value = normalizeModelStyle(style);
  // An imported base ignores the stored custom values, but look, glass and edge glow still show.
  if (value.base === 'imported') return value.look === 'physical' && value.glass === 'none' && value.fresnelIntensity === 0 ? 'original' : 'custom';
  return MODEL_MATERIAL_PRESETS.find(preset => SURFACE_KEYS.every(key => value[key] === preset.settings[key]))?.id ?? 'custom';
}
export function selectedLightingPreset(style) {
  const value = normalizeModelStyle(style);
  return MODEL_LIGHTING_PRESETS.find(preset => Object.entries(preset.settings).every(([key, setting]) => value[key] === setting))?.id ?? 'custom';
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
