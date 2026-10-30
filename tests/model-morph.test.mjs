import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMorphingSphere } from '../src/model-morph.js';
import { DEFAULT_MODEL_STYLE } from '../src/model-style.js';

const DENSE_TOPOLOGY = { widthSegments: 192, heightSegments: 144 };

function sphere() {
  const geometry = new THREE.SphereGeometry(1, 24, 16);
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3).fill(1), 3));
  return geometry;
}
function fixture(t, settings = {}, source = sphere(), options) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(source, material);
  const controller = createMorphingSphere(mesh, options);
  controller.setStyle({ ...DEFAULT_MODEL_STYLE, ...settings });
  t.after(() => { controller.dispose(); source.dispose(); material.dispose(); });
  return { mesh, controller, source, material };
}
function snapshot(geometry) {
  return Object.fromEntries(['position', 'normal', 'color'].map(key => [key, geometry.attributes[key].array.slice()]));
}
function versions(geometry) {
  return ['position', 'normal', 'color'].map(key => geometry.attributes[key].version);
}
function probesGeometry(directions) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float64Array(directions.flatMap(point => point.toArray())), 3));
  return geometry;
}
function assertSurface(geometry, radius) {
  const point = new THREE.Vector3(), normal = new THREE.Vector3();
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i);
    normal.fromBufferAttribute(geometry.attributes.normal, i);
    assert.ok(Number.isFinite(point.length()) && Number.isFinite(normal.length()), `finite vertex ${i}`);
    assert.ok(Math.abs(normal.length() - 1) < 1e-6, `normalized normal ${i}`);
    assert.ok(normal.dot(point) > 0, `outward normal ${i}`);
    assert.ok(point.length() <= radius + 2e-7, `envelope contains vertex ${i}`);
    assert.ok(geometry.boundingBox.containsPoint(point), `box contains vertex ${i}`);
    assert.ok(geometry.boundingSphere.containsPoint(point), `sphere contains vertex ${i}`);
  }
}

test('elapsed time changes the real surface and normals, and reverse seeking is exact', t => {
  const { mesh, controller } = fixture(t);
  controller.update(.375);
  const first = snapshot(mesh.geometry);
  controller.update(2.25);
  assert.notDeepEqual(mesh.geometry.attributes.position.array, first.position);
  assert.notDeepEqual(mesh.geometry.attributes.normal.array, first.normal);
  assert.notDeepEqual(mesh.geometry.attributes.color.array, first.color);
  controller.update(.375);
  assert.deepEqual(snapshot(mesh.geometry), first);
  controller.update(0);
  const zero = snapshot(mesh.geometry);
  controller.update(-100);
  assert.deepEqual(snapshot(mesh.geometry), zero, 'negative layer-local elapsed clamps to zero');
  controller.update(60 * 60 * 24 + .375);
  assert.notDeepEqual(mesh.geometry.attributes.position.array, first.position, 'clock is not periodically wrapped');
});

test('speed zero freezes every buffer, negative speed reverses the field clock', t => {
  const { mesh, controller } = fixture(t, { morphSpeed: 0 }, sphere(), DENSE_TOPOLOGY);
  controller.update(1);
  const frozen = snapshot(mesh.geometry), frozenVersions = versions(mesh.geometry);
  controller.update(100);
  assert.deepEqual(snapshot(mesh.geometry), frozen);
  assert.deepEqual(versions(mesh.geometry), frozenVersions);
  controller.setStyle({ ...DEFAULT_MODEL_STYLE, morphSpeed: -2 });
  controller.update(.75);
  const backwards = snapshot(mesh.geometry);
  controller.setStyle({ ...DEFAULT_MODEL_STYLE, morphSpeed: -1 });
  controller.update(1.5);
  assert.deepEqual(snapshot(mesh.geometry), backwards, 'equal signed times have identical geometry/color');
  controller.setStyle(DEFAULT_MODEL_STYLE);
  controller.update(1.5);
  assert.notDeepEqual(mesh.geometry.attributes.position.array, backwards.position);
});

