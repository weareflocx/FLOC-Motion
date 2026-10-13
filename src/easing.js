// The one easing library: choreography transitions and carousel progress
// curves share these named curves. Each maps 0 → 0 and 1 → 1 and depends only
// on its input, so preview, scrubbing and export agree.
export const smoothProgress = t => t * t * (3 - 2 * t);

function bounce(t) {
  if (t < 1 / 2.75) return 7.5625 * t * t;
  if (t < 2 / 2.75) return 7.5625 * (t - 1.5 / 2.75) ** 2 + 0.75;
  if (t < 2.5 / 2.75) return 7.5625 * (t - 2.25 / 2.75) ** 2 + 0.9375;
  return 7.5625 * (t - 2.625 / 2.75) ** 2 + 0.984375;
}

const BACK = 1.70158;
export const EASING_GROUPS = ['Basic', 'Expressive', 'Overshoot'];
// Stored names are permanent: never rename or reshape an existing curve.
export const EASINGS = Object.freeze([
  { id: 'linear', name: 'Linear', group: 'Basic', ease: t => t },
  { id: 'smooth', name: 'Smooth', group: 'Basic', ease: smoothProgress },
  { id: 'ease-in', name: 'Ease in', group: 'Basic', ease: t => t * t },
  { id: 'ease-out', name: 'Ease out', group: 'Basic', ease: t => 1 - (1 - t) ** 2 },
  { id: 'natural', name: 'Natural', group: 'Expressive', ease: t => (1 - Math.cos(Math.PI * t)) / 2 },
  { id: 'glide', name: 'Glide', group: 'Expressive', ease: t => 1 - (1 - t) ** 3 },
  { id: 'slow', name: 'Slow', group: 'Expressive', ease: t => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2 },
  { id: 'vive', name: 'Vive', group: 'Expressive', ease: t => 1 - (1 - t) ** 5 },
  { id: 'back', name: 'Back', group: 'Overshoot', ease: t => 1 + (BACK + 1) * (t - 1) ** 3 + BACK * (t - 1) ** 2 },
  { id: 'bounce', name: 'Bounce', group: 'Overshoot', ease: bounce },
  { id: 'elastic', name: 'Elastic', group: 'Overshoot', ease: t => 1 + 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * 2 * Math.PI / 3) }
].map(Object.freeze));
const NAMED = new Map(EASINGS.map(easing => [easing.id, easing.ease]));

// A custom curve is [x1, y1, x2, y2], as in CSS cubic-bezier(). Time control
// points stay within 0–1 so progress is a function of time.
export const BEZIER_Y_RANGE = [-2, 3];
export const isCubicBezier = value => Array.isArray(value) && value.length === 4
  && value.every(number => typeof number === 'number' && Number.isFinite(number))
  && [value[0], value[2]].every(x => x >= 0 && x <= 1)
  && [value[1], value[3]].every(y => y >= BEZIER_Y_RANGE[0] && y <= BEZIER_Y_RANGE[1]);
export const isEasing = value => NAMED.has(value) || isCubicBezier(value);

function cubicBezier([x1, y1, x2, y2]) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = t => ((ax * t + bx) * t + cx) * t;
  return x => {
    // Newton's method converges for most curves; bisection always does.
    let t = x;
    for (let i = 0; i < 8; i++) {
      const error = sampleX(t) - x, slope = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(error) < 1e-7) return ((ay * t + by) * t + cy) * t;
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    let low = 0, high = 1;
    t = x;
    for (let i = 0; i < 40 && high - low > 1e-9; i++) {
      if (sampleX(t) < x) low = t; else high = t;
      t = (low + high) / 2;
    }
    return ((ay * t + by) * t + cy) * t;
  };
}

// Progress 0–1 through `easing`: a curve name or a cubic-bézier array.
export function easeProgress(easing, value) {
  const t = Math.max(0, Math.min(1, value));
  if (t === 0 || t === 1) return t;
  const named = NAMED.get(easing);
  if (named) return named(t);
  if (isCubicBezier(easing)) return cubicBezier(easing)(t);
  throw new Error('Unknown easing.');
}
