import { evaluateChoreography } from '../choreography.js';

// A selection is an ordered list of layer ids; the last id is the primary layer
// that the inspector, timeline and single-layer gestures follow.
export const POSITIONABLE_TYPES = Object.freeze(['text', 'logo', 'media', 'model', 'carousel']);

export const singleSelection = id => id == null ? [] : [id];
export const primaryLayerId = ids => ids.at(-1) ?? null;

export function toggleSelection(ids, id) {
  return ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id];
}

// `order` lists ids as the layer list shows them; the clicked id becomes primary.
export function rangeSelection(order, anchor, id) {
  const from = order.indexOf(anchor), to = order.indexOf(id);
  if (from < 0 || to < 0) return singleSelection(id);
  const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
  return from > to ? range.reverse() : range;
}

export function pruneSelection(ids, layers) {
  const kept = ids.filter(id => layers.some(layer => layer.id === id));
  return kept.length === ids.length ? ids : kept;
}

const onCanvas = (layer, time) => layer.visible && time >= layer.start && time < layer.end;

// Layers a group gesture, nudge or arrangement may move: locked, hidden and
// off-playhead members stay selected but keep their placement.
export function transformableLayers(project, ids, time) {
  return ids.map(id => project.layers.find(layer => layer.id === id))
    .filter(layer => layer && POSITIONABLE_TYPES.includes(layer.type) && !layer.locked && onCanvas(layer, time))
    .map(layer => evaluateChoreography(layer, time));
}

export function selectAllIds(project, time) {
  return project.layers.filter(layer => POSITIONABLE_TYPES.includes(layer.type) && !layer.locked && onCanvas(layer, time)).map(layer => layer.id);
}

// Group lock/visibility toggles: a mixed selection is locked or shown entirely.
export function groupFlagValue(layers, field) {
  return field === 'locked' ? layers.some(layer => !layer.locked) : layers.some(layer => !layer.visible);
}

export function arrangeAvailability(project, ids, time) {
  const movable = transformableLayers(project, ids, time).length;
  return { align: movable > 0, distribute: movable >= 3 };
}
