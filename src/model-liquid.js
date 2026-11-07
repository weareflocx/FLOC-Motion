import * as THREE from 'three';
import { MarchingCubes, triTable } from 'three/addons/objects/MarchingCubes.js';
import { DEFAULT_MODEL_STYLE } from './model-style.js';
import { createLiquidSurface, syncLiquidSurface } from './model-liquid-normals.js';

// Mesh adaptation of Sabo Sugi's Abstract Chrome Liquid:
// https://codepen.io/editor/sabosugi/pen/01a1777c-c5ba-7db4-978a-e60cd0100f42
// Positive field values are inside: MarchingCubes differentiates -field to
// produce outward normals. The runtime mesh holds welded, unprojected samples
// of its zero set; the vertex shader projects them (model-liquid-normals.js).
const SHAPE_KEYS = ['liquidRadius', 'liquidInnerRadius', 'liquidThickness', 'liquidWarp', 'liquidFrequency', 'liquidOpen', 'liquidClosed', 'liquidDetail', 'liquidDuration', 'liquidEase', 'liquidSpeed'];
const TAU = Math.PI * 2;
const AXIS_LENGTH = Math.hypot(.35, 1, .45);
const AX = .35 / AXIS_LENGTH, AY = 1 / AXIS_LENGTH, AZ = .45 / AXIS_LENGTH;
const TRIANGLE_COUNTS = new Uint8Array(256);
const REFINEMENT_ORDER = [0, 3, 5, 3, 1, 4, 5, 4, 2, 3, 4, 5];
for (let i = 0; i < 256; i++) {
  let count = 0;
  while (count < 16 && triTable[i * 16 + count] !== -1) count++;
  TRIANGLE_COUNTS[i] = count / 3;
}

function phaseAt(style, elapsed) {
  if (!Number.isFinite(elapsed)) throw new RangeError('Liquid ribbons time must be finite.');
  const cycles = Math.max(0, elapsed) * style.liquidSpeed / style.liquidDuration;
  if (!Number.isFinite(cycles)) throw new RangeError('Liquid ribbons clock must be finite.');
  const u = ((cycles % 1) + 1) % 1;
  return TAU * (u - style.liquidEase * Math.sin(TAU * u));
}

function radiusOf(style) {
  return Math.max(style.liquidRadius, style.liquidInnerRadius) + style.liquidThickness + Math.sqrt(3) * style.liquidWarp * (1 + .85 + .15);
}

function createField(detail, capacity = 16384) {
  const cubes = new MarchingCubes(detail, { flatShading: false }, false, false, capacity);
  cubes.isolation = 0;
  cubes.geometry.boundingBox = new THREE.Box3();
  return {
    cubes, capacity, exact: new Uint8Array(cubes.size3),
    coordinates: new Float64Array(detail),
    firstX: new Float64Array(detail), firstY: new Float64Array(detail), firstZ: new Float64Array(detail)
  };
}

function triangleCount(cubes) {
  const n = cubes.size, n2 = cubes.size2, field = cubes.field;
  let count = 0;
  for (let z = 1; z < n - 2; z++) {
    for (let y = 1; y < n - 2; y++) {
      let q = z * n2 + y * n + 1;
      for (let x = 1; x < n - 2; x++, q++) {
        const code = (field[q] < 0 ? 1 : 0) | (field[q + 1] < 0 ? 2 : 0)
          | (field[q + n + 1] < 0 ? 4 : 0) | (field[q + n] < 0 ? 8 : 0)
          | (field[q + n2] < 0 ? 16 : 0) | (field[q + n2 + 1] < 0 ? 32 : 0)
          | (field[q + n2 + n + 1] < 0 ? 64 : 0) | (field[q + n2 + n] < 0 ? 128 : 0);
        count += TRIANGLE_COUNTS[code];
      }
    }
  }
  return count;
}

