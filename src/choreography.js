import { easeProgress } from './easing.js';
import { DEFAULT_TEXT_STYLE } from './text-style.js';
import { PROJECT_LIMITS } from './project-limits.js';
import { SCENE_DEPTH_RANGE, assertPlainSceneRecord } from './scene-settings.js';

// The pose every state holds: framing, size, opacity and orientation.
const COMMON_FIELDS = { x: [0, 95], y: [0, 95], z: SCENE_DEPTH_RANGE, opacity: [0, 1], tilt: [-180, 180], yaw: [-180, 180], roll: [-180, 180] };
const FIELDS = {
  effect: { opacity: [0, 1] },
  text: { ...COMMON_FIELDS, size: [12, 180] },
  logo: { ...COMMON_FIELDS, x: [-1000, 1000], y: [-1000, 1000], size: [2, 500] },
  media: { ...COMMON_FIELDS, x: [-1000, 1000], y: [-1000, 1000], size: [2, 500] },
  model: { ...COMMON_FIELDS, x: [-1000, 1000], y: [-1000, 1000], size: [2, 500], tilt: [-180, 180], yaw: [-180, 180], roll: [-180, 180] },
  carousel: { x: [10, 90], y: [10, 90], z: SCENE_DEPTH_RANGE, size: [0.5, 2.5], opacity: [0, 1], tilt: [-65, 65], yaw: [-180, 180], roll: [-180, 180] }
};

// Optional values: a state that omits one leaves it to the neighboring states
// that hold it, or to the layer's own value when none does. Effect amounts
// drive the first effect of their type in the layer's effects.
export const EFFECT_FIELDS = Object.freeze({
  blurAmount: { type: 'blur', key: 'amount', bounds: [0, 48] },
  noiseOpacity: { type: 'noise', key: 'opacity', bounds: [0, 1] },
  monochromeAmount: { type: 'monochrome', key: 'amount', bounds: [0, 1] },
  warpAmount: { type: 'optical-warp', key: 'amount', bounds: [0, 1] },
  duotoneAmount: { type: 'duotone', key: 'amount', bounds: [0, 1] },
  chromaticAmount: { type: 'chromatic', key: 'amount', bounds: [0, 1] },
  waveAmount: { type: 'wave', key: 'amount', bounds: [0, 1] },
  halftoneAmount: { type: 'halftone', key: 'amount', bounds: [0, 1] },
  ditheringAmount: { type: 'dithering', key: 'amount', bounds: [0, 1] },
  glassAmount: { type: 'fluted-glass', key: 'amount', bounds: [0, 1] }
});
const EFFECT_BOUNDS = Object.fromEntries(Object.entries(EFFECT_FIELDS).map(([field, { bounds }]) => [field, bounds]));
const OPTIONAL_FIELDS = {
  text: { color: 'color', letterSpacing: [-0.15, 0.5], lineHeight: [0.5, 3], ...EFFECT_BOUNDS },
  carousel: { stretch: [0, 1], ...EFFECT_BOUNDS },
  logo: EFFECT_BOUNDS, media: EFFECT_BOUNDS, model: EFFECT_BOUNDS, effect: EFFECT_BOUNDS
};
const LABELS = { x: 'Position', y: 'Position', z: 'Depth', size: 'Size', opacity: 'Opacity', roll: 'Rotation', tilt: 'Tilt', yaw: 'Yaw',
  stretch: 'Edge stretch', color: 'Color', letterSpacing: 'Letter spacing', lineHeight: 'Line height',
  blurAmount: 'Blur', noiseOpacity: 'Noise', monochromeAmount: 'Monochrome', warpAmount: 'Optical warp',
  duotoneAmount: 'Duotone', chromaticAmount: 'Chromatic split', waveAmount: 'Liquid wave', halftoneAmount: 'Halftone', ditheringAmount: 'Dithering', glassAmount: 'Fluted glass' };

