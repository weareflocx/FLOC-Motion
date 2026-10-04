// Content edits do not change scene resources or layer geometry settings.
export function updateTextPreview(current, project) {
  const withoutText = value => {
    const { linkedFormats, ...renderProject } = value;
    return { ...renderProject, layers: value.layers.map(layer => layer.type === 'text' ? { ...layer, text: '' } : layer) };
  };
  if (JSON.stringify(withoutText(current.project)) !== JSON.stringify(withoutText(project))) return false;
  const changes = project.layers.filter((layer, index) => layer.type === 'text' && layer.text !== current.project.layers[index].text);
  if (!changes.length) return false;
  const nodes = [...current.node.querySelectorAll('[data-floc-layer]')];
  const updates = changes.map(layer => ({ layer, node: nodes.find(node => node.dataset.flocLayer === layer.id) }));
  if (updates.some(update => !update.node)) return false;
  updates.forEach(({ layer, node }) => { node.textContent = layer.text; });
  return true;
}
