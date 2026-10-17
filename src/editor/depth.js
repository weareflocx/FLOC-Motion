import { SCENE_DEPTH_RANGE, SPATIAL_LAYER_TYPES } from '../scene-settings.js';

// Depth is the authored `z` (percent of canvas height); positive values are nearer the
// default front camera. These helpers place one layer among the pieces (cards, models,
// planes) of the other layers as the scene reports them for the displayed frame.
export const DEPTH_GAP = 5;
const EPSILON = 0.05;
const [MIN_DEPTH, MAX_DEPTH] = SCENE_DEPTH_RANGE;

export const clampDepth = value => Math.round(Math.max(MIN_DEPTH, Math.min(MAX_DEPTH, value)) * 10) / 10;

// Single, unlocked, visible depth-capable layers inside their time range accept depth edits.
export function depthEditable(layer, time) {
  return Boolean(layer && SPATIAL_LAYER_TYPES.includes(layer.type) && layer.visible && !layer.locked && time >= layer.start && time < layer.end);
}

// `info` is the scene's `depthInfo()`; `id` is the layer being placed, excluded from its own guide.
export function depthGuide(info = [], id = null) {
  const layers = info.filter(item => item.id !== id);
  const pieces = layers.flatMap(item => item.pieces).sort((a, b) => a.min - b.min || a.max - b.max);
  if (!pieces.length) return { layers, pieces, centers: [], stops: [], snapPoints: [], front: null, back: null };
  // Stops sit between consecutive piece centers. Tilted carousel cards overlap in depth,
  // so gaps between their full extents would skip every card at once; centers keep
  // one photo per step and match the counts shown to the user.
  const centers = unique(pieces.map(piece => clampDepth((piece.min + piece.max) / 2)));
  const front = clampDepth(pieces.reduce((value, piece) => Math.max(value, piece.max), -Infinity) + DEPTH_GAP);
  const back = clampDepth(pieces.reduce((value, piece) => Math.min(value, piece.min), Infinity) - DEPTH_GAP);
  const between = centers.slice(1).map((center, index) => clampDepth((centers[index] + center) / 2))
    .filter((stop, index) => stop > centers[index] && stop < centers[index + 1]);
  const stops = unique([back, ...between, front]);
  const snapPoints = unique([...stops, ...layers.flatMap(item => [item.min, item.max, (item.min + item.max) / 2].map(clampDepth))]);
  return { layers, pieces, centers, stops, snapPoints, front, back };
}

function unique(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

// The next stop toward the camera (`direction` 1) or away from it (-1) that passes one more
// piece center: from beyond the outer stop, the first press still passes a piece. Already
// beyond every piece in that direction: the depth stays where it is.
export function nextDepth(guide, z, direction) {
  const passes = stop => guide.centers.some(center => direction > 0
    ? center >= z - EPSILON && center < stop - EPSILON
    : center <= z + EPSILON && center > stop + EPSILON);
  const stop = direction > 0
    ? guide.stops.find(value => value > z + EPSILON && passes(value))
    : guide.stops.findLast(value => value < z - EPSILON && passes(value));
  return stop ?? clampDepth(z);
}

export function outerDepth(guide, z, direction) {
  const stop = direction > 0 ? guide.front : guide.back;
  return stop ?? clampDepth(z);
}

export function snapDepth(guide, z, threshold) {
  let best = z, distance = threshold;
  for (const point of guide.snapPoints) {
    const gap = Math.abs(point - z);
    if (gap <= distance) { best = point; distance = gap; }
  }
  return clampDepth(best);
}

// Counts pieces by their centers, so "in front of 2" means two photos/objects are farther.
export function depthCounts(guide, z) {
  let inFront = 0, behind = 0;
  for (const piece of guide.pieces) {
    const center = (piece.min + piece.max) / 2;
    if (center < z - EPSILON) inFront++;
    else if (center > z + EPSILON) behind++;
  }
  return { inFront, behind };
}

export function depthLabel(guide, z) {
  const { inFront, behind } = depthCounts(guide, z);
  return `In front of ${inFront} · Behind ${behind}`;
}

// Ruler domain: every reported piece plus the given values, with a margin on both ends.
export function depthScale(guide, values = []) {
  const points = [...guide.pieces.flatMap(piece => [piece.min, piece.max]), ...values].filter(Number.isFinite);
  let low = Math.min(...points), high = Math.max(...points);
  if (!points.length) { low = 0; high = 0; }
  const margin = Math.max(10, (high - low) * 0.12);
  return { low: Math.max(MIN_DEPTH, low - margin), high: Math.min(MAX_DEPTH, high + margin) };
}

export function sameDepthInfo(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    return item.id === other.id && item.min === other.min && item.max === other.max && item.pieces.length === other.pieces.length
      && item.pieces.every((piece, i) => piece.min === other.pieces[i].min && piece.max === other.pieces[i].max);
  });
}