export const choreographyFields = layer => FIELDS[layer?.type] ?? {};
export const optionalChoreographyFields = layer => OPTIONAL_FIELDS[layer?.type] ?? {};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const effectIndex = (layer, field) => layer.effects?.findIndex(effect => effect.type === EFFECT_FIELDS[field].type) ?? -1;
const heldBy = (states, field) => states?.some(state => Object.hasOwn(state.values, field)) ?? false;

// Optional fields at least one state holds.
export const animatedFields = layer => Object.keys(optionalChoreographyFields(layer)).filter(field => heldBy(layer.choreography, field));

// Optional fields this layer can capture now: effect amounts need their effect.
export const capturableFields = layer => Object.keys(optionalChoreographyFields(layer))
  .filter(field => !Object.hasOwn(EFFECT_FIELDS, field) || effectIndex(layer, field) !== -1);

// The current value of a pose or optional field on a (possibly evaluated) layer.
export function choreographyValue(layer, field) {
  if (Object.hasOwn(EFFECT_FIELDS, field)) {
    const index = effectIndex(layer, field);
    return index === -1 ? undefined : layer.effects[index][EFFECT_FIELDS[field].key];
  }
  if (layer.type === 'text' && Object.hasOwn(DEFAULT_TEXT_STYLE, field)) return Number.isFinite(layer[field]) ? layer[field] : DEFAULT_TEXT_STYLE[field];
  return layer[field];
}

// Display names of what a state holds, in a stable order.
export const capturedProperties = state => [...new Set(Object.keys(LABELS).filter(field => Object.hasOwn(state.values, field)).map(field => LABELS[field]))];

const toLinear = channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
const toSrgb = channel => channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
const channels = hex => [1, 3, 5].map(index => toLinear(parseInt(hex.slice(index, index + 2), 16) / 255));
// Colors blend in linear RGB, so midpoints keep their perceived brightness.
export function mixColor(from, to, progress) {
  const a = channels(from), b = channels(to);
  return `#${a.map((value, i) => Math.round(clamp(toSrgb(value + (b[i] - value) * progress), 0, 1) * 255).toString(16).padStart(2, '0')).join('')}`;
}

// Overshooting curves (back, spring, custom) stay within the field's bounds.
function sample(states, field, time, base, kind) {
  const holders = states.filter(state => Object.hasOwn(state.values, field));
  if (!holders.length) return base;
  if (time <= holders[0].time) return holders[0].values[field];
  const last = holders.at(-1);
  if (time >= last.time) return last.values[field];
  const index = holders.findIndex(state => state.time >= time);
  const from = holders[index - 1], to = holders[index];
  const progress = easeProgress(to.easing, (time - from.time) / (to.time - from.time));
  if (kind === 'color') return mixColor(from.values[field], to.values[field], progress);
  const value = from.values[field] + (to.values[field] - from.values[field]) * progress;
  return progress >= 0 && progress <= 1 ? value : clamp(value, ...kind);
}

// Only the supplied time determines a pose, so seeking and exported frames agree.
export function evaluateChoreography(layer, absoluteTime) {
  const states = layer.choreography;
  if (!states?.length) return layer;
  const time = absoluteTime - layer.start;
  const pose = { ...layer };
  for (const [field, bounds] of Object.entries(choreographyFields(layer))) pose[field] = sample(states, field, time, layer[field], bounds);
  let effects = null;
  for (const [field, kind] of Object.entries(optionalChoreographyFields(layer))) {
    if (!heldBy(states, field)) continue;
    if (!Object.hasOwn(EFFECT_FIELDS, field)) { pose[field] = sample(states, field, time, layer[field], kind); continue; }
    const index = effectIndex(layer, field);
    if (index === -1) continue;
    const { key } = EFFECT_FIELDS[field];
    effects ??= layer.effects.map(effect => ({ ...effect }));
    effects[index][key] = sample(states, field, time, layer.effects[index][key], kind);
  }
  if (effects) pose.effects = effects;
  return pose;
}

