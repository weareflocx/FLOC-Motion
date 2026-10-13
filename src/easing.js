// The one easing library: choreography transitions and carousel progress
// curves share these named curves. Each is a pure function of progress t and a
// strength s (0–1) that sets the curve's character; it maps 0 → 0 and 1 → 1,
// so preview, scrubbing and export agree. All but Linear and Ease in end at rest.
export const DEFAULT_STRENGTH = 0.5;
export const smoothProgress = t => t * t * (3 - 2 * t);

// Power 1 (linear) at s = 0, cubic at 0.5, quintic at 1.
const power = s => 1 + 4 * s;
const easeIn = (t, s) => t ** power(s);
const easeOut = (t, s) => 1 - (1 - t) ** power(s);
const easeInOut = (t, s) => t < 0.5 ? (2 * t) ** power(s) / 2 : 1 - (2 - 2 * t) ** power(s) / 2;

// Ease-out-back: with u = 1 − t, 1 − (c + 1)u³ + cu² peaks 4c³ / (27(c + 1)²)
// past the target and lands with zero speed. Strength sets that overshoot to
// 0–25 % of the move (c = 0 is a cubic ease-out, c = 3 overshoots exactly 25 %).
const BACK_OVERSHOOT = 0.25;
const backConstants = new Map();
function backConstant(s) {
  let c = backConstants.get(s);
  if (c !== undefined) return c;
  const overshoot = BACK_OVERSHOOT * s;
  let low = 0, high = 3;
  for (let i = 0; i < 48; i++) {
    c = (low + high) / 2;
    if (4 * c ** 3 / (27 * (c + 1) ** 2) < overshoot) low = c; else high = c;
  }
  if (backConstants.size >= 256) backConstants.clear();
  backConstants.set(s, c);
  return c;
}
function back(t, s) {
  const c = backConstant(s), u = 1 - t;
  return 1 - (c + 1) * u ** 3 + c * u * u;
}

// A ball dropped onto the target: it falls under constant gravity, then each
// rebound keeps e of its speed, so rebound k rises e^2k of the move and lasts
// e times the previous one. The rebounds form a geometric series that ends
// exactly at t = 1, so the curve never passes the target and lands at rest.
// Strength sets the first rebound to 5–30 % of the move.
function bounce(t, s) {
  const e = Math.sqrt(0.05 + 0.25 * s);
  const fall = (1 - e) / (1 + e);
  if (t < fall) return (t / fall) ** 2;
  let start = fall, duration = 2 * e * fall, height = e * e;
  // Rebounds lower than this are far below a pixel.
  while (height > 1e-7) {
    if (t < start + duration) {
      const x = (t - start) / duration;
      return 1 - 4 * height * x * (1 - x);
    }
    start += duration; duration *= e; height *= e * e;
  }
  return 1;
}

// A damped spring released from rest. Strength sets the first swing past the
// target to 5–25 % of the move (the damping ratio follows from it) and the first
// arrival to 45–35 % of the step. After arrival the spring's clock speeds up
// just enough for the swings to die down inside the step, and the last fifth
// eases the remaining few thousandths into an exact stop.
function spring(t, s) {
  const overshoot = 0.05 + 0.2 * s, arrival = 0.45 - 0.1 * s;
  const log = Math.log(overshoot);
  const zeta = -log / Math.sqrt(Math.PI ** 2 + log * log);
  // Spring time τ is measured in arrivals: x(1) = 1 for the first time.
  const damped = Math.PI - Math.acos(zeta), decay = zeta * damped / Math.sqrt(1 - zeta * zeta);
  const end = Math.log(100) / decay;
  const late = Math.max(0, t - arrival);
  const warp = Math.max(0, end - 1 / arrival) / (1 - arrival) ** 2;
  const tau = t / arrival + warp * late * late;
  const offset = Math.exp(-decay * tau) * (Math.cos(damped * tau) + decay / damped * Math.sin(damped * tau));
  const settle = Math.max(0, (t - 0.8) / 0.2);
  return 1 - offset * (1 - smoothProgress(settle));
}

export const EASING_GROUPS = ['Basic', 'Overshoot'];
// Ids are stored in projects. `strength` names what s regulates, or null when
// the curve has no strength.
export const EASINGS = Object.freeze([
  { id: 'linear', name: 'Linear', group: 'Basic', ease: t => t, strength: null },
  { id: 'ease-in-out', name: 'Ease in-out', group: 'Basic', ease: easeInOut, strength: { label: 'Strength', help: 'From linear at 0 % to a sharp start and soft landing at 100 %.' } },
  { id: 'ease-in', name: 'Ease in', group: 'Basic', ease: easeIn, strength: { label: 'Strength', help: 'From linear at 0 % to a slow start that speeds into the stop at 100 %.' } },
  { id: 'ease-out', name: 'Ease out', group: 'Basic', ease: easeOut, strength: { label: 'Strength', help: 'From linear at 0 % to a fast start that settles softly at 100 %.' } },
  { id: 'back', name: 'Back', group: 'Overshoot', ease: back, strength: { label: 'Overshoot', help: 'How far it passes the target before settling back: 0–25 % of the move.' } },
  { id: 'bounce', name: 'Bounce', group: 'Overshoot', ease: bounce, strength: { label: 'Bounciness', help: 'How high it rebounds off the target: the first rebound is 5–30 % of the move.' } },
  { id: 'spring', name: 'Spring', group: 'Overshoot', ease: spring, strength: { label: 'Springiness', help: 'How far it swings past the target and how long it wobbles: 5–25 % of the move.' } }
].map(easing => Object.freeze({ ...easing, strength: easing.strength && Object.freeze(easing.strength) })));
const NAMED = new Map(EASINGS.map(easing => [easing.id, easing.ease]));

// Pre-v6 progress curves were blended with linear by their intensity k. The
// source preset catalog still names them; this returns today's closest curve
// and strength. At k = 0 a legacy curve showed the family's Original motion.
// Project files are converted by their own frozen copy in project-migrations.js.
const LEGACY_CURVES = {
  smooth: ['ease-in-out', 0.35], natural: ['ease-in-out', 0.35], slow: ['ease-in-out', 0.5],
  'ease-in': ['ease-in', 0.25], 'ease-out': ['ease-out', 0.25], glide: ['ease-out', 0.5], vive: ['ease-out', 1],
  back: ['back', 0.4], bounce: ['bounce', 1], elastic: ['spring', 1], linear: ['linear', 1]
};
export function legacyCurve(name, intensity) {
  if (!Object.hasOwn(LEGACY_CURVES, name)) return { curve: 'native', intensity };
  if (intensity === 0) return { curve: 'native', intensity: DEFAULT_STRENGTH };
  const [curve, scale] = LEGACY_CURVES[name];
  return { curve, intensity: curve === 'linear' ? intensity : Math.round(intensity * scale * 1000) / 1000 };
}

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

// Progress 0–1 through `easing` (a curve name or a cubic-bézier array) at
// `strength` 0–1. Choreography transitions use the default strength.
export function easeProgress(easing, value, strength = DEFAULT_STRENGTH) {
  const t = Math.max(0, Math.min(1, value));
  if (t === 0 || t === 1) return t;
  const named = NAMED.get(easing);
  if (named) return named(t, Math.max(0, Math.min(1, strength)));
  if (isCubicBezier(easing)) return cubicBezier(easing)(t);
  throw new Error('Unknown easing.');
}
