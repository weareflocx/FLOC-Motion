// Placement edits keep decoded media and renderer resources alive.
export function updatePlacementPreview(current, project) {
  const normalize = value => ({ ...value, layers: value.layers.map(layer => {
    if (!['text', 'logo', 'media', 'model', 'carousel'].includes(layer.type)) return layer;
    const { x, y, size, ...rest } = layer;
    if (['model', 'carousel'].includes(layer.type)) {
      const { tilt, yaw, roll, ...unchanged } = rest;
      return unchanged;
    }
    return rest;
  }) });
  if (JSON.stringify(normalize(current.project)) !== JSON.stringify(normalize(project))) return false;
  current.scene.updateLayers(project.layers);
  return true;
}
