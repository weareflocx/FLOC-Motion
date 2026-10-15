import { useCallback } from 'react';
import { PROJECT_LIMITS, duplicateLayer, reorderLayer, demoProject, carouselImages } from '../project.js';
import { BRAND } from '../brand.js';
import { effectLayer } from '../effects.js';
import { safeArea } from '../layout.js';
import { evaluateChoreography } from '../choreography.js';
import { ALIGN_MODES, alignDeltas, applyPositions, arrangedPositions, distributeDeltas, selectionBounds } from './arrange.js';
import { layerPosition, measureLayerBounds } from './layer-bounds.js';
import { POSITIONABLE_TYPES, groupFlagValue, singleSelection, transformableLayers } from './selection.js';

const lockedNotice = (verb, layers) => `${verb} skipped ${layers.length === 1 ? `the locked layer “${layers[0].name}”` : `${layers.length} locked layers`}. Unlock ${layers.length === 1 ? 'it' : 'them'} to include ${layers.length === 1 ? 'it' : 'them'}.`;

export function useCompositionActions({ project, projectRef, selected, setSelected, setSelection = ids => setSelected(ids.at(-1) ?? null), setLeftTab, change, report }) {
  const addText = useCallback(() => {
    const current = projectRef.current;
    if (current.layers.length >= PROJECT_LIMITS.maxLayers) return;
    const id = crypto.randomUUID();
    change({ ...current, layers: [...current.layers, { id, type: 'text', name: 'New text', visible: true, start: 0, end: current.duration, text: 'Your next idea.', x: 8, y: 76, size: 42, color: BRAND.colors.white, weight: 600, width: 78, fadeIn: 0.45, fadeOut: 0.25, rise: false }] });
    setSelected(id);
    setLeftTab('layers');
  }, [change, projectRef, setLeftTab, setSelected]);

  // Card list edits name their carousel; the inspector's Cards section owns them.
  const editCards = useCallback((layerId, edit) => {
    const current = projectRef.current, layer = current.layers.find(l => l.id === layerId && l.type === 'carousel');
    if (!layer || layer.locked) return;
    const images = edit([...carouselImages(current, layer)]);
    if (images) change({ ...current, layers: current.layers.map(l => l.id === layer.id ? { ...l, images } : l) });
  }, [change, projectRef]);
  const moveImage = useCallback((layerId, from, to) => editCards(layerId, images => {
    if (from === to || to < 0 || to >= images.length || !images[from]) return null;
    images.splice(to, 0, ...images.splice(from, 1));
    return images;
  }), [editCards]);
  const removeImage = useCallback((layerId, index) => editCards(layerId, images => images.filter((_, imageIndex) => imageIndex !== index)), [editCards]);

  const moveLayer = useCallback((delta, id = selected) => {
    const current = projectRef.current;
    const index = current.layers.findIndex(layer => layer.id === id);
    const target = current.layers[index + delta];
    if (!target || current.layers[index]?.locked || current.layers[index]?.type === 'background' || target.type === 'background') return;
    if (change(reorderLayer(current, id, target.id, delta > 0 ? 'above' : 'below'))) setSelected(id);
  }, [change, projectRef, selected, setSelected]);

  const dropLayer = useCallback((id, targetId, side) => {
    const current = projectRef.current;
    if (current.layers.find(l => l.id === id)?.locked || current.layers.find(l => l.id === id)?.type === 'background') return;
    let next;
    try { next = reorderLayer(current, id, targetId, side); } catch (error) { report?.(error.message); return; }
    if (next.layers.every((layer, i) => layer.id === current.layers[i].id)) return;
    if (change(next)) setSelected(id);
  }, [change, projectRef, report, setSelected]);

  const copyLayer = useCallback(id => {
    const current = projectRef.current;
    if (current.layers.length >= PROJECT_LIMITS.maxLayers || current.layers.find(l => l.id === id)?.locked || current.layers.find(l => l.id === id)?.type === 'background') return;
    const newId = crypto.randomUUID();
    if (change(duplicateLayer(current, id, newId))) setSelected(newId);
  }, [change, projectRef, setSelected]);

  const removeText = useCallback(id => {
    if (project.layers.find(layer => layer.id === id)?.locked || project.layers.find(layer => layer.id === id)?.type === 'background') return;
    change({ ...project, layers: project.layers.filter(layer => layer.id !== id) });
    setSelected(project.layers.find(layer => layer.id !== id)?.id ?? null);
  }, [change, project, setSelected]);

  const addLayer = useCallback((type, fields = {}) => {
    const current = projectRef.current;
    if (type === 'background' || current.layers.length >= PROJECT_LIMITS.maxLayers) return false;
    const source = type === 'effect' ? effectLayer(crypto.randomUUID(), current.duration) : demoProject().layers.find(l => l.type === type);
    if (!source) return;
    const layer = { ...source, ...fields, id: crypto.randomUUID(), type, end: current.duration, ...(type === 'carousel' ? { images: fields.images ?? [], name: `Carousel ${current.layers.filter(l => l.type === type).length + 1}` } : {}) };
    if (!change({ ...current, layers: [...current.layers, layer] })) return false;
    setSelected(layer.id); setLeftTab('layers');
    return true;
  }, [change, projectRef, setSelected, setLeftTab]);

  // Group edits act on the selection in one undoable change; locked members are skipped and reported.
  const removeLayers = useCallback(ids => {
    const current = projectRef.current;
    const targets = current.layers.filter(layer => ids.includes(layer.id));
    const locked = targets.filter(layer => layer.locked), removable = targets.filter(layer => !layer.locked && layer.type !== 'background');
    if (!removable.length) { if (locked.length) report?.(lockedNotice('Delete', locked)); return null; }
    const next = change({ ...current, layers: current.layers.filter(layer => !removable.includes(layer)) });
    if (!next) return null;
    const kept = targets.filter(layer => !removable.includes(layer));
    setSelection(kept.length ? kept.map(layer => layer.id) : singleSelection(next.layers[0]?.id));
    if (locked.length) report?.(lockedNotice('Delete', locked));
    return next;
  }, [change, projectRef, report, setSelection]);

  const duplicateLayers = useCallback(ids => {
    const current = projectRef.current;
    const targets = current.layers.filter(layer => ids.includes(layer.id));
    const locked = targets.filter(layer => layer.locked), sources = targets.filter(layer => !layer.locked && layer.type !== 'background');
    if (!sources.length) { if (locked.length) report?.(lockedNotice('Duplicate', locked)); return null; }
    if (current.layers.length + sources.length > PROJECT_LIMITS.maxLayers) { report?.(`Duplicating ${sources.length} layers would exceed ${PROJECT_LIMITS.maxLayers} layers.`); return null; }
    const copies = sources.map(layer => ({ source: layer.id, id: crypto.randomUUID() }));
    try {
      const next = change(copies.reduce((draft, copy) => duplicateLayer(draft, copy.source, copy.id), current));
      if (!next) return null;
      setSelection(copies.map(copy => copy.id));
      if (locked.length) report?.(lockedNotice('Duplicate', locked));
      return next;
    } catch (error) { report?.(error.message); return null; }
  }, [change, projectRef, report, setSelection]);

  // `field` is 'locked' or 'visible'; mixed selections lock or show every member.
  const setLayersFlag = useCallback((ids, field) => {
    const current = projectRef.current;
    const targets = current.layers.filter(layer => ids.includes(layer.id));
    if (!targets.length || !['locked', 'visible'].includes(field)) return null;
    const value = groupFlagValue(targets, field);
    return change({ ...current, layers: current.layers.map(layer => targets.includes(layer) ? { ...layer, [field]: value } : layer) });
  }, [change, projectRef]);

  const positionLayers = useCallback((positions, time) => {
    try { return change(applyPositions(projectRef.current, positions, time)); }
    catch (error) { report?.(error.message); return null; }
  }, [change, projectRef, report]);

  // Aligns to the bounds of every selected on-canvas layer (locked ones anchor
  // without moving), or to the safe area for one layer; distributes 3+ movable layers.
  const arrangeLayers = useCallback((mode, ids, time, root) => {
    const current = projectRef.current;
    const layers = transformableLayers(current, ids, time);
    const rects = measureLayerBounds(root, layers);
    if (!layers.length || rects.length !== layers.length) { report?.('Show the selected layers on the canvas to arrange them.'); return null; }
    const anchors = measureLayerBounds(root, current.layers.filter(layer => ids.includes(layer.id) && POSITIONABLE_TYPES.includes(layer.type) && layer.visible && time >= layer.start && time < layer.end).map(layer => evaluateChoreography(layer, time)));
    const deltas = Object.hasOwn(ALIGN_MODES, mode) ? alignDeltas(rects, mode, ids.length > 1 ? selectionBounds(anchors) : safeArea(current.layout)) : distributeDeltas(rects, mode);
    const members = layers.map(layer => ({ id: layer.id, type: layer.type, start: layerPosition(root, layer) }));
    const positions = arrangedPositions(members, deltas).filter(position => {
      const start = members.find(member => member.id === position.id).start;
      return Math.abs(position.x - start.x) > 1e-6 || Math.abs(position.y - start.y) > 1e-6;
    });
    return positions.length ? positionLayers(positions, time) : current;
  }, [positionLayers, projectRef, report]);

  return { addLayer, addText, moveImage, moveLayer, dropLayer, copyLayer, removeImage, removeText, removeLayers, duplicateLayers, setLayersFlag, positionLayers, arrangeLayers };
}
