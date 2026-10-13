const MEASURED_TYPES = ['text', 'logo', 'media', 'model'];

export function layerNode(root, id) {
  return [...(root?.querySelectorAll('[data-floc-layer]') ?? [])].find(node => node.dataset.flocLayer === id);
}

// Canvas-percent rectangles of rendered layers, as placement guides, snapping and
// alignment compare them. Carousels are their placement point. `layers` must be
// evaluated at the displayed time.
export function measureLayerBounds(root, layers) {
  const frame = root?.getBoundingClientRect();
  if (!frame?.width || !frame?.height) return [];
  const nodes = [...root.querySelectorAll('[data-floc-layer]')];
  return layers.flatMap(layer => {
    if (layer.type === 'carousel') return [{ id: layer.id, x: layer.x, y: layer.y, width: 0, height: 0 }];
    if (!MEASURED_TYPES.includes(layer.type)) return [];
    const node = nodes.find(item => item.dataset.flocLayer === layer.id);
    if (!node) return [];
    const box = node.getBoundingClientRect();
    return [{ id: layer.id, x: (box.left - frame.left) / frame.width * 100, y: (box.top - frame.top) / frame.height * 100, width: box.width / frame.width * 100, height: box.height / frame.height * 100 }];
  });
}

// The stored coordinates the scene currently places, including safe-area
// constraints on text, so moves keep the visual offset of the rendered box.
export function layerPosition(root, layer) {
  if (layer.type === 'carousel') return { x: layer.x, y: layer.y };
  const node = layerNode(root, layer.id);
  const x = parseFloat(node?.style.left), y = parseFloat(node?.style.top);
  return { x: Number.isFinite(x) ? x : layer.x, y: Number.isFinite(y) ? y : layer.y };
}
