import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMorphingSphere } from '../src/model-morph.js';
import { DEFAULT_MODEL_STYLE } from '../src/model-style.js';
import { morphHash, morphOracle } from './fixtures/morph-oracle.js';

const DENSE_TOPOLOGY = { widthSegments: 192, heightSegments: 144 };
const PALETTE_KEYS = ['morphColor1', 'morphColor2', 'morphColor3', 'morphColor4'];

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
  return Object.fromEntries(['position', 'normal'].map(key => [key, geometry.attributes[key].array.slice()]));
}
function versions(geometry) {
  return ['position', 'normal'].map(key => geometry.attributes[key].version);
}
function probesGeometry(directions) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float64Array(directions.flatMap(point => point.toArray())), 3));
  return geometry;
}
const probeDirections = Array.from({ length: 48 }, (_, i) => new THREE.Vector3().setFromSphericalCoords(1, (i % 7 + 1) * Math.PI / 8, i * 2.399963229728653))
  .concat([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(axis => new THREE.Vector3(...axis)));
const paletteOf = style => PALETTE_KEYS.map(key => new THREE.Color(style[key]));
const fract = value => value - Math.floor(value);
const smooth = (low, high, value) => { const t = Math.max(0, Math.min(1, (value - low) / (high - low))); return t * t * (3 - 2 * t); };

// Double-precision mirror of the GLSL that reads only the shader descriptor: proves the
// uniforms and CPU-hashed lattices encode the style and clock the oracle defines.
function latticeNoise(texture, x, y, z) {
  const image = texture.image, ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const cell = (dx, dy, dz) => {
    const cx = ix + dx, cy = iy + dy, cz = iz + dz;
    assert.ok(cx >= 0 && cx < image.width && cy >= 0 && cy < image.height && cz >= 0 && cz < image.depth, 'all eight field corners lie within the texture');
    return image.data[cx + image.width * (cy + image.height * cz)];
  };
  const fade = value => value ** 3 * (value * (value * 6 - 15) + 10);
  const u = fade(x - ix), v = fade(y - iy), w = fade(z - iz);
  let value = 0;
  for (let dz = 0; dz <= 1; dz++) for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) value += cell(dx, dy, dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  return Math.max(0, Math.min(1, value));
}
function evaluate(uniforms, direction) {
  const value = name => uniforms[name].value, warp = value('flocMorphWarp'), d = direction.clone().normalize();
  const p = d.clone().multiplyScalar(.4);
  let frequency = value('flocMorphFrequency'), power = value('flocMorphPower');
  for (let iteration = 0; iteration < value('flocMorphDetail'); iteration++) {
    const phase = value('flocMorphPhase');
    const step = new THREE.Vector3(Math.sin(p.y * power + phase + frequency * .18), Math.sin(p.z * power + phase + frequency * .21), Math.sin(p.x * power + phase + frequency * .24));
    p.addScaledVector(step, warp / power);
    frequency++; power *= value('flocMorphFalloff');
  }
  const contrast = value('flocMorphContrast'), drift = value('flocMorphDrift');
  const level = latticeNoise(value('flocMorphLattice'), p.x * 3.1 + drift, p.y * 3.1 + drift, p.z * 3.1 + drift) ** contrast;
  const position = d.clone().multiplyScalar(1 + value('flocMorphAmplitude') * smooth(.2, .8, level));
  if (!value('flocMorphPainted')) return { position, color: null };
  const chromaDrift = value('flocMorphChromaDrift');
  const chroma = latticeNoise(value('flocMorphChromaLattice'), p.x * 1.5 + chromaDrift, p.y * 1.5 + chromaDrift, p.z * 1.5 + chromaDrift) ** contrast;
  const factor = fract(d.x * .27 + d.y * .27 + d.z * .27 + chroma ** 4.6) * 4, band = Math.floor(factor), palette = value('flocMorphPalette');
  const color = palette[band].clone().lerp(palette[(band + 1) % 4], smooth(0, 1.4, fract(factor))).multiplyScalar(.4 + smooth(.4, .8, level) * 1.3);
  return { position, color, factor };
}
function assertMatchesOracle(controller, style, time, message) {
  const { uniforms } = controller.surfaceDisplacement, flat = probeDirections.flatMap(direction => direction.toArray());
  const expected = morphOracle(flat, style, time, style.base === 'custom' ? null : paletteOf(style));
  for (const [i, direction] of probeDirections.entries()) {
    const { position, color, factor } = evaluate(uniforms, direction);
    assert.ok(position.distanceTo(new THREE.Vector3().fromArray(expected.positions, i * 3)) < 1e-6, `${message}: position ${i}`);
    if (!color || Math.abs(factor - Math.round(factor)) < 1e-6) continue;
    for (const [axis, channel] of ['r', 'g', 'b'].entries()) assert.ok(Math.abs(color[channel] - expected.colors[i * 3 + axis]) < 1e-6, `${message}: color ${i}`);
  }
}
function uniformState(uniforms) {
  return Object.fromEntries(Object.entries(uniforms).map(([key, { value }]) => [key, value?.isTexture ? value.image.data.slice() : Array.isArray(value) ? value.map(color => color.toArray()) : value]));
}

test('owned geometry is the canonical unit sphere inside conservative whole-animation bounds', t => {
  const { mesh, controller } = fixture(t, {}, sphere(), DENSE_TOPOLOGY);
  const geometry = mesh.geometry, point = new THREE.Vector3(), normal = new THREE.Vector3();
  assert.equal(geometry.attributes.color, undefined, 'colors come from the shader, not a CPU buffer');
  for (let i = 0; i < geometry.attributes.position.count; i++) {
    point.fromBufferAttribute(geometry.attributes.position, i);
    normal.fromBufferAttribute(geometry.attributes.normal, i);
    assert.ok(Math.abs(point.length() - 1) < 1e-7 && point.equals(normal), `unit direction ${i}`);
  }
  const directions = geometry.attributes.position.array;
  const extremes = [
    { morphAmplitude: 0, morphWarp: 0, morphFrequency: 1, morphFalloff: 1, morphDetail: 1, morphContrast: .2, morphSpeed: -4 },
    { morphAmplitude: .75, morphWarp: 1.5, morphFrequency: 10, morphFalloff: 1.6, morphDetail: 16, morphContrast: 2, morphSpeed: 4 },
    { morphAmplitude: .75, morphWarp: 1.5, morphFrequency: 1, morphFalloff: 1, morphDetail: 16, morphContrast: .2, morphSpeed: -4 }
  ];
  for (const settings of extremes) {
    const style = { ...DEFAULT_MODEL_STYLE, ...settings };
    controller.setStyle(style);
    assert.equal(controller.radius, 1 + settings.morphAmplitude);
    assert.ok(Number.isFinite(geometry.boundingSphere.radius) && geometry.boundingSphere.radius >= controller.radius);
    assert.ok(geometry.boundingSphere.radius < controller.radius + 1e-5, 'bounds stay tight to the analytic envelope');
    assert.deepEqual(geometry.boundingSphere.center.toArray(), [0, 0, 0]);
    for (const time of [0, .25, 3.5]) {
      controller.update(time);
      const { positions } = morphOracle(directions, style, time * style.morphSpeed);
      let reach = 0;
      for (let i = 0; i < positions.length; i += 3) {
        point.fromArray(positions, i);
        reach = Math.max(reach, point.length());
        assert.ok(geometry.boundingBox.containsPoint(point) && geometry.boundingSphere.containsPoint(point), `bounds contain displaced vertex ${i / 3}`);
      }
      if (settings.morphAmplitude) assert.ok(reach > 1 + settings.morphAmplitude * .9, 'the envelope is reached by the actual surface');
    }
  }
});

test('the CPU never rewrites vertex buffers: frames, styles and palettes only touch uniforms', t => {
  const { mesh, controller } = fixture(t, {}, sphere(), DENSE_TOPOLOGY);
  controller.update(.75);
  const initial = snapshot(mesh.geometry), initialVersions = versions(mesh.geometry), positions = mesh.geometry.attributes.position.array;
  const { uniforms } = controller.surfaceDisplacement;
  controller.update(2);
  controller.setStyle({ ...DEFAULT_MODEL_STYLE, morphAmplitude: .7, morphWarp: 1.2, morphColor1: '#ff0000', base: 'tinted' });
  controller.update(3);
  assert.deepEqual(snapshot(mesh.geometry), initial);
  assert.deepEqual(versions(mesh.geometry), initialVersions);
  assert.equal(mesh.geometry.attributes.position.array, positions);
  assert.equal(uniforms.flocMorphAmplitude.value, .7);
  assert.equal(uniforms.flocMorphWarp.value, 1.2);
});

test('the shader field reproduces the double-precision surface and palette from its uniforms', t => {
  const { controller } = fixture(t, {}, probesGeometry(probeDirections));
  const settings = [
    { morphSpeed: -1 },
    { morphWarp: 0, morphContrast: 2, morphSpeed: 1, morphAmplitude: .75 },
    { morphDetail: 1, morphContrast: .2, morphAmplitude: .75, base: 'tinted', morphColor1: '#ff0000', morphColor3: '#ffffff' },
    { morphWarp: 1.5, morphFrequency: 1, morphFalloff: 1, morphDetail: 16, morphContrast: .2, morphSpeed: -4 },
    { base: 'custom' }
  ];
  for (const patch of settings) {
    const style = { ...DEFAULT_MODEL_STYLE, ...patch };
    controller.setStyle(style);
    for (const elapsed of [0, 2.75, 1000.125]) {
      controller.update(elapsed);
      assertMatchesOracle(controller, style, elapsed * style.morphSpeed, `${JSON.stringify(patch)} at ${elapsed}`);
    }
  }
});

test('seeks are exact, negative elapsed clamps and the clock is never wrapped', t => {
  const { controller } = fixture(t);
  const { uniforms } = controller.surfaceDisplacement;
  controller.update(.375);
  const first = uniformState(uniforms);
  controller.update(2.25);
  assert.notDeepEqual(uniformState(uniforms), first);
  controller.update(.375);
  assert.deepEqual(uniformState(uniforms), first, 'reverse seek recovers the exact shader state');
  controller.update(0);
  const zero = uniformState(uniforms);
  controller.update(-100);
  assert.deepEqual(uniformState(uniforms), zero, 'negative layer-local elapsed clamps to zero');
  const day = 60 * 60 * 24 + .375;
  controller.update(day);
  assert.notDeepEqual(uniformState(uniforms), first, 'clock is not periodically wrapped');
  assertMatchesOracle(controller, DEFAULT_MODEL_STYLE, day, 'one day later');
  assert.throws(() => controller.update(Infinity), RangeError);
});

test('speed zero freezes the shader state, negative speed reverses the field clock', t => {
  const { controller } = fixture(t, { morphSpeed: 0 });
  const { uniforms } = controller.surfaceDisplacement;
  controller.update(1);
  const frozen = uniformState(uniforms), textures = [uniforms.flocMorphLattice.value, uniforms.flocMorphChromaLattice.value], textureVersions = textures.map(texture => texture.version);
  controller.update(100);
  assert.deepEqual(uniformState(uniforms), frozen);
  assert.deepEqual(textures.map(texture => texture.version), textureVersions);
  controller.setStyle({ ...DEFAULT_MODEL_STYLE, morphSpeed: -2 });
  controller.update(.75);
  const backwards = uniformState(uniforms);
  controller.setStyle({ ...DEFAULT_MODEL_STYLE, morphSpeed: -1 });
  controller.update(1.5);
  assert.deepEqual(uniformState(uniforms), backwards, 'equal signed times have identical shader state');
  assertMatchesOracle(controller, DEFAULT_MODEL_STYLE, -1.5, 'reversed clock');
  controller.setStyle(DEFAULT_MODEL_STYLE);
  controller.update(1.5);
  assert.notDeepEqual(uniformState(uniforms), backwards);
});

test('each shape control changes the displaced surface and restoring it is exact', t => {
  const { controller } = fixture(t, {}, probesGeometry(probeDirections));
  const { uniforms } = controller.surfaceDisplacement;
  const surface = () => probeDirections.map(direction => evaluate(uniforms, direction).position.toArray());
  controller.update(.9);
  const original = surface(), originalState = uniformState(uniforms);
  const changedFields = { morphAmplitude: .65, morphWarp: 1.3, morphFrequency: 9, morphFalloff: 1.5, morphDetail: 3, morphContrast: 1.8 };
  for (const [key, value] of Object.entries(changedFields)) {
    const style = { ...DEFAULT_MODEL_STYLE, [key]: value };
    controller.setStyle(style);
    controller.update(.9);
    assert.notDeepEqual(surface(), original, key);
    assertMatchesOracle(controller, style, .9, key);
    controller.setStyle(DEFAULT_MODEL_STYLE);
    controller.update(.9);
    assert.deepEqual(uniformState(uniforms), originalState, `restore ${key}`);
  }
});

test('palette hex values become linear shader colors; Custom stops painting and Imported recovers it', t => {
  const { controller } = fixture(t, {}, probesGeometry(probeDirections));
  const { uniforms } = controller.surfaceDisplacement, palette = uniforms.flocMorphPalette.value;
  const style = { ...DEFAULT_MODEL_STYLE, morphColor1: '#808080', morphColor2: '#ff8800', morphColor3: '#00ff44', morphColor4: '#ffffff' };
  controller.setStyle(style);
  controller.update(.4);
  assert.equal(uniforms.flocMorphPalette.value, palette, 'palette colors are edited in place');
  assert.ok(Math.abs(palette[0].r - new THREE.Color('#808080').r) < 1e-12 && palette[0].r < .25, 'sRGB hex converts to linear');
  assert.equal(uniforms.flocMorphPainted.value, true);
  assertMatchesOracle(controller, style, .4, 'palette');
  const chroma = uniforms.flocMorphChromaLattice.value, chromaVersion = chroma.version, chromaDrift = uniforms.flocMorphChromaDrift.value;
  controller.setStyle({ ...style, base: 'custom' });
  controller.update(25);
  assert.equal(uniforms.flocMorphPainted.value, false, 'Custom keeps vertex colors untouched');
  assert.equal(chroma.version, chromaVersion, 'Custom skips the color lattice');
  assert.equal(uniforms.flocMorphChromaDrift.value, chromaDrift);
  controller.setStyle(style);
  controller.update(25);
  assert.equal(uniforms.flocMorphPainted.value, true);
  assertMatchesOracle(controller, style, 25, 'returning to Imported paints the current palette');
});

test('UV seam and every duplicate pole share bit-identical shader inputs', t => {
  const { mesh, source } = fixture(t);
  assert.deepEqual(mesh.geometry.attributes.uv.array, source.attributes.uv.array);
  const width = 24, height = 16;
  const equalVertex = (a, b) => {
    for (const key of ['position', 'normal']) {
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
  const source = sphere(), original = Object.fromEntries(['position', 'normal', 'color'].map(key => [key, source.attributes[key].array.slice()]));
  const sourceUV = source.attributes.uv.array.slice(), sourceIndex = source.index.array.slice();
  const { mesh } = fixture(t, { morphWarp: 0 }, source, DENSE_TOPOLOGY);
  const geometry = mesh.geometry, uv = geometry.attributes.uv, p = geometry.attributes.position;
  const seams = new Map(), poles = [[], []], point = new THREE.Vector3(), expected = new THREE.Vector3();
  const equalVertex = (a, b) => {
    for (const key of ['position', 'normal']) {
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
  for (const [key, values] of Object.entries(original)) assert.deepEqual(source.attributes[key].array, values, 'runtime density never mutates the published source');
  assert.deepEqual(source.attributes.uv.array, sourceUV);
  assert.deepEqual(source.index.array, sourceIndex);
});

test('analytic surface normals follow dense independent finite-difference tangents', () => {
  const epsilon = 1e-4, probes = [];
  for (let row = 1; row < 10; row++) {
    for (let column = 0; column < 16; column++) {
      const direction = new THREE.Vector3().setFromSphericalCoords(1, row * Math.PI / 10, column * Math.PI / 8);
      const tangent = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0)).normalize();
      const bitangent = new THREE.Vector3().crossVectors(direction, tangent).normalize();
      for (const point of [direction, direction.clone().addScaledVector(tangent, epsilon), direction.clone().addScaledVector(tangent, -epsilon),
        direction.clone().addScaledVector(bitangent, epsilon), direction.clone().addScaledVector(bitangent, -epsilon)]) probes.push(...point.toArray());
    }
  }
  for (const settings of [{}, { morphWarp: 0 }, { morphWarp: 1.3, morphFalloff: 1.2, morphDetail: 8 }]) {
    const { positions, normals } = morphOracle(probes, { ...DEFAULT_MODEL_STYLE, ...settings }, .625);
    for (let i = 0; i < probes.length / 3; i += 5) {
      const du = new THREE.Vector3().fromArray(positions, (i + 1) * 3).sub(new THREE.Vector3().fromArray(positions, (i + 2) * 3));
      const dv = new THREE.Vector3().fromArray(positions, (i + 3) * 3).sub(new THREE.Vector3().fromArray(positions, (i + 4) * 3));
      const finiteDifference = new THREE.Vector3().crossVectors(du, dv).normalize();
      assert.ok(new THREE.Vector3().fromArray(normals, i * 3).dot(finiteDifference) > .999, `normal follows deformed tangents at probe ${i / 5}`);
    }
  }
});

test('surface gradients and curvature stay continuous through all noise lattice axes', () => {
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
      centers.push({ start: probes.length / 3, axis });
      for (let step = -3; step <= 3; step++) probes.push(...direction.clone().addScaledVector(tangent, h * step).normalize().toArray());
    }
  }
  const { positions, normals } = morphOracle(probes, { ...DEFAULT_MODEL_STYLE, morphWarp: 0, morphContrast: 1, morphAmplitude: .75 }, 2.3);
  const point = new THREE.Vector3(), activeProbes = [0, 0, 0];
  for (const { start, axis } of centers) {
    const radii = Array.from({ length: 7 }, (_, i) => point.fromArray(positions, (start + i) * 3).length());
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
    const leftNormal = new THREE.Vector3().fromArray(normals, (start + 2) * 3);
    const rightNormal = new THREE.Vector3().fromArray(normals, (start + 4) * 3);
    const centerNormal = new THREE.Vector3().fromArray(normals, (start + 3) * 3);
    assert.ok(centerNormal.dot(leftNormal.add(rightNormal).normalize()) > .99999, `no reflection crease at probe ${start}`);
  }
  for (const [axis, count] of activeProbes.entries()) assert.ok(count >= 3, `non-flat lattice probes exercise axis ${axis}`);
});

test('layers sharing a decoded source own isolated geometry and dispose safely', t => {
  const source = sphere(), original = Object.fromEntries(['position', 'normal', 'color'].map(key => [key, source.attributes[key].array.slice()]));
  const sourceVersions = ['position', 'normal', 'color'].map(key => source.attributes[key].version);
  const first = fixture(t, {}, source, DENSE_TOPOLOGY), second = fixture(t, {}, source, DENSE_TOPOLOGY);
  let sourceDisposals = 0, materialDisposals = 0, ownedDisposals = 0;
  source.addEventListener('dispose', () => sourceDisposals++);
  first.material.addEventListener('dispose', () => materialDisposals++);
  const owned = first.mesh.geometry;
  owned.addEventListener('dispose', () => ownedDisposals++);
  assert.notEqual(first.mesh.geometry, source);
  assert.notEqual(first.mesh.geometry, second.mesh.geometry);
  assert.notEqual(first.controller.surfaceDisplacement.uniforms, second.controller.surfaceDisplacement.uniforms, 'shader state belongs to each controller');
  first.controller.update(.5);
  second.controller.update(2);
  const secondState = uniformState(second.controller.surfaceDisplacement.uniforms), secondRadius = second.mesh.geometry.boundingSphere.radius;
  first.controller.setStyle({ ...DEFAULT_MODEL_STYLE, morphAmplitude: .7 });
  first.controller.update(3);
  assert.ok(first.mesh.geometry.boundingSphere.radius > secondRadius);
  assert.equal(second.mesh.geometry.boundingSphere.radius, secondRadius);
  assert.deepEqual(uniformState(second.controller.surfaceDisplacement.uniforms), secondState);
  for (const [key, values] of Object.entries(original)) assert.deepEqual(source.attributes[key].array, values);
  assert.deepEqual(['position', 'normal', 'color'].map(key => source.attributes[key].version), sourceVersions);
  assert.equal(source.boundingBox, null);
  first.controller.dispose();
  first.controller.dispose();
  assert.equal(first.mesh.geometry, source);
  assert.equal(sourceDisposals, 0);
  assert.equal(materialDisposals, 0);
  assert.equal(ownedDisposals, 1);
  second.controller.update(4);
  assert.notDeepEqual(uniformState(second.controller.surfaceDisplacement.uniforms), secondState);
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

test('CPU raycasts hit the undisplaced input sphere inside the conservative bounds', t => {
  const { mesh, controller } = fixture(t, { morphAmplitude: .75 }, sphere(), DENSE_TOPOLOGY);
  controller.update(.8);
  mesh.updateMatrixWorld(true);
  const direction = new THREE.Vector3(.3, .5, -.8).normalize();
  const hit = new THREE.Raycaster(direction.clone().multiplyScalar(4), direction.clone().negate()).intersectObject(mesh)[0];
  assert.ok(hit, 'real indexed geometry is raycastable');
  assert.ok(hit.point.length() <= 1 + 1e-6 && hit.point.length() > .99);
  assert.ok(mesh.geometry.boundingSphere.radius >= 1.75, 'the GPU shell lies inside the CPU bounds');
});

test('shader descriptors share one stable uniform set and their GLSL entry points', t => {
  const { controller } = fixture(t);
  const displacement = controller.surfaceDisplacement, normals = controller.surfaceNormals;
  assert.equal(controller.surfaceDisplacement, displacement, 'descriptor is stable');
  assert.equal(normals.uniforms, displacement.uniforms, 'vertex and fragment passes read the same field state');
  assert.match(displacement.pars, /vec3 flocDisplace\(vec3 position, inout vec3 normal, inout vec3 color\)/);
  assert.match(normals.pars, /vec3 flocSurfaceNormal\(vec3 localPosition\)/);
  assert.equal(typeof displacement.key, 'string');
});

test('lattices reuse cells between drift crossings, refresh exactly and dispose per controller', t => {
  const first = fixture(t), second = fixture(t);
  first.controller.update(.25);
  const descriptor = first.controller.surfaceNormals;
  const uniforms = descriptor.uniforms, texture = uniforms.flocMorphLattice.value;
  const buffer = texture.image.data, initial = buffer.slice(), version = texture.version;
  assert.equal(first.controller.surfaceNormals, descriptor, 'descriptor is stable');
  assert.notEqual(second.controller.surfaceNormals.uniforms.flocMorphLattice.value, texture, 'textures belong to the controller');
  const origin = Math.round(.25 * .3 - uniforms.flocMorphDrift.value);
  for (let i = 0; i < 64; i++) {
    const x = i % texture.image.width, y = (i * 7) % texture.image.height, z = (i * 13) % texture.image.depth;
    assert.equal(buffer[x + texture.image.width * (y + texture.image.height * z)], Math.fround(morphHash(origin + x, origin + y, origin + z)), 'lattice stores the double-precision CPU hash');
  }
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
  const textures = [texture, uniforms.flocMorphChromaLattice.value], disposals = [0, 0, 0, 0];
  textures.forEach((value, i) => value.addEventListener('dispose', () => disposals[i]++));
  first.controller.setStyle({ ...DEFAULT_MODEL_STYLE, morphWarp: 0 });
  const replacements = [uniforms.flocMorphLattice.value, uniforms.flocMorphChromaLattice.value];
  replacements.forEach((value, i) => value.addEventListener('dispose', () => disposals[i + 2]++));
  assert.notEqual(replacements[0], textures[0], 'field extent changes resize the owned texture');
  assert.notEqual(replacements[1], textures[1], 'the color lattice follows the same extent');
  assert.deepEqual(disposals, [1, 1, 0, 0]);
  first.controller.dispose();
  first.controller.dispose();
  assert.deepEqual(disposals, [1, 1, 1, 1]);
  assert.equal(first.controller.surfaceNormals, null, 'disposed getter cannot allocate a new texture');
  assert.equal(first.controller.surfaceDisplacement, null);
  assert.ok(second.controller.surfaceNormals.uniforms.flocMorphLattice.value.image.data.length > 0);
});
