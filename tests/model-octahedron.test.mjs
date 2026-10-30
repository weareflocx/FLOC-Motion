import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMagicalOctahedron } from '../src/model-octahedron.js';
import { createModelMaterials } from '../src/model-materials.js';
import { DEFAULT_MODEL_STYLE } from '../src/model-style.js';

function fixture() {
  const source = new THREE.OctahedronGeometry(2.06, 0).scale(1, 1.16, 1);
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff' });
  const mesh = new THREE.Mesh(source, material), model = new THREE.Group();
  model.add(mesh);
  const controller = createMagicalOctahedron(model);
  return { source, material, mesh, model, controller, dispose() { controller.dispose(); source.dispose(); material.dispose(); } };
}

function close(a, b, message) { assert.ok(Math.abs(a - b) < 1e-6, message ?? `${a} differs from ${b}`); }

test('eight sharp octahedral faces follow actual radius/height and analytic bounds', () => {
  const value = fixture();
  value.controller.setStyle({ ...DEFAULT_MODEL_STYLE, octaRadius: 1.7, octaHeight: 2.1 });
  const geometry = value.mesh.geometry;
  try {
    assert.equal(geometry.index, null);
    assert.equal(geometry.attributes.position.count, 24);
    const positions = geometry.attributes.position, normals = geometry.attributes.normal;
    for (let i = 0; i < positions.count; i++) {
      close(Math.abs(positions.getX(i)) + Math.abs(positions.getY(i)) / 2.1 + Math.abs(positions.getZ(i)), 1.7);
      close(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)), 1);
      const face = i - i % 3;
      for (let axis = 0; axis < 3; axis++) close(normals.array[i * 3 + axis], normals.array[face * 3 + axis]);
      close(Math.abs(normals.getY(i) / normals.getX(i)), 1 / 2.1);
    }
    close(geometry.boundingSphere.radius, 3.57);
    close(geometry.boundingBox.max.y, 3.57);
    close(geometry.boundingBox.min.x, -1.7);
  } finally { value.dispose(); }
});

test('live shape changes update CPU rays and reuse owned buffers without touching source or neighbors', () => {
  const a = fixture(), b = fixture();
  try {
    const owned = a.mesh.geometry, position = owned.attributes.position, normal = owned.attributes.normal;
    const source = Array.from(a.source.attributes.position.array), neighbor = Array.from(b.mesh.geometry.attributes.position.array);
    const ray = new THREE.Raycaster(new THREE.Vector3(.8, 0, 5), new THREE.Vector3(0, 0, -1));
    a.controller.setStyle({ ...DEFAULT_MODEL_STYLE, octaRadius: .5, octaHeight: .3, octaRotation: 0 });
    a.model.updateMatrixWorld(true);
    assert.equal(ray.intersectObject(a.model, true).length, 0);
    a.controller.setStyle({ ...DEFAULT_MODEL_STYLE, octaRadius: 3, octaHeight: 2.5, octaRotation: 0 });
    a.model.updateMatrixWorld(true);
    assert.ok(ray.intersectObject(a.model, true).length > 0);
    assert.equal(a.mesh.geometry, owned);
    assert.equal(owned.attributes.position, position);
    assert.equal(owned.attributes.normal, normal);
    close(a.controller.radius, 7.5);
    assert.deepEqual(Array.from(a.source.attributes.position.array), source);
    assert.deepEqual(Array.from(b.mesh.geometry.attributes.position.array), neighbor);
    assert.notEqual(a.mesh.geometry, b.mesh.geometry);
  } finally { a.dispose(); b.dispose(); }
});

test('absolute procedural clock rotates actual pickable geometry, freezes, reverses and seeks', () => {
  const value = fixture();
  try {
    const { controller, mesh } = value;
    controller.setStyle({ ...DEFAULT_MODEL_STYLE, octaRotation: .4, octaSpeed: 2 });
    controller.update(1.25);
    const pose = mesh.quaternion.clone();
    close(mesh.rotation.y, -1);
    controller.update(8);
    controller.update(1.25);
    assert.ok(mesh.quaternion.equals(pose));
    controller.setStyle({ ...DEFAULT_MODEL_STYLE, octaRotation: .4, octaSpeed: -2 });
    controller.update(1.25);
    close(mesh.rotation.y, 1);
    controller.setStyle({ ...DEFAULT_MODEL_STYLE, octaRotation: .4, octaSpeed: 0 });
    controller.update(2);
    const frozen = mesh.quaternion.clone();
    controller.update(10);
    assert.ok(mesh.quaternion.equals(frozen));
    controller.update(-10);
    assert.ok(mesh.quaternion.equals(frozen));
    assert.throws(() => controller.update(NaN), /finite/);
    assert.throws(() => controller.update(Infinity), /finite/);
  } finally { value.dispose(); }
});

test('volume and ordinary surfaces remain instance-owned and material manager disposes variants', () => {
  const a = fixture(), b = fixture();
  const materials = createModelMaterials(a.model, { originalSurface: a.controller.originalSurface });
  const neighborMaterials = createModelMaterials(b.model, { originalSurface: b.controller.originalSurface });
  const disposed = new Set(), generated = new Set();
  function capture() {
    const material = a.mesh.material;
    if (!generated.has(material)) material.addEventListener('dispose', () => disposed.add(material));
    generated.add(material);
    return material;
  }
  try {
    const imported = { ...DEFAULT_MODEL_STYLE, base: 'imported', look: 'physical', glass: 'none' };
    materials.update(imported); neighborMaterials.update(imported);
    const volume = capture();
    assert.ok(volume.isShaderMaterial);
    assert.notEqual(volume, b.mesh.material);
    assert.notEqual(volume.uniforms.uEvolutionTime, b.mesh.material.uniforms.uEvolutionTime);
    for (const patch of [{ base: 'custom' }, { look: 'toon' }, { glass: 'see-through' }, { glass: 'environment' }]) {
      materials.update({ ...imported, ...patch });
      const surface = capture();
      assert.ok(!surface.isShaderMaterial, JSON.stringify(patch));
    }
    materials.update(imported);
    assert.equal(a.mesh.material, volume);
    materials.dispose();
    assert.equal(disposed.size, generated.size);
  } finally { neighborMaterials.dispose(); a.dispose(); b.dispose(); }
});

test('disposal restores cache-owned geometry, authored pose and callback exactly once', () => {
  const source = new THREE.OctahedronGeometry(1), mesh = new THREE.Mesh(source, new THREE.MeshBasicMaterial());
  mesh.rotation.set(.1, .2, .3);
  const pose = mesh.quaternion.clone(), callback = mesh.onBeforeRender;
  const controller = createMagicalOctahedron(mesh), owned = mesh.geometry;
  let disposed = 0; owned.addEventListener('dispose', () => disposed++);
  controller.update(7);
  controller.dispose(); controller.dispose();
  assert.equal(mesh.geometry, source);
  assert.ok(mesh.quaternion.equals(pose));
  assert.equal(mesh.onBeforeRender, callback);
  assert.equal(disposed, 1);
  source.dispose(); mesh.material.dispose();
});