test('zero amplitude is a smooth unit sphere while palette animation remains live', t => {
  const { mesh, controller } = fixture(t, { morphAmplitude: 0 });
  controller.update(.5);
  const first = snapshot(mesh.geometry), initialVersions = versions(mesh.geometry);
  assert.equal(controller.radius, 1);
  for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
    const position = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i);
    const normal = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.normal, i);
    assert.ok(Math.abs(position.length() - 1) < 1e-7);
    assert.ok(position.distanceTo(normal) < 1e-7);
  }
  controller.update(3);
  assert.deepEqual(mesh.geometry.attributes.position.array, first.position);
  assert.deepEqual(mesh.geometry.attributes.normal.array, first.normal);
  assert.notDeepEqual(mesh.geometry.attributes.color.array, first.color);
  assert.deepEqual(versions(mesh.geometry).slice(0, 2), initialVersions.slice(0, 2));
});

test('extreme controls retain finite outward normals and truthful bounds', t => {
  const { mesh, controller } = fixture(t);
  const extremes = [
    { morphAmplitude: 0, morphWarp: 0, morphFrequency: 1, morphFalloff: 1, morphDetail: 1, morphContrast: .2, morphSpeed: -4 },
    { morphAmplitude: .75, morphWarp: 1.5, morphFrequency: 10, morphFalloff: 1.6, morphDetail: 16, morphContrast: 2, morphSpeed: 4 },
    { morphAmplitude: .75, morphWarp: 1.5, morphFrequency: 1, morphFalloff: 1, morphDetail: 16, morphContrast: .2, morphSpeed: -4 }
  ];
  for (const settings of extremes) {
    controller.setStyle({ ...DEFAULT_MODEL_STYLE, ...settings });
    assert.equal(controller.radius, 1 + settings.morphAmplitude);
    for (const time of [0, .25, 3.5]) {
      controller.update(time);
      assertSurface(mesh.geometry, controller.radius);
    }
  }
});

test('UV seam and every duplicate pole have matching positions, colors and normals', t => {
  const { mesh, controller, source } = fixture(t);
  controller.update(1.234);
  assert.deepEqual(mesh.geometry.attributes.uv.array, source.attributes.uv.array);
  const width = 24, height = 16;
  const equalVertex = (a, b) => {
    for (const key of ['position', 'normal', 'color']) {
      const values = mesh.geometry.attributes[key].array;
      assert.deepEqual(values.slice(a * 3, a * 3 + 3), values.slice(b * 3, b * 3 + 3), `${key}: ${a}/${b}`);
    }
  };
  for (let row = 0; row <= height; row++) equalVertex(row * (width + 1), row * (width + 1) + width);
  for (let column = 1; column <= width; column++) {
    equalVertex(0, column);
    equalVertex(height * (width + 1), height * (width + 1) + column);
  }
});

