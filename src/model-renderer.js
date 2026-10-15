import * as THREE from 'three';
import { watchContextLoss } from './scene-resources.js';

// One hidden WebGL context renders every model layer on the page, so models never
// compete with carousels for the browser's limited number of live contexts. Each
// model renders into the bottom-left corner of the shared buffer and is copied onto
// its layer's 2D canvas, which keeps its last frame if the context is ever lost.
export const MAX_MODEL_RESOLUTION = 4096;

// A model canvas holds its largest size across keyframes at the composition's
// current pixel width, capped at twice that width and the GPU's texture limit.
export function modelResolution(layer, compositionWidth, maxSide = MAX_MODEL_RESOLUTION) {
  const sizes = [layer.size, ...(layer.choreography ?? []).map(state => state.values?.size)].filter(Number.isFinite);
  const size = sizes.length ? Math.max(...sizes) : 100;
  return Math.max(1, Math.min(Math.round(compositionWidth * size / 100), Math.round(compositionWidth * 2), maxSide));
}

function createRenderer() {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const listeners = new Set();
  const context = watchContextLoss(canvas, {
    restored() { listeners.forEach(listener => listener.restored()); },
    failed() { listeners.forEach(listener => listener.failed()); }
  });
  return {
    renderer,
    maxSide: Math.min(MAX_MODEL_RESOLUTION, renderer.capabilities.maxTextureSize),
    get lost() { return context.lost; },
    // Returns false while the context is lost; the target keeps its last frame.
    // Tone mapping is per model: programs are cached per mapping by three.js.
    draw(scene, camera, target, toneMapping = THREE.NoToneMapping, exposure = 1) {
      const size = target.width;
      if (context.lost || !size) return false;
      // The shared buffer only grows, so models of different sizes alternate freely.
      if (canvas.width < size || canvas.height < size) renderer.setSize(Math.max(canvas.width, size), Math.max(canvas.height, size), false);
      renderer.setViewport(0, 0, size, size);
      renderer.setScissor(0, 0, size, size);
      renderer.setScissorTest(true);
      renderer.toneMapping = toneMapping; renderer.toneMappingExposure = exposure;
      try { renderer.render(scene, camera); } finally { renderer.setScissorTest(false); }
      const output = target.getContext('2d');
      if (!output) return false;
      output.clearRect(0, 0, size, size);
      output.drawImage(canvas, 0, canvas.height - size, size, size, 0, 0, size, size);
      return true;
    },
    // Owners redraw after a restore and report a context that never returns.
    watch(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
}

// A failed creation is remembered, so drawing never retries it every frame.
let shared;
export function modelRenderer() {
  if (!shared) try { shared = createRenderer(); } catch (error) { shared = { error }; }
  if (shared.error) throw shared.error;
  return shared;
}
