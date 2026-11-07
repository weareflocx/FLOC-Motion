import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { createLiquidGeometry, createLiquidRibbons } from '../src/model-liquid.js';
import { DEFAULT_MODEL_STYLE } from '../src/model-style.js';

const settings = overrides => ({ ...DEFAULT_MODEL_STYLE, liquidDetail: 32, ...overrides });
function fixture(t, overrides = {}, source = new THREE.BoxGeometry()) {
  const material = new THREE.MeshStandardMaterial();
  const mesh = new THREE.Mesh(source, material), controller = createLiquidRibbons(mesh);
  controller.setStyle(settings(overrides));
  t.after(() => { controller.dispose(); source.dispose(); material.dispose(); });
  return { mesh, controller, source, material };
}
// Draw-order vertices of the active range: refined output is indexed, published
// coarse output is not; both read as consecutive triangle corners here.
function drawn(geometry) {
  if (!geometry.index) return geometry;
  const count = geometry.drawRange.count, index = geometry.index.array, result = new THREE.BufferGeometry();
  for (const name of ['position', 'normal']) {
    const source = geometry.attributes[name].array, array = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) array.set(source.subarray(index[i] * 3, index[i] * 3 + 3), i * 3);
    result.setAttribute(name, new THREE.BufferAttribute(array, 3));
  }
  result.setDrawRange(0, count);
  result.boundingBox = geometry.boundingBox; result.boundingSphere = geometry.boundingSphere;
  return result;
}
function snapshot(geometry) {
  const { attributes, drawRange } = drawn(geometry), end = drawRange.count * 3;
  return {
    position: attributes.position.array.slice(0, end),
    normal: attributes.normal.array.slice(0, end)
  };
}
const versions = geometry => ['position', 'normal'].map(key => geometry.attributes[key].version);
function assertSurface(source, radius) {
  const geometry = drawn(source);
  assert.ok(Number.isFinite(geometry.boundingSphere.radius));
  const point = new THREE.Vector3(), normal = new THREE.Vector3();
  const activeBounds = new THREE.Box3();
  for (let i = 0; i < geometry.drawRange.count; i++) {
    point.fromBufferAttribute(geometry.attributes.position, i);
    normal.fromBufferAttribute(geometry.attributes.normal, i);
    activeBounds.expandByPoint(point);
    assert.ok(Number.isFinite(point.length()) && Number.isFinite(normal.length()), `finite vertex ${i}`);
    assert.ok(Math.abs(normal.length() - 1) < 2e-6, `unit normal ${i}`);
    assert.ok(geometry.boundingBox.containsPoint(point), `active bounds contain vertex ${i}`);
    assert.ok(geometry.boundingSphere.containsPoint(point), `sphere contains vertex ${i}`);
    assert.ok(point.length() <= radius + 2e-6, `conservative envelope contains vertex ${i}`);
  }
  if (geometry.drawRange.count > 0) assert.ok(geometry.boundingBox.equals(activeBounds), 'bounds exclude inactive buffer capacity and stale vertices');
}

// Independent zero-warp oracle: both octaves still rotate q even at warp=0.
const octave = new THREE.Matrix3().set(0, -.8, -.6, .8, .36, -.48, .6, -.48, .64);
function unwarpedDistance(point, style) {
  const q = point.clone().applyMatrix3(octave).applyMatrix3(octave);
  const r = q.length();
  q.divideScalar(Math.max(r, .001));
  const waveA = .30 * Math.sin(3 * q.x) * Math.cos(2 * q.z) + .12 * Math.sin(5 * q.z) + .05 * Math.sin(9 * q.x);
  const waveB = .30 * Math.sin(3 * q.y) * Math.cos(2 * q.x) + .12 * Math.sin(5 * q.y) + .05 * Math.sin(9 * q.z);
  const cutA = Math.max(0, (Math.abs(q.y + waveA) - style.liquidOpen) * style.liquidRadius * .6);
  const cutB = Math.max(0, (Math.abs(.8 * q.x + .6 * q.z + waveB) - style.liquidOpen * .9) * style.liquidInnerRadius * .6);
  return Math.min(Math.hypot(r - style.liquidRadius, cutA), Math.hypot(r - style.liquidInnerRadius, cutB)) - style.liquidThickness;
}

