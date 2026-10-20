import { backgroundRenderer, disposeBackgroundRenderer } from './background-renderer.js';

// `controls` lists the pattern-specific settings the editor shows: direction
// for patterns that drift across the frame, focus for those with a center.
export const PROCEDURAL_BACKGROUNDS = [
  { id: 'grid', name: 'Grid', controls: ['direction'] },
  { id: 'grain', name: 'Grain', controls: [] },
  { id: 'waves', name: 'Waves', controls: [] },
  { id: 'geometry', name: 'Geometry', controls: [] },
  { id: 'dots', name: 'Dots', controls: ['direction'] },
  { id: 'stripes', name: 'Stripes', controls: ['direction'] },
  { id: 'checkerboard', name: 'Checkerboard', controls: ['direction'] },
  { id: 'rings', name: 'Rings', controls: ['focus'] },
  { id: 'rays', name: 'Rays', controls: ['focus'] },
  { id: 'mesh', name: 'Mesh', controls: [] },
  { id: 'flow', name: 'Flow', controls: [] },
  { id: 'halftone', name: 'Halftone', controls: ['direction'] },
  { id: 'gradient', name: 'Gradient', controls: [] },
  { id: 'aurora', name: 'Aurora', controls: [] },
  { id: 'noise', name: 'Noise', controls: [] }
];
// Direction is in degrees (0 moves right, 90 up); focus is a percentage of the
// frame. Their defaults depend on pattern and seed: see `proceduralDefaults`.
export const DEFAULT_PROCEDURAL_BACKGROUND = { pattern: 'grid', patternColor: '#ffffff', patternScale: 1, patternIntensity: 0.35, patternSpeed: 0.2, patternSeed: 1, patternVignette: 0, patternGrain: 0,
  patternLoop: false, patternDirection: 315, patternFocusX: 50, patternFocusY: 50 };
// Below 0.25 the shader also thins strokes so fine patterns stay open.
export const PATTERN_SCALE = Object.freeze({ min: 0.1, max: 4 });

// Calibration, measured on rendered frames: `gain` gives every pattern a
// comparable visual weight at the same intensity, and `pace` a comparable
// amount of motion at the same speed. `drift` is a pattern's native travel in
// lattice cells per unit of pattern time, with its default direction.
const TUNING = {
  grid: { gain: 1, pace: 1, drift: { rate: 0.25 * Math.SQRT2, angle: 315, lattice: 'square' } },
  grain: { gain: 0.4, pace: 1 },
  waves: { gain: 1, pace: 0.12 },
  geometry: { gain: 1, pace: 0.25 },
  dots: { gain: 1, pace: 1, drift: { rate: 0.25 * Math.SQRT2, angle: 315, lattice: 'square' } },
  stripes: { gain: 0.45, pace: 1, drift: { rate: 0.25, angle: 45, lattice: 'line' } },
  checkerboard: { gain: 0.3, pace: 1, drift: { rate: Math.hypot(0.25, 0.12), angle: 360 - Math.atan2(0.12, 0.25) * 180 / Math.PI, lattice: 'checker' } },
  rings: { gain: 1, pace: 1 },
  rays: { gain: 0.4, pace: 0.25 },
  mesh: { gain: 1, pace: 0.15 },
  flow: { gain: 1, pace: 0.5 },
  halftone: { gain: 0.6, pace: 0.6, drift: { rate: 0.1 * Math.SQRT2, angle: 0, lattice: 'diagonal' } },
  gradient: { gain: 0.55, pace: 0.08 },
  aurora: { gain: 0.9, pace: 0.2 },
  noise: { gain: 0.7, pace: 0.25 }
};
const IDS = PROCEDURAL_BACKGROUNDS.map(({ id }) => id);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);

// The shader's integer hash (`random(salt)` in background-shader.js), so
// defaults can reproduce positions the shader used to derive from the seed.
const mixBits = x => {
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16; return x >>> 0;
};
const seededRandom = (seed, salt) => (mixBits(1048576 ^ mixBits(1048576 ^ mixBits(salt ^ mixBits(seed >>> 0)))) >>> 8) / 16777216;

// Values for a layer's missing fields. Direction follows the pattern's native
// drift and focus its seeded center, so settings saved before these controls
// existed keep their exact motion and framing.
export function proceduralDefaults(layer = {}) {
  const pattern = IDS.includes(layer.pattern) ? layer.pattern : DEFAULT_PROCEDURAL_BACKGROUND.pattern;
  const seed = Number.isInteger(layer.patternSeed) ? layer.patternSeed : DEFAULT_PROCEDURAL_BACKGROUND.patternSeed;
  return { ...DEFAULT_PROCEDURAL_BACKGROUND, patternDirection: TUNING[pattern].drift?.angle ?? DEFAULT_PROCEDURAL_BACKGROUND.patternDirection,
    patternFocusX: (0.3 + 0.4 * seededRandom(seed, 1)) * 100, patternFocusY: (0.3 + 0.4 * seededRandom(seed, 2)) * 100 };
}

