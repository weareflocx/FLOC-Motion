// Adapted from Textures (textures.dev), Copyright (c) 2026 Textures.
// MIT; see public/licenses/textures-dev.txt. Original geometry lives in the
// two field modules; no original React lifecycle or remote code runs here.
import { createSettleTexture, createMagnetTexture, createWarpTexture, createPinchTexture } from './texture-grid-fields.js';
import { createPillarsTexture, createSphereTexture, createTwistTexture, createWatchTexture } from './texture-sculpt-fields.js';
import { textureLayout, texturePlacement } from './texture-layout.js';

export const TEXTURE_BACKGROUNDS = Object.freeze([
  ['settle', 'Settle'], ['magnet', 'Magnet'], ['warp', 'Warp'], ['pillars', 'Pillars'],
  ['pinch', 'Pinch'], ['sphere', 'Sphere'], ['twist', 'Twist'], ['watch', 'Watch']
].map(([id, name]) => Object.freeze({ id, name, controls: ['focus'], source: 'textures.dev', license: 'MIT', url: `https://textures.dev/s/${id}` })));
const FACTORIES = { settle: createSettleTexture, magnet: createMagnetTexture, warp: createWarpTexture, pillars: createPillarsTexture,
  pinch: createPinchTexture, sphere: createSphereTexture, twist: createTwistTexture, watch: createWatchTexture };
const W = 732, H = 516, TAU = Math.PI * 2, STEP = 1 / 60, HISTORY_STEPS = 96, HISTORY_RATE = 1.5;
const states = new WeakMap();
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
function mixBits(value) { value = Math.imul(value ^ value >>> 16, 0x7feb352d); value = Math.imul(value ^ value >>> 15, 0x846ca68b); return (value ^ value >>> 16) >>> 0; }
const channel = value => Math.round(clamp(value) * 255);
const css = rgb => `rgb(${channel(rgb[0])},${channel(rgb[1])},${channel(rgb[2])})`;

// The original ambient path, with its random phase replaced by a stable seed.
// Looping quantizes each harmonic, so the pointer's complete history repeats.
function pointerAngle(time, loop, frequency) {
  if (!loop) return TAU / 4.5 * frequency * time;
  const cycles = (Math.round(Math.abs(loop) / 4.5 * frequency) || 1) * Math.sign(loop), cycle = time / loop;
  return TAU * cycles * (cycle - Math.floor(cycle));
}
function pointerAt(out, time, u, width, height) {
  const phase = mixBits(u.seed) / 4294967296 * TAU;
  out.x = width * u.focus[0] + width * .5 * (.76 * Math.sin(pointerAngle(time, u.loop, 1) + phase) + .2 * Math.sin(pointerAngle(time, u.loop, 1.93) + 1.2 + phase));
  out.y = height * u.focus[1] + height * .5 * (.72 * Math.sin(pointerAngle(time, u.loop, .75) + .8 + phase) + .2 * Math.sin(pointerAngle(time, u.loop, 1.37) + 2.1 + phase));
}
function createState(id, layout) {
  const state = { id, field: FACTORIES[id](layout), layout, width: layout?.width ?? W, height: layout?.height ?? H,
    pointer: { x: 0, y: 0, active: 1, reduced: false }, palette: [], paletteKey: '', scratch: null, frame: null,
    grain: null, grainImage: null, grainKey: '', grainPattern: null, vignetteKey: '', vignette: null,
    paint: { ink: '', field: '', weight: 1, colorAt: null }, phase: 0, accentAmount: 0 };
  state.paint.colorAt = (x, y) => {
    if (!state.accentAmount) return state.paint.ink;
    const field = Math.sin((x / state.width - .5) * 4.2 + state.phase) + Math.cos((y / state.height - .5) * 3.4 - state.phase);
    let value = clamp((field + .6) / 1.2); value = value * value * (3 - 2 * value);
    return state.palette[Math.round(value * state.accentAmount * 63)];
  };
  return state;
}
function configurePaint(state, u) {
  const key = `${u.ink}:${u.accent}`;
  if (state.paletteKey !== key) {
    state.paletteKey = key;
    for (let i = 0; i < 64; i++) state.palette[i] = css(u.ink.map((value, channel) => value + (u.accent[channel] - value) * i / 63));
  }
  state.paint.ink = state.palette[0]; state.paint.field = css(u.base); state.accentAmount = u.accentAmount;
  state.phase = mixBits(u.seed ^ 5) / 4294967296 * TAU + (u.loop ? TAU * Math.sign(u.loop) * (u.time / u.loop - Math.floor(u.time / u.loop)) : u.time);
}
function overlays(state, context, canvas, u) {
  const { width, height } = canvas;
  if (u.vignette > 0) {
    const key = `${width}:${height}:${u.vignette}`;
    if (state.vignetteKey !== key) {
      state.vignetteKey = key;
      state.vignette = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * .175, width / 2, height / 2, Math.hypot(width, height) / 2);
      state.vignette.addColorStop(0, 'rgba(0,0,0,0)'); state.vignette.addColorStop(1, `rgba(0,0,0,${u.vignette * .8})`);
    }
    context.fillStyle = state.vignette; context.fillRect(0, 0, width, height);
  }
  if (u.grain > 0) {
    if (!state.grain) { state.grain = canvas.ownerDocument.createElement('canvas'); state.grain.width = state.grain.height = 64; state.grainImage = state.grain.getContext('2d').createImageData(64, 64); }
    const key = `${u.seed}:${u.frame}:${u.unit}`;
    if (state.grainKey !== key) {
      const pixels = state.grainImage.data;
      for (let i = 0; i < 4096; i++) { const gray = mixBits(u.seed ^ Math.imul(u.frame, 0x9e3779b9) ^ i) >>> 24, j = i * 4; pixels[j] = pixels[j + 1] = pixels[j + 2] = gray; pixels[j + 3] = 255; }
      state.grain.getContext('2d').putImageData(state.grainImage, 0, 0);
      state.grainPattern = context.createPattern(state.grain, 'repeat');
      state.grainPattern.setTransform(new DOMMatrix().scale(Math.max(.5, u.unit * 1.4)));
      state.grainKey = key;
    }
    context.globalCompositeOperation = 'soft-light'; context.globalAlpha = u.grain * .24;
    context.fillStyle = state.grainPattern; context.fillRect(0, 0, width, height);
  }
}

