const scenes = new WeakMap();
const MEASURED_TYPES = ['text', 'logo', 'media', 'model', 'carousel'];

// The stage owns scene lifetime; arrangement and inspector resize share its geometry authority.
export function registerStageScene(root, scene) {
  if (scene) scenes.set(root, scene);
  else scenes.delete(root);
}

export const stageScene = root => root && scenes.get(root);

export function layerNode(root, id) {
  return [...(root?.querySelectorAll('[data-floc-layer]') ?? [])].find(node => node.dataset.flocLayer === id);
}

export function projectedRect(root, id, scene = stageScene(root)) {
  const bounds = scene?.projectedBounds(id), frame = root?.getBoundingClientRect();
  if (!bounds || !frame?.width || !frame?.height) return null;
  const left = frame.left + bounds.x / 100 * frame.width, top = frame.top + bounds.y / 100 * frame.height;
  const width = bounds.width / 100 * frame.width, height = bounds.height / 100 * frame.height;
  return { left, top, width, height, right: left + width, bottom: top + height };
}

// Canvas-percent rectangles come from visible scene geometry, never hidden source DOM.
// `layers` must be evaluated at the displayed time.
export function measureLayerBounds(root, layers, scene = stageScene(root)) {
  return layers.flatMap(layer => {
    if (!MEASURED_TYPES.includes(layer.type)) return [];
    const bounds = scene?.projectedBounds(layer.id);
    return bounds ? [{ id: layer.id, ...bounds }] : [];
  });
}

// Convert a projected screen displacement to authored XY on the layer's depth plane.
// A parallel/unstable intersection is not an editable placement.
export function projectedShift(root, id, x, y, dx, dy, scene = stageScene(root)) {
  const from = scene?.projectPointer(x / 100, y / 100, id);
  const to = scene?.projectPointer((x + dx) / 100, (y + dy) / 100, id);
  return from && to ? { x: to.x - from.x, y: to.y - from.y } : null;
}

export function layerPosition(root, layer) {
  // Flat text may retain a layout/safe-area offset in its source presentation.
  const node = layer.space === 'flat' && layer.type === 'text' ? layerNode(root, layer.id) : null;
  const x = parseFloat(node?.style.left), y = parseFloat(node?.style.top);
  return { x: Number.isFinite(x) ? x : layer.x, y: Number.isFinite(y) ? y : layer.y };
}
