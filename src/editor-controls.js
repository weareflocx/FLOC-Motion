import { constrainPlacement } from './layout.js';
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const rounded = n => Math.round(n * 1e6) / 1e6;

export function carouselPlacement(x, y) {
  return { x: rounded(clamp(x, 10, 90)), y: rounded(clamp(y, 10, 90)) };
}

export function canvasWheelSize(layer, deltaY, size = layer.size) {
  const limits = { text: [12, 180, 2], logo: [2, 35, 1], media: [2, 100, 1], model: [2, 100, 1], carousel: [0.5, 2.5, 0.05] };
  if (!limits[layer.type] || !Number.isFinite(deltaY) || !Number.isFinite(size)) throw new Error('Invalid canvas size gesture.');
  const [min, max, step] = limits[layer.type];
  return rounded(clamp(size + (deltaY < 0 ? step : deltaY > 0 ? -step : 0), min, max));
}

export const GRID_POINTS = Object.freeze([
  ...Array.from({ length: 36 }, (_, index) => Object.freeze({ row: Math.floor(index / 6), column: index % 6, x: 5 + (index % 6 + 0.5) * 15, y: 5 + (Math.floor(index / 6) + 0.5) * 15 })),
  Object.freeze({ row: null, column: null, x: 50, y: 50 })
]);
export function nearestGridPoint(x, y) {
  return GRID_POINTS.reduce((best, point, index) => (point.x - x) ** 2 + (point.y - y) ** 2 < (GRID_POINTS[best].x - x) ** 2 + (GRID_POINTS[best].y - y) ** 2 ? index : best, 0);
}
export function freePlacement(x, y, width, height, layout) {
  return constrainPlacement(x, y, width, height, layout);
}
export function nudgePlacement(position, dx, dy, [canvasWidth, canvasHeight], bounds, step = 1, layout) {
  return freePlacement(position.x + dx * step / canvasWidth * 100, position.y + dy * step / canvasHeight * 100, bounds.width, bounds.height, layout);
}
export function gridPlacement(index, width, height, alignment = 'center') {
  const point = GRID_POINTS[index];
  if (!point || !['left', 'center', 'right'].includes(alignment)) throw new Error('Invalid grid position.');
  const bounded = (value, size) => {
    const inset = Math.max(0, Math.min(5, (100 - size) / 2));
    return rounded(clamp(value, inset, Math.max(inset, Math.min(95, 100 - inset - size))));
  };
  return { x: bounded(point.x - width * ({ left: 0, center: 0.5, right: 1 }[alignment]), width), y: bounded(point.y - height / 2, height), gridIndex: index };
}
export function stepGridPoint(index, dx, dy) {
  if (index === 36) return (dy > 0 ? 3 : 2) * 6 + (dx > 0 ? 3 : 2);
  const point = GRID_POINTS[index];
  return clamp(point.row + dy, 0, 5) * 6 + clamp(point.column + dx, 0, 5);
}

export function editClip(layer, kind, delta, duration, fps) {
  const step = 1 / fps;
  const quantized = Math.round(delta * fps) / fps;
  const span = layer.end - layer.start;
  const minimum = Math.max(0.01, Math.min(step, span));
  // Do not round timestamps: imported short clips must keep their valid duration.
  const range = (start, end) => ({ start: start + 0.01 > end ? Math.max(0, end - 0.01 - Number.EPSILON * Math.max(1, duration)) : start, end });
  if (kind === 'move') {
    const start = clamp(layer.start + quantized, 0, duration - span);
    return range(start, Math.min(duration, start + span));
  }
  if (kind === 'start') return range(clamp(layer.start + quantized, 0, layer.end - minimum), layer.end);
  if (kind === 'end') return range(layer.start, clamp(layer.end + quantized, layer.start + minimum, duration));
  throw new Error('Unknown clip action.');
}

export function editFade(layer, kind, delta, fps) {
  if (!['fadeIn', 'fadeOut'].includes(kind)) throw new Error('Unknown fade action.');
  // The fade-out handle sits at the clip end, so moving it left lengthens the fade.
  const quantized = Math.round(delta * fps) / fps * (kind === 'fadeIn' ? 1 : -1);
  const other = kind === 'fadeIn' ? layer.fadeOut : layer.fadeIn;
  return { fadeIn: layer.fadeIn, fadeOut: layer.fadeOut, [kind]: clamp(layer[kind] + quantized, 0, Math.max(0, layer.end - layer.start - other)) };
}

export function timeAtPointer(clientX, rect, duration, fps) {
  return clamp(Math.round((clientX - rect.left) / rect.width * duration * fps) / fps, 0, duration - 1 / fps);
}