function fillField(entry, style, phase, bound) {
  const { cubes, exact, coordinates, firstX, firstY, firstZ } = entry;
  const n = cubes.size, n2 = cubes.size2, field = cubes.field;
  const warp = style.liquidWarp, warp2 = warp * .85, warp3 = warp * .15;
  const frequency = style.liquidFrequency, frequency2 = frequency * 2.2, frequency3 = frequency * 4.5;
  const radius = style.liquidRadius, innerRadius = style.liquidInnerRadius, thickness = style.liquidThickness;
  const opening = style.liquidOpen + (style.liquidClosed - style.liquidOpen) * (.5 - .5 * Math.cos(phase));
  const phase2 = 2 * phase, phase3 = 3 * phase;
  const offsetX2 = 1.3 - phase2, offsetY2 = 3.7 - phase2, offsetZ2 = 5.1 - phase2;
  const offsetX3 = 4 + phase3, offsetY3 = .7 + phase3, offsetZ3 = 2.9 + phase3;
  const radialCutA = radius * .6, radialCutB = innerRadius * .6, openingB = opening * .9;
  // Each remaining warp changes length by at most sqrt(3)*its amplitude;
  // the intervening ROT_OCT matrices are orthogonal. Outside both expanded
  // radial shells the field is provably negative, regardless of either cut.
  const margin0 = thickness + Math.sqrt(3) * (warp + warp2 + warp3) + 1e-10;
  const margin1 = thickness + Math.sqrt(3) * (warp2 + warp3) + 1e-10;
  const margin2 = thickness + Math.sqrt(3) * warp3 + 1e-10;
  const margin3 = thickness + 1e-10;
  for (let i = 0; i < n; i++) {
    const coordinate = (2 * i / n - 1) * bound;
    coordinates[i] = coordinate;
    // The first octave is separable on the grid: three trig calls per axis,
    // not three per voxel. Subsequent octaves still evaluate the exact warp.
    firstX[i] = warp * Math.sin(coordinate * frequency + 4.2 + phase);
    firstY[i] = warp * Math.sin(coordinate * frequency + phase);
    firstZ[i] = warp * Math.sin(coordinate * frequency + 2.1 + phase);
  }
  function sample(x, y, z, full) {
    const px = coordinates[x], py = coordinates[y], pz = coordinates[z];
    let r;
    if (!full) {
      r = Math.sqrt(px * px + py * py + pz * pz);
      if (Math.abs(r - radius) > margin0 && Math.abs(r - innerRadius) > margin0) return NaN;
    }
    let nx = px + firstY[y], ny = py + firstZ[z], nz = pz + firstX[x];
    // GLSL's ROT_OCT constructor is column-major.
    let qx = -.8 * ny - .6 * nz;
    let qy = .8 * nx + .36 * ny - .48 * nz;
    let qz = .6 * nx - .48 * ny + .64 * nz;
    if (!full) {
      r = Math.sqrt(qx * qx + qy * qy + qz * qz);
      if (Math.abs(r - radius) > margin1 && Math.abs(r - innerRadius) > margin1) return NaN;
    }
    nx = qx + warp2 * Math.sin(qy * frequency2 + offsetX2);
    ny = qy + warp2 * Math.sin(qz * frequency2 + offsetY2);
    nz = qz + warp2 * Math.sin(qx * frequency2 + offsetZ2);
    qx = -.8 * ny - .6 * nz;
    qy = .8 * nx + .36 * ny - .48 * nz;
    qz = .6 * nx - .48 * ny + .64 * nz;
    if (!full) {
      r = Math.sqrt(qx * qx + qy * qy + qz * qz);
      if (Math.abs(r - radius) > margin2 && Math.abs(r - innerRadius) > margin2) return NaN;
    }
    nx = qx + warp3 * Math.sin(qy * frequency3 + offsetX3);
    ny = qy + warp3 * Math.sin(qz * frequency3 + offsetY3);
    nz = qz + warp3 * Math.sin(qx * frequency3 + offsetZ3);
    r = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!full && Math.abs(r - radius) > margin3 && Math.abs(r - innerRadius) > margin3) return NaN;
    const divisor = Math.max(r, .001);
    nx /= divisor; ny /= divisor; nz /= divisor;
    const waveA = .30 * Math.sin(3 * nx + phase) * Math.cos(2 * nz - phase)
      + .12 * Math.sin(5 * nz + phase2) + .05 * Math.sin(9 * nx - phase3);
    const cutA = Math.max(0, (Math.abs(ny + waveA) - opening) * radialCutA);
    const waveB = .30 * Math.sin(3 * ny - phase) * Math.cos(2 * nx + phase)
      + .12 * Math.sin(5 * ny - phase2) + .05 * Math.sin(9 * nz + phase3);
    const cutB = Math.max(0, (Math.abs(.8 * nx + .6 * nz + waveB) - openingB) * radialCutB);
    const drA = r - radius, drB = r - innerRadius;
    return (thickness - Math.sqrt(Math.min(drA * drA + cutA * cutA, drB * drB + cutB * cutB))) * .45;
  }
  let index = 0;
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++, index++) {
        const value = sample(x, y, z, false);
        const deferred = Number.isNaN(value);
        field[index] = deferred ? -1 : value;
        exact[index] = deferred ? 0 : 1;
      }
    }
  }
  // Deferred negatives preserve every case sign, but must never participate in
  // edge interpolation or central-difference normals. Mark all eight corners
  // of every crossing cell AND their six axial neighbors for exact evaluation.
  for (let z = 1; z < n - 2; z++) {
    for (let y = 1; y < n - 2; y++) {
      let q = z * n2 + y * n + 1;
      for (let x = 1; x < n - 2; x++, q++) {
        const inside = field[q] < 0;
        if ((field[q + 1] < 0) === inside && (field[q + n] < 0) === inside
          && (field[q + n + 1] < 0) === inside && (field[q + n2] < 0) === inside
          && (field[q + n2 + 1] < 0) === inside && (field[q + n2 + n] < 0) === inside
          && (field[q + n2 + n + 1] < 0) === inside) continue;
        for (let corner = 0; corner < 8; corner++) {
          const k = q + (corner & 1) + (corner & 2 ? n : 0) + (corner & 4 ? n2 : 0);
          if (exact[k] === 0) exact[k] = 2;
          if (exact[k - 1] === 0) exact[k - 1] = 2;
          if (exact[k + 1] === 0) exact[k + 1] = 2;
          if (exact[k - n] === 0) exact[k - n] = 2;
          if (exact[k + n] === 0) exact[k + n] = 2;
          if (exact[k - n2] === 0) exact[k - n2] = 2;
          if (exact[k + n2] === 0) exact[k + n2] = 2;
        }
      }
    }
  }
  index = 0;
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++, index++) {
        if (exact[index] === 2) field[index] = sample(x, y, z, true);
      }
    }
  }
  cubes.normal_cache.fill(0);
}

