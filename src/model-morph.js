import * as THREE from 'three';
import { DEFAULT_MODEL_STYLE } from './model-style.js';
import { createMorphSurfaceNormals } from './model-morph-normals.js';

// Mesh adaptation of Sabo Sugi's Abnormal Sphere Morphing:
// https://codepen.io/sabosugi/pen/vEyOYEX
// Update real vertices so render depth, bounds and CPU picking share one shape.

const FIELD_KEYS = ['morphWarp', 'morphFrequency', 'morphFalloff', 'morphDetail', 'morphContrast'];
const PALETTE_KEYS = ['morphColor1', 'morphColor2', 'morphColor3', 'morphColor4'];
const fract = value => value - Math.floor(value);
const hash = (x, y, z) => fract(Math.sin(x * 12.9898 + y * 78.283 + z * 37.919) * 43758.7053);
const smooth = (low, high, value) => {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

// Value and its analytic spatial gradient share the same eight lattice hashes.
// Quintic interpolation has zero first and second derivatives at cell boundaries.
function noise(x, y, z, contrast, gradient, out) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * fx * (fx * (6 * fx - 15) + 10);
  const v = fy * fy * fy * (fy * (6 * fy - 15) + 10);
  const w = fz * fz * fz * (fz * (6 * fz - 15) + 10);
  const a = hash(ix, iy, iz), b = hash(ix + 1, iy, iz);
  const c = hash(ix, iy + 1, iz), d = hash(ix + 1, iy + 1, iz);
  const e = hash(ix, iy, iz + 1), f = hash(ix + 1, iy, iz + 1);
  const g = hash(ix, iy + 1, iz + 1), h = hash(ix + 1, iy + 1, iz + 1);
  const ab = a + (b - a) * u, cd = c + (d - c) * u;
  const ef = e + (f - e) * u, gh = g + (h - g) * u;
  const lower = ab + (cd - ab) * v, upper = ef + (gh - ef) * v;
  const value = Math.max(0, Math.min(1, lower + (upper - lower) * w));
  out[0] = Math.pow(value, contrast);
  if (!gradient) return;
  // Fractional powers have a singular derivative at zero. The downstream height
  // smoothstep is flat there; bound this intermediate before multiplying by zero.
  const scale = contrast * Math.pow(Math.max(value, 1e-12), contrast - 1);
  out[1] = ((b - a + ((d - c) - (b - a)) * v) * (1 - w) + (f - e + ((h - g) - (f - e)) * v) * w) * (30 * fx * fx * (fx - 1) * (fx - 1)) * scale;
  out[2] = ((cd - ab) * (1 - w) + (gh - ef) * w) * (30 * fy * fy * (fy - 1) * (fy - 1)) * scale;
  out[3] = (upper - lower) * (30 * fz * fz * (fz - 1) * (fz - 1)) * scale;
}

function ownGeometry(source, widthSegments, heightSegments) {
  const geometry = widthSegments !== undefined || heightSegments !== undefined
    ? new THREE.SphereGeometry(1, widthSegments, heightSegments)
    : source.clone();
  const original = geometry.getAttribute('position');
  const count = original.count;
  const directions = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) {
    // SphereGeometry duplicates the UV seam and poles with trigonometric residue.
    // Canonical directions give those vertices exactly the same surface normal.
    const x = Math.abs(original.getX(i)) < 1e-12 ? 0 : original.getX(i);
    const y = Math.abs(original.getY(i)) < 1e-12 ? 0 : original.getY(i);
    const z = Math.abs(original.getZ(i)) < 1e-12 ? 0 : original.getZ(i);
    const length = Math.hypot(x, y, z);
    if (!Number.isFinite(length) || length === 0) throw new Error('Morphing sphere requires finite, nonzero sphere vertices.');
    const offset = i * 3;
    directions[offset] = x / length;
    directions[offset + 1] = y / length;
    directions[offset + 2] = z / length;
  }
  // Dedicated float attributes also handle decoded interleaved/normalized inputs.
  for (const name of ['position', 'normal', 'color']) {
    geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  }
  geometry.boundingBox = new THREE.Box3();
  geometry.boundingSphere = new THREE.Sphere();
  return {
    geometry, directions,
    warped: new Float64Array(count * 3), gradients: new Float64Array(count * 3),
    heights: new Float64Array(count), brightness: new Float64Array(count), factors: new Float64Array(count)
  };
}

