import { createSceneRenderer } from './scene-renderer.js';

// Standalone asset/material previews share the same renderer implementation as
// compositions. A composition injects its own owner, including for Flat sources.
export const MAX_MODEL_RESOLUTION = 4096;

// A model canvas holds its largest size across keyframes at the composition's
// current pixel width, capped at twice that width and the GPU's texture limit.
export function modelResolution(layer, compositionWidth, maxSide = MAX_MODEL_RESOLUTION) {
  const sizes = [layer.size, ...(layer.choreography ?? []).map(state => state.values?.size)].filter(Number.isFinite);
  const size = sizes.length ? Math.max(...sizes) : 100;
  return Math.max(1, Math.min(Math.round(compositionWidth * size / 100), Math.round(compositionWidth * 2), maxSide));
}

let shared;
export function modelRenderer() {
  if (shared?.failed) { shared.dispose(); shared = undefined; }
  if (!shared) shared = createSceneRenderer();
  return shared;
}