// Independent scalar oracle in world coordinates, including the forward phase
// rotation. Numerical derivatives of this value test the entire warp chain.
function distanceAt(point, style, elapsed = 0) {
  const cycles = elapsed * style.liquidSpeed / style.liquidDuration;
  const u = ((cycles % 1) + 1) % 1, phase = 2 * Math.PI * (u - style.liquidEase * Math.sin(2 * Math.PI * u));
  const q = point.clone().applyAxisAngle(new THREE.Vector3(.35, 1, .45).normalize(), phase);
  const delta = new THREE.Vector3();
  const opening = style.liquidOpen + (style.liquidClosed - style.liquidOpen) * (.5 - .5 * Math.cos(phase));
  delta.set(Math.sin(q.y * style.liquidFrequency + phase), Math.sin(q.z * style.liquidFrequency + 2.1 + phase), Math.sin(q.x * style.liquidFrequency + 4.2 + phase));
  q.addScaledVector(delta, style.liquidWarp).applyMatrix3(octave);
  delta.set(Math.sin(q.y * style.liquidFrequency * 2.2 + 1.3 - 2 * phase), Math.sin(q.z * style.liquidFrequency * 2.2 + 3.7 - 2 * phase), Math.sin(q.x * style.liquidFrequency * 2.2 + 5.1 - 2 * phase));
  q.addScaledVector(delta, style.liquidWarp * .85).applyMatrix3(octave);
  delta.set(Math.sin(q.y * style.liquidFrequency * 4.5 + 4 + 3 * phase), Math.sin(q.z * style.liquidFrequency * 4.5 + .7 + 3 * phase), Math.sin(q.x * style.liquidFrequency * 4.5 + 2.9 + 3 * phase));
  q.addScaledVector(delta, style.liquidWarp * .15);
  const r = q.length();
  q.divideScalar(Math.max(r, .001));
  const waveA = .30 * Math.sin(3 * q.x + phase) * Math.cos(2 * q.z - phase) + .12 * Math.sin(5 * q.z + 2 * phase) + .05 * Math.sin(9 * q.x - 3 * phase);
  const waveB = .30 * Math.sin(3 * q.y - phase) * Math.cos(2 * q.x + phase) + .12 * Math.sin(5 * q.y - 2 * phase) + .05 * Math.sin(9 * q.z + 3 * phase);
  const a = Math.max(0, (Math.abs(q.y + waveA) - opening) * style.liquidRadius * .6);
  const b = Math.max(0, (Math.abs(.8 * q.x + .6 * q.z + waveB) - opening * .9) * style.liquidInnerRadius * .6);
  return Math.min(Math.hypot(r - style.liquidRadius, a), Math.hypot(r - style.liquidInnerRadius, b)) - style.liquidThickness;
}