function sampleField(entry, style, time, scratch) {
  const { directions, warped, gradients, heights, brightness } = entry;
  const initialPower = Math.pow(style.morphFalloff, style.morphFrequency);
  const phase = time * -.4, drift = time * .3;
  for (let i = 0; i < heights.length; i++) {
    const k = i * 3;
    let x = directions[k] * .4, y = directions[k + 1] * .4, z = directions[k + 2] * .4;
    let xx = .4, xy = 0, xz = 0, yx = 0, yy = .4, yz = 0, zx = 0, zy = 0, zz = .4;
    let frequency = style.morphFrequency, power = initialPower;
    for (let iteration = 0; iteration < style.morphDetail; iteration++) {
      const ax = y * power + phase + frequency * .18;
      const ay = z * power + phase + frequency * .21;
      const az = x * power + phase + frequency * .24;
      const cx = style.morphWarp * Math.cos(ax), cy = style.morphWarp * Math.cos(ay), cz = style.morphWarp * Math.cos(az);
      const nxx = xx + cx * yx, nxy = xy + cx * yy, nxz = xz + cx * yz;
      const nyx = yx + cy * zx, nyy = yy + cy * zy, nyz = yz + cy * zz;
      const nzx = zx + cz * xx, nzy = zy + cz * xy, nzz = zz + cz * xz;
      x += style.morphWarp * Math.sin(ax) / power;
      y += style.morphWarp * Math.sin(ay) / power;
      z += style.morphWarp * Math.sin(az) / power;
      xx = nxx; xy = nxy; xz = nxz; yx = nyx; yy = nyy; yz = nyz; zx = nzx; zy = nzy; zz = nzz;
      frequency++;
      power *= style.morphFalloff;
    }
    warped[k] = x; warped[k + 1] = y; warped[k + 2] = z;
    noise(x * 3.1 + drift, y * 3.1 + drift, z * 3.1 + drift, style.morphContrast, true, scratch);
    const height = scratch[0], t = Math.max(0, Math.min(1, (height - .2) / .6));
    heights[i] = t * t * (3 - 2 * t);
    brightness[i] = .4 + smooth(.4, .8, height) * 1.3;
    const scale = 3.1 * 6 * t * (1 - t) / .6;
    gradients[k] = (scratch[1] * xx + scratch[2] * yx + scratch[3] * zx) * scale;
    gradients[k + 1] = (scratch[1] * xy + scratch[2] * yy + scratch[3] * zy) * scale;
    gradients[k + 2] = (scratch[1] * xz + scratch[2] * yz + scratch[3] * zz) * scale;
  }
}

function deform(entry, amplitude) {
  const { geometry, directions, gradients, heights } = entry;
  const positions = geometry.attributes.position.array, normals = geometry.attributes.normal.array;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let radiusSquared = (1 + amplitude) ** 2;
  for (let i = 0; i < heights.length; i++) {
    const k = i * 3, x = directions[k], y = directions[k + 1], z = directions[k + 2];
    const radius = 1 + amplitude * heights[i];
    positions[k] = x * radius; positions[k + 1] = y * radius; positions[k + 2] = z * radius;
    // Normal of r(direction)*direction: subtract the tangential radius gradient.
    const gx = gradients[k], gy = gradients[k + 1], gz = gradients[k + 2];
    const radialGradient = x * gx + y * gy + z * gz, scale = amplitude / radius;
    const nx = x - scale * (gx - x * radialGradient);
    const ny = y - scale * (gy - y * radialGradient);
    const nz = z - scale * (gz - z * radialGradient);
    const inverseLength = 1 / Math.max(1e-12, Math.hypot(nx, ny, nz));
    normals[k] = nx * inverseLength; normals[k + 1] = ny * inverseLength; normals[k + 2] = nz * inverseLength;
    // Read Float32 values back so bounds include rounding of the actual GPU mesh.
    const px = positions[k], py = positions[k + 1], pz = positions[k + 2];
    minX = Math.min(minX, px); minY = Math.min(minY, py); minZ = Math.min(minZ, pz);
    maxX = Math.max(maxX, px); maxY = Math.max(maxY, py); maxZ = Math.max(maxZ, pz);
    radiusSquared = Math.max(radiusSquared, px * px + py * py + pz * pz);
  }
  geometry.boundingBox.min.set(minX, minY, minZ);
  geometry.boundingBox.max.set(maxX, maxY, maxZ);
  geometry.boundingSphere.radius = Math.sqrt(radiusSquared) * (1 + Number.EPSILON);
  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.normal.needsUpdate = true;
}

function sampleChroma(entry, contrast, time, scratch) {
  const { directions, warped, factors } = entry;
  const drift = time * .6 + 20;
  for (let i = 0; i < factors.length; i++) {
    const k = i * 3;
    noise(warped[k] * 1.5 + drift, warped[k + 1] * 1.5 + drift, warped[k + 2] * 1.5 + drift, contrast, false, scratch);
    factors[i] = fract((directions[k] + directions[k + 1] + directions[k + 2]) * .27 + Math.pow(scratch[0], 4.6)) * 4;
  }
}

