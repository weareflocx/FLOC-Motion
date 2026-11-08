import { useCallback, useMemo } from 'react';
import { PROJECT_LIMITS } from '../project.js';
import { arrangeAvailability, selectAllIds } from './selection.js';
import { alignTargetLabel } from './commands.js';
import { useDistribution } from './useDistribution.js';

// Selection-driven commands shared by the canvas, shortcuts, palette and the multi-selection summary.
// Every action pauses playback so it applies to the frame on screen.
export function useSelectionActions({ project, projectRef, clock, time, setPlaying, positionPreview, previewPosition, selection: { selection, selected, setSelection, setSelected, selectLayer }, actions }) {
  const { positionLayers, arrangeLayers, distributeLayers, setLayersFlag, duplicateLayers, removeLayers } = actions;
  const distribution = useDistribution({ project, projectRef, clock, time, selection, positionPreview, previewPosition, distributeLayers });
  const selectAll = useCallback(() => { setPlaying(false); setSelection(selectAllIds(projectRef.current, clock.get().time)); }, [projectRef, clock, setPlaying, setSelection]);
  const collapseSelection = useCallback(() => setSelected(selected), [selected, setSelected]);
  // Selecting keeps the preview playing; a drag pauses at the frame it started on.
  const selectCanvasLayer = useCallback(id => setSelected(id), [setSelected]);
  const toggleCanvasLayer = useCallback(id => selectLayer(id, 'toggle'), [selectLayer]);
  const moveGroup = useCallback(positions => { setPlaying(false); positionLayers(positions, clock.get().time); }, [positionLayers, clock, setPlaying]);
  const arrange = useCallback(mode => { setPlaying(false); arrangeLayers(mode, selection, clock.get().time, document.querySelector('.workspace .stage[aria-busy="false"]')); }, [arrangeLayers, selection, clock, setPlaying]);
  const selectedLayers = useMemo(() => project.layers.filter(item => selection.includes(item.id)), [project.layers, selection]);
  const arrangeState = useMemo(() => ({ ...arrangeAvailability(project, selection, time), target: alignTargetLabel(selection.length, project.layout) }), [project, selection, time]);
  const unlockedSelected = selectedLayers.filter(item => !item.locked);
  const structuralSelection = unlockedSelected.filter(item => item.type !== 'background');
  const canDuplicate = structuralSelection.length > 0 && project.layers.length + structuralSelection.length <= PROJECT_LIMITS.maxLayers;
  const groupActions = {
    toggleLock: () => setLayersFlag(selection, 'locked'), toggleVisibility: () => setLayersFlag(selection, 'visible'),
    duplicate: () => duplicateLayers(selection), remove: () => { setPlaying(false); removeLayers(selection); }
  };
  const summary = selection.length > 1 ? { layers: selectedLayers, canAlign: arrangeState.align, canDistribute: arrangeState.distribute, canDuplicate, onArrange: arrange, distribution, onToggleLock: groupActions.toggleLock, onToggleVisibility: groupActions.toggleVisibility, onDuplicate: groupActions.duplicate, onRemove: groupActions.remove } : null;
  return { selectAll, collapseSelection, selectCanvasLayer, toggleCanvasLayer, moveGroup, arrange, distribution, selectedLayers, arrangeState, canDuplicate, canDelete: structuralSelection.length > 0, groupActions, summary };
}
