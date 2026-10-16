import * as THREE from 'three';
import { watchContextLoss } from './scene-resources.js';
import { disposeProceduralBackgrounds } from './backgrounds.js';

const COPY_VERTEX = 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}';
const COPY_FRAGMENT = 'varying vec2 vUv;uniform sampler2D source;void main(){gl_FragColor=texture2D(source,vUv);}';

// All source cameras, spatial geometry, picking and final output use this context.
// The displayed 2D copy retains its last frame if the context is lost.
export function createSceneRenderer() {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0, 0);
  renderer.autoClear = false;
  const listeners = new Set(), captures = new Map(), framebuffers = new Map(), targets = new Map();
  const viewport = new THREE.Vector4(), scissor = new THREE.Vector4(), origin = new THREE.Vector2();
  const copyScene = new THREE.Scene(), copyCamera = new THREE.Camera();
  const copyMaterial = new THREE.ShaderMaterial({ vertexShader: COPY_VERTEX, fragmentShader: COPY_FRAGMENT,
    uniforms: { source: { value: null } }, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
  const copyGeometry = new THREE.PlaneGeometry(2, 2); copyScene.add(new THREE.Mesh(copyGeometry, copyMaterial));
  let width = 1, height = 1, disposed = false, failed = false, pickTarget;
  const context = watchContextLoss(canvas, {
    restored() {
      for (const pool of [captures, framebuffers, targets]) { pool.forEach(value => value.dispose()); pool.clear(); }
      pickTarget?.dispose(); pickTarget = undefined; listeners.forEach(listener => listener.restored?.());
    },
    failed() { failed = true; listeners.forEach(listener => listener.failed?.()); }
  });
  function capacity(w, h) {
    if (canvas.width < w || canvas.height < h) renderer.setSize(Math.max(canvas.width, w), Math.max(canvas.height, h), false);
  }
  function frame(w, h, clear = true) {
    width = w; height = h; capacity(w, h);
    renderer.setRenderTarget(null); renderer.setViewport(0, 0, w, h);
    renderer.setScissor(0, 0, w, h); renderer.setScissorTest(true);
    renderer.autoClear = false;
    if (clear) { renderer.setClearColor(0, 0); renderer.clear(true, true, true); }
  }
  function draw(scene, camera, target, toneMapping = THREE.NoToneMapping, exposure = 1) {
    if (context.lost || disposed) return false;
    const w = target.width, h = target.height;
    frame(w, h);
    renderer.toneMapping = toneMapping; renderer.toneMappingExposure = exposure;
    renderer.render(scene, camera);
    const output = target.getContext('2d');
    if (!output) throw new Error('A source surface needs a 2D canvas.');
    output.resetTransform(); output.clearRect(0, 0, w, h);
    output.drawImage(canvas, 0, canvas.height - h, w, h, 0, 0, w, h);
    return true;
  }
  function framebuffer(slot = 'frame') {
    let texture = framebuffers.get(slot);
    if (!texture || texture.image.width !== width || texture.image.height !== height) {
      texture?.dispose(); texture = new THREE.FramebufferTexture(width, height);
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      texture.colorSpace = THREE.NoColorSpace; framebuffers.set(slot, texture);
    }
    renderer.setRenderTarget(null); renderer.copyFramebufferToTexture(texture, origin);
    return texture;
  }
  function capture(resolution = Math.max(width, height), slot = 'frame') {
    const texture = framebuffer(slot), scale = Math.min(1, resolution / Math.max(width, height));
    if (scale === 1) return texture;
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    const key = `${slot}:${w}:${h}`;
    let target = captures.get(key);
    if (!target) {
      target = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      target.texture.colorSpace = THREE.NoColorSpace; captures.set(key, target);
    }
    renderer.getViewport(viewport); renderer.getScissor(scissor); const clipped = renderer.getScissorTest();
    renderer.setRenderTarget(target); renderer.setViewport(0, 0, w, h); renderer.setScissorTest(false);
    copyMaterial.uniforms.source.value = texture; renderer.render(copyScene, copyCamera);
    renderer.setRenderTarget(null); renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(clipped);
    return target.texture;
  }
  function copyTo(target) {
    if (target.width !== width) target.width = width;
    if (target.height !== height) target.height = height;
    const output = target.getContext('2d'); output.resetTransform(); output.clearRect(0, 0, width, height);
    output.drawImage(canvas, 0, canvas.height - height, width, height, 0, 0, width, height);
  }
  return {
    renderer, canvas,
    maxSide: Math.min(4096, renderer.capabilities.maxTextureSize),
    get lost() { return context.lost; },
    get failed() { return failed; },
    watch(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    capacity, frame, draw, capture, framebuffer, copyTo,
    dataTarget(key, w, h, render) {
      let target = targets.get(key);
      if (!target || target.width !== w || target.height !== h) {
        target?.dispose(); target = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
        target.texture.colorSpace = THREE.NoColorSpace; targets.set(key, target);
      }
      const oldTarget = renderer.getRenderTarget(); renderer.getViewport(viewport); renderer.getScissor(scissor);
      const clipped = renderer.getScissorTest(), mapping = renderer.toneMapping, exposure = renderer.toneMappingExposure;
      try {
        renderer.setRenderTarget(target); renderer.setViewport(0, 0, w, h); renderer.setScissorTest(false);
        renderer.setClearColor(0, 0); renderer.clear(true, true, true); renderer.toneMapping = THREE.NoToneMapping; renderer.toneMappingExposure = 1;
        render();
      } finally {
        renderer.setRenderTarget(oldTarget); renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(clipped);
        renderer.toneMapping = mapping; renderer.toneMappingExposure = exposure;
      }
      return target;
    },
    drawCopy(texture) { copyMaterial.uniforms.source.value = texture; renderer.render(copyScene, copyCamera); },
    picking(w, h, render) {
      if (!pickTarget || pickTarget.width !== w || pickTarget.height !== h) {
        pickTarget?.dispose(); pickTarget = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
        pickTarget.texture.colorSpace = THREE.NoColorSpace;
      }
      const oldTarget = renderer.getRenderTarget(); renderer.getViewport(viewport); renderer.getScissor(scissor);
      const clipped = renderer.getScissorTest(), mapping = renderer.toneMapping, exposure = renderer.toneMappingExposure;
      try {
        renderer.setRenderTarget(pickTarget); renderer.setViewport(0, 0, w, h); renderer.setScissorTest(false);
        renderer.setClearColor(0, 0); renderer.clear(true, true, true); renderer.toneMapping = THREE.NoToneMapping; renderer.toneMappingExposure = 1;
        render();
      } finally {
        renderer.setRenderTarget(oldTarget); renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(clipped);
        renderer.toneMapping = mapping; renderer.toneMappingExposure = exposure;
      }
      return pickTarget;
    },
    dispose() {
      if (disposed) return;
      disposed = true; context.dispose(); listeners.clear();
      disposeProceduralBackgrounds(renderer);
      for (const pool of [captures, framebuffers, targets]) { pool.forEach(value => value.dispose()); pool.clear(); }
      pickTarget?.dispose();
      copyGeometry.dispose(); copyMaterial.dispose(); renderer.dispose(); renderer.forceContextLoss();
    }
  };
}