test('requested runtime sphere preserves generated UVs, closed fine triangles and smooth seams/poles', t => {
  const source = sphere(), original = snapshot(source);
  const sourceUV = source.attributes.uv.array.slice(), sourceIndex = source.index.array.slice();
  const { mesh, controller } = fixture(t, { morphWarp: 0 }, source, DENSE_TOPOLOGY);
  controller.update(1.234);
  const geometry = mesh.geometry, uv = geometry.attributes.uv, p = geometry.attributes.position;
  const seams = new Map(), poles = [[], []], point = new THREE.Vector3(), expected = new THREE.Vector3();
  const equalVertex = (a, b) => {
    for (const key of ['position', 'normal', 'color']) {
      const values = geometry.attributes[key].array;
      assert.deepEqual(values.slice(a * 3, a * 3 + 3), values.slice(b * 3, b * 3 + 3), `${key}: ${a}/${b}`);
    }
  };
  for (let i = 0; i < p.count; i++) {
    const u = uv.getX(i), v = uv.getY(i), phi = (1 - v) * Math.PI, theta = u * Math.PI * 2;
    expected.set(-Math.cos(theta) * Math.sin(phi), Math.cos(phi), Math.sin(theta) * Math.sin(phi));
    point.fromBufferAttribute(p, i).normalize();
    assert.ok(point.distanceTo(expected) < 5e-7, `generated UVs follow actual sphere vertex ${i}`);
    if (v === 1 || v === 0) poles[v === 1 ? 0 : 1].push(i);
    else if (u === 0 || u === 1) {
      const previous = seams.get(v);
      if (previous === undefined) seams.set(v, i);
      else { equalVertex(previous, i); seams.delete(v); }
    }
  }
  assert.equal(seams.size, 0, 'every generated UV seam has its coincident partner');
  for (const pole of poles) for (const i of pole) equalVertex(pole[0], i);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), edge = new THREE.Vector3(), normal = new THREE.Vector3();
  let longestEdge = 0, solidAngle = 0;
  for (let i = 0; i < geometry.index.count; i += 3) {
    a.fromBufferAttribute(p, geometry.index.getX(i)).normalize();
    b.fromBufferAttribute(p, geometry.index.getX(i + 1)).normalize();
    c.fromBufferAttribute(p, geometry.index.getX(i + 2)).normalize();
    normal.crossVectors(edge.copy(b).sub(a), point.copy(c).sub(a));
    assert.ok(normal.dot(a) > 0, `outward nondegenerate runtime triangle ${i / 3}`);
    solidAngle += 2 * Math.atan2(normal.dot(a), 1 + a.dot(b) + b.dot(c) + c.dot(a));
    longestEdge = Math.max(longestEdge, a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
  }
  assert.ok(longestEdge > .03 && longestEdge < .041, 'actual triangles resolve the requested fine angular surface');
  assert.ok(Math.abs(solidAngle - 4 * Math.PI) < 1e-8, 'indexed triangles cover the complete sphere without openings');
  assertSurface(geometry, controller.radius);
  assert.deepEqual(snapshot(source), original, 'runtime density never mutates the published source');
  assert.deepEqual(source.attributes.uv.array, sourceUV);
  assert.deepEqual(source.index.array, sourceIndex);
});

test('analytic normals follow dense independent finite-difference surface tangents', t => {
  const epsilon = 1e-4, probes = [];
  for (let row = 1; row < 10; row++) {
    for (let column = 0; column < 16; column++) {
      const direction = new THREE.Vector3().setFromSphericalCoords(1, row * Math.PI / 10, column * Math.PI / 8);
      const tangent = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0)).normalize();
      const bitangent = new THREE.Vector3().crossVectors(direction, tangent).normalize();
      probes.push(direction, direction.clone().addScaledVector(tangent, epsilon), direction.clone().addScaledVector(tangent, -epsilon),
        direction.clone().addScaledVector(bitangent, epsilon), direction.clone().addScaledVector(bitangent, -epsilon));
    }
  }
  const { mesh, controller } = fixture(t, {}, probesGeometry(probes));
  for (const settings of [{}, { morphWarp: 0 }, { morphWarp: 1.3, morphFalloff: 1.2, morphDetail: 8 }]) {
    controller.setStyle({ ...DEFAULT_MODEL_STYLE, ...settings });
    controller.update(.625);
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i < probes.length; i += 5) {
      const du = new THREE.Vector3().fromBufferAttribute(p, i + 1).sub(new THREE.Vector3().fromBufferAttribute(p, i + 2));
      const dv = new THREE.Vector3().fromBufferAttribute(p, i + 3).sub(new THREE.Vector3().fromBufferAttribute(p, i + 4));
      const finiteDifference = new THREE.Vector3().crossVectors(du, dv).normalize();
      const actual = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.normal, i);
      assert.ok(actual.dot(finiteDifference) > .999, `normal follows deformed tangents at probe ${i / 5}`);
    }
  }
});

