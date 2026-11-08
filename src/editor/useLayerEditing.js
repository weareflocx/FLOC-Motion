import { useCallback, useMemo } from 'react';
import { evaluateChoreography } from '../choreography.js';
import { choreographyPatch } from './choreography-edit.js';
import { centeredResize, layerResizeBounds } from './canvas-resize.js';

// Edits from the inspector, canvas and timeline apply at the playhead: animated layers get a
// choreography keyframe there, and the inspector shows the pose evaluated at the current time.
// Only edits tied to that instant pause playback; static values update the playing scene.
export function useLayerEditing({ project, projectRef, clock, time, patch, setTime, setPlaying, setError }) {
  const displayedProject = useMemo(() => project.layers.some(item => item.choreography?.length)
    ? { ...project, layers: project.layers.map(item => evaluateChoreography(item, time)) } : project, [project, time]);
  const editLayer = useCallback((id, fields) => {
    const current = projectRef.current, at = clock.get().time;
    const target = current.layers.find(item => item.id === id);
    if (!target) return;
    try {
      // Centered resizing measures the element on screen at the playhead.
      const resize = Object.keys(fields).length === 1 && Object.hasOwn(fields, 'size') && ['logo', 'media', 'model', 'dataflow'].includes(target.type);
      if (resize) {
        const displayed = evaluateChoreography(target, at);
        const bounds = layerResizeBounds(displayed, document.querySelector('.workspace .stage[aria-busy="false"]'));
        if (bounds) fields = centeredResize(displayed, fields.size, bounds);
      }
      const next = choreographyPatch(target, fields, at, current.fps);
      // A keyframe or a measured resize belongs to that instant: stop the playhead exactly there.
      if (resize || Object.hasOwn(next, 'choreography')) { setPlaying(false); setTime(at); }
      return patch(id, next);
    } catch (error) { setError(error.message); }
  }, [patch, projectRef, clock, setTime, setPlaying, setError]);
  const seek = useCallback(value => { setTime(Math.max(0, Math.min(projectRef.current.duration, value))); setPlaying(false); }, [projectRef, setTime, setPlaying]);
  return { displayedProject, editLayer, seek };
}