function paint(entry, palette) {
  const { geometry, factors, brightness } = entry, colors = geometry.attributes.color.array;
  for (let i = 0; i < factors.length; i++) {
    const factor = factors[i], index = Math.floor(factor), blend = smooth(0, 1.4, fract(factor));
    const a = palette[index], b = palette[(index + 1) % 4], light = brightness[i], k = i * 3;
    colors[k] = (a.r + (b.r - a.r) * blend) * light;
    colors[k + 1] = (a.g + (b.g - a.g) * blend) * light;
    colors[k + 2] = (a.b + (b.b - a.b) * blend) * light;
  }
  geometry.attributes.color.needsUpdate = true;
}

// Caller selects the canonical sculpture source and supplies normalized modelStyle.
// Geometry ownership is per controller, never per cached GLTF or shared material.
// Explicit segments replace only runtime topology; omitted options retain source probes.
export function createMorphingSphere(model, { widthSegments, heightSegments } = {}) {
  const entries = [], bindings = [], bySource = new Map();
  model.traverse(mesh => {
    if (!mesh.isMesh) return;
    const source = mesh.geometry;
    let entry = bySource.get(source);
    if (!entry) {
      entry = ownGeometry(source, widthSegments, heightSegments);
      bySource.set(source, entry);
      entries.push(entry);
    }
    bindings.push({ mesh, source, owned: entry.geometry });
    mesh.geometry = entry.geometry;
  });
  const style = {}, palette = PALETTE_KEYS.map(() => new THREE.Color());
  const scratch = new Float64Array(4);
  let fieldDirty = true, shapeDirty = true, paletteDirty = true, chromaDirty = true;
  let fieldTime = NaN, disposed = false;
  let surfaceNormalState = null, elapsedTime = 0;
  function setStyle(input = DEFAULT_MODEL_STYLE) {
    if (disposed) return;
    for (const key of FIELD_KEYS) {
      const value = input[key] ?? DEFAULT_MODEL_STYLE[key];
      if (style[key] !== value) fieldDirty = true;
      style[key] = value;
    }
    const amplitude = input.morphAmplitude ?? DEFAULT_MODEL_STYLE.morphAmplitude;
    if (style.morphAmplitude !== amplitude) shapeDirty = true;
    style.morphAmplitude = amplitude;
    style.morphSpeed = input.morphSpeed ?? DEFAULT_MODEL_STYLE.morphSpeed;
    for (let i = 0; i < PALETTE_KEYS.length; i++) {
      const key = PALETTE_KEYS[i], value = input[key] ?? DEFAULT_MODEL_STYLE[key];
      if (style[key] !== value) {
        style[key] = value;
        palette[i].set(value);
        paletteDirty = true;
      }
    }
    style.base = input.base ?? DEFAULT_MODEL_STYLE.base;
    if (surfaceNormalState) surfaceNormalState.update(style, elapsedTime * style.morphSpeed);
  }
  setStyle();
  return {
    setStyle,
    get radius() { return 1 + style.morphAmplitude; },
    get surfaceNormals() {
      if (disposed) return null;
      if (!surfaceNormalState) surfaceNormalState = createMorphSurfaceNormals(style, elapsedTime * style.morphSpeed, hash);
      return surfaceNormalState.descriptor;
    },
    update(elapsed) {
      if (disposed) return;
      const time = Math.max(0, elapsed) * style.morphSpeed;
      if (!Number.isFinite(elapsed) || !Number.isFinite(time)) throw new RangeError('Morphing sphere time must be finite.');
      elapsedTime = Math.max(0, elapsed);
      if (surfaceNormalState) surfaceNormalState.update(style, time);
      const resample = fieldDirty || fieldTime !== time;
      if (resample) {
        for (const entry of entries) sampleField(entry, style, time, scratch);
        fieldTime = time;
        fieldDirty = false;
        chromaDirty = true;
        paletteDirty = true;
      }
      if (shapeDirty || (resample && style.morphAmplitude !== 0)) {
        for (const entry of entries) deform(entry, style.morphAmplitude);
        shapeDirty = false;
      }
      if (style.base !== 'custom' && paletteDirty) {
        for (const entry of entries) {
          if (chromaDirty) sampleChroma(entry, style.morphContrast, time, scratch);
          paint(entry, palette);
        }
        chromaDirty = false;
        paletteDirty = false;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (surfaceNormalState) surfaceNormalState.dispose();
      for (const { mesh, source, owned } of bindings) if (mesh.geometry === owned) mesh.geometry = source;
      for (const entry of entries) entry.geometry.dispose();
    }
  };
}
