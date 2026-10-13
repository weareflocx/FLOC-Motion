import { BACKGROUND_VERTEX, backgroundFragment } from './background-shader.js';
import { watchContextLoss } from './scene-resources.js';

// One hidden WebGL 2 context serves every procedural background on the page,
// including the editor's pattern tiles, so backgrounds never compete with
// carousels and models for the browser's limited number of live contexts.
// Each draw renders into the bottom-left corner of the shared buffer and is
// copied onto the layer's own 2D canvas, which therefore keeps its last frame
// if the GPU context is ever lost.
const UNIFORMS = ['uResolution', 'uUnit', 'uLine', 'uTime', 'uFrame', 'uPattern', 'uScale', 'uWeight', 'uSeed', 'uBase', 'uInk', 'uVignette', 'uGrain'];

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(`Procedural background shader failed to compile: ${gl.getShaderInfoLog(shader)}`);
  return shader;
}

function createRenderer(ids) {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('Procedural backgrounds need WebGL 2. Enable hardware acceleration in your browser, then reload.');
  const listeners = new Set();
  let program, locations;
  function build() {
    program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, BACKGROUND_VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, backgroundFragment(ids)));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`Procedural background shader failed to link: ${gl.getProgramInfoLog(program)}`);
    locations = Object.fromEntries(UNIFORMS.map(name => [name, gl.getUniformLocation(program, name)]));
    gl.bindVertexArray(gl.createVertexArray());
    gl.useProgram(program);
  }
  build();
  const context = watchContextLoss(canvas, {
    restored() { build(); listeners.forEach(listener => listener.restored()); },
    failed() { listeners.forEach(listener => listener.failed()); }
  });
  return {
    // Returns false while the context is lost; the target keeps its last frame.
    draw(target, uniforms) {
      const { width, height } = target;
      if (context.lost || gl.isContextLost()) return false;
      // The shared buffer only grows, so tiles and stages can alternate freely.
      if (canvas.width < width) canvas.width = width;
      if (canvas.height < height) canvas.height = height;
      gl.viewport(0, 0, width, height);
      const u = locations;
      gl.uniform2f(u.uResolution, width, height);
      gl.uniform1f(u.uUnit, uniforms.unit);
      gl.uniform1f(u.uLine, uniforms.line);
      gl.uniform1f(u.uTime, uniforms.time);
      gl.uniform1ui(u.uFrame, uniforms.frame);
      gl.uniform1i(u.uPattern, uniforms.pattern);
      gl.uniform1f(u.uScale, uniforms.scale);
      gl.uniform1f(u.uWeight, uniforms.weight);
      gl.uniform1ui(u.uSeed, uniforms.seed);
      gl.uniform3fv(u.uBase, uniforms.base);
      gl.uniform3fv(u.uInk, uniforms.ink);
      gl.uniform1f(u.uVignette, uniforms.vignette);
      gl.uniform1f(u.uGrain, uniforms.grain);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const output = target.getContext('2d');
      if (!output) return false;
      output.drawImage(canvas, 0, canvas.height - height, width, height, 0, 0, width, height);
      return true;
    },
    // Owners redraw after a restore and report a context that never returns.
    watch(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
}

// A failed creation is remembered, so drawing never retries it every frame.
let shared;
export function backgroundRenderer(ids) {
  if (!shared) try { shared = createRenderer(ids); } catch (error) { shared = { error }; }
  if (shared.error) throw shared.error;
  return shared;
}
