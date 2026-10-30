import { normalizeDataFlowStyle } from './data-flow-style.js';

// Data Pulse, Sabo Sugi: https://codepen.io/sabosugi/pen/azmxRXY
// Coordinates travel with the reference camera, while curves use absolute X.
export const DATA_FLOW_LENGTH = 1500;
export const DATA_FLOW_START = -100;
export const DATA_FLOW_VISIBLE_MIN = -30;
export const DATA_FLOW_VISIBLE_MAX = 350;
const TAU = Math.PI * 2;
const fraction = value => value - Math.floor(value);
const smooth = (a, b, value) => { const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t); };
function random(seed, index, stream) {
  let value = seed ^ Math.imul(index + 1, 0x9e3779b9) ^ Math.imul(stream + 1, 0x85ebca6b);
  value = Math.imul(value ^ value >>> 16, 0x7feb352d);
  value = Math.imul(value ^ value >>> 15, 0x846ca68b);
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
}

export function createDataFlowLayout(input) {
  const style = normalizeDataFlowStyle(input);
  const fibers = new Float32Array(style.fiberCount * 3), particles = new Float32Array(style.particleCount * 3);
  for (let i = 0; i < style.fiberCount; i++) {
    const angle = random(style.seed, i, 0) * TAU, radius = random(style.seed, i, 1), offset = i * 3;
    fibers[offset] = Math.sin(angle) * radius;
    fibers[offset + 1] = Math.cos(angle) * radius;
    fibers[offset + 2] = random(style.seed, i, 2) * 100;
  }
  for (let i = 0; i < style.particleCount; i++) {
    const offset = i * 3;
    particles[offset] = Math.floor(random(style.seed, i, 16) * style.fiberCount);
    particles[offset + 1] = random(style.seed, i, 17);
    particles[offset + 2] = .8 + .4 * random(style.seed, i, 18);
  }
  return { fibers, particles };
}

export function dataFlowTime(style, elapsed) {
  const time = Math.max(0, elapsed) * style.speed;
  if (!Number.isFinite(elapsed) || !Number.isFinite(time)) throw new RangeError('Data flow time must be finite.');
  return time;
}

// `time` is already the signed layer-local clock; do not multiply speed twice.
export function dataFlowPosition(style, baseY, baseZ, noiseSeed, relativeX, time, out, offset = 0) {
  const x = relativeX - 60 + time * style.travelSpeed;
  if (!Number.isFinite(relativeX) || !Number.isFinite(time) || !Number.isFinite(x)) throw new RangeError('Data flow coordinates and time must be finite.');
  const phase = fraction((x - time * style.flowSpeed) / style.nodeDistance);
  const pinch = Math.pow(.5 + .5 * Math.cos(phase * TAU), style.pinchSharpness);
  const spread = style.pinchWidth + (style.spread - style.pinchWidth) * pinch;
  out[offset] = relativeX;
  out[offset + 1] = baseY * spread + Math.sin(x * .015 + noiseSeed + time * 1.2) * style.noise * pinch;
  out[offset + 2] = baseZ * spread + Math.cos(x * .018 - noiseSeed + time) * style.noise * pinch;
  return out;
}

export function dataFlowParticlePosition(style, layout, index, time, out, offset = 0) {
  if (!Number.isInteger(index) || index < 0 || index >= layout.particles.length / 3) throw new RangeError('Unknown Data flow pulse.');
  const k = index * 3, fiber = layout.particles[k] * 3;
  const progress = fraction(layout.particles[k + 1] + time * style.particleSpeed * layout.particles[k + 2] / DATA_FLOW_LENGTH);
  const sample = progress * (style.samples - 1), first = Math.floor(sample), blend = sample - first;
  const step = DATA_FLOW_LENGTH / (style.samples - 1);
  dataFlowPosition(style, layout.fibers[fiber], layout.fibers[fiber + 1], layout.fibers[fiber + 2], DATA_FLOW_START + first * step, time, out, offset);
  const x = out[offset], y = out[offset + 1], z = out[offset + 2];
  dataFlowPosition(style, layout.fibers[fiber], layout.fibers[fiber + 1], layout.fibers[fiber + 2], DATA_FLOW_START + (first + 1) * step, time, out, offset);
  out[offset] = x + (out[offset] - x) * blend;
  out[offset + 1] = y + (out[offset + 1] - y) * blend;
  out[offset + 2] = z + (out[offset + 2] - z) * blend;
  return out;
}

export function dataFlowFade(relativeX) {
  return smooth(DATA_FLOW_VISIBLE_MIN, 50, relativeX) * (1 - smooth(150, DATA_FLOW_VISIBLE_MAX, relativeX));
}