// `margin` widens bounds by the farthest any shader projection moves a vertex.
function finishGeometry(surface, phase, bound, margin = 0) {
  const geometry = surface.geometry, positions = surface.positionArray, normals = surface.normalArray;
  // map(p) evaluates R(phase)*p, hence bake its inverse into the extracted
  // zero set. The phase rotation is computed once, never once per SDF sample.
  const c = Math.cos(phase), s = -Math.sin(phase), v = 1 - c;
  const xx = AX * AX * v + c, xy = AX * AY * v - AZ * s, xz = AX * AZ * v + AY * s;
  const yx = AY * AX * v + AZ * s, yy = AY * AY * v + c, yz = AY * AZ * v - AX * s;
  const zx = AZ * AX * v - AY * s, zy = AZ * AY * v + AX * s, zz = AZ * AZ * v + c;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity, radius2 = 0;
  for (let i = 0; i < surface.count * 3; i += 3) {
    const x = positions[i] * bound, y = positions[i + 1] * bound, z = positions[i + 2] * bound;
    positions[i] = xx * x + xy * y + xz * z;
    positions[i + 1] = yx * x + yy * y + yz * z;
    positions[i + 2] = zx * x + zy * y + zz * z;
    if (normals) {
      const nx = normals[i], ny = normals[i + 1], nz = normals[i + 2];
      const length = Math.hypot(nx, ny, nz);
      if (!Number.isFinite(length) || length === 0) throw new Error('Liquid ribbons produced an invalid surface normal.');
      normals[i] = (xx * nx + xy * ny + xz * nz) / length;
      normals[i + 1] = (yx * nx + yy * ny + yz * nz) / length;
      normals[i + 2] = (zx * nx + zy * ny + zz * nz) / length;
    }
    const px = positions[i], py = positions[i + 1], pz = positions[i + 2];
    minX = Math.min(minX, px); minY = Math.min(minY, py); minZ = Math.min(minZ, pz);
    maxX = Math.max(maxX, px); maxY = Math.max(maxY, py); maxZ = Math.max(maxZ, pz);
    radius2 = Math.max(radius2, px * px + py * py + pz * pz);
  }
  if (surface.count === 0) {
    geometry.boundingBox.min.set(0, 0, 0);
    geometry.boundingBox.max.set(0, 0, 0);
  } else {
    geometry.boundingBox.min.set(minX - margin, minY - margin, minZ - margin);
    geometry.boundingBox.max.set(maxX + margin, maxY + margin, maxZ + margin);
  }
  geometry.boundingSphere.center.set(0, 0, 0);
  geometry.boundingSphere.radius = (Math.sqrt(radius2) + margin) * (1 + Number.EPSILON);
  if (!Number.isFinite(radius2)) throw new Error('Liquid ribbons produced nonfinite bounds.');
}