test('surface gradients and curvature stay continuous through all noise lattice axes', t => {
  const probes = [], centers = [], h = .006;
  // With warp zero and speed one, the noise lattice coordinate is 1.24*d + .3*t.
  // At t=2.3, a direction component of .25 therefore lies on lattice plane 1.
  for (let axis = 0; axis < 3; axis++) {
    for (let sample = 0; sample < 24; sample++) {
      const angle = (sample + .37) * Math.PI / 12;
      const direction = new THREE.Vector3();
      direction.setComponent(axis, .25);
      direction.setComponent((axis + 1) % 3, Math.sqrt(1 - .25 ** 2) * Math.cos(angle));
      direction.setComponent((axis + 2) % 3, Math.sqrt(1 - .25 ** 2) * Math.sin(angle));
      const tangent = new THREE.Vector3().setComponent(axis, 1).addScaledVector(direction, -.25).normalize();
      centers.push({ start: probes.length, axis });
      for (let step = -3; step <= 3; step++) probes.push(direction.clone().addScaledVector(tangent, h * step).normalize());
    }
  }
  const { mesh, controller } = fixture(t, { morphWarp: 0, morphSpeed: 1, morphContrast: 1, morphAmplitude: .75, base: 'custom' }, probesGeometry(probes));
  controller.update(2.3);
  const p = mesh.geometry.attributes.position, point = new THREE.Vector3();
  const activeProbes = [0, 0, 0];
  for (const { start, axis } of centers) {
    const radii = Array.from({ length: 7 }, (_, i) => point.fromBufferAttribute(p, start + i).length());
    const height = (radii[3] - 1) / .75;
    // Stay away from the separate height smoothstep's flat/clamped endpoints.
    if (height < .15 || height > .85) continue;
    activeProbes[axis]++;
    const [m3, m2, m1, center, p1, p2, p3] = radii;
    const leftGradient = (3 * center - 4 * m1 + m2) / (2 * h);
    const rightGradient = (-3 * center + 4 * p1 - p2) / (2 * h);
    assert.ok(Math.abs(leftGradient - rightGradient) < .005, `continuous gradient at probe ${start}`);
    const leftCurvature = (2 * center - 5 * m1 + 4 * m2 - m3) / (h * h);
    const rightCurvature = (2 * center - 5 * p1 + 4 * p2 - p3) / (h * h);
    assert.ok(Math.abs(leftCurvature - rightCurvature) < .25, `continuous curvature at probe ${start}`);
    const leftNormal = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.normal, start + 2);
    const rightNormal = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.normal, start + 4);
    const centerNormal = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.normal, start + 3);
    assert.ok(centerNormal.dot(leftNormal.add(rightNormal).normalize()) > .99999, `no reflection crease at probe ${start}`);
  }
  for (const [axis, count] of activeProbes.entries()) assert.ok(count >= 3, `non-flat lattice probes exercise axis ${axis}`);
});

test('palette and material edits never regenerate or alter the geometry', t => {
  const { mesh, controller } = fixture(t);
  controller.update(1.2);
  const first = snapshot(mesh.geometry), firstVersions = versions(mesh.geometry);
  const palette = { ...DEFAULT_MODEL_STYLE, morphColor1: '#ff0000', morphColor2: '#00ff00', morphColor3: '#ffffff', morphColor4: '#ff8800' };
  controller.setStyle(palette);
  controller.update(1.2);
  assert.deepEqual(mesh.geometry.attributes.position.array, first.position);
  assert.deepEqual(mesh.geometry.attributes.normal.array, first.normal);
  assert.deepEqual(versions(mesh.geometry).slice(0, 2), firstVersions.slice(0, 2));
  assert.notDeepEqual(mesh.geometry.attributes.color.array, first.color);
  const changedPalette = snapshot(mesh.geometry), paletteVersions = versions(mesh.geometry);
  controller.setStyle({ ...palette, base: 'tinted', color: '#ff00ff', roughness: .9, metalness: 1, look: 'toon', environment: 'neon', motion: 'spin' });
  controller.update(1.2);
  assert.deepEqual(snapshot(mesh.geometry), changedPalette);
  assert.deepEqual(versions(mesh.geometry), paletteVersions);
});

test('Custom skips color work and returning to Imported recovers the current palette', t => {
  const { mesh, controller } = fixture(t);
  const reference = fixture(t);
  controller.update(.1);
  const initialColorVersion = mesh.geometry.attributes.color.version;
  const style = { ...DEFAULT_MODEL_STYLE, morphColor1: '#ff8800', morphColor3: '#00ff44' };
  controller.setStyle({ ...style, base: 'custom' });
  controller.update(2.5);
  assert.equal(mesh.geometry.attributes.color.version, initialColorVersion);
  const geometryVersions = versions(mesh.geometry).slice(0, 2);
  controller.setStyle(style);
  controller.update(2.5);
  reference.controller.setStyle(style);
  reference.controller.update(2.5);
  assert.deepEqual(snapshot(mesh.geometry), snapshot(reference.mesh.geometry));
  assert.deepEqual(versions(mesh.geometry).slice(0, 2), geometryVersions);
});

