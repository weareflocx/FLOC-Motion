import { FORMATS } from '../project.js';
import { safeArea } from '../layout.js';

// Spatial distribution places whole layers once; it never creates a group object.
// Geometry runs in composition pixels so circles stay round in every format.
// Angles are degrees in screen space: 0 points right and positive turns clockwise
// (-90 is the top). Distances are percentages of the composition's short side.
export const DISTRIBUTE_LAYOUTS = Object.freeze({
  line: Object.freeze({ label: 'Line', angle: 0, spacing: 4 }),
  grid: Object.freeze({ label: 'Grid', columns: null, gapX: 4, gapY: 4 }),
  circle: Object.freeze({ label: 'Circle', radius: null, startAngle: -90, orientation: 'none' }),
  arc: Object.freeze({ label: 'Arc', radius: null, startAngle: 200, endAngle: 340, orientation: 'none' })
});
export const DISTRIBUTE_ORDERS = Object.freeze([['layers', 'Selection order'], ['position', 'Left to right'], ['reverse', 'Reverse selection order']]);
// Roll follows the editor's rotation sign (positive turns clockwise on screen).
// 'tangent' runs each layer's baseline clockwise along the curve (tops point outward);
// 'center' turns each layer's top toward the center.
export const DISTRIBUTE_ORIENTATIONS = Object.freeze([['none', 'Keep rotation'], ['tangent', 'Follow the curve'], ['center', 'Face the center']]);
export const MIN_DEFAULT_RADIUS = 15;
// Clearance between neighbours when the default radius is derived.
const RING_GAP = 4;

export function defaultDistribution() {
  const options = Object.fromEntries(Object.entries(DISTRIBUTE_LAYOUTS).map(([id, { label, ...values }]) => [id, { ...values }]));
  return { layout: 'line', order: 'layers', center: null, safeArea: true, ...options };
}

const radians = degrees => degrees * Math.PI / 180;
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
export const wrapRoll = degrees => { const value = ((degrees + 180) % 360 + 360) % 360 - 180; return Math.round(value * 1e6) / 1e6; };

function ordered(items, order) {
  if (order === 'reverse') return [...items].reverse();
  if (order === 'position') return [...items].sort((a, b) => Math.abs(a.cx - b.cx) > .5 ? a.cx - b.cx : a.cy - b.cy);
  return items;
}

// A measured box is axis-aligned around the current roll; near right angles its
// unrotated size is recoverable, otherwise the larger side bounds it either way.
function unrotated({ w, h, roll }) {
  const angle = radians(roll);
  if (Math.abs(Math.sin(2 * angle)) > .05) { const side = Math.max(w, h); return [side, side]; }
  return Math.abs(Math.cos(angle)) > .5 ? [w, h] : [h, w];
}
const rotatedBox = ([w, h], roll) => {
  const angle = radians(roll);
  return [Math.abs(w * Math.cos(angle)) + Math.abs(h * Math.sin(angle)), Math.abs(w * Math.sin(angle)) + Math.abs(h * Math.cos(angle))];
};
const extentAlong = ([w, h], angle) => Math.abs(w * Math.cos(angle)) + Math.abs(h * Math.sin(angle));

function ringAngles(kind, options, count) {
  const start = finite(options.startAngle, DISTRIBUTE_LAYOUTS[kind].startAngle);
  if (kind === 'circle') return Array.from({ length: count }, (_, i) => start + i * 360 / count);
  const end = finite(options.endAngle, DISTRIBUTE_LAYOUTS.arc.endAngle), sweep = end - start;
  if (count === 1) return [start + sweep / 2];
  // A full sweep would stack both ends; it spaces like a circle instead.
  const step = Math.abs(sweep) >= 360 ? sweep / count : sweep / (count - 1);
  return Array.from({ length: count }, (_, i) => start + i * step);
}

function orientedRoll(orientation, angle) {
  if (orientation === 'tangent') return wrapRoll(angle + 90);
  if (orientation === 'center') return wrapRoll(angle - 90);
  return undefined;
}

