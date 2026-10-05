import { safeArea } from '../layout.js';

const limits = { logo: [2, 500], media: [2, 500], model: [2, 500] };

// Keep the top-left coordinates used by saved projects and exported scenes.
export function centeredResize(layer, size, bounds) {
  if (!limits[layer.type]) return { size };
  const [min, max] = limits[layer.type];
  size = Math.max(min, Math.min(max, size));
  const ratio = size / layer.size;
  const clamp = value => Math.max(-1000, Math.min(1000, value));
  return { size, x: clamp(bounds.x + bounds.width * (1 - ratio) / 2), y: clamp(bounds.y + bounds.height * (1 - ratio) / 2) };
}

export function canvasMediaPlacement(x, y) {
  const clamp = value => Math.max(-1000, Math.min(1000, value));
  return { x: clamp(x), y: clamp(y) };
}

// Snap only within a small pointer distance: continuing past a margin releases it.
export function snapCenteredResize(layer, size, bounds, visualBounds, layout, tolerance) {
  const area = safeArea(layout);
  const requested = centeredResize(layer, size, bounds);
  let best;
  for (const [axis, extent] of [['x', 'width'], ['y', 'height']]) {
    const center = visualBounds[axis] + visualBounds[extent] / 2;
    const half = visualBounds[extent] / 2;
    if (!half) continue;
    for (const reference of new Set([0, 100, area[axis], area[axis] + area[extent]])) {
      const candidate = layer.size * Math.abs(reference - center) / half;
      const distance = Math.abs(candidate - requested.size) / layer.size * half / tolerance[axis];
      if (distance <= 1 && centeredResize(layer, candidate, bounds).size === candidate && (!best || distance < best.distance)) best = { candidate, distance, axis, reference };
    }
  }
  const result = best ? centeredResize(layer, best.candidate, bounds) : requested;
  const guides = [];
  for (const [axis, extent] of [['x', 'width'], ['y', 'height']]) {
    const half = visualBounds[extent] / 2 * result.size / layer.size;
    const center = visualBounds[axis] + visualBounds[extent] / 2;
    for (const reference of new Set([0, 100, area[axis], area[axis] + area[extent]])) {
      if (Math.min(Math.abs(center - half - reference), Math.abs(center + half - reference)) < 1e-5) guides.push({ axis, value: reference });
    }
  }
  return { ...result, guides };
}

export function layerResizeBounds(layer, root) {
  const node = [...(root?.querySelectorAll('[data-floc-layer]') ?? [])].find(node => node.dataset.flocLayer === layer.id);
  if (!node || !root.clientWidth || !root.clientHeight) return null;
  const style = node.ownerDocument?.defaultView?.getComputedStyle(node);
  return { x: parseFloat(node.style.left), y: parseFloat(node.style.top), width: (parseFloat(style?.width) || node.offsetWidth) / root.clientWidth * 100, height: (parseFloat(style?.height) || node.offsetHeight) / root.clientHeight * 100 };
}