// The GPU projects each welded sample in float32; rounding of the rotation and
// of the trust test stays far below this fraction of `bound`.
const TRUST_SLACK = 1e-5;

// Welded samples are drawn once through an index, so each frame uploads only the
// active vertex and index ranges instead of twelve copies per coarse triangle.
function createRefinement(capacity) {
  const geometry = new THREE.BufferGeometry();
  // At most six distinct samples per coarse triangle, before edge welding.
  const positionArray = new Float32Array(capacity * 6 * 3);
  geometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(capacity * 12), 1).setUsage(THREE.DynamicDrawUsage));
  geometry.boundingBox = new THREE.Box3();
  geometry.boundingSphere = new THREE.Sphere();
  let hashSize = 1;
  while (hashSize < capacity * 12) hashSize *= 2;
  const scratch = new Float32Array(3);
  return {
    geometry, positionArray, capacity, count: 0, corners: new Uint32Array(6),
    hash: new Uint32Array(hashSize), scratch, bits: new Uint32Array(scratch.buffer)
  };
}

// Until finishGeometry rotates them, the active positions are the hash keys.
function refineSurface(entry, refined, phase, bound) {
  const { positionArray: keys, corners, hash, scratch, bits } = refined;
  const mask = hash.length - 1, source = entry.cubes.positionArray;
  hash.fill(0);
  let sampleCount = 0;
  function sample(x, y, z) {
    scratch[0] = x === 0 ? 0 : x; scratch[1] = y === 0 ? 0 : y; scratch[2] = z === 0 ? 0 : z;
    let slot = (Math.imul(bits[0], 73856093) ^ Math.imul(bits[1], 19349663) ^ Math.imul(bits[2], 83492791)) & mask;
    let id;
    while ((id = hash[slot]) !== 0) {
      const k = (id - 1) * 3;
      if (keys[k] === scratch[0] && keys[k + 1] === scratch[1] && keys[k + 2] === scratch[2]) return id - 1;
      slot = (slot + 1) & mask;
    }
    id = sampleCount++;
    const k = id * 3;
    keys[k] = scratch[0]; keys[k + 1] = scratch[1]; keys[k + 2] = scratch[2];
    hash[slot] = id + 1;
    return id;
  }
  // Shared endpoints and midpoints are one vertex, hence one projected value
  // and one normal: neighboring triangles cannot open cracks.
  const index = refined.geometry.index, indices = index.array;
  let count = 0;
  for (let i = 0; i < entry.cubes.count * 3; i += 9) {
    corners[0] = sample(source[i], source[i + 1], source[i + 2]);
    corners[1] = sample(source[i + 3], source[i + 4], source[i + 5]);
    corners[2] = sample(source[i + 6], source[i + 7], source[i + 8]);
    corners[3] = sample((source[i] + source[i + 3]) * .5, (source[i + 1] + source[i + 4]) * .5, (source[i + 2] + source[i + 5]) * .5);
    corners[4] = sample((source[i + 3] + source[i + 6]) * .5, (source[i + 4] + source[i + 7]) * .5, (source[i + 5] + source[i + 8]) * .5);
    corners[5] = sample((source[i + 6] + source[i]) * .5, (source[i + 7] + source[i + 1]) * .5, (source[i + 8] + source[i + 2]) * .5);
    for (let j = 0; j < 12; j++) indices[count++] = corners[REFINEMENT_ORDER[j]];
  }
  refined.count = sampleCount;
  refined.geometry.setDrawRange(0, count);
  for (const [attribute, length] of [[refined.geometry.attributes.position, sampleCount * 3], [index, count]]) {
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, length);
    attribute.needsUpdate = true;
  }
  const cell = 2 * bound / entry.cubes.size;
  finishGeometry(refined, phase, bound, cell * .35 + bound * TRUST_SLACK);
}

