import * as THREE from 'three';
import { DEFAULT_MODEL_STYLE } from './model-style.js';
import { createMorphSurface } from './model-morph-normals.js';

// Mesh adaptation of Sabo Sugi's Abnormal Sphere Morphing:
// https://codepen.io/sabosugi/pen/vEyOYEX
// The vertex shader displaces the unit-sphere directions, so every render pass shares
// one shape; CPU geometry keeps those directions with whole-animation bounds.

const PALETTE_KEYS = ['morphColor1', 'morphColor2', 'morphColor3', 'morphColor4'];

function ownGeometry(source, widthSegments, heightSegments) {
  const geometry = widthSegments !== undefined || heightSegments !== undefined
    ? new THREE.SphereGeometry(1, widthSegments, heightSegments)
    : source.clone();
  const original = geometry.getAttribute('position');
  const count = original.count, directions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // SphereGeometry duplicates the UV seam and poles with trigonometric residue.
    // Canonical directions give those vertices exactly the same displaced surface.
    const x = Math.abs(original.getX(i)) < 1e-12 ? 0 : original.getX(i);
    const y = Math.abs(original.getY(i)) < 1e-12 ? 0 : original.getY(i);
    const z = Math.abs(original.getZ(i)) < 1e-12 ? 0 : original.getZ(i);
    const length = Math.hypot(x, y, z);
    if (!Number.isFinite(length) || length === 0) throw new Error('Morphing sphere requires finite, nonzero sphere vertices.');
    directions[i * 3] = x / length;
    directions[i * 3 + 1] = y / length;
    directions[i * 3 + 2] = z / length;
  }
  // Dedicated float attributes also handle decoded interleaved/normalized inputs.
  geometry.setAttribute('position', new THREE.BufferAttribute(directions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(directions.slice(), 3));
  geometry.deleteAttribute('color');
  geometry.boundingBox = new THREE.Box3();
  geometry.boundingSphere = new THREE.Sphere();
  return geometry;
}

// Caller selects the canonical sculpture source and supplies normalized modelStyle.
// Geometry ownership is per controller, never per cached GLTF or shared material.
// Explicit segments replace only runtime topology; omitted options retain source probes.
export function createMorphingSphere(model, { widthSegments, heightSegments } = {}) {
  const geometries = [], bindings = [], bySource = new Map();
  model.traverse(mesh => {
    if (!mesh.isMesh) return;
    const source = mesh.geometry;
    let geometry = bySource.get(source);
    if (!geometry) {
      geometry = ownGeometry(source, widthSegments, heightSegments);
      bySource.set(source, geometry);
      geometries.push(geometry);
    }
    bindings.push({ mesh, source, owned: geometry });
    mesh.geometry = geometry;
  });
  const style = {}, palette = PALETTE_KEYS.map(() => new THREE.Color());
  let surface = null, elapsedTime = 0, disposed = false;
  const surfaceState = () => {
    if (disposed) return null;
    surface ??= createMorphSurface(style, elapsedTime * style.morphSpeed, palette);
    return surface;
  };
  function setStyle(input = DEFAULT_MODEL_STYLE) {
    if (disposed) return;
    for (const key of ['morphWarp', 'morphFrequency', 'morphFalloff', 'morphDetail', 'morphContrast', 'morphSpeed', 'base']) style[key] = input[key] ?? DEFAULT_MODEL_STYLE[key];
    for (let i = 0; i < PALETTE_KEYS.length; i++) {
      const key = PALETTE_KEYS[i], value = input[key] ?? DEFAULT_MODEL_STYLE[key];
      if (style[key] !== value) palette[i].set(style[key] = value);
    }
    const amplitude = input.morphAmplitude ?? DEFAULT_MODEL_STYLE.morphAmplitude;
    if (style.morphAmplitude !== amplitude) {
      // Height is a smoothstep in [0, 1]; the margin covers float32 normalization.
      const radius = (1 + amplitude) * (1 + 1e-6);
      for (const geometry of geometries) {
        geometry.boundingBox.min.setScalar(-radius);
        geometry.boundingBox.max.setScalar(radius);
        geometry.boundingSphere.radius = radius;
      }
    }
    style.morphAmplitude = amplitude;
    surface?.update(style, elapsedTime * style.morphSpeed);
  }
  setStyle();
  return {
    setStyle,
    get radius() { return 1 + style.morphAmplitude; },
    get surfaceNormals() { return surfaceState()?.normals ?? null; },
    get surfaceDisplacement() { return surfaceState()?.displacement ?? null; },
    update(elapsed) {
      if (disposed) return;
      const time = Math.max(0, elapsed) * style.morphSpeed;
      if (!Number.isFinite(elapsed) || !Number.isFinite(time)) throw new RangeError('Morphing sphere time must be finite.');
      elapsedTime = Math.max(0, elapsed);
      surface?.update(style, time);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      surface?.dispose();
      for (const { mesh, source, owned } of bindings) if (mesh.geometry === owned) mesh.geometry = source;
      for (const geometry of geometries) geometry.dispose();
    }
  };
}
