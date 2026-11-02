import { useEffect, useMemo, useState } from 'react';
import { textMotionPresetPatch } from '../text-motion.js';
import { textSideLength } from '../editor-controls.js';

// Hovering or focusing a text entry/exit preset previews it on the main canvas.
// The preview is a derived project shown only by the stage: the session project,
// history, autosave and selection never see it. While it lasts the shared playback
// clock loops the previewed segment; ending restores the playhead and play state.

export const PREVIEW_HOLD = 0.4;

// Entry plays from the layer's start and holds briefly; exit holds briefly before
// playing out to the end. The segment stays inside the layer and short of the
// composition's end, where the clock would stop.
export function textMotionPreviewSegment(layer, side, duration, fps) {
  const last = Math.max(0, duration - 1 / fps);
  const length = textSideLength(layer, side) + PREVIEW_HOLD;
  const [from, to] = side === 'entry' ? [layer.start, layer.start + length] : [layer.end - length, layer.end];
  const start = Math.min(last, Math.max(layer.start, from));
  return { start, end: Math.max(start, Math.min(last, layer.end, to)) };
}

// The project the canvas shows for a preview target, or null when it cannot preview.
// `apply(project, id, patch)` returns the patched project (validation in the app).
export function textMotionPreviewProject(project, target, apply) {
  const layer = target && project.layers.find(item => item.id === target.layerId);
  if (!layer || layer.type !== 'text' || layer.locked) return null;
  try { return apply(project, layer.id, textMotionPresetPatch(layer, target.side, target.preset)); } catch { return null; }
}

// Loops `segment` on the playback clock and remembers what to restore.
export function createTextMotionPreview(clock) {
  let saved = null, segment = null, unsubscribe = null;
  const loop = () => {
    const { time } = clock.get();
    if (segment && segment.end > segment.start && (time >= segment.end || time < segment.start - 1e-6)) clock.setTime(segment.start);
  };
  return {
    get active() { return saved !== null; },
    show(next) {
      if (!saved) {
        const { time, playing } = clock.get();
        saved = { time, playing };
        unsubscribe = clock.subscribe(loop);
      }
      segment = next;
      clock.setTime(next.start);
      clock.setPlaying(next.end > next.start);
    },
    end() {
      if (!saved) return;
      const back = saved;
      unsubscribe();
      saved = segment = unsubscribe = null;
      clock.setPlaying(false);
      clock.setTime(back.time);
      clock.setPlaying(back.playing);
    }
  };
}

// `blocked` covers canvas gestures and pending canvas edits; previews only follow the
// single selected layer. Returns the project for the canvas (null when not previewing)
// and `preview(layerId, side, presetId)`, where a null preset ends the preview.
export function useTextMotionPreview({ project, clock, selected, blocked, apply }) {
  const [target, setTarget] = useState(null);
  const [controller] = useState(() => createTextMotionPreview(clock));
  const allowed = target && !blocked && target.layerId === selected;
  const previewProject = useMemo(() => allowed ? textMotionPreviewProject(project, target, apply) : null, [allowed, project, target, apply]);
  useEffect(() => {
    if (!previewProject) {
      controller.end();
      if (target) setTarget(null);
      return;
    }
    const layer = previewProject.layers.find(item => item.id === target.layerId);
    controller.show(textMotionPreviewSegment(layer, target.side, previewProject.duration, previewProject.fps));
  }, [previewProject, target]);
  useEffect(() => () => controller.end(), [controller]);
  const preview = useMemo(() => (layerId, side, preset) => setTarget(preset ? { layerId, side, preset } : null), []);
  return { project: previewProject, preview };
}
