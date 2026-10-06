import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import linescape from '../shaders/linescape.frag?raw';

export function LoginBackground() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power' }); }
    catch { return; }
    const uniforms = {
      RENDERSIZE: { value: new THREE.Vector2(1, 1) },
      TIME: { value: 0 }, Offset_X: { value: 1 }, Speed: { value: 0 }
    };
    const vertexShader = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader: 'uniform vec2 RENDERSIZE; uniform float TIME; uniform float Offset_X; uniform float Speed;\n' + linescape,
      depthTest: false, depthWrite: false
    });
    const target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false });
    const split = new THREE.Vector2();
    const splitMaterial = new THREE.ShaderMaterial({
      uniforms: { image: { value: target.texture }, split: { value: split } },
      vertexShader,
      fragmentShader: `uniform sampler2D image; uniform vec2 split; varying vec2 vUv;
        void main() {
          float r = texture2D(image, vUv + split).r;
          float g = texture2D(image, vUv).g;
          float b = texture2D(image, vUv - split).b;
          gl_FragColor = vec4(r, g, b, 1.0);
        }`,
      depthTest: false, depthWrite: false
    });
    const geometry = new THREE.PlaneGeometry(2, 2);
    const scene = new THREE.Scene();
    const quad = new THREE.Mesh(geometry, material);
    scene.add(quad);
    const camera = new THREE.Camera();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const started = performance.now();
    let frame = 0, lastDraw = 0, contextLost = false;
    function draw(now) {
      uniforms.TIME.value = reducedMotion.matches ? 0 : (now - started) / 1000;
      quad.material = material;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      quad.material = splitMaterial;
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }
    function tick(now) {
      if (now - lastDraw >= 1000 / 30) { draw(now); lastDraw = now; }
      frame = requestAnimationFrame(tick);
    }
    function update() {
      cancelAnimationFrame(frame);
      if (document.hidden || contextLost) return;
      const { width, height } = canvas.getBoundingClientRect();
      const scale = Math.min(1, 1200 / Math.max(width, height));
      const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
      renderer.setSize(w, h, false);
      target.setSize(w, h);
      split.set(3 / Math.max(1, width), 0.6 / Math.max(1, height));
      uniforms.RENDERSIZE.value.set(w, h);
      draw(performance.now());
      if (!reducedMotion.matches) frame = requestAnimationFrame(tick);
    }
    function loseContext(event) { event.preventDefault(); contextLost = true; cancelAnimationFrame(frame); }
    function restoreContext() { contextLost = false; update(); }
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    reducedMotion.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    canvas.addEventListener('webglcontextlost', loseContext);
    canvas.addEventListener('webglcontextrestored', restoreContext);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      reducedMotion.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
      canvas.removeEventListener('webglcontextlost', loseContext);
      canvas.removeEventListener('webglcontextrestored', restoreContext);
      geometry.dispose(); material.dispose(); splitMaterial.dispose(); target.dispose(); renderer.dispose();
    };
  }, []);
  return <canvas ref={canvasRef} className="auth-background" aria-hidden="true"/>;
}