function frameRate(fps) {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('A positive frame rate is required.');
  return fps;
}

export function stateAtTime(layer, absoluteTime, fps) {
  frameRate(fps);
  const time = absoluteTime - layer.start;
  const exact = layer.choreography?.reduce((closest, state) => Math.abs(state.time - time) <= 1e-9 && (!closest || Math.abs(state.time - time) < Math.abs(closest.time - time)) ? state : closest, undefined);
  const frame = Math.round(time * fps);
  return exact ?? layer.choreography?.find(state => Math.round(state.time * fps) === frame);
}

// A state always holds the pose. Optional values are held when patched, already
// held by this state or another one, or, with `all`, whenever they apply.
export function captureState(layer, absoluteTime, fps, patch = {}, id = crypto.randomUUID(), { all = false } = {}) {
  frameRate(fps);
  const fields = choreographyFields(layer), optional = optionalChoreographyFields(layer);
  if (!Object.keys(fields).length) throw new Error('This layer cannot have choreography.');
  if (!Number.isFinite(absoluteTime)) throw new Error('State time must be finite.');
  assertPlainSceneRecord(patch, 'choreography values');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(field => !Object.hasOwn(fields, field) && !Object.hasOwn(optional, field))) throw new Error('Invalid choreography values.');
  const maxFrame = Math.floor(Math.min(PROJECT_LIMITS.maxDuration, layer.end - layer.start) * fps + 1e-9);
  const frameTime = clamp(Math.round((absoluteTime - layer.start) * fps), 0, maxFrame) / fps;
  const existing = stateAtTime(layer, absoluteTime, fps) ?? stateAtTime(layer, layer.start + frameTime, fps);
  // Preserve off-frame imported times when replacing their frame, keeping ordering intact.
  const time = existing?.time ?? frameTime;
  const pose = evaluateChoreography(layer, layer.start + time);
  const values = Object.fromEntries(Object.keys(fields).map(field => [field, Object.hasOwn(patch, field) ? patch[field] : pose[field] ?? (field === 'opacity' ? 1 : ['z', 'tilt', 'yaw', 'roll'].includes(field) ? 0 : undefined)]));
  const capturable = new Set(capturableFields(layer)), animated = new Set(animatedFields(layer));
  for (const field of Object.keys(optional)) {
    if (Object.hasOwn(patch, field)) values[field] = patch[field];
    else if (existing && Object.hasOwn(existing.values, field) && !capturable.has(field)) values[field] = existing.values[field];
    else if (capturable.has(field) && (all || animated.has(field))) values[field] = choreographyValue(pose, field);
  }
  const state = { id: existing?.id ?? id, time, easing: existing?.easing ?? 'ease-in-out', values };
  return [...(layer.choreography ?? []).filter(entry => entry.id !== existing?.id), state].sort((a, b) => a.time - b.time);
}

export function moveState(layer, id, localTime, fps) {
  frameRate(fps);
  if (!Number.isFinite(localTime)) throw new Error('State time must be finite.');
  const states = layer.choreography ?? [];
  const index = states.findIndex(state => state.id === id);
  if (index === -1) throw new Error('State not found.');
  const minFrame = index > 0 ? Math.round(states[index - 1].time * fps) + 1 : 0;
  const clipEnd = Math.floor(Math.min(PROJECT_LIMITS.maxDuration, layer.end - layer.start) * fps + 1e-9);
  const maxFrame = Math.min(clipEnd, index < states.length - 1 ? Math.round(states[index + 1].time * fps) - 1 : clipEnd);
  if (minFrame > maxFrame) return states;
  const time = clamp(Math.round(localTime * fps), minFrame, maxFrame) / fps;
  return states.map(state => state.id === id ? { ...state, time } : state);
}
