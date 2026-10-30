import * as THREE from 'three';
import { MarchingCubes, triTable } from 'three/addons/objects/MarchingCubes.js';
import { DEFAULT_MODEL_STYLE } from './model-style.js';
import { createLiquidSurfaceNormals, syncLiquidSurfaceNormals } from './model-liquid-normals.js';

// Mesh adaptation of Sabo Sugi's Abstract Chrome Liquid:
// https://codepen.io/editor/sabosugi/pen/01a1777c-c5ba-7db4-978a-e60cd0100f42
// Positive field values are inside: MarchingCubes differentiates -field to
// produce outward normals. Its vertices, rather than a shader proxy, are used
// by rendering, bounds, exports and CPU raycasting.
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

function finishGeometry(cubes, phase, bound) {
  const geometry = cubes.geometry, positions = cubes.positionArray, normals = cubes.normalArray;
  // map(p) evaluates R(phase)*p, hence bake its inverse into the extracted
  // zero set. The phase rotation is computed once, never once per SDF sample.
  const c = Math.cos(phase), s = -Math.sin(phase), v = 1 - c;
  const xx = AX * AX * v + c, xy = AX * AY * v - AZ * s, xz = AX * AZ * v + AY * s;
  const yx = AY * AX * v + AZ * s, yy = AY * AY * v + c, yz = AY * AZ * v - AX * s;
  const zx = AZ * AX * v - AY * s, zy = AZ * AY * v + AX * s, zz = AZ * AZ * v + c;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity, radius2 = 0;
  for (let i = 0; i < cubes.count * 3; i += 3) {
    const x = positions[i] * bound, y = positions[i + 1] * bound, z = positions[i + 2] * bound;
    positions[i] = xx * x + xy * y + xz * z;
    positions[i + 1] = yx * x + yy * y + yz * z;
    positions[i + 2] = zx * x + zy * y + zz * z;
    const nx = normals[i], ny = normals[i + 1], nz = normals[i + 2];
    const length = Math.hypot(nx, ny, nz);
    if (!Number.isFinite(length) || length === 0) throw new Error('Liquid ribbons produced an invalid surface normal.');
    normals[i] = (xx * nx + xy * ny + xz * nz) / length;
    normals[i + 1] = (yx * nx + yy * ny + yz * nz) / length;
    normals[i + 2] = (zx * nx + zy * ny + zz * nz) / length;
    const px = positions[i], py = positions[i + 1], pz = positions[i + 2];
    minX = Math.min(minX, px); minY = Math.min(minY, py); minZ = Math.min(minZ, pz);
    maxX = Math.max(maxX, px); maxY = Math.max(maxY, py); maxZ = Math.max(maxZ, pz);
    radius2 = Math.max(radius2, px * px + py * py + pz * pz);
  }
  if (cubes.count === 0) {
    geometry.boundingBox.min.set(0, 0, 0);
    geometry.boundingBox.max.set(0, 0, 0);
  } else {
    geometry.boundingBox.min.set(minX, minY, minZ);
    geometry.boundingBox.max.set(maxX, maxY, maxZ);
  }
  geometry.boundingSphere.center.set(0, 0, 0);
  geometry.boundingSphere.radius = Math.sqrt(radius2) * (1 + Number.EPSILON);
  if (!Number.isFinite(radius2)) throw new Error('Liquid ribbons produced nonfinite bounds.');
}

