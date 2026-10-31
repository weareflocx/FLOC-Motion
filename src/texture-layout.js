// Layout is measured in authored texture units, never preview pixels.
export const TEXTURE_LAYOUTS = Object.freeze(['original', 'adaptive', 'fit']);
export const TEXTURE_DISTRIBUTIONS = Object.freeze(['auto', 'manual']);
export const TEXTURE_LAYOUT_LIMITS = Object.freeze({ density: [.25, 2], count: [1, 64], elementSize: [.25, 1.5], margin: [0, .25] });
export const TEXTURE_LAYOUT_DEFAULTS = Object.freeze({ textureLayout: 'original', textureDistribution: 'auto', textureDensity: 1,
  textureColumns: 24, textureRows: 18, textureElementSize: 1, textureMargin: .05 });

// Native spacing preserves each texture's motif proportions and stagger.
const PITCH = Object.freeze({ settle: [35.04, 39.5], magnet: [13.84, 14], warp: [36.22, 28.06], pinch: [26.98, 27],
  pillars: [23.0941, 33.4779], sphere: [732 / 33, 732 / 33], twist: [670 / 24, 455 / 17], watch: [26.08, 26.08] });
const bounded = (value, [min, max]) => Math.max(min, Math.min(max, value));

export function textureLayout(id, settings, aspect) {
  if ((settings.textureLayout ?? 'original') === 'original') return null;
  const [pitchX, pitchY] = PITCH[id];
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const density = bounded(settings.textureDensity ?? 1, TEXTURE_LAYOUT_LIMITS.density);
  const manual = settings.textureDistribution === 'manual';
  const columns = bounded(manual ? settings.textureColumns ?? 24 : Math.ceil(516 * Math.max(1, ratio) / pitchX * density), TEXTURE_LAYOUT_LIMITS.count);
  const rows = bounded(manual ? settings.textureRows ?? 18 : Math.ceil(516 * Math.max(1, 1 / ratio) / pitchY * density), TEXTURE_LAYOUT_LIMITS.count);
  return { columns, rows, width: columns * pitchX, height: rows * pitchY,
    elementSize: bounded(settings.textureElementSize ?? 1, TEXTURE_LAYOUT_LIMITS.elementSize) };
}

// A fixed envelope, rather than this frame's moving bounds, keeps Fit all stable.
export function texturePlacement(layout, bounds, width, height, settings, zoom = 1) {
  if (settings.textureLayout === 'fit') {
    const margin = bounded(settings.textureMargin ?? .05, TEXTURE_LAYOUT_LIMITS.margin);
    const scale = Math.min(width * (1 - margin * 2) / (bounds.maxX - bounds.minX), height * (1 - margin * 2) / (bounds.maxY - bounds.minY));
    return { scale, x: width / 2 - (bounds.minX + bounds.maxX) / 2 * scale, y: height / 2 - (bounds.minY + bounds.maxY) / 2 * scale };
  }
  const scale = Math.max(width / layout.width, height / layout.height) * zoom;
  return { scale, x: (width - layout.width * scale) / 2, y: (height - layout.height * scale) / 2 };
}