test('published coarse geometry preserves dense reference interpolation and grid normals', t => {
  const point = new THREE.Vector3(), q = new THREE.Vector3(), delta = new THREE.Vector3(), normal = new THREE.Vector3();
  const rotation = new THREE.Quaternion(), axis = new THREE.Vector3(.35, 1, .45).normalize();
  const probes = [
    [settings(), 0],
    [settings(), 1.25],
    [settings({ liquidWarp: 1.2, liquidFrequency: 4, liquidThickness: .04 }), 2]
  ];
  for (const [style, elapsed] of probes) {
    const geometry = createLiquidGeometry(style, elapsed);
    t.after(() => geometry.dispose());
    const n = style.liquidDetail, cycles = elapsed * style.liquidSpeed / style.liquidDuration;
    const u = ((cycles % 1) + 1) % 1, phase = 2 * Math.PI * (u - style.liquidEase * Math.sin(2 * Math.PI * u));
    const opening = style.liquidOpen + (style.liquidClosed - style.liquidOpen) * (.5 - .5 * Math.cos(phase));
    const radius = Math.max(style.liquidRadius, style.liquidInnerRadius) + style.liquidThickness + Math.sqrt(3) * style.liquidWarp * 2;
    const bound = radius / (1 - 4 / n);
    const dense = new MarchingCubes(n, { flatShading: false }, false, false, 5 * (n - 3) ** 3);
    dense.isolation = 0;
    t.after(() => dense.geometry.dispose());
    let index = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++, index++) {
      q.set((2 * x / n - 1) * bound, (2 * y / n - 1) * bound, (2 * z / n - 1) * bound);
      delta.set(Math.sin(q.y * style.liquidFrequency + phase), Math.sin(q.z * style.liquidFrequency + 2.1 + phase), Math.sin(q.x * style.liquidFrequency + 4.2 + phase));
      q.addScaledVector(delta, style.liquidWarp).applyMatrix3(octave);
      delta.set(Math.sin(q.y * style.liquidFrequency * 2.2 + 1.3 - 2 * phase), Math.sin(q.z * style.liquidFrequency * 2.2 + 3.7 - 2 * phase), Math.sin(q.x * style.liquidFrequency * 2.2 + 5.1 - 2 * phase));
      q.addScaledVector(delta, style.liquidWarp * .85).applyMatrix3(octave);
      delta.set(Math.sin(q.y * style.liquidFrequency * 4.5 + 4 + 3 * phase), Math.sin(q.z * style.liquidFrequency * 4.5 + .7 + 3 * phase), Math.sin(q.x * style.liquidFrequency * 4.5 + 2.9 + 3 * phase));
      q.addScaledVector(delta, style.liquidWarp * .15);
      const r = Math.hypot(q.x, q.y, q.z);
      q.divideScalar(Math.max(r, .001));
      const waveA = .30 * Math.sin(3 * q.x + phase) * Math.cos(2 * q.z - phase) + .12 * Math.sin(5 * q.z + 2 * phase) + .05 * Math.sin(9 * q.x - 3 * phase);
      const waveB = .30 * Math.sin(3 * q.y - phase) * Math.cos(2 * q.x + phase) + .12 * Math.sin(5 * q.y - 2 * phase) + .05 * Math.sin(9 * q.z + 3 * phase);
      const cutA = Math.max(0, (Math.abs(q.y + waveA) - opening) * style.liquidRadius * .6);
      const cutB = Math.max(0, (Math.abs(.8 * q.x + .6 * q.z + waveB) - opening * .9) * style.liquidInnerRadius * .6);
      dense.field[index] = (style.liquidThickness - Math.min(Math.hypot(r - style.liquidRadius, cutA), Math.hypot(r - style.liquidInnerRadius, cutB))) * .45;
    }
    dense.update();
    assert.equal(geometry.drawRange.count, dense.count, 'early-outs preserve all marching cases in the immutable base');
    rotation.setFromAxisAngle(axis, -phase);
    let positionError = 0, minimumNormalDot = 1;
    for (let i = 0; i < dense.count; i++) {
      point.fromBufferAttribute(dense.geometry.attributes.position, i).multiplyScalar(bound).applyQuaternion(rotation);
      q.fromBufferAttribute(geometry.attributes.position, i);
      positionError = Math.max(positionError, point.distanceTo(q));
      normal.fromBufferAttribute(dense.geometry.attributes.normal, i).normalize().applyQuaternion(rotation);
      q.fromBufferAttribute(geometry.attributes.normal, i);
      minimumNormalDot = Math.min(minimumNormalDot, normal.dot(q));
    }
    assert.ok(positionError < 3e-6, `dense surface error ${positionError}`);
    assert.ok(minimumNormalDot > .999999, `dense outward normal agreement ${minimumNormalDot}`);
  }
});

test('loop endpoints, repeat seeks, reverse playback and paused clocks are deterministic', t => {
  const { mesh, controller } = fixture(t, { liquidDuration: 8 });
  controller.update(0);
  const first = snapshot(mesh.geometry);
  controller.update(8);
  assert.deepEqual(snapshot(mesh.geometry), first);
  controller.update(2);
  const quarter = snapshot(mesh.geometry);
  assert.notDeepEqual(quarter.position, first.position);
  controller.update(5);
  controller.update(2);
  assert.deepEqual(snapshot(mesh.geometry), quarter);
  controller.update(-100);
  assert.deepEqual(snapshot(mesh.geometry), first, 'negative elapsed clamps before signed speed');
  controller.setStyle(settings({ liquidDuration: 8, liquidSpeed: -1 }));
  controller.update(6);
  assert.deepEqual(snapshot(mesh.geometry), quarter, 'reverse cycle has the same phase');
  controller.setStyle(settings({ liquidDuration: 8, liquidSpeed: 0 }));
  controller.update(3);
  const paused = snapshot(mesh.geometry), pausedVersions = versions(mesh.geometry);
  controller.update(1000);
  assert.deepEqual(snapshot(mesh.geometry), paused);
  assert.deepEqual(versions(mesh.geometry), pausedVersions);
});

