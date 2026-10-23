import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { ParametricGeometry } from 'three/addons/geometries/ParametricGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODEL_SHAPES } from '../src/model-shapes.js';
import { blankProject, fileLayer, validateProject } from '../src/project.js';

// Shapes are generated deterministically, so the generator reproduces every published
// file; never change a published shape in place (see src/model-shapes.js).

// Smooth normals everywhere: seam and pole duplicates are merged before normals are computed.
function smooth(geometry) {
  for (const name of Object.keys(geometry.attributes)) if (name !== 'position') geometry.deleteAttribute(name);
  const merged = mergeVertices(geometry, 1e-6);
  geometry.dispose();
  merged.computeVertexNormals();
  return merged;
}
const surface = (fn, slices, stacks) => smooth(new ParametricGeometry((u, v, target) => target.set(...fn(u, v)), slices, stacks));

// `profile` (a closed loop of [normal, binormal] points with `symmetry`-fold rotational symmetry)
// is swept once around the closed `curve` with rotation-minimizing frames, turning by `turns`
// symmetry steps, so the tube closes onto itself with a shifted profile, as in a Möbius band.
function sweep(curve, profile, { segments, symmetry, turns }) {
  const count = profile.length, positions = [], indices = [];
  const points = Array.from({ length: segments }, (_, i) => curve(i / segments));
  const tangents = points.map((_, i) => points[(i + 1) % segments].clone().sub(points[(i + segments - 1) % segments]).normalize());
  // Start from the curvature direction, so a ring's profile lies flat in its plane.
  const bend = points[1].clone().add(points[segments - 1]).sub(points[0].clone().multiplyScalar(2));
  const normals = [bend.sub(tangents[0].clone().multiplyScalar(bend.dot(tangents[0]))).normalize()];
  for (let i = 1; i <= segments; i++) {
    const tangent = tangents[i % segments];
    normals[i] = normals[i - 1].clone().sub(tangent.clone().multiplyScalar(normals[i - 1].dot(tangent))).normalize();
  }
  // Transport around a non-planar loop leaves a holonomy angle; spread its correction evenly.
  const holonomy = Math.atan2(normals[0].clone().cross(normals[segments]).dot(tangents[0]), normals[0].dot(normals[segments]));
  const twist = 2 * Math.PI * turns / symmetry, shift = count * turns / symmetry;
  for (let i = 0; i < segments; i++) {
    const normal = normals[i].clone().applyAxisAngle(tangents[i], -holonomy * i / segments), binormal = normal.clone().cross(tangents[i]);
    const angle = twist * i / segments, cos = Math.cos(angle), sin = Math.sin(angle);
    for (const [a, b] of profile) {
      const n = a * cos - b * sin, m = a * sin + b * cos;
      positions.push(points[i].x + n * normal.x + m * binormal.x, points[i].y + n * normal.y + m * binormal.y, points[i].z + n * normal.z + m * binormal.z);
    }
  }
  for (let i = 0; i < segments; i++) {
    const last = i === segments - 1, next = last ? 0 : i + 1, offset = last ? shift : 0;
    for (let j = 0; j < count; j++) {
      const a = i * count + j, b = i * count + (j + 1) % count, c = next * count + (j + offset) % count, d = next * count + (j + 1 + offset) % count;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
const circle = radius => t => new THREE.Vector3(radius * Math.cos(2 * Math.PI * t), radius * Math.sin(2 * Math.PI * t), 0);

// A closed loop with `symmetry`-fold rotational symmetry: one sector is built and rotated.
function symmetricProfile(sector, symmetry) {
  return Array.from({ length: symmetry }, (_, k) => {
    const angle = 2 * Math.PI * k / symmetry, cos = Math.cos(angle), sin = Math.sin(angle);
    return sector.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]);
  }).flat();
}
// `steps` points from `from` up to `to`; `closed` also includes `to`.
const arc = (cx, cy, r, from, to, steps, closed = false) => Array.from({ length: steps + (closed ? 1 : 0) }, (_, i) => { const a = from + (to - from) * i / steps; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
// Half of a rounded rectangle, completed by a half-turn.
function bandProfile(width, height, corner, steps) {
  const [w, h] = [width / 2 - corner, height / 2 - corner];
  return symmetricProfile([...arc(w, -h, corner, -Math.PI / 2, 0, steps, true), ...arc(w, h, corner, 0, Math.PI / 2, steps, true)], 2);
}
// One rounded corner and side of an equilateral triangle, completed by thirds.
function triangleProfile(size, corner, steps) {
  const inner = size - corner * 2, edge = [Math.cos(Math.PI / 3) * corner, Math.sin(Math.PI / 3) * corner];
  const from = [inner + edge[0], edge[1]], to = [inner * Math.cos(2 * Math.PI / 3) + edge[0], inner * Math.sin(2 * Math.PI / 3) + edge[1]];
  return symmetricProfile([...arc(inner, 0, corner, -Math.PI / 3, Math.PI / 3, steps), ...Array.from({ length: steps }, (_, i) => [from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps])], 3);
}

// A gyroid lattice shell carved into a sphere: the zero set of a signed field, meshed with
// marching cubes and smoothed through shared vertices.
function gyroidSphere() {
  const resolution = 96, period = 4.6 * Math.PI, wall = 0.42;
  const cubes = new MarchingCubes(resolution, new THREE.MeshBasicMaterial(), false, false, 600000);
  cubes.isolation = 0;
  for (let z = 0; z < resolution; z++) for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
    const [px, py, pz] = [x, y, z].map(value => value / (resolution - 1) * 2 - 1);
    const [gx, gy, gz] = [px, py, pz].map(value => value * period / 2);
    const gyroid = Math.sin(gx) * Math.cos(gy) + Math.sin(gy) * Math.cos(gz) + Math.sin(gz) * Math.cos(gx);
    const ball = 0.86 - Math.hypot(px, py, pz);
    cubes.field[x + y * resolution + z * resolution * resolution] = Math.min(wall - Math.abs(gyroid), ball * 6);
  }
  cubes.update();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(cubes.positionArray.slice(0, cubes.count * 3), 3));
  cubes.geometry.dispose(); cubes.material.dispose();
  return smooth(geometry);
}

// Gielis superformula: a five-lobed outline swept with a round cross-section, like an inflated star.
function superformula(angle, m, n1, n2, n3) {
  return Math.pow(Math.pow(Math.abs(Math.cos(m * angle / 4)), n2) + Math.pow(Math.abs(Math.sin(m * angle / 4)), n3), -1 / n1);
}
function softStar(u, v) {
  const theta = (u * 2 - 1) * Math.PI, phi = (v - 0.5) * Math.PI, r = superformula(theta, 5, 0.8, 1.2, 1.2);
  return [r * Math.cos(theta) * Math.cos(phi), r * Math.sin(theta) * Math.cos(phi), Math.sin(phi)];
}

// A torus whose tube carries fine helical flutes.
function flutedTorus(u, v) {
  const around = u * 2 * Math.PI, tube = v * 2 * Math.PI, radius = 0.32 * (1 + 0.07 * Math.cos(18 * tube + 4 * around));
  return [(0.82 + radius * Math.cos(tube)) * Math.cos(around), (0.82 + radius * Math.cos(tube)) * Math.sin(around), radius * Math.sin(tube)];
}

// A sphere gathered into pleats that soften toward its poles.
function pleatedOrb(u, v) {
  const around = u * 2 * Math.PI, polar = v * Math.PI, radius = 1 + 0.11 * Math.cos(18 * around) * Math.sin(polar) ** 2;
  return [radius * Math.sin(polar) * Math.cos(around), radius * Math.cos(polar), radius * Math.sin(polar) * Math.sin(around)];
}

// A lemniscate lifted at its crossing so the ribbon passes over itself.
const lemniscate = t => { const a = 2 * Math.PI * t, d = 1 + Math.sin(a) ** 2; return new THREE.Vector3(1.25 * Math.cos(a) / d, 1.25 * Math.sin(a) * Math.cos(a) / d, 0.32 * Math.sin(a)); };

const GENERATORS = {
  // Recovered byte for byte from the workspace knot used to develop glass refraction.
  'torus-knot': () => new THREE.TorusKnotGeometry(0.72, 0.24, 160, 32),
  'cinquefoil-knot': () => new THREE.TorusKnotGeometry(0.72, 0.14, 400, 32, 2, 5),
  'gyroid-sphere': gyroidSphere,
  mobius: () => sweep(circle(0.8), bandProfile(0.62, 0.1, 0.04, 8), { segments: 320, symmetry: 2, turns: 1 }),
  'twisted-ring': () => sweep(circle(0.74), triangleProfile(0.42, 0.06, 10), { segments: 320, symmetry: 3, turns: 4 }),
  'infinity-ribbon': () => sweep(lemniscate, bandProfile(0.42, 0.06, 0.025, 8), { segments: 480, symmetry: 2, turns: 3 }),
  'soft-star': () => surface(softStar, 240, 96),
  'fluted-torus': () => surface(flutedTorus, 288, 96),
  'pleated-orb': () => surface(pleatedOrb, 288, 96)
};

// GLTFExporter reads its Blob through the browser FileReader contract.
globalThis.FileReader ??= class { readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }); } };

// The published GLB bytes of a shape.
export async function generateShape(id) {
  if (!GENERATORS[id]) throw new Error(`No generator for ${id}.`);
  const geometry = GENERATORS[id](), material = new THREE.MeshStandardMaterial({ metalness: 0, roughness: 1 });
  try { return Buffer.from(await new GLTFExporter().parseAsync(new THREE.Mesh(geometry, material), { binary: true })); }
  finally { geometry.dispose(); material.dispose(); }
}

// One frame showing the shape as a new layer gets it, turned slightly so depth reads.
export function shapePreviewFixture(shape) {
  const project = blankProject(shape.name);
  project.duration = 1; project.layers[0] = { ...project.layers[0], end: 1, color: '#161616' };
  project.layers.push({ ...fileLayer(shape, 1, 'shape'), x: 14, y: 14, size: 72, tilt: -16, yaw: 24 });
  return { id: shape.id, project: validateProject(project), times: [0] };
}
