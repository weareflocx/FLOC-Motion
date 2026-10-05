// Placement edits keep decoded media and renderer resources alive.
export function updatePlacementPreview(current, project) {
  const normalize = value => {
    const { linkedFormats, ...renderProject } = value;
    return { ...renderProject, layers: value.layers.map(layer => {
      const { contentField, ...renderLayer } = layer;
      if (!['text', 'logo', 'media', 'model', 'carousel', 'background'].includes(layer.type)) return renderLayer;
      const { x, y, size, opacity, choreography, roll, ...rest } = renderLayer;
      if (['model', 'carousel'].includes(layer.type)) {
        const { tilt, yaw, roll, ...unchanged } = rest;
        return unchanged;
      }
      return rest;
    }) };
  };
  if (JSON.stringify(normalize(current.project)) !== JSON.stringify(normalize(project))) return false;
  current.scene.updateLayers(project.layers);
  return true;
}