test('equivalent styles, surface-only edits and repeated frames retain buffers and upload versions', t => {
  const { mesh, controller } = fixture(t);
  controller.update(1);
  const geometry = mesh.geometry, positions = geometry.attributes.position.array, normals = geometry.attributes.normal.array;
  const original = snapshot(geometry), originalVersions = versions(geometry);
  controller.setStyle(settings({ color: '#ff0000', liquidReflectance: .5, liquidTint: '#ffcc00', roughness: .9 }));
  controller.update(1);
  assert.deepEqual(snapshot(geometry), original);
  assert.deepEqual(versions(geometry), originalVersions);
  controller.update(2);
  assert.equal(mesh.geometry, geometry);
  assert.equal(geometry.attributes.position.array, positions);
  assert.equal(geometry.attributes.normal.array, normals);
});

test('duration, speed and easing affect the cycle clock rather than accumulating frame state', t => {
  const { mesh, controller } = fixture(t, { liquidDuration: 8, liquidEase: 0 });
  controller.update(1);
  const eighth = snapshot(mesh.geometry);
  controller.setStyle(settings({ liquidDuration: 16, liquidSpeed: 2, liquidEase: 0 }));
  controller.update(1);
  assert.deepEqual(snapshot(mesh.geometry), eighth, 'equal cycle fractions have identical surfaces');
  controller.setStyle(settings({ liquidDuration: 8, liquidEase: .15 }));
  controller.update(1);
  assert.notDeepEqual(snapshot(mesh.geometry).position, eighth.position, 'easing changes phase inside a loop');
  controller.update(8);
  const endpoint = snapshot(mesh.geometry);
  controller.update(0);
  assert.deepEqual(snapshot(mesh.geometry), endpoint, 'easing keeps the loop seamless');
});

test('published coarse output stays compact and deterministic independently of runtime refinement', t => {
  const first = createLiquidGeometry(settings()), second = createLiquidGeometry(settings());
  t.after(() => { first.dispose(); second.dispose(); });
  assert.equal(first.attributes.position.count, first.drawRange.count);
  assert.equal(first.attributes.normal.count, first.drawRange.count);
  assert.deepEqual(snapshot(first), snapshot(second));
  assert.ok(first.boundingBox.equals(second.boundingBox));
  assert.ok(first.boundingSphere.equals(second.boundingSphere));
});

test('projected vertices and refined triangle interiors better approximate the zero-warp zero set', t => {
  const style = settings({ liquidWarp: 0, liquidRadius: 1.4, liquidInnerRadius: .55, liquidThickness: .1, liquidOpen: 1.2 });
  const { mesh, controller } = fixture(t, style);
  controller.update(0);
  const coarse = createLiquidGeometry(style);
  t.after(() => coarse.dispose());
  const point = new THREE.Vector3(), corner = new THREE.Vector3();
  function residuals(geometry) {
    let vertices = 0, interiors = 0, maxVertex = 0;
    for (let i = 0; i < geometry.drawRange.count; i++) {
      point.fromBufferAttribute(geometry.attributes.position, i);
      const residual = Math.abs(unwarpedDistance(point, style));
      vertices += residual;
      maxVertex = Math.max(maxVertex, residual);
    }
    for (let i = 0; i < geometry.drawRange.count; i += 3) {
      point.set(0, 0, 0);
      for (let j = 0; j < 3; j++) point.add(corner.fromBufferAttribute(geometry.attributes.position, i + j));
      interiors += Math.abs(unwarpedDistance(point.divideScalar(3), style));
    }
    return { vertices: vertices / geometry.drawRange.count, interiors: interiors / (geometry.drawRange.count / 3), maxVertex };
  }
  const before = residuals(coarse), after = residuals(drawn(mesh.geometry));
  assert.ok(after.vertices < before.vertices * .1, `vertex residual ${after.vertices} versus coarse ${before.vertices}`);
  assert.ok(after.interiors < before.interiors * .5, `triangle residual ${after.interiors} versus coarse ${before.interiors}`);
  assert.ok(after.maxVertex < before.maxVertex, 'projection does not merely redistribute the worst surface error');
  assertSurface(mesh.geometry, controller.radius);
});

