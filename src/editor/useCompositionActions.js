import { useCallback } from 'react';
import { BRAND } from '../brand.js';

export function useCompositionActions({ project, projectRef, selected, setSelected, setLeftTab, change }) {
  const addText = useCallback(() => {
    const current = projectRef.current;
    const id = crypto.randomUUID();
    change({ ...current, layers: [...current.layers, { id, type: 'text', name: 'New text', visible: true, start: 0, end: current.duration, text: 'Your next idea.', x: 8, y: 76, size: 42, color: BRAND.colors.white, weight: 600, width: 78, animation: 'fade' }] });
    setSelected(id);
    setLeftTab('layers');
  }, [change, projectRef, setLeftTab, setSelected]);

  const reorderImage = useCallback((index, delta) => {
    const images = [...project.images];
    const next = index + delta;
    if (next < 0 || next >= images.length) return;
    [images[index], images[next]] = [images[next], images[index]];
    change({ ...project, images });
  }, [change, project]);

  const moveLayer = useCallback(delta => {
    const layers = [...project.layers];
    const index = layers.findIndex(layer => layer.id === selected);
    const next = index + delta;
    if (next < 0 || next >= layers.length) return;
    [layers[index], layers[next]] = [layers[next], layers[index]];
    change({ ...project, layers });
  }, [change, project, selected]);

  const removeImage = useCallback(index => {
    change({ ...project, images: project.images.filter((_, imageIndex) => imageIndex !== index) });
  }, [change, project]);

  const removeText = useCallback(id => {
    change({ ...project, layers: project.layers.filter(layer => layer.id !== id) });
    setSelected(project.layers.find(layer => layer.type === 'carousel').id);
  }, [change, project, setSelected]);

  return { addText, reorderImage, moveLayer, removeImage, removeText };
}