// Distance and exact outward derivative in the unrotated field domain. Reverse
// differentiation carries the rounded cut through direction normalization and
// all three domain warps; no grid-normal interpolation is used at runtime.
function createEvaluator(style, phase) {
  const w1 = style.liquidWarp, w2 = w1 * .85, w3 = w1 * .15;
  const f1 = style.liquidFrequency, f2 = f1 * 2.2, f3 = f1 * 4.5;
  const opening = style.liquidOpen + (style.liquidClosed - style.liquidOpen) * (.5 - .5 * Math.cos(phase));
  const radiusA = style.liquidRadius, radiusB = style.liquidInnerRadius;
  const cutRadiusA = radiusA * .6, cutRadiusB = radiusB * .6;
  const thickness = style.liquidThickness, phase2 = 2 * phase, phase3 = 3 * phase;
  return (x, y, z, out) => {
    let ax = y * f1 + phase, ay = z * f1 + 2.1 + phase, az = x * f1 + 4.2 + phase;
    const dx1 = w1 * f1 * Math.cos(ax), dy1 = w1 * f1 * Math.cos(ay), dz1 = w1 * f1 * Math.cos(az);
    let nx = x + w1 * Math.sin(ax), ny = y + w1 * Math.sin(ay), nz = z + w1 * Math.sin(az);
    let qx = -.8 * ny - .6 * nz, qy = .8 * nx + .36 * ny - .48 * nz, qz = .6 * nx - .48 * ny + .64 * nz;
    ax = qy * f2 + 1.3 - phase2; ay = qz * f2 + 3.7 - phase2; az = qx * f2 + 5.1 - phase2;
    const dx2 = w2 * f2 * Math.cos(ax), dy2 = w2 * f2 * Math.cos(ay), dz2 = w2 * f2 * Math.cos(az);
    nx = qx + w2 * Math.sin(ax); ny = qy + w2 * Math.sin(ay); nz = qz + w2 * Math.sin(az);
    qx = -.8 * ny - .6 * nz; qy = .8 * nx + .36 * ny - .48 * nz; qz = .6 * nx - .48 * ny + .64 * nz;
    ax = qy * f3 + 4 + phase3; ay = qz * f3 + .7 + phase3; az = qx * f3 + 2.9 + phase3;
    const dx3 = w3 * f3 * Math.cos(ax), dy3 = w3 * f3 * Math.cos(ay), dz3 = w3 * f3 * Math.cos(az);
    x = qx + w3 * Math.sin(ax); y = qy + w3 * Math.sin(ay); z = qz + w3 * Math.sin(az);
    const r = Math.sqrt(x * x + y * y + z * z), divisor = Math.max(r, .001);
    nx = x / divisor; ny = y / divisor; nz = z / divisor;
    const a3 = 3 * nx + phase, a2 = 2 * nz - phase, a5 = 5 * nz + phase2, a9 = 9 * nx - phase3;
    const b3 = 3 * ny - phase, b2 = 2 * nx + phase, b5 = 5 * ny - phase2, b9 = 9 * nz + phase3;
    const sa3 = Math.sin(a3), ca2 = Math.cos(a2), sb3 = Math.sin(b3), cb2 = Math.cos(b2);
    const a = ny + .30 * sa3 * ca2 + .12 * Math.sin(a5) + .05 * Math.sin(a9);
    const b = .8 * nx + .6 * nz + .30 * sb3 * cb2 + .12 * Math.sin(b5) + .05 * Math.sin(b9);
    const cutA = Math.max(0, (Math.abs(a) - opening) * cutRadiusA);
    const cutB = Math.max(0, (Math.abs(b) - opening * .9) * cutRadiusB);
    const drA = r - radiusA, drB = r - radiusB;
    const branch = drA * drA + cutA * cutA <= drB * drB + cutB * cutB ? 0 : 1;
    const dr = branch === 0 ? drA : drB, cut = branch === 0 ? cutA : cutB;
    const distance = Math.sqrt(dr * dr + cut * cut);
    let gx = 0, gy = 0, gz = 0;
    if (cut > 0) {
      const factor = cut * (branch === 0 ? cutRadiusA * Math.sign(a) : cutRadiusB * Math.sign(b));
      if (branch === 0) {
        gx = factor * (.9 * Math.cos(a3) * ca2 + .45 * Math.cos(a9));
        gy = factor;
        gz = factor * (-.6 * sa3 * Math.sin(a2) + .6 * Math.cos(a5));
      } else {
        gx = factor * (.8 - .6 * sb3 * Math.sin(b2));
        gy = factor * (.9 * Math.cos(b3) * cb2 + .6 * Math.cos(b5));
        gz = factor * (.6 + .45 * Math.cos(b9));
      }
    }
    // J(normalize(q))^T g; the clamped central divisor is constant below .001.
    const radial = r >= .001 ? (gx * nx + gy * ny + gz * nz) / divisor : 0;
    const radialDistance = r > 0 ? dr / r : 0;
    gx = gx / divisor + x * radialDistance - nx * radial;
    gy = gy / divisor + y * radialDistance - ny * radial;
    gz = gz / divisor + z * radialDistance - nz * radial;
    if (distance > 0) { gx /= distance; gy /= distance; gz /= distance; }
    // Each warp is q + amplitude*sin(q.yzx*frequency+offset).
    qx = gx + dz3 * gz; qy = gy + dx3 * gx; qz = gz + dy3 * gy;
    gx = .8 * qy + .6 * qz; gy = -.8 * qx + .36 * qy - .48 * qz; gz = -.6 * qx - .48 * qy + .64 * qz;
    qx = gx + dz2 * gz; qy = gy + dx2 * gx; qz = gz + dy2 * gy;
    gx = .8 * qy + .6 * qz; gy = -.8 * qx + .36 * qy - .48 * qz; gz = -.6 * qx - .48 * qy + .64 * qz;
    out[0] = distance - thickness;
    out[1] = gx + dz1 * gz; out[2] = gy + dx1 * gx; out[3] = gz + dy1 * gy;
    out[4] = branch;
  };
}