// The smallest radius whose neighbouring chords clear both members' extents.
function defaultRadius(items, angles, closed, rotating, unit) {
  let radius = MIN_DEFAULT_RADIUS * unit;
  const pairs = closed ? items.length : items.length - 1;
  for (let i = 0; i < pairs && items.length > 1; i++) {
    const j = (i + 1) % items.length, step = radians(angles[j] - angles[i]) + (closed && j === 0 ? 2 * Math.PI * Math.sign(angles[1] - angles[0] || 1) : 0);
    const half = Math.abs(Math.sin(step / 2));
    if (half < 1e-6) continue;
    const chord = radians(angles[i]) + step / 2 + Math.PI / 2;
    // Rotating members lie with their own width along the tangent, i.e. along the chord.
    const extent = item => rotating ? unrotated(item)[0] : extentAlong([item.w, item.h], chord);
    radius = Math.max(radius, ((extent(items[i]) + extent(items[j])) / 2 + RING_GAP * unit) / (2 * half));
  }
  return Math.ceil(radius / unit * 10) / 10 * unit;
}

// Positions relative to the arrangement's origin, in pixels.
function arrange(kind, items, options, unit) {
  const n = items.length;
  if (kind === 'line') {
    const angle = radians(finite(options.angle, 0)), cos = Math.cos(angle), sin = Math.sin(angle);
    const gap = Math.max(0, finite(options.spacing, DISTRIBUTE_LAYOUTS.line.spacing)) * unit;
    const extents = items.map(item => extentAlong([item.w, item.h], angle));
    let cursor = -(extents.reduce((sum, value) => sum + value, 0) + gap * (n - 1)) / 2;
    return { points: extents.map(extent => { const along = cursor + extent / 2; cursor += extent + gap; return { x: cos * along, y: sin * along }; }), radius: null };
  }
  if (kind === 'grid') {
    const columns = Math.max(1, Math.min(n, Math.round(finite(options.columns, Math.ceil(Math.sqrt(n))))));
    const rows = Math.ceil(n / columns);
    const gapX = Math.max(0, finite(options.gapX, 4)) * unit, gapY = Math.max(0, finite(options.gapY, 4)) * unit;
    const widths = Array(columns).fill(0), heights = Array(rows).fill(0);
    items.forEach((item, i) => { widths[i % columns] = Math.max(widths[i % columns], item.w); heights[Math.floor(i / columns)] = Math.max(heights[Math.floor(i / columns)], item.h); });
    const starts = (sizes, gap) => { let cursor = -(sizes.reduce((sum, value) => sum + value, 0) + gap * (sizes.length - 1)) / 2; return sizes.map(size => { const middle = cursor + size / 2; cursor += size + gap; return middle; }); };
    const xs = starts(widths, gapX), ys = starts(heights, gapY);
    return { points: items.map((_, i) => ({ x: xs[i % columns], y: ys[Math.floor(i / columns)] })), radius: null };
  }
  const angles = ringAngles(kind, options, n), orientation = options.orientation ?? 'none';
  const closed = kind === 'circle' || Math.abs(finite(options.endAngle, 0) - finite(options.startAngle, 0)) >= 360;
  const radius = Number.isFinite(options.radius) && options.radius > 0 ? options.radius * unit : defaultRadius(items, angles, closed, orientation !== 'none', unit);
  return { radius, points: angles.map(angle => ({ x: radius * Math.cos(radians(angle)), y: radius * Math.sin(radians(angle)), roll: orientedRoll(orientation, angle) })) };
}

function boundsOf(boxes) {
  const left = Math.min(...boxes.map(box => box.x - box.w / 2)), top = Math.min(...boxes.map(box => box.y - box.h / 2));
  const right = Math.max(...boxes.map(box => box.x + box.w / 2)), bottom = Math.max(...boxes.map(box => box.y + box.h / 2));
  return { left, top, right, bottom };
}