function raster(state, key, target) {
  state[key] ??= target.ownerDocument.createElement('canvas');
  const canvas = state[key];
  if (canvas.width !== target.width) canvas.width = target.width;
  if (canvas.height !== target.height) canvas.height = target.height;
  // Pin rasterization to CPU backing: Chromium's adaptive readback otherwise
  // changes subpixel edge rounding on the first repeated identical seek.
  return canvas.getContext('2d', { willReadFrequently: true });
}

// Every seek reconstructs the same bounded source history. No accumulated state
// or wall-clock animation can make preview, reverse seeking and export diverge.
export function drawTextureBackground(canvas, id, u) {
  if (!Object.hasOwn(FACTORIES, id)) throw new Error(`Unknown local texture: ${id}`);
  const target = canvas.getContext('2d');
  if (!target) throw new Error('Texture backgrounds require a 2D canvas.');
  const layout = textureLayout(id, u.texture, u.textureAspect);
  let state = states.get(canvas);
  if (!state || state.id !== id || state.layout?.columns !== layout?.columns || state.layout?.rows !== layout?.rows ||
    state.layout?.elementSize !== layout?.elementSize) {
    state = createState(id, layout); states.set(canvas, state);
  }
  configurePaint(state, u);
  const context = raster(state, 'frame', canvas);
  context.save(); context.resetTransform(); context.globalCompositeOperation = 'source-over'; context.globalAlpha = 1; context.filter = 'none';
  context.fillStyle = state.paint.field; context.fillRect(0, 0, canvas.width, canvas.height);
  const weight = clamp(u.weight);
  if (weight > 0) {
    state.field.reset();
    for (let tick = 0; tick < HISTORY_STEPS; tick++) {
      pointerAt(state.pointer, u.time - (HISTORY_STEPS - tick - 1) * STEP * HISTORY_RATE, u, state.width, state.height);
      state.field.step(state.pointer, STEP);
    }
    let output = context;
    if (weight < 1) {
      output = raster(state, 'scratch', canvas);
      output.resetTransform(); output.globalAlpha = 1; output.globalCompositeOperation = 'source-over'; output.filter = 'none';
      output.fillStyle = state.paint.field; output.fillRect(0, 0, canvas.width, canvas.height);
    }
    output.save();
    if (layout) {
      const placement = texturePlacement(layout, state.field.bounds, canvas.width, canvas.height, u.texture, u.scale);
      output.translate(placement.x, placement.y); output.scale(placement.scale, placement.scale);
    } else {
      const scale = Math.max(canvas.width / W, canvas.height / H) * u.scale;
      output.translate((canvas.width - W * scale) / 2, (canvas.height - H * scale) / 2); output.scale(scale, scale);
      output.beginPath(); output.rect(0, 0, W, H); output.clip();
    }
    state.field.draw(output, state.paint); output.restore();
    if (output !== context) { context.globalAlpha = weight; context.drawImage(state.scratch, 0, 0); context.globalAlpha = 1; }
  }
  overlays(state, context, state.frame, u); context.restore();
  target.save(); target.resetTransform(); target.globalCompositeOperation = 'copy'; target.globalAlpha = 1; target.filter = 'none';
  target.drawImage(state.frame, 0, 0); target.restore();
  return true;
}
