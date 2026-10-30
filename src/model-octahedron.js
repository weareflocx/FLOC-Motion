import * as THREE from 'three';
import { DEFAULT_MODEL_STYLE } from './model-style.js';
import { OCTAHEDRON_VERTEX, OCTAHEDRON_FRAGMENT } from './model-octahedron-shader.js';

const UNIFORM_KEYS = {
  octaRadius: 'uOctahedronRadius', octaHeight: 'uOctahedronHeight',
  octaScale: 'uDomainScale', octaPath: 'uPathScale', octaDensity: 'uGlowDensity',
  octaOpacity: 'uVolumeOpacity', octaOrb: 'uOrbBoost', octaEdge: 'uEdgeGlow',
  octaBackEdge: 'uBackEdgeGlow', octaSteps: 'uVolumeSteps'
};
const COLOR_KEYS = { octaTint: 'uFractalTint', octaFrontColor: 'uFrontEdgeColor', octaBackColor: 'uBackEdgeColor' };
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function reshape(geometry, unitPositions, radius, height) {
  const position = geometry.attributes.position, values = position.array;
  for (let i = 0; i < values.length; i += 3) {
    values[i] = unitPositions[i] * radius;
    values[i + 1] = unitPositions[i + 1] * radius * height;
    values[i + 2] = unitPositions[i + 2] * radius;
  }
  position.needsUpdate = true;
  // Nonindexed triangles have separate vertices: these are sharp face normals,
  // including the correct inverse-height normal on the stretched octahedron.
  geometry.computeVertexNormals();
  geometry.boundingBox.min.set(-radius, -radius * height, -radius);
  geometry.boundingBox.max.set(radius, radius * height, radius);
  geometry.boundingSphere.radius = Math.max(radius, radius * height);
}

// One owned eight-face mesh per instance, in the original shader's source units.
// Published GLB geometry/materials remain cache-owned and are restored on disposal.
export function createMagicalOctahedron(model) {
  const geometry = new THREE.OctahedronGeometry(1, 0);
  const unitPositions = geometry.attributes.position.array.slice();
  geometry.boundingBox = new THREE.Box3();
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  const uniforms = {
    uCameraToLocal: { value: new THREE.Matrix4() }, uOrthographic: { value: false },
    uEvolutionTime: { value: 0 }, uColorTime: { value: 0 }
  };
  for (const name of Object.values(UNIFORM_KEYS)) uniforms[name] = { value: 0 };
  for (const name of Object.values(COLOR_KEYS)) uniforms[name] = { value: new THREE.Color() };
  const bindings = [], inverseWorld = new THREE.Matrix4(), rotation = new THREE.Quaternion();
  let style, elapsed = 0, disposed = false;
  const originalSurface = {
    createMaterial() {
      return new THREE.ShaderMaterial({
        name: 'Magical Octahedron volume',
        uniforms: { ...uniforms, uBaseTint: { value: new THREE.Color(1, 1, 1) } },
        vertexShader: OCTAHEDRON_VERTEX, fragmentShader: OCTAHEDRON_FRAGMENT,
        toneMapped: false, transparent: false, depthWrite: true
      });
    },
    updateMaterial(material, next) {
      // The reference's hexToRawColor deliberately does not decode sRGB.
      material.uniforms.uBaseTint.value.setStyle(next.base === 'tinted' ? next.color : '#ffffff', THREE.LinearSRGBColorSpace);
    }
  };
  model.traverse(mesh => {
    if (!mesh.isMesh) return;
    const binding = { mesh, source: mesh.geometry, rotation: mesh.quaternion.clone(), onBeforeRender: mesh.onBeforeRender };
    bindings.push(binding);
    mesh.geometry = geometry;
    mesh.onBeforeRender = function(renderer, scene, camera, renderedGeometry, material, group) {
      binding.onBeforeRender?.call(this, renderer, scene, camera, renderedGeometry, material, group);
      if (!material.isShaderMaterial || !material.uniforms.uCameraToLocal) return;
      inverseWorld.copy(this.matrixWorld).invert();
      uniforms.uCameraToLocal.value.multiplyMatrices(inverseWorld, camera.matrixWorld);
      uniforms.uOrthographic.value = !!camera.isOrthographicCamera;
      // A material may be shared by several authored meshes. Upload the actual
      // output camera/object matrix for every draw, not only on material changes.
      material.uniformsNeedUpdate = true;
    };
  });
  function update(time) {
    if (disposed) return;
    if (!Number.isFinite(time)) throw new RangeError('Magical Octahedron time must be finite.');
    elapsed = Math.max(0, time);
    const clock = elapsed * style.octaSpeed;
    uniforms.uEvolutionTime.value = clock * style.octaEvolution;
    uniforms.uColorTime.value = clock * style.octaColorSpeed;
    // Reference row-vector ray rotation(-yaw) is the inverse of this actual
    // geometry rotation. Picking/depth therefore see exactly the rendered pose.
    rotation.setFromAxisAngle(Y_AXIS, -clock * style.octaRotation);
    for (const binding of bindings) binding.mesh.quaternion.copy(binding.rotation).multiply(rotation);
  }
  function setStyle(next) {
    if (disposed) return;
    const previous = style;
    style = { ...DEFAULT_MODEL_STYLE, ...next };
    if (!previous || previous.octaRadius !== style.octaRadius || previous.octaHeight !== style.octaHeight) {
      reshape(geometry, unitPositions, style.octaRadius, style.octaHeight);
    }
    for (const [key, name] of Object.entries(UNIFORM_KEYS)) uniforms[name].value = style[key];
    for (const [key, name] of Object.entries(COLOR_KEYS)) uniforms[name].value.setStyle(style[key], THREE.LinearSRGBColorSpace);
    update(elapsed);
  }
  setStyle(DEFAULT_MODEL_STYLE);
  return {
    setStyle, update, originalSurface,
    get radius() { return geometry.boundingSphere.radius; },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const binding of bindings) {
        if (binding.mesh.geometry === geometry) binding.mesh.geometry = binding.source;
        binding.mesh.quaternion.copy(binding.rotation);
        binding.mesh.onBeforeRender = binding.onBeforeRender;
      }
      geometry.dispose();
    }
  };
}
