import { Vector4 } from 'three';
import { BACKGROUND_VERTEX, backgroundFragment } from './background-shader.js';
import { watchContextLoss } from './scene-resources.js';

const UNIFORMS = ['uResolution', 'uUnit', 'uLine', 'uTime', 'uLoop', 'uFrame', 'uPattern', 'uScale', 'uWeight', 'uSeed', 'uDrift', 'uDirection', 'uFocus', 'uBase', 'uInk', 'uAccent', 'uAccentAmount', 'uAccentLayer', 'uVignette', 'uGrain'];
function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const message = gl.getShaderInfoLog(shader); gl.deleteShader(shader);
    throw new Error(`Procedural background shader failed to compile: ${message}`);
  }
  return shader;
}
function createProgram(gl, ids) {
  const program = gl.createProgram(), shaders = [];
  try {
    shaders.push(compile(gl, gl.VERTEX_SHADER, BACKGROUND_VERTEX));
    shaders.push(compile(gl, gl.FRAGMENT_SHADER, backgroundFragment(ids)));
    for (const shader of shaders) gl.attachShader(program, shader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`Procedural background shader failed to link: ${gl.getProgramInfoLog(program)}`);
    return { program, vao: gl.createVertexArray(), locations: Object.fromEntries(UNIFORMS.map(name => [name, gl.getUniformLocation(program, name)])) };
  } catch (error) { gl.deleteProgram(program); throw error; }
  finally { for (const shader of shaders) gl.deleteShader(shader); }
}
function draw(gl, resource, width, height, uniforms) {
  gl.bindVertexArray(resource.vao); gl.useProgram(resource.program);
  gl.viewport(0, 0, width, height);
  gl.disable(gl.SCISSOR_TEST); gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
  gl.colorMask(true, true, true, true);
  const u = resource.locations;
  gl.uniform2f(u.uResolution, width, height);
  gl.uniform1f(u.uUnit, uniforms.unit); gl.uniform1f(u.uLine, uniforms.line);
  gl.uniform1f(u.uTime, uniforms.time); gl.uniform1f(u.uLoop, uniforms.loop); gl.uniform1ui(u.uFrame, uniforms.frame);
  gl.uniform1i(u.uPattern, uniforms.pattern); gl.uniform1f(u.uScale, uniforms.scale);
  gl.uniform1f(u.uWeight, uniforms.weight); gl.uniform1ui(u.uSeed, uniforms.seed);
  gl.uniform2fv(u.uDrift, uniforms.drift); gl.uniform2fv(u.uDirection, uniforms.direction); gl.uniform2fv(u.uFocus, uniforms.focus);
  gl.uniform3fv(u.uBase, uniforms.base); gl.uniform3fv(u.uInk, uniforms.ink);
  gl.uniform3fv(u.uAccent, uniforms.accent); gl.uniform1f(u.uAccentAmount, uniforms.accentAmount); gl.uniform1i(u.uAccentLayer, uniforms.accentLayer ? 1 : 0);
  gl.uniform1f(u.uVignette, uniforms.vignette); gl.uniform1f(u.uGrain, uniforms.grain);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
function copy(canvas, target) {
  const output = target.getContext('2d');
  if (!output) return false;
  output.save(); output.resetTransform(); output.globalAlpha = 1; output.globalCompositeOperation = 'copy'; output.filter = 'none';
  output.drawImage(canvas, 0, canvas.height - target.height, target.width, target.height, 0, 0, target.width, target.height);
  output.restore();
  return true;
}

// Catalog/login tiles share a standalone context; composition callers inject
// their root renderer instead, so no composition allocates a background context.
function createRenderer(ids) {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('Procedural backgrounds need WebGL 2. Enable hardware acceleration in your browser, then reload.');
  const listeners = new Set();
  let resource = createProgram(gl, ids);
  const context = watchContextLoss(canvas, {
    restored() { resource = createProgram(gl, ids); listeners.forEach(listener => listener.restored()); },
    failed() { listeners.forEach(listener => listener.failed()); }
  });
  return {
    draw(target, uniforms) {
      if (context.lost || gl.isContextLost()) return false;
      if (canvas.width < target.width) canvas.width = target.width;
      if (canvas.height < target.height) canvas.height = target.height;
      draw(gl, resource, target.width, target.height, uniforms);
      return copy(canvas, target);
    },
    watch(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
}
function createSharedRenderer(ids, renderer) {
  const gl = renderer.getContext(), viewport = new Vector4(), scissor = new Vector4(), activeViewport = new Vector4(), activeScissor = new Vector4();
  let resource = null, oversized = null;
  return {
    draw(target, uniforms) {
      if (gl.isContextLost()) return false;
      // Restored contexts invalidate native objects; the root alone owns
      // context-loss listeners/recovery; rebuild lazily without a second owner.
      if (!resource || !gl.isProgram(resource.program)) resource = createProgram(gl, ids);
      const renderTarget = renderer.getRenderTarget(), cubeFace = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
      renderer.getViewport(viewport); renderer.getScissor(scissor);
      const scissorTest = renderer.getScissorTest();
      activeViewport.fromArray(gl.getParameter(gl.VIEWPORT)); activeScissor.fromArray(gl.getParameter(gl.SCISSOR_BOX));
      const activeScissorTest = gl.isEnabled(gl.SCISSOR_TEST);
      const canvas = renderer.domElement;
      let framebuffer = null;
      try {
        renderer.resetState();
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        // Usually the root buffer is at least source-sized. A larger source
        // uses an isolated framebuffer/readback rather than resizing the root.
        if (target.width > canvas.width || target.height > canvas.height) {
          if (!oversized || oversized.width !== target.width || oversized.height !== target.height || !gl.isFramebuffer(oversized.framebuffer)) {
            if (oversized) { gl.deleteFramebuffer(oversized.framebuffer); gl.deleteTexture(oversized.texture); }
            const texture = gl.createTexture(); framebuffer = gl.createFramebuffer();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, target.width, target.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            oversized = { framebuffer, texture, width: target.width, height: target.height, pixels: new Uint8Array(target.width * target.height * 4) };
          }
          framebuffer = oversized.framebuffer; gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        }
        draw(gl, resource, target.width, target.height, uniforms);
        if (!framebuffer) return copy(canvas, target);
        gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.UNSIGNED_BYTE, oversized.pixels);
        const output = target.getContext('2d');
        if (!output) return false;
        if (!oversized.image) oversized.image = output.createImageData(target.width, target.height);
        const stride = target.width * 4;
        for (let row = 0; row < target.height; row++) oversized.image.data.set(oversized.pixels.subarray(row * stride, (row + 1) * stride), (target.height - row - 1) * stride);
        output.putImageData(oversized.image, 0, 0);
        return true;
      } finally {
        renderer.resetState();
        renderer.setRenderTarget(renderTarget, cubeFace, mip);
        renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest);
        renderer.state.viewport(activeViewport); renderer.state.scissor(activeScissor); renderer.state.setScissorTest(activeScissorTest);
      }
    },
    dispose() {
      if (resource) { gl.deleteProgram(resource.program); gl.deleteVertexArray(resource.vao); resource = null; }
      if (oversized) { gl.deleteFramebuffer(oversized.framebuffer); gl.deleteTexture(oversized.texture); oversized = null; }
    }
  };
}
let shared;
const contexts = new WeakMap();
export function backgroundRenderer(ids, renderer = null) {
  if (renderer) {
    let adapter = contexts.get(renderer);
    if (!adapter) { adapter = createSharedRenderer(ids, renderer); contexts.set(renderer, adapter); }
    return adapter;
  }
  if (!shared) try { shared = createRenderer(ids); } catch (error) { shared = { error }; }
  if (shared.error) throw shared.error;
  return shared;
}

export function disposeBackgroundRenderer(renderer) {
  contexts.get(renderer)?.dispose();
  contexts.delete(renderer);
}
