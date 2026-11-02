import { SPATIAL_LAYER_TYPES, assertPlainSceneRecord } from './scene-settings.js';

// Whole-element motion is separate from authored/keyframed pose and content clocks.
// Float distances use percent of the composition's shorter side; rotation is
// composition Z, and pulse scales the rendered element without reflow or reframing.
export const DEFAULT_ELEMENT_MOTION = Object.freeze({
  float: Object.freeze({ enabled: false, axis: 'y', amplitude: 2, duration: 4, phase: 0, direction: 1 }),
  spin: Object.freeze({ enabled: false, duration: 12, phase: 0, direction: 1 }),
  pulse: Object.freeze({ enabled: false, amplitude: .08, duration: 4, phase: 0, direction: 1 })
});
export const ELEMENT_MOTION_RANGES = Object.freeze({
  duration: Object.freeze([.1, 120]), phase: Object.freeze([0, 1]),
  floatAmplitude: Object.freeze([0, 25]), pulseAmplitude: Object.freeze([0, .5])
});
export const supportsElementMotion = layer => SPATIAL_LAYER_TYPES.includes(layer?.type);

export function normalizeElementMotion(input = DEFAULT_ELEMENT_MOTION) {
  assertPlainSceneRecord(input, 'element motion');
  for (const key of Object.keys(input)) if (!Object.hasOwn(DEFAULT_ELEMENT_MOTION, key)) throw new Error('Unknown element motion.');
  const result = {};
  for (const [type, defaults] of Object.entries(DEFAULT_ELEMENT_MOTION)) {
    const supplied = Object.hasOwn(input, type) ? assertPlainSceneRecord(input[type], `${type} element motion`) : {};
    for (const key of Object.keys(supplied)) if (!Object.hasOwn(defaults, key)) throw new Error(`Unknown ${type} motion property.`);
    const value = { ...defaults, ...supplied };
    if (typeof value.enabled !== 'boolean') throw new Error('Element motion enabled must be a boolean.');
    if (![-1, 0, 1].includes(value.direction)) throw new Error('Element motion direction must be Forward, Reverse or Paused.');
    if (type === 'float' && !['x', 'y'].includes(value.axis)) throw new Error('Float axis must be X or Y.');
    for (const key of ['duration', 'phase', ...(type === 'spin' ? [] : ['amplitude'])]) {
      const [min, max] = ELEMENT_MOTION_RANGES[key === 'amplitude' ? `${type}Amplitude` : key];
      if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max) throw new Error(`Element motion ${type} ${key} must be between ${min} and ${max}.`);
    }
    result[type] = value;
  }
  return result;
}

const TAU = Math.PI * 2;
function phaseAt(motion, elapsed) {
  const cycle = (motion.direction ?? 1) * elapsed / motion.duration + (motion.phase ?? 0);
  return cycle - Math.floor(cycle);
}

// No accumulated state: arbitrary seeks, frame rates and export order agree.
// A caller-owned sample avoids allocation in the render loop.
export function elementMotionAt(layer, absoluteTime, out = {}) {
  out.offsetX = out.offsetY = out.rotation = 0;
  out.scale = 1; out.active = false;
  if (!supportsElementMotion(layer) || !layer.elementMotion) return out;
  const elapsed = Math.max(0, absoluteTime - layer.start), motion = layer.elementMotion;
  if (motion.float?.enabled) {
    const distance = motion.float.amplitude * Math.sin(TAU * phaseAt(motion.float, elapsed));
    if (motion.float.axis === 'x') out.offsetX = distance; else out.offsetY = distance;
  }
  if (motion.spin?.enabled) out.rotation = 360 * phaseAt(motion.spin, elapsed);
  if (motion.pulse?.enabled) out.scale = 1 + motion.pulse.amplitude * Math.sin(TAU * phaseAt(motion.pulse, elapsed));
  out.active = out.offsetX !== 0 || out.offsetY !== 0 || out.rotation !== 0 || out.scale !== 1;
  return out;
}