// Drift in the pattern's lattice cells for `amount` units of pattern time.
// Grid, dots and checkerboard use screen axes, halftone its 45° screen and
// stripes the distance along their normal (x only).
function latticeDrift({ rate, lattice }, [nx, ny], amount) {
  if (lattice === 'line') return [rate * amount, 0];
  const x = nx * rate * amount, y = ny * rate * amount;
  return lattice === 'diagonal' ? [Math.SQRT1_2 * (x - y), Math.SQRT1_2 * (x + y)] : [x, y];
}
const STEPS = { square: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]], checker: [[1, 1], [1, -1], [-1, 1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]] };
// A seamless loop must travel a whole lattice step: the nearest one, and at
// least one when the pattern moves. Checkerboard steps keep x + y even so
// every square lands on a square of the same color.
function wholeDrift([x, y], lattice) {
  if (lattice === 'line') return [Math.round(x) || Math.sign(x), 0];
  let a = Math.round(x), b = Math.round(y);
  if (lattice === 'checker' && (a + b) % 2) {
    if (Math.abs(x - a) >= Math.abs(y - b)) a += Math.sign(x - a) || 1; else b += Math.sign(y - b) || 1;
  }
  if (a || b || !(x || y)) return [a, b];
  const closeness = ([sx, sy]) => (sx * x + sy * y) / Math.hypot(sx, sy);
  return (STEPS[lattice] ?? STEPS.square).reduce((best, step) => closeness(step) > closeness(best) ? step : best);
}

// Everything the shader needs, derived only from the layer and a supplied
// time, so reverse seeks and exports reproduce the same frame. Speed zero
// freezes the pattern, its grain included. Editor tiles show a magnified
// crop with thicker strokes so the pattern stays legible at thumbnail size.
// A seamless loop spans the layer's duration: pattern time runs from 0 to
// `loop`, drift travels whole lattice steps and the shader rounds every other
// motion to whole cycles, so the last frame leads straight into the first.
export function backgroundUniforms(layer, elapsed, width, height, fps = 24, { tile = false } = {}) {
  const settings = { ...proceduralDefaults(layer), ...layer };
  const id = IDS.includes(settings.pattern) ? settings.pattern : DEFAULT_PROCEDURAL_BACKGROUND.pattern;
  const { gain, pace, drift } = TUNING[id];
  const seconds = Math.max(0, Number.isFinite(elapsed) ? elapsed : 0);
  const speed = clamp(Number.isFinite(settings.patternSpeed) ? settings.patternSpeed : 0, -2, 2);
  const span = settings.end - settings.start;
  const loop = settings.patternLoop === true && speed !== 0 && span > 0 ? span * speed * pace : 0;
  const phase = loop ? (seconds % span) / span : 0;
  const time = loop ? phase * loop : seconds * speed * pace;
  const angle = (Number.isFinite(settings.patternDirection) ? settings.patternDirection : 0) * Math.PI / 180;
  const direction = [Math.cos(angle), -Math.sin(angle)];
  const travel = !drift ? [0, 0] : loop ? wholeDrift(latticeDrift(drift, direction, loop), drift.lattice).map(cells => cells * phase) : latticeDrift(drift, direction, time);
  return {
    unit: Math.min(width, height) / (tile ? 324 : 1080),
    line: tile ? 2 : 1,
    time,
    loop,
    frame: speed === 0 ? 0 : Math.floor(seconds * fps + 1e-4) >>> 0,
    pattern: IDS.indexOf(id),
    scale: clamp(settings.patternScale, PATTERN_SCALE.min, PATTERN_SCALE.max),
    weight: clamp(settings.patternIntensity, 0, 1) * gain,
    seed: settings.patternSeed >>> 0,
    drift: travel,
    direction,
    focus: [clamp(settings.patternFocusX, 0, 100) / 100, clamp(settings.patternFocusY, 0, 100) / 100],
    base: rgb(settings.color ?? '#080808'),
    ink: rgb(settings.patternColor),
    vignette: clamp(settings.patternVignette, 0, 1),
    grain: clamp(settings.patternGrain, 0, 1)
  };
}

// Draws one frame onto a 2D canvas. Returns false while the graphics context
// is lost (the canvas keeps its previous frame); throws without WebGL 2.
export function drawProceduralBackground(canvas, layer, elapsed, fps = 24, renderer = null) {
  if (!canvas.width || !canvas.height) return true;
  return backgroundRenderer(IDS, renderer).draw(canvas, backgroundUniforms(layer, elapsed, canvas.width, canvas.height, fps));
}

export function disposeProceduralBackgrounds(renderer) { disposeBackgroundRenderer(renderer); }

// Re-renders the stage after a context restore; `failed` reports a context
// that never returns. Returns the unsubscribe function.
export function watchProceduralBackgrounds(listener) {
  return backgroundRenderer(IDS).watch(listener);
}

// Editor tile. Without WebGL 2 the tile shows the base color only; the stage
// reports the missing capability.
export function drawBackgroundPreview(canvas, layer) {
  try {
    if (backgroundRenderer(IDS).draw(canvas, backgroundUniforms(layer, 1, canvas.width, canvas.height, 24, { tile: true }))) return true;
  } catch {}
  const context = canvas.getContext('2d');
  if (context) { context.fillStyle = layer.color ?? '#080808'; context.fillRect(0, 0, canvas.width, canvas.height); }
  return false;
}
