import { EASINGS, easeProgress } from './easing.js';

// Original keeps each family's own progress; every other curve comes from the shared library.
export const MOTION_CURVES = [['native', 'Original'], ...EASINGS.map(({ id, name }) => [id, name])];
export const DEFAULT_MOTION = Object.freeze({ mode: 'continuous', action: 1, pause: 0, curve: 'native', intensity: 0.5 });
const clamp = value => Math.max(0, Math.min(1, value));
const mod = (value, period) => ((value % period) + period) % period;

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

export function motionClock(layer, count, time) {
  count = Math.max(1, count);
  const local = Math.max(0, time - layer.start), motion = layer.motion ?? DEFAULT_MOTION;
  let cycle;
  if (motion.mode === 'steps') {
    const period = motion.action + motion.pause;
    const beat = local / period;
    const progress = Math.min((beat - Math.floor(beat)) * period / motion.action, 1);
    const eased = layer.template === 'sweep-reveal' ? sweepProgress(progress, motion) : motionEase(progress, motion, layer.template === 'window-push' ? 1 - (1 - progress) ** 3 : progress);
    cycle = layer.speed === 0 ? 0 : (Math.floor(beat) + eased) * Math.sign(layer.speed) / count;
  } else {
    cycle = layer.loopDuration > 0 ? (layer.speed === 0 ? 0 : local / layer.loopDuration * Math.sign(layer.speed)) : local * layer.speed / 360;
    // These families historically measure speed in card advances, not degrees.
    if (!layer.loopDuration && layer.template === 'horizontal') cycle = local * layer.speed / 35 / count;
    // These families shape each card's transition rather than the whole clock.
    if (!['flip', 'stickers', 'zoom-through', 'stack-shuffle', 'sweep-reveal', 'window-push'].includes(layer.template) && motion.curve !== 'native') {
      const advance = Math.abs(cycle * count);
      cycle = (Math.floor(advance) + motionEase(advance % 1, motion)) * Math.sign(cycle) / count;
    }
  }
  return { phase: mod(cycle, 1), advance: cycle * count, stepped: motion.mode === 'steps' };
}
