export const MOTION_CURVES = [
  ['native', 'Original'], ['linear', 'Linear'], ['smooth', 'Smooth'],
  ['natural', 'Natural'], ['glide', 'Glide'], ['slow', 'Slow'],
  ['vive', 'Vive'], ['bounce', 'Bounce'], ['elastic', 'Elastic']
];
export const DEFAULT_MOTION = Object.freeze({ mode: 'continuous', action: 1, pause: 0, curve: 'native', intensity: 0.5 });
const clamp = value => Math.max(0, Math.min(1, value));
const mod = (value, period) => ((value % period) + period) % period;
export const smoothProgress = t => t * t * (3 - 2 * t);

function bounce(t) {
  if (t < 1 / 2.75) return 7.5625 * t * t;
  if (t < 2 / 2.75) return 7.5625 * (t - 1.5 / 2.75) ** 2 + 0.75;
  if (t < 2.5 / 2.75) return 7.5625 * (t - 2.25 / 2.75) ** 2 + 0.9375;
  return 7.5625 * (t - 2.625 / 2.75) ** 2 + 0.984375;
}

// Progress, not wall-clock animation: preview, scrubbing and export use the same curve.
export function motionEase(value, motion = DEFAULT_MOTION, original = clamp(value)) {
  const t = clamp(value);
  if (t === 0 || t === 1) return t;
  if (motion.curve === 'native' || motion.intensity === 0) return original;
  const curves = {
    linear: () => t,
    smooth: () => smoothProgress(t),
    natural: () => (1 - Math.cos(Math.PI * t)) / 2,
    glide: () => 1 - (1 - t) ** 3,
    slow: () => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2,
    vive: () => 1 - (1 - t) ** 5,
    bounce: () => bounce(t),
    elastic: () => 1 + 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * 2 * Math.PI / 3)
  };
  return original + (curves[motion.curve]() - original) * motion.intensity;
}

// This wipe's Glide is symmetric: the reveal edge accelerates, then settles.
export function sweepProgress(value, motion = DEFAULT_MOTION) {
  const t = clamp(value);
  const original = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
  return clamp(motionEase(t, motion.curve === 'glide' ? { ...motion, curve: 'native' } : motion, original));
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
    if (!layer.loopDuration && ['horizontal', 'depth', 'arc'].includes(layer.template)) cycle = local * layer.speed / (layer.template === 'arc' ? 60 : 35) / count;
    // These families shape each card's transition rather than the whole clock.
    if (!['flip', 'stickers', 'nested-rise', 'zoom-through', 'stack-shuffle', 'sweep-reveal', 'window-push'].includes(layer.template) && motion.curve !== 'native' && motion.intensity > 0) {
      const advance = Math.abs(cycle * count);
      cycle = (Math.floor(advance) + motionEase(advance % 1, motion)) * Math.sign(cycle) / count;
    }
  }
  return { phase: mod(cycle, 1), advance: cycle * count, stepped: motion.mode === 'steps' };
}