test('duplicate frames and equivalent styles do not touch buffers or upload versions', t => {
  const { mesh, controller } = fixture(t, {}, sphere(), DENSE_TOPOLOGY);
  controller.update(.75);
  const initial = snapshot(mesh.geometry), initialVersions = versions(mesh.geometry);
  const positions = mesh.geometry.attributes.position.array;
  const normals = mesh.geometry.attributes.normal.array;
  const colors = mesh.geometry.attributes.color.array;
  for (let i = 0; i < 4; i++) {
    controller.setStyle({ ...DEFAULT_MODEL_STYLE });
    controller.update(.75);
  }
  assert.deepEqual(snapshot(mesh.geometry), initial);
  assert.deepEqual(versions(mesh.geometry), initialVersions);
  controller.update(2);
  assert.equal(mesh.geometry.attributes.position.array, positions);
  assert.equal(mesh.geometry.attributes.normal.array, normals);
  assert.equal(mesh.geometry.attributes.color.array, colors);
});

test('layers sharing a decoded source own isolated geometry and dispose safely', t => {
  const source = sphere(), original = snapshot(source), sourceVersions = versions(source);
  const first = fixture(t, {}, source, DENSE_TOPOLOGY), second = fixture(t, {}, source, DENSE_TOPOLOGY);
  let sourceDisposals = 0, materialDisposals = 0, ownedDisposals = 0;
  source.addEventListener('dispose', () => sourceDisposals++);
  first.material.addEventListener('dispose', () => materialDisposals++);
  const owned = first.mesh.geometry;
  owned.addEventListener('dispose', () => ownedDisposals++);
  assert.notEqual(first.mesh.geometry, source);
  assert.notEqual(first.mesh.geometry, second.mesh.geometry);
  first.controller.update(.5);
  second.controller.update(2);
  const secondBefore = snapshot(second.mesh.geometry);
  first.controller.setStyle({ ...DEFAULT_MODEL_STYLE, morphAmplitude: .7 });
  first.controller.update(3);
  assert.deepEqual(snapshot(second.mesh.geometry), secondBefore);
  assert.deepEqual(snapshot(source), original);
  assert.deepEqual(versions(source), sourceVersions);
  assert.equal(source.boundingBox, null);
  first.controller.dispose();
  first.controller.dispose();
  assert.equal(first.mesh.geometry, source);
  assert.equal(sourceDisposals, 0);
  assert.equal(materialDisposals, 0);
  assert.equal(ownedDisposals, 1);
  second.controller.update(4);
  assert.notDeepEqual(snapshot(second.mesh.geometry), secondBefore);
  assert.deepEqual(snapshot(source), original);
  first.controller.update(5);
  assert.equal(ownedDisposals, 1);
});

test('repeated meshes within one model share one owned geometry without disposing later replacements', t => {
  const source = sphere(), material = new THREE.MeshStandardMaterial(), replacement = sphere();
  const model = new THREE.Group(), a = new THREE.Mesh(source, material), b = new THREE.Mesh(source, material);
  model.add(a, b);
  const controller = createMorphingSphere(model, DENSE_TOPOLOGY);
  t.after(() => { controller.dispose(); source.dispose(); material.dispose(); replacement.dispose(); });
  assert.equal(a.geometry, b.geometry);
  assert.notEqual(a.geometry, source);
  controller.update(.75);
  let disposed = 0, replacementDisposed = 0;
  a.geometry.addEventListener('dispose', () => disposed++);
  replacement.addEventListener('dispose', () => replacementDisposed++);
  a.geometry = replacement;
  controller.dispose();
  assert.equal(a.geometry, replacement);
  assert.equal(b.geometry, source);
  assert.equal(disposed, 1);
  assert.equal(replacementDisposed, 0);
});