test('analytic outward normals agree with independent finite differences through warped and rotated fields', t => {
  const { mesh, controller } = fixture(t);
  const point = new THREE.Vector3(), normal = new THREE.Vector3(), gradient = new THREE.Vector3();
  const shifted = new THREE.Vector3(), finer = new THREE.Vector3();
  function derivative(style, elapsed, epsilon, target) {
    for (const axis of ['x', 'y', 'z']) {
      shifted.copy(point); shifted[axis] += epsilon;
      const plus = distanceAt(shifted, style, elapsed);
      shifted[axis] -= 2 * epsilon;
      target[axis] = (plus - distanceAt(shifted, style, elapsed)) / (2 * epsilon);
    }
    return target.normalize();
  }
  for (const [style, elapsed] of [
    [settings({ liquidWarp: 0, liquidOpen: 0 }), 0],
    [settings(), 1.25],
    [settings({ liquidWarp: 1.2, liquidFrequency: 4, liquidThickness: .04 }), 2]
  ]) {
    controller.setStyle(style); controller.update(elapsed);
    let checked = 0, probes = 0;
    const geometry = drawn(mesh.geometry);
    for (let i = 0; i < geometry.drawRange.count; i += 37) {
      point.fromBufferAttribute(geometry.attributes.position, i);
      normal.fromBufferAttribute(geometry.attributes.normal, i);
      derivative(style, elapsed, 1e-5, gradient);
      derivative(style, elapsed, 5e-6, finer);
      probes++;
      // Only true nondifferentiable min/cut seams lack a unique normal.
      if (gradient.dot(finer) < .999999) continue;
      assert.ok(normal.dot(finer) > .9998, `outward derivative agreement at vertex ${i}: ${normal.dot(finer)}`);
      checked++;
    }
    assert.ok(checked > probes * .95, 'almost all samples have a stable independently measured derivative');
    assertSurface(mesh.geometry, controller.radius);
  }
});

test('neighboring coarse triangles share exactly the same projected edge midpoint and normal', t => {
  const { mesh, controller } = fixture(t);
  controller.update(0);
  const coarse = createLiquidGeometry(settings());
  t.after(() => coarse.dispose());
  const edges = new Map(), point = new THREE.Vector3(), refined = drawn(mesh.geometry);
  let shared = 0;
  for (let triangle = 0; triangle < coarse.drawRange.count / 3; triangle++) {
    const keys = [];
    for (let corner = 0; corner < 3; corner++) {
      point.fromBufferAttribute(coarse.attributes.position, triangle * 3 + corner);
      keys.push(point.toArray().join(','));
    }
    for (const [a, b, midpoint] of [[0, 1, 1], [1, 2, 5], [2, 0, 2]]) {
      const key = [keys[a], keys[b]].sort().join('|'), vertex = triangle * 12 + midpoint;
      const sample = [
        ...point.fromBufferAttribute(refined.attributes.position, vertex).toArray(),
        ...point.fromBufferAttribute(refined.attributes.normal, vertex).toArray()
      ];
      if (edges.has(key)) {
        assert.deepEqual(sample, edges.get(key), 'shared projected edges have no geometric or shading cracks');
        shared++;
      } else edges.set(key, sample);
    }
  }
  assert.ok(shared > 100, 'checks shared edges belonging to distinct parent triangles');
});

test('radius, inner radius, thickness, opening, warp and frequency alter the actual mesh', t => {
  const { mesh, controller } = fixture(t);
  controller.update(0);
  const original = snapshot(mesh.geometry);
  for (const overrides of [
    { liquidRadius: 1.7 }, { liquidInnerRadius: 1.3 }, { liquidThickness: .1 },
    { liquidOpen: 1.2 }, { liquidWarp: 0 }, { liquidFrequency: 3.2 }
  ]) {
    controller.setStyle(settings(overrides));
    controller.update(0);
    assert.notDeepEqual(snapshot(mesh.geometry).position, original.position, JSON.stringify(overrides));
    assertSurface(mesh.geometry, controller.radius);
  }
});