function createRefinement(capacity) {
  const geometry = new THREE.BufferGeometry();
  const positionArray = new Float32Array(capacity * 12 * 3), normalArray = new Float32Array(positionArray.length);
  geometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normalArray, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.boundingBox = new THREE.Box3();
  geometry.boundingSphere = new THREE.Sphere();
  let hashSize = 1;
  while (hashSize < capacity * 12) hashSize *= 2;
  const scratch = new Float32Array(3);
  return {
    geometry, positionArray, normalArray, capacity, count: 0,
    // At most six distinct samples per coarse triangle, before edge welding.
    keys: new Float32Array(capacity * 6 * 3),
    samples: new Float32Array(capacity * 6 * 6),
    triangles: new Uint32Array(capacity * 6),
    hash: new Uint32Array(hashSize), scratch, bits: new Uint32Array(scratch.buffer), value: new Float64Array(5)
  };
}

function refineSurface(entry, refined, style, phase, bound) {
  const { keys, samples, triangles, hash, scratch, bits, value } = refined;
  const mask = hash.length - 1;
  const evaluate = createEvaluator(style, phase), source = entry.cubes.positionArray;
  const cell = 2 * bound / entry.cubes.size, trust = cell * .35, maxStep = cell * .2;
  const tolerance = Math.max(1e-8, style.liquidThickness * 1e-5);
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
    const k = id * 3, target = id * 6;
    keys[k] = scratch[0]; keys[k + 1] = scratch[1]; keys[k + 2] = scratch[2];
    hash[slot] = id + 1;
    const ox = scratch[0] * bound, oy = scratch[1] * bound, oz = scratch[2] * bound;
    x = ox; y = oy; z = oz;
    evaluate(x, y, z, value);
    const branch = value[4], initialX = value[1], initialY = value[2], initialZ = value[3];
    // Bounded, monotone Newton steps stay in this local sheet's basin. Reject a
    // branch switch or an opposing derivative rather than jumping across folds.
    for (let iteration = 0; iteration < 3 && Math.abs(value[0]) > tolerance; iteration++) {
      const distance = value[0], gx = value[1], gy = value[2], gz = value[3];
      const length2 = gx * gx + gy * gy + gz * gz;
      if (length2 < 1e-20) break;
      let step = distance / length2;
      step *= Math.min(1, maxStep / (Math.abs(step) * Math.sqrt(length2)));
      let accepted = false;
      for (let attempt = 0; attempt < 3; attempt++, step *= .5) {
        const px = x - step * gx, py = y - step * gy, pz = z - step * gz;
        if ((px - ox) ** 2 + (py - oy) ** 2 + (pz - oz) ** 2 > trust * trust) continue;
        evaluate(px, py, pz, value);
        if (value[4] === branch && Math.abs(value[0]) < Math.abs(distance)
          && value[1] * initialX + value[2] * initialY + value[3] * initialZ > 0) {
          x = px; y = py; z = pz; accepted = true;
          break;
        }
      }
      if (!accepted) { evaluate(x, y, z, value); break; }
    }
    const length = Math.hypot(value[1], value[2], value[3]);
    if (!Number.isFinite(length) || length === 0) throw new Error('Liquid ribbons produced an invalid analytic normal.');
    samples[target] = x; samples[target + 1] = y; samples[target + 2] = z;
    samples[target + 3] = value[1] / length; samples[target + 4] = value[2] / length; samples[target + 5] = value[3] / length;
    return id;
  }
  // Shared endpoints and midpoints have one projected value and one normal.
  // Welding precedes projection, so neighboring triangles cannot open cracks.
  let count = 0;
  for (let i = 0; i < entry.cubes.count * 3; i += 9) {
    triangles[count++] = sample(source[i], source[i + 1], source[i + 2]);
    triangles[count++] = sample(source[i + 3], source[i + 4], source[i + 5]);
    triangles[count++] = sample(source[i + 6], source[i + 7], source[i + 8]);
    triangles[count++] = sample((source[i] + source[i + 3]) * .5, (source[i + 1] + source[i + 4]) * .5, (source[i + 2] + source[i + 5]) * .5);
    triangles[count++] = sample((source[i + 3] + source[i + 6]) * .5, (source[i + 4] + source[i + 7]) * .5, (source[i + 5] + source[i + 8]) * .5);
    triangles[count++] = sample((source[i + 6] + source[i]) * .5, (source[i + 7] + source[i + 1]) * .5, (source[i + 8] + source[i + 2]) * .5);
  }
  let output = 0;
  for (let i = 0; i < count; i += 6) {
    for (let j = 0; j < 12; j++) {
      const sampleOffset = triangles[i + REFINEMENT_ORDER[j]] * 6;
      for (let axis = 0; axis < 3; axis++, output++) {
        refined.positionArray[output] = samples[sampleOffset + axis];
        refined.normalArray[output] = samples[sampleOffset + axis + 3];
      }
    }
  }
  refined.count = output / 3;
  refined.geometry.setDrawRange(0, refined.count);
  refined.geometry.attributes.position.needsUpdate = true;
  refined.geometry.attributes.normal.needsUpdate = true;
  finishGeometry(refined, phase, 1);
}