test('picking intersects the deformed shell instead of the immutable base sphere', t => {
  const { mesh, controller } = fixture(t, { morphAmplitude: .75 }, sphere(), DENSE_TOPOLOGY);
  controller.update(.8);
  mesh.updateMatrixWorld(true);
  const positions = mesh.geometry.attributes.position, index = mesh.geometry.index;
  const center = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), target = new THREE.Vector3();
  let furthest = 0;
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(positions, index.getX(i));
    b.fromBufferAttribute(positions, index.getX(i + 1));
    c.fromBufferAttribute(positions, index.getX(i + 2));
    center.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    if (center.lengthSq() > furthest) { furthest = center.lengthSq(); target.copy(center); }
  }
  const direction = target.clone().normalize();
  const ray = new THREE.Raycaster(direction.clone().multiplyScalar(4), direction.clone().negate());
  const hit = ray.intersectObject(mesh)[0];
  assert.ok(hit, 'real indexed geometry is raycastable');
  assert.ok(hit.point.length() > 1.01, 'hit is outside the original unit sphere');
  controller.setStyle({ ...DEFAULT_MODEL_STYLE, morphAmplitude: 0 });
  controller.update(.8);
  const smoothHit = ray.intersectObject(mesh)[0];
  assert.ok(smoothHit.point.length() <= 1 + 1e-6);
  assert.ok(smoothHit.point.length() > .97);
});

test('palette hex values are converted from sRGB to linear vertex colors', t => {
  const white = fixture(t, { morphColor1: '#ffffff', morphColor2: '#ffffff', morphColor3: '#ffffff', morphColor4: '#ffffff' });
  const gray = fixture(t, { morphColor1: '#808080', morphColor2: '#808080', morphColor3: '#808080', morphColor4: '#808080' });
  white.controller.update(.4);
  gray.controller.update(.4);
  const expected = new THREE.Color('#808080').r;
  const whiteColors = white.mesh.geometry.attributes.color.array, grayColors = gray.mesh.geometry.attributes.color.array;
  for (let i = 0; i < grayColors.length; i++) assert.ok(Math.abs(grayColors[i] / whiteColors[i] - expected) < 1e-7);
});

test('each shape field invalidates the surface while amplitude-only edits reuse the palette', t => {
  const { mesh, controller } = fixture(t);
  controller.update(.9);
  const original = snapshot(mesh.geometry);
  const changedFields = { morphAmplitude: .65, morphWarp: 1.3, morphFrequency: 9, morphFalloff: 1.5, morphDetail: 3, morphContrast: 1.8 };
  for (const [key, value] of Object.entries(changedFields)) {
    controller.setStyle({ ...DEFAULT_MODEL_STYLE, [key]: value });
    controller.update(.9);
    assert.notDeepEqual(mesh.geometry.attributes.position.array, original.position, key);
    assertSurface(mesh.geometry, controller.radius);
    controller.setStyle(DEFAULT_MODEL_STYLE);
    controller.update(.9);
    assert.deepEqual(snapshot(mesh.geometry), original, `restore ${key}`);
  }
  const colorVersion = mesh.geometry.attributes.color.version;
  controller.setStyle({ ...DEFAULT_MODEL_STYLE, morphAmplitude: .7 });
  controller.update(.9);
  assert.deepEqual(mesh.geometry.attributes.color.array, original.color);
  assert.equal(mesh.geometry.attributes.color.version, colorVersion);
});