test('open and closed widths independently change topology and can deliberately invert the cycle', t => {
  const { mesh, controller } = fixture(t, { liquidWarp: 0, liquidThickness: .08, liquidOpen: 0, liquidClosed: 1.2, liquidDuration: 8 });
  controller.update(0);
  const open = snapshot(mesh.geometry);
  controller.update(4);
  const closed = snapshot(mesh.geometry);
  assert.notEqual(open.position.length, closed.position.length, 'triangle count changes with ribbon closure');
  controller.setStyle(settings({ liquidWarp: 0, liquidThickness: .08, liquidOpen: 1.2, liquidClosed: 0, liquidDuration: 8 }));
  controller.update(0);
  assert.notEqual(snapshot(mesh.geometry).position.length, open.position.length, 'inverted open width starts closed');
  controller.update(4);
  const inverted = snapshot(mesh.geometry);
  assert.notEqual(inverted.position.length, closed.position.length, 'inverted closed width ends open');
  controller.setStyle(settings({ liquidWarp: 0, liquidThickness: .08, liquidOpen: 0, liquidClosed: 0, liquidDuration: 8 }));
  controller.update(4);
  assert.deepEqual(snapshot(mesh.geometry), inverted, 'closed-width zero equals an always-open cycle at the same phase');
});

test('zero warp keeps two distinct rounded bands with outward SDF normals and real openings', t => {
  const style = settings({ liquidWarp: 0, liquidRadius: 1.4, liquidInnerRadius: .55, liquidThickness: .1, liquidOpen: 0 });
  const { mesh, controller, material } = fixture(t, style);
  material.side = THREE.DoubleSide;
  controller.update(0);
  const geometry = drawn(mesh.geometry);
  const point = new THREE.Vector3(), normal = new THREE.Vector3();
  let inner = 0, outer = 0, checkedNormals = 0;
  for (let i = 0; i < geometry.drawRange.count; i++) {
    point.fromBufferAttribute(geometry.attributes.position, i);
    normal.fromBufferAttribute(geometry.attributes.normal, i);
    const r = point.length();
    if (r < .8) inner++;
    else outer++;
    assert.ok(Math.min(Math.abs(r - .55), Math.abs(r - 1.4)) < .13, 'no surface bridges the two radial bands');
    // Ignore true min/cut seams when probing a finite interval.
    const epsilon = .002;
    const plus = unwarpedDistance(point.clone().addScaledVector(normal, epsilon), style);
    const minus = unwarpedDistance(point.clone().addScaledVector(normal, -epsilon), style);
    if (Math.abs(unwarpedDistance(point, style)) < .02) {
      assert.ok(plus > minus, `normal follows outward distance gradient ${i}`);
      checkedNormals++;
    }
  }
  assert.ok(inner > 100 && outer > 100, 'both authored sheets survive extraction');
  assert.ok(checkedNormals > geometry.drawRange.count / 2);
  const direction = new THREE.Vector3(.8, 1, .6).normalize();
  const inverse = octave.clone().transpose();
  direction.applyMatrix3(inverse).applyMatrix3(inverse);
  mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(direction.clone().multiplyScalar(3), direction.clone().negate());
  assert.equal(ray.intersectObject(mesh).length, 0, 'ray traverses both real ribbon openings');
  controller.setStyle({ ...style, liquidOpen: 1.2 });
  controller.update(0);
  mesh.updateMatrixWorld(true);
  assert.ok(ray.intersectObject(mesh).length > 0, 'the same ray intersects the closed sheets');
  assertSurface(mesh.geometry, Math.max(style.liquidRadius, style.liquidInnerRadius) + style.liquidThickness);
});

test('thin sheets preserve their authored thickness instead of expanding to the grid cell', t => {
  const style = settings({ liquidWarp: 0, liquidRadius: 1.4, liquidInnerRadius: .7, liquidThickness: .04, liquidOpen: 1.2 });
  const { mesh, controller } = fixture(t, style);
  controller.update(0);
  const geometry = drawn(mesh.geometry);
  let outerMin = Infinity, outerMax = 0;
  for (let i = 0; i < geometry.drawRange.count; i++) {
    const r = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, i).length();
    if (r > 1) { outerMin = Math.min(outerMin, r); outerMax = Math.max(outerMax, r); }
  }
  assert.ok(outerMax <= 1.441 && outerMin >= 1.34, 'interpolated surface stays within the thin shell');
  assert.ok(outerMax - outerMin < .1, 'no artificial cell-sized inflation');
});

