import { useCallback } from 'react';
import { duplicateLayer, reorderLayer, demoProject, carouselImages } from '../project.js';
import { BRAND } from '../brand.js';
import { effectLayer } from '../effects.js';

export function useCompositionActions({ project, projectRef, selected, setSelected, setLeftTab, change }) {
  const addText = useCallback(() => {
    const current = projectRef.current;
    if (current.layers.length >= 20) return;
    const id = crypto.randomUUID();
    change({ ...current, layers: [...current.layers, { id, type: 'text', name: 'New text', visible: true, start: 0, end: current.duration, text: 'Your next idea.', x: 8, y: 76, size: 42, color: BRAND.colors.white, weight: 600, width: 78, fadeIn: 0.45, fadeOut: 0.25, rise: false }] });
    setSelected(id);
    setLeftTab('layers');
  }, [change, projectRef, setLeftTab, setSelected]);

  const reorderImage = useCallback((index, delta) => {
    const layer = project.layers.find(l => l.id === selected && l.type === 'carousel') || project.layers.find(l => l.type === 'carousel');
    if (!layer || layer.locked) return;
    const images = [...carouselImages(project, layer)];
    const next = index + delta;
    if (next < 0 || next >= images.length) return;
    [images[index], images[next]] = [images[next], images[index]];
    change({ ...project, layers: project.layers.map(l => l.id === layer.id ? { ...l, images } : l) });
  }, [change, project, selected]);

  const moveLayer = useCallback((delta, id = selected) => {
    const current = projectRef.current;
    const index = current.layers.findIndex(layer => layer.id === id);
    const target = current.layers[index + delta];
    if (!target || current.layers[index]?.locked) return;
    if (change(reorderLayer(current, id, target.id, delta > 0 ? 'above' : 'below'))) setSelected(id);
  }, [change, projectRef, selected, setSelected]);

  const dropLayer = useCallback((id, targetId, side) => {
    const current = projectRef.current;
    if (current.layers.find(l => l.id === id)?.locked) return;
    const next = reorderLayer(current, id, targetId, side);
    if (next.layers.every((layer, i) => layer.id === current.layers[i].id)) return;
    if (change(next)) setSelected(id);
  }, [change, projectRef, setSelected]);

  const copyLayer = useCallback(id => {
    const current = projectRef.current;
    if (current.layers.length >= 20 || current.layers.find(l => l.id === id)?.locked) return;
    const newId = crypto.randomUUID();
    if (change(duplicateLayer(current, id, newId))) setSelected(newId);
  }, [change, projectRef, setSelected]);

  const removeImage = useCallback(index => {
    const layer = project.layers.find(l => l.id === selected && l.type === 'carousel') || project.layers.find(l => l.type === 'carousel');
    if (!layer || layer.locked) return;
    const images = carouselImages(project, layer).filter((_, imageIndex) => imageIndex !== index);
    change({ ...project, layers: project.layers.map(l => l.id === layer.id ? { ...l, images } : l) });
  }, [change, project, selected]);

  const removeText = useCallback(id => {
    if (project.layers.find(layer => layer.id === id)?.locked) return;
    change({ ...project, layers: project.layers.filter(layer => layer.id !== id) });
    setSelected(project.layers.find(layer => layer.id !== id)?.id ?? null);
  }, [change, project, setSelected]);

  const addLayer = useCallback((type, fields = {}) => {
    const current = projectRef.current;
    if (current.layers.length >= 20) return false;
    const source = type === 'effect' ? effectLayer(crypto.randomUUID(), current.duration) : demoProject().layers.find(l => l.type === type);
    if (!source) return;
    const layer = { ...source, ...fields, id: crypto.randomUUID(), type, end: current.duration, ...(type === 'carousel' ? { images: fields.images ?? [], name: `Carousel ${current.layers.filter(l => l.type === type).length + 1}` } : {}) };
    if (!change({ ...current, layers: [...current.layers, layer] })) return false;
    setSelected(layer.id); setLeftTab('layers');
    return true;
  }, [change, projectRef, setSelected, setLeftTab]);

  return { addLayer, addText, reorderImage, moveLayer, dropLayer, copyLayer, removeImage, removeText };
}