function createSurface(refine = false) {
  const style = {}, shader = refine ? createLiquidSurface() : null;
  let entry, refined, dirty = true, lastPhase = NaN, disposed = false;
  function setStyle(input = DEFAULT_MODEL_STYLE) {
    if (disposed) return;
    for (const key of SHAPE_KEYS) {
      const value = input[key] ?? DEFAULT_MODEL_STYLE[key];
      if (style[key] !== value) dirty = true;
      style[key] = value;
    }
  }
  setStyle();
  // Uniforms change only together with the samples they project, in update().
  return {
    setStyle,
    get geometry() { return refine ? refined?.geometry : entry?.cubes.geometry; },
    get radius() { return radiusOf(style); },
    get surfaceNormals() { return shader?.normals; },
    get surfaceDisplacement() { return shader?.displacement; },
    update(elapsed) {
      if (disposed) return;
      const phase = phaseAt(style, elapsed);
      if (!dirty && phase === lastPhase) return;
      if (!entry || entry.cubes.size !== style.liquidDetail) {
        entry?.cubes.geometry.dispose();
        refined?.geometry.dispose();
        refined = undefined;
        entry = createField(style.liquidDetail);
      }
      // MC skips the outermost cells and needs neighbors for central differences.
      // Keep the entire conservative sphere at least two cells from either edge.
      const bound = radiusOf(style) / (1 - 4 / style.liquidDetail);
      fillField(entry, style, phase, bound);
      // Three only warns after writing beyond its output arrays. Count the
      // exact cases first, then grow geometrically without resampling the SDF.
      const triangles = triangleCount(entry.cubes);
      if (triangles > entry.capacity) {
        let capacity = entry.capacity;
        while (capacity < triangles) capacity *= 2;
        const replacement = createField(style.liquidDetail, capacity);
        replacement.cubes.field = entry.cubes.field;
        replacement.cubes.normal_cache = entry.cubes.normal_cache;
        replacement.cubes.palette = entry.cubes.palette;
        entry.cubes.geometry.dispose();
        entry = replacement;
      }
      entry.cubes.update();
      if (entry.cubes.count !== triangles * 3 || entry.cubes.count > entry.cubes.positionArray.length / 3) {
        throw new RangeError('Liquid ribbons marching-cubes output overflow.');
      }
      if (refine) {
        if (!refined || triangles > refined.capacity) {
          refined?.geometry.dispose();
          refined = createRefinement(entry.capacity);
        }
        refineSurface(entry, refined, phase, bound);
        syncLiquidSurface(shader, style, phase, 2 * bound / style.liquidDetail);
      } else {
        finishGeometry(entry.cubes, phase, bound);
      }
      lastPhase = phase;
      dirty = false;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      entry?.cubes.geometry.dispose();
      refined?.geometry.dispose();
    }
  };
}

// Compact owned output for the published GLB, without the inactive buffer tail.
export function createLiquidGeometry(style = DEFAULT_MODEL_STYLE, elapsed = 0) {
  const surface = createSurface();
  try {
    surface.setStyle(style);
    surface.update(elapsed);
    const source = surface.geometry, count = source.drawRange.count;
    const geometry = new THREE.BufferGeometry();
    for (const name of ['position', 'normal']) {
      geometry.setAttribute(name, new THREE.BufferAttribute(source.attributes[name].array.slice(0, count * 3), 3));
    }
    geometry.setDrawRange(0, count);
    geometry.boundingBox = source.boundingBox.clone();
    geometry.boundingSphere = source.boundingSphere.clone();
    return geometry;
  } finally {
    surface.dispose();
  }
}

export function createLiquidRibbons(model) {
  const surface = createSurface(true), bindings = [];
  let disposed = false;
  model.traverse(mesh => {
    if (mesh.isMesh) bindings.push({ mesh, source: mesh.geometry, owned: null });
  });
  return {
    setStyle: surface.setStyle,
    get radius() { return surface.radius; },
    get surfaceNormals() { return surface.surfaceNormals; },
    get surfaceDisplacement() { return surface.surfaceDisplacement; },
    update(elapsed) {
      if (disposed) return;
      surface.update(elapsed);
      for (const binding of bindings) {
        binding.owned = surface.geometry;
        binding.mesh.geometry = surface.geometry;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const { mesh, source, owned } of bindings) if (mesh.geometry === owned) mesh.geometry = source;
      surface.dispose();
    }
  };
}