test('control extremes retain finite active bounds and unit normals at the declared grid resolution', t => {
  const { mesh, controller } = fixture(t);
  const extremes = [
    { liquidRadius: .3, liquidInnerRadius: .1, liquidThickness: .04, liquidWarp: 0, liquidFrequency: .2, liquidOpen: 0, liquidClosed: 0 },
    { liquidRadius: 2, liquidInnerRadius: 1.5, liquidThickness: .5, liquidWarp: 1.2, liquidFrequency: 4, liquidOpen: 1.2, liquidClosed: 1.2 },
    { liquidRadius: .3, liquidInnerRadius: 1.5, liquidThickness: .04, liquidWarp: 1.2, liquidFrequency: 4, liquidOpen: 0, liquidClosed: 1.2 }
  ];
  for (const overrides of extremes) {
    controller.setStyle(settings(overrides));
    for (const elapsed of [0, 1.25]) {
      controller.update(elapsed);
      assertSurface(mesh.geometry, controller.radius);
    }
  }
});

test('quality changes replace only owned geometry and disposal restores shared sources', t => {
  const source = new THREE.BoxGeometry(), original = source.attributes.position.array.slice();
  const originalNormals = source.attributes.normal.array.slice(), originalIndex = source.index.array.slice();
  const originalUV = source.attributes.uv.array.slice(), sourceVersions = versions(source);
  const first = fixture(t, {}, source), second = fixture(t, {}, source);
  let sourceDisposals = 0, materialDisposals = 0, ownedDisposals = 0;
  source.addEventListener('dispose', () => sourceDisposals++);
  first.material.addEventListener('dispose', () => materialDisposals++);
  first.controller.update(.5);
  second.controller.update(2);
  const secondBefore = snapshot(second.mesh.geometry), oldOwned = first.mesh.geometry;
  oldOwned.addEventListener('dispose', () => ownedDisposals++);
  assert.notEqual(first.mesh.geometry, second.mesh.geometry);
  first.controller.setStyle(settings({ liquidDetail: 33 }));
  first.controller.update(.5);
  assert.notEqual(first.mesh.geometry, oldOwned);
  assert.equal(ownedDisposals, 1);
  assert.deepEqual(snapshot(second.mesh.geometry), secondBefore);
  assert.deepEqual(source.attributes.position.array, original);
  assert.deepEqual(source.attributes.normal.array, originalNormals);
  assert.deepEqual(source.attributes.uv.array, originalUV);
  assert.deepEqual(source.index.array, originalIndex);
  assert.deepEqual(versions(source), sourceVersions, 'runtime updates never upload or rewrite the shared asset');
  const owned = first.mesh.geometry;
  owned.addEventListener('dispose', () => ownedDisposals++);
  first.controller.dispose();
  first.controller.dispose();
  first.controller.update(10);
  assert.equal(first.mesh.geometry, source);
  assert.equal(ownedDisposals, 2);
  assert.equal(sourceDisposals, 0);
  assert.equal(materialDisposals, 0);
});

test('every mesh binding shares one owned surface and externally replaced geometry is not restored', t => {
  const source = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial(), replacement = new THREE.SphereGeometry();
  const model = new THREE.Group(), a = new THREE.Mesh(source, material), b = new THREE.Mesh(source, material);
  model.add(a, b);
  const controller = createLiquidRibbons(model);
  controller.setStyle(settings());
  controller.update(0);
  assert.equal(a.geometry, b.geometry);
  b.geometry = replacement;
  controller.dispose();
  assert.equal(a.geometry, source);
  assert.equal(b.geometry, replacement);
  t.after(() => { source.dispose(); replacement.dispose(); material.dispose(); });
});

test('nonfinite seeks fail explicitly without accepting a corrupt clock', t => {
  const { mesh, controller } = fixture(t);
  controller.update(0);
  const original = snapshot(mesh.geometry);
  for (const time of [NaN, Infinity, -Infinity]) assert.throws(() => controller.update(time), RangeError);
  assert.deepEqual(snapshot(mesh.geometry), original);
});

