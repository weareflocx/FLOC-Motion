import { patchLayer } from '../project.js';
import { choreographyPatch } from './choreography-edit.js';

// Stored position limits, matching the single-layer canvas gestures.
const POSITION_RANGES = { text: [0, 95], logo: [-1000, 1000], media: [-1000, 1000], model: [-1000, 1000], carousel: [10, 90] };
const rounded = value => Math.round(value * 1e6) / 1e6;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const extent = axis => axis === 'x' ? 'width' : 'height';

export const ALIGN_MODES = Object.freeze({ left: ['x', 0], center: ['x', 0.5], right: ['x', 1], top: ['y', 0], middle: ['y', 0.5], bottom: ['y', 1] });
export const DISTRIBUTE_MODES = Object.freeze({ horizontal: 'x', vertical: 'y' });

export function selectionBounds(rects) {
  if (!rects.length) return null;
  const left = Math.min(...rects.map(rect => rect.x)), top = Math.min(...rects.map(rect => rect.y));
  const right = Math.max(...rects.map(rect => rect.x + rect.width)), bottom = Math.max(...rects.map(rect => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

// Moves each rectangle so the chosen edge or center meets the reference's.
export function alignDeltas(rects, mode, reference = selectionBounds(rects)) {
  const [axis, fraction] = ALIGN_MODES[mode] ?? [];
  if (!axis) throw new Error('Unknown alignment.');
  const size = extent(axis), target = reference[axis] + reference[size] * fraction;
  return rects.map(rect => {
    const delta = target - (rect[axis] + rect[size] * fraction);
    return { id: rect.id, dx: axis === 'x' ? delta : 0, dy: axis === 'y' ? delta : 0 };
  });
}

// Equal gaps between neighbours; the outermost edges of the selection stay put.
export function distributeDeltas(rects, mode) {
  const axis = DISTRIBUTE_MODES[mode];
  if (!axis) throw new Error('Unknown distribution.');
  if (rects.length < 3) return [];
  const size = extent(axis);
  const sorted = [...rects].sort((a, b) => a[axis] - b[axis] || a[axis] + a[size] - b[axis] - b[size]);
  const start = sorted[0][axis], end = Math.max(...sorted.map(rect => rect[axis] + rect[size]));
  const gap = (end - start - sorted.reduce((sum, rect) => sum + rect[size], 0)) / (sorted.length - 1);
  let cursor = start;
  return sorted.map(rect => {
    const delta = cursor - rect[axis];
    cursor += rect[size] + gap;
    return { id: rect.id, dx: axis === 'x' ? delta : 0, dy: axis === 'y' ? delta : 0 };
  });
}

export function placeLayer(type, start, dx, dy) {
  const [min, max] = POSITION_RANGES[type];
  return { x: rounded(clamp(start.x + dx, min, max)), y: rounded(clamp(start.y + dy, min, max)) };
}

// Limits a shared offset so no member is clamped and the arrangement keeps its shape.
export function groupDelta(members, dx, dy) {
  const limit = (axis, delta) => {
    let low = -Infinity, high = Infinity;
    for (const member of members) {
      const [min, max] = POSITION_RANGES[member.type];
      low = Math.max(low, Math.min(0, min - member.start[axis]));
      high = Math.min(high, Math.max(0, max - member.start[axis]));
    }
    return clamp(delta, low, high);
  };
  return { dx: limit('x', dx), dy: limit('y', dy) };
}

// Members are `{ id, type, start }` with `start` from `layerPosition`.
export function groupPositions(members, dx, dy) {
  const delta = groupDelta(members, dx, dy);
  return members.map(member => ({ id: member.id, ...placeLayer(member.type, member.start, delta.dx, delta.dy) }));
}

export function arrangedPositions(members, deltas) {
  return deltas.flatMap(({ id, dx, dy }) => {
    const member = members.find(item => item.id === id);
    return member ? [{ id, ...placeLayer(member.type, member.start, dx, dy) }] : [];
  });
}

// All moved layers become one project, and so one undoable change.
export function applyPositions(project, positions, time) {
  return positions.reduce((next, { id, x, y }) => {
    const layer = next.layers.find(item => item.id === id);
    if (!layer || (layer.x === x && layer.y === y && !layer.choreography?.length)) return next;
    return patchLayer(next, id, choreographyPatch(layer, { x, y }, time, next.fps));
  }, project);
}
