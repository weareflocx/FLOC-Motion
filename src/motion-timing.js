import { EASINGS, easeProgress } from './easing.js';

// Original keeps each family's own progress; every other curve comes from the shared library.
export const MOTION_CURVES = [['native', 'Original'], ...EASINGS.map(({ id, name }) => [id, name])];
export const DEFAULT_MOTION = Object.freeze({ mode: 'continuous', action: 1, pause: 0, curve: 'native', intensity: 0.5 });
const clamp = value => Math.max(0, Math.min(1, value));
const mod = (value, period) => ((value % period) + period) % period;
const plainRecord = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || (Object.getPrototypeOf(prototype) === null && Object.hasOwn(prototype, 'constructor') && typeof prototype.constructor === 'function' && Function.prototype.toString.call(prototype.constructor) === Function.prototype.toString.call(Object));
};

export function validateMotion(motion) {
  if (!plainRecord(motion) || Object.getOwnPropertySymbols(motion).length || Object.keys(motion).some(key => !Object.hasOwn(DEFAULT_MOTION, key))) throw new Error('Invalid motion settings.');
  if (!['continuous', 'steps'].includes(motion.mode) || !MOTION_CURVES.some(([id]) => id === motion.curve)) throw new Error('Unknown rhythm or curve.');
  for (const [key, min, max, label] of [['action', .05, 30, 'Action duration'], ['pause', 0, 30, 'Pause duration'], ['intensity', 0, 1, 'Curve strength']]) {
    if (typeof motion[key] !== 'number' || !Number.isFinite(motion[key]) || motion[key] < min || motion[key] > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return motion;
}

export function normalizeMotion(input) {
  if (input !== undefined && (!plainRecord(input) || Object.getOwnPropertySymbols(input).length)) throw new Error('Invalid motion settings.');
  return validateMotion({ ...DEFAULT_MOTION, ...input });
}

// Progress, not wall-clock animation: preview, scrubbing and export use the same curve.
// Original keeps the family's own progress; every other curve uses its strength.
export function motionEase(value, motion = DEFAULT_MOTION, original = clamp(value)) {
  const t = clamp(value);
  if (t === 0 || t === 1) return t;
  return motion.curve === 'native' ? original : easeProgress(motion.curve, t, motion.intensity);
}

// This wipe's Original is symmetric: the reveal edge accelerates, then settles.
export function sweepProgress(value, motion = DEFAULT_MOTION) {
  const t = clamp(value);
  return clamp(motionEase(t, motion, t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2));
}

export function motionBaseline(layer, name = 'Original motion') {
  return { name, speed: layer.speed, loopDuration: layer.loopDuration, motion: { ...(layer.motion ?? DEFAULT_MOTION) } };
}

export function evaluateMotionClock(motion, count, local, speed, loopDuration, template, out = {}) {
  count = Math.max(1, count);
  let cycle;
  if (motion.mode === 'steps') {
    const period = motion.action + motion.pause;
    const beat = local / period;
    const progress = Math.min((beat - Math.floor(beat)) * period / motion.action, 1);
    const eased = template === 'sweep-reveal' ? sweepProgress(progress, motion) : motionEase(progress, motion, template === 'window-push' ? 1 - (1 - progress) ** 3 : progress);
    cycle = speed === 0 ? 0 : (Math.floor(beat) + eased) * Math.sign(speed) / count;
  } else {
    cycle = loopDuration > 0 ? (speed === 0 ? 0 : local / loopDuration * Math.sign(speed)) : local * speed / 360;
    // These families historically measure speed in card advances, not degrees.
    if (!loopDuration && template === 'horizontal') cycle = local * speed / 35 / count;
    // These families shape each card's transition rather than the whole clock.
    if (template !== 'flip' && template !== 'stickers' && template !== 'zoom-through' && template !== 'stack-shuffle' && template !== 'sweep-reveal' && template !== 'window-push' && motion.curve !== 'native') {
      const advance = Math.abs(cycle * count);
      cycle = (Math.floor(advance) + motionEase(advance % 1, motion)) * Math.sign(cycle) / count;
    }
  }
  out.phase = mod(cycle, 1);
  out.advance = cycle * count;
  out.stepped = motion.mode === 'steps';
  return out;
}

export function motionClock(layer, count, time, out = {}) {
  return evaluateMotionClock(layer.motion ?? DEFAULT_MOTION, count, Math.max(0, time - layer.start), layer.speed, layer.loopDuration, layer.template, out);
}
