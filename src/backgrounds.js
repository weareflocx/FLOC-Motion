import { backgroundRenderer, disposeBackgroundRenderer } from './background-renderer.js';

export const PROCEDURAL_BACKGROUNDS = [
  { id: 'grid', name: 'Grid' },
  { id: 'grain', name: 'Grain' },
  { id: 'waves', name: 'Waves' },
  { id: 'geometry', name: 'Geometry' },
  { id: 'dots', name: 'Dots' },
  { id: 'stripes', name: 'Stripes' },
  { id: 'checkerboard', name: 'Checkerboard' },
  { id: 'rings', name: 'Rings' },
  { id: 'rays', name: 'Rays' },
  { id: 'mesh', name: 'Mesh' },
  { id: 'flow', name: 'Flow' },
  { id: 'halftone', name: 'Halftone' },
  { id: 'gradient', name: 'Gradient' },
  { id: 'aurora', name: 'Aurora' },
  { id: 'noise', name: 'Noise' }
];
export const DEFAULT_PROCEDURAL_BACKGROUND = { pattern: 'grid', patternColor: '#ffffff', patternScale: 1, patternIntensity: 0.35, patternSpeed: 0.2, patternSeed: 1, patternVignette: 0, patternGrain: 0 };

// Calibration, measured on rendered frames: `gain` gives every pattern a
// comparable visual weight at the same intensity, and `pace` a comparable
// amount of motion at the same speed.
const TUNING = {
  grid: { gain: 1, pace: 1 },
  grain: { gain: 0.4, pace: 1 },
  waves: { gain: 1, pace: 0.12 },
  geometry: { gain: 1, pace: 0.25 },
  dots: { gain: 1, pace: 1 },
  stripes: { gain: 0.45, pace: 1 },
  checkerboard: { gain: 0.3, pace: 1 },
  rings: { gain: 1, pace: 1 },
  rays: { gain: 0.4, pace: 0.25 },
  mesh: { gain: 1, pace: 0.15 },
  flow: { gain: 1, pace: 0.5 },
  halftone: { gain: 0.6, pace: 0.6 },
  gradient: { gain: 0.55, pace: 0.08 },
  aurora: { gain: 0.9, pace: 0.2 },
  noise: { gain: 0.7, pace: 0.25 }
};
const IDS = PROCEDURAL_BACKGROUNDS.map(({ id }) => id);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);

// Everything the shader needs, derived only from the layer and a supplied
// time, so reverse seeks and exports reproduce the same frame. Speed zero
// freezes the pattern, its grain included. Editor tiles show a magnified
// crop with thicker strokes so the pattern stays legible at thumbnail size.
export function backgroundUniforms(layer, elapsed, width, height, fps = 24, { tile = false } = {}) {
  const settings = { ...DEFAULT_PROCEDURAL_BACKGROUND, ...layer };
  const id = IDS.includes(settings.pattern) ? settings.pattern : DEFAULT_PROCEDURAL_BACKGROUND.pattern;
  const seconds = Math.max(0, Number.isFinite(elapsed) ? elapsed : 0);
  const speed = clamp(Number.isFinite(settings.patternSpeed) ? settings.patternSpeed : 0, -2, 2);
  return {
    unit: Math.min(width, height) / (tile ? 324 : 1080),
    line: tile ? 2 : 1,
    time: seconds * speed * TUNING[id].pace,
    frame: speed === 0 ? 0 : Math.floor(seconds * fps + 1e-4) >>> 0,
    pattern: IDS.indexOf(id),
    scale: clamp(settings.patternScale, 0.25, 4),
    weight: clamp(settings.patternIntensity, 0, 1) * TUNING[id].gain,
    seed: settings.patternSeed >>> 0,
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
