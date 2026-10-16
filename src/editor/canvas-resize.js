import { safeArea } from '../layout.js';
import { layerPosition, stageScene } from './layer-bounds.js';

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
// The visual edges scale about the stored box center, which a 3D model's
// silhouette need not share.
export function snapCenteredResize(layer, size, bounds, visualBounds, layout, tolerance, projectedPivot = null) {
  const area = safeArea(layout);
  const requested = centeredResize(layer, size, bounds);
  const edges = (axis, extent) => [visualBounds[axis], visualBounds[axis] + visualBounds[extent]];
  const pivot = (axis, extent) => projectedPivot?.[axis] ?? bounds[axis] + bounds[extent] / 2;
  let best;
  for (const [axis, extent] of [['x', 'width'], ['y', 'height']]) {
    if (!visualBounds[extent]) continue;
    const center = pivot(axis, extent);
    for (const reference of new Set([0, 100, area[axis], area[axis] + area[extent]])) {
      for (const edge of edges(axis, extent)) {
        const ratio = (reference - center) / (edge - center);
        if (!(ratio > 0) || !Number.isFinite(ratio)) continue;
        const candidate = layer.size * ratio;
        const distance = Math.abs(candidate - requested.size) / layer.size * Math.abs(edge - center) / tolerance[axis];
        if (distance <= 1 && centeredResize(layer, candidate, bounds).size === candidate && (!best || distance < best.distance)) best = { candidate, distance, axis, reference };
      }
    }
  }
  const result = best ? centeredResize(layer, best.candidate, bounds) : requested;
  const guides = [];
  for (const [axis, extent] of [['x', 'width'], ['y', 'height']]) {
    const center = pivot(axis, extent), ratio = result.size / layer.size;
    const scaled = edges(axis, extent).map(edge => center + (edge - center) * ratio);
    for (const reference of new Set([0, 100, area[axis], area[axis] + area[extent]])) {
      if (scaled.some(edge => Math.abs(edge - reference) < 1e-5)) guides.push({ axis, value: reference });
    }
  }
  return { ...result, guides };
}

export function layerResizeBounds(layer, root) {
  const scene = stageScene(root);
  if (scene && !scene.projectedBounds(layer.id)) return null;
  const node = [...(root?.querySelectorAll('[data-floc-layer]') ?? [])].find(node => node.dataset.flocLayer === layer.id);
  if (!node || !root.clientWidth || !root.clientHeight) return null;
  // Source dimensions are intrinsic object sizing, not picking/projected bounds.
  // Keeping this local box preserves the authored center under camera orbit and depth.
  const style = node.ownerDocument?.defaultView?.getComputedStyle(node);
  return { ...layerPosition(root, layer), width: (parseFloat(style?.width) || node.offsetWidth) / root.clientWidth * 100, height: (parseFloat(style?.height) || node.offsetHeight) / root.clientHeight * 100 };
}