test('fragment-normal lattice stores CPU hash cells and encloses the actual signed-time field', t => {
  const directions = Array.from({ length: 48 }, (_, i) => new THREE.Vector3().setFromSphericalCoords(1, (i % 7 + 1) * Math.PI / 8, i * 2.399963229728653));
  directions.push(new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1));
  const { mesh, controller } = fixture(t, {}, probesGeometry(directions));
  const settings = [
    { ...DEFAULT_MODEL_STYLE, morphSpeed: -1 },
    { ...DEFAULT_MODEL_STYLE, morphWarp: 0, morphContrast: 2, morphSpeed: 1 },
    { ...DEFAULT_MODEL_STYLE, morphWarp: 1.5, morphFrequency: 1, morphFalloff: 1, morphDetail: 16, morphContrast: .2, morphSpeed: -4 }
  ];
  for (const style of settings) {
    controller.setStyle(style);
    controller.update(2.75);
    const { uniforms } = controller.surfaceNormals;
    const texture = uniforms.flocMorphLattice.value, image = texture.image, origin = uniforms.flocMorphOrigin.value;
    const hash = (x, y, z) => {
      const value = Math.sin(x * 12.9898 + y * 78.283 + z * 37.919) * 43758.7053;
      return Math.fround(value - Math.floor(value));
    };
    const cell = (x, y, z) => {
      const ix = x - origin.x, iy = y - origin.y, iz = z - origin.z;
      assert.ok(ix >= 0 && ix < image.width && iy >= 0 && iy < image.height && iz >= 0 && iz < image.depth, 'all eight field corners lie within the texture');
      const value = image.data[ix + image.width * (iy + image.height * iz)];
      assert.equal(value, hash(x, y, z), 'lattice uses the mesh CPU hash, not GLSL sin hashing');
      return value;
    };
    const signedTime = 2.75 * style.morphSpeed;
    for (let i = 0; i < directions.length; i++) {
      const p = directions[i].clone().multiplyScalar(.4);
      let frequency = style.morphFrequency, power = style.morphFalloff ** frequency;
      for (let iteration = 0; iteration < style.morphDetail; iteration++) {
        const displacement = new THREE.Vector3(
          Math.sin(p.y * power - signedTime * .4 + frequency * .18),
          Math.sin(p.z * power - signedTime * .4 + frequency * .21),
          Math.sin(p.x * power - signedTime * .4 + frequency * .24));
        p.addScaledVector(displacement, style.morphWarp / power);
        frequency++; power *= style.morphFalloff;
      }
      p.multiplyScalar(3.1).addScalar(signedTime * .3);
      const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
      const fade = value => value ** 3 * (value * (value * 6 - 15) + 10);
      const u = fade(p.x - x), v = fade(p.y - y), w = fade(p.z - z);
      let noise = 0;
      for (let dz = 0; dz <= 1; dz++) for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
        noise += cell(x + dx, y + dy, z + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
      }
      const t = Math.max(0, Math.min(1, (noise ** style.morphContrast - .2) / .6));
      const radius = 1 + style.morphAmplitude * t * t * (3 - 2 * t);
      const actual = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i).length();
      assert.ok(Math.abs(actual - radius) < 3e-7, 'texture field reproduces the actual mesh radius');
    }
  }
});

test('fragment-normal resources reuse cells between drift crossings and dispose per controller', t => {
  const first = fixture(t), second = fixture(t);
  first.controller.update(.25);
  const descriptor = first.controller.surfaceNormals;
  const uniforms = descriptor.uniforms, texture = uniforms.flocMorphLattice.value;
  const buffer = texture.image.data, initial = buffer.slice(), version = texture.version;
  assert.equal(first.controller.surfaceNormals, descriptor, 'descriptor is stable');
  assert.notEqual(second.controller.surfaceNormals.uniforms.flocMorphLattice.value, texture, 'textures belong to the controller');
  first.controller.update(.75);
  assert.equal(texture.version, version, 'fractional clock changes do not refill cells');
  first.controller.setStyle({ ...DEFAULT_MODEL_STYLE, morphAmplitude: .7, morphContrast: 1.5 });
  first.controller.update(.75);
  assert.equal(texture.version, version, 'amplitude and contrast reuse the same lattice');
  first.controller.update(4);
  assert.equal(uniforms.flocMorphLattice.value, texture);
  assert.equal(texture.image.data, buffer);
  assert.ok(texture.version > version, 'crossing a lattice drift cell refreshes its values');
  assert.notDeepEqual(buffer, initial);
  first.controller.update(.25);
  assert.deepEqual(buffer, initial, 'reverse seek recovers the exact CPU cells');
  let oldDisposals = 0, newDisposals = 0;
  texture.addEventListener('dispose', () => oldDisposals++);
  first.controller.setStyle({ ...DEFAULT_MODEL_STYLE, morphWarp: 0 });
  const replacement = uniforms.flocMorphLattice.value;
  replacement.addEventListener('dispose', () => newDisposals++);
  assert.notEqual(replacement, texture, 'field extent changes resize the owned texture');
  assert.equal(oldDisposals, 1);
  first.controller.dispose();
  first.controller.dispose();
  assert.equal(newDisposals, 1);
  assert.equal(first.controller.surfaceNormals, null, 'disposed getter cannot allocate a new texture');
  assert.ok(second.controller.surfaceNormals.uniforms.flocMorphLattice.value.image.data.length > 0);
});