// `rects` are measured visible boxes in canvas percent `{ id, x, y, width, height, roll? }`
// (roll is the member's current rotation). Returns each member's target visible center
// in canvas percent, with an absolute roll when a circle or arc orients its members.
export function distributionTargets(rects, settings = {}, { format = 'landscape', layout } = {}) {
  const dimensions = FORMATS[format];
  if (!dimensions) throw new Error('Unknown format.');
  const kind = settings.layout ?? 'line';
  if (!Object.hasOwn(DISTRIBUTE_LAYOUTS, kind)) throw new Error('Unknown distribution layout.');
  const [width, height] = dimensions, unit = Math.min(width, height) / 100;
  const { label, ...defaults } = DISTRIBUTE_LAYOUTS[kind];
  const options = { ...defaults, ...settings[kind] };
  const items = ordered(rects.map(rect => ({ id: rect.id, w: rect.width / 100 * width, h: rect.height / 100 * height, cx: (rect.x + rect.width / 2) / 100 * width, cy: (rect.y + rect.height / 2) / 100 * height, roll: finite(rect.roll, 0) })), settings.order);
  if (!items.length) return { layout: kind, targets: [], bounds: null, fits: true, center: null, radius: null };
  const { points, radius } = arrange(kind, items, options, unit);
  const boxes = items.map((item, i) => {
    const [w, h] = points[i].roll === undefined ? [item.w, item.h] : rotatedBox(unrotated(item), points[i].roll);
    return { x: points[i].x, y: points[i].y, w, h };
  });
  const relative = boundsOf(boxes);
  const all = boundsOf(items.map(item => ({ x: item.cx, y: item.cy, w: item.w, h: item.h })));
  const selected = { x: (all.left + all.right) / 2, y: (all.top + all.bottom) / 2 };
  const explicit = settings.center && Number.isFinite(settings.center.x) && Number.isFinite(settings.center.y);
  // Without an explicit center a line, grid or circle centers on the selection; an arc
  // centers its visible bounds there (its circle center sits off the curve).
  const origin = explicit ? { x: settings.center.x / 100 * width, y: settings.center.y / 100 * height }
    : kind === 'arc' ? { x: selected.x - (relative.left + relative.right) / 2, y: selected.y - (relative.top + relative.bottom) / 2 } : selected;
  let fits = true;
  if (settings.safeArea !== false) {
    const area = safeArea(layout);
    for (const [axis, low, high, size, start, extent] of [['x', 'left', 'right', width, area.x, area.width], ['y', 'top', 'bottom', height, area.y, area.height]]) {
      const min = start / 100 * size, max = (start + extent) / 100 * size;
      const from = origin[axis] + relative[low], to = origin[axis] + relative[high];
      if (to - from > max - min + 1e-6) { fits = false; origin[axis] += (min + max) / 2 - (from + to) / 2; }
      else if (from < min) origin[axis] += min - from;
      else if (to > max) origin[axis] += max - to;
    }
  }
  const round = value => Math.round(value * 1e6) / 1e6;
  return {
    layout: kind, fits,
    targets: items.map((item, i) => ({ id: item.id, cx: round((origin.x + points[i].x) / width * 100), cy: round((origin.y + points[i].y) / height * 100), ...(points[i].roll === undefined ? {} : { roll: points[i].roll }) })),
    bounds: { x: round((origin.x + relative.left) / width * 100), y: round((origin.y + relative.top) / height * 100), width: round((relative.right - relative.left) / width * 100), height: round((relative.bottom - relative.top) / height * 100) },
    center: { x: round(origin.x / width * 100), y: round(origin.y / height * 100) },
    radius: radius === null ? null : round(radius / unit),
    // Where the canvas radius handle sits: the first member of a circle, the middle of an arc.
    handleAngle: radius === null ? null : kind === 'circle' ? finite(options.startAngle, -90) : (finite(options.startAngle, 200) + finite(options.endAngle, 340)) / 2
  };
}