function createSurface(refine = false) {
  const style = {};
  let entry, refined, normalDescriptor, dirty = true, lastPhase = NaN, lastElapsed = 0, disposed = false;
  function setStyle(input = DEFAULT_MODEL_STYLE) {
    if (disposed) return;
    for (const key of SHAPE_KEYS) {
      const value = input[key] ?? DEFAULT_MODEL_STYLE[key];
      if (style[key] !== value) dirty = true;
      style[key] = value;
    }
    if (normalDescriptor) syncLiquidSurfaceNormals(normalDescriptor, style, phaseAt(style, lastElapsed));
  }
  setStyle();
  return {
    setStyle,
    get geometry() { return refine ? refined?.geometry : entry?.cubes.geometry; },
    get radius() { return radiusOf(style); },
    get surfaceNormals() {
      if (!normalDescriptor) {
        normalDescriptor = createLiquidSurfaceNormals();
        syncLiquidSurfaceNormals(normalDescriptor, style, phaseAt(style, lastElapsed));
      }
      return normalDescriptor;
    },
    update(elapsed) {
      if (disposed) return;
      const phase = phaseAt(style, elapsed);
      lastElapsed = elapsed;
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
        refineSurface(entry, refined, style, phase, bound);
      } else {
        finishGeometry(entry.cubes, phase, bound);
      }
      lastPhase = phase;
      if (normalDescriptor) syncLiquidSurfaceNormals(normalDescriptor, style, phase);
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
