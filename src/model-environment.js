import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Reflection environments are generated locally from small scenes; nothing is
// downloaded. Each is prefiltered once per model scene through PMREM.
const SKY_VERTEX = 'varying vec3 direction; void main() { direction = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
function dome(scene, fragment) {
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(12, 64, 32), new THREE.ShaderMaterial({ side: THREE.BackSide, vertexShader: SKY_VERTEX, fragmentShader: fragment })));
}
// An emissive panel facing the model; intensity scales its color beyond 1.
function panel(scene, width, height, intensity, position, color = 0xffffff) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
  mesh.position.set(...position); mesh.lookAt(0, 0, 0); scene.add(mesh);
}
const BUILDERS = {
  // The pre-v13 "Generated studio": three.js RoomEnvironment.
  studio: () => ({ scene: new RoomEnvironment(), sigma: .04 }),
  // Graded gray walls, a large overhead softbox, two strips and a warm fill.
  softbox: () => {
    const scene = new THREE.Scene();
    dome(scene, 'varying vec3 direction; void main() { float h = direction.y * 0.5 + 0.5; gl_FragColor = vec4(mix(vec3(0.035), vec3(0.42), smoothstep(0.15, 0.95, h)), 1.0); }');
    panel(scene, 9, 9, 4, [0, 9, 1]);
    panel(scene, 1.6, 10, 7, [-8, 1, 4]);
    panel(scene, 1.6, 10, 5, [8, 1, -2]);
    panel(scene, 5, 3, 2.2, [3, 2, 9], 0xfff2e2);
    return { scene, sigma: .03 };
  },
  // Small hard softboxes on black: graphic, high-contrast reflections.
  stage: () => {
    const scene = new THREE.Scene();
    dome(scene, 'varying vec3 direction; void main() { gl_FragColor = vec4(vec3(0.012), 1.0); }');
    panel(scene, 6, 4, 9, [-5, 5, 6]);
    panel(scene, 1.2, 9, 6, [8, 1, -3]);
    panel(scene, 1.2, 9, 4, [-8, 1, -4]);
    return { scene, sigma: .02 };
  },
  // Deep blue sky, orange horizon and a low sun.
  sunset: () => {
    const scene = new THREE.Scene();
    dome(scene, `varying vec3 direction; void main() {
      float h = direction.y;
      vec3 top = vec3(0.02, 0.04, 0.12), horizon = vec3(1.6, 0.55, 0.18), ground = vec3(0.05, 0.03, 0.04);
      vec3 color = h > 0.0 ? mix(horizon, top, smoothstep(0.0, 0.55, h)) : mix(horizon * 0.35, ground, smoothstep(0.0, 0.3, -h));
      color += vec3(14.0, 7.0, 3.0) * smoothstep(0.995, 0.999, dot(direction, normalize(vec3(-0.6, 0.12, 0.8))));
      gl_FragColor = vec4(color, 1.0); }`);
    return { scene, sigma: .02 };
  },
  // Magenta and cyan tubes with a white top bar on near black.
  neon: () => {
    const scene = new THREE.Scene();
    dome(scene, 'varying vec3 direction; void main() { gl_FragColor = vec4(0.006, 0.006, 0.012, 1.0); }');
    panel(scene, 1, 10, 8, [-7, 0, 3], 0xff2d9a);
    panel(scene, 1, 10, 8, [7, 0, 3], 0x2dd5ff);
    panel(scene, 8, .6, 6, [0, 6, -4]);
    return { scene, sigma: .02 };
  }
};
export const MODEL_ENVIRONMENTS = Object.freeze(['none', ...Object.keys(BUILDERS)]);

function disposeScene(scene) {
  scene.traverse(node => { node.geometry?.dispose(); node.material?.dispose(); });
  scene.dispose?.();
}

// PMREM is renderer/context-local: never share GPU targets through the source cache.
export function createModelEnvironment(renderer, scene) {
  let target, current;
  function clear() { scene.environment = null; target?.dispose(); target = undefined; current = undefined; }
  return {
    update(style) {
      const id = style.shader === 'toon' || style.shader === 'wireframe' ? 'none' : style.environment;
      if (id !== current) {
        clear();
        if (id !== 'none') {
          const { scene: source, sigma } = BUILDERS[id]();
          let generator;
          const previousTarget = renderer.getRenderTarget();
          try {
            generator = new THREE.PMREMGenerator(renderer);
            target = generator.fromScene(source, sigma);
          } catch (error) {
            // fromScene may fail while its output target is still bound.
            const failedTarget = renderer.getRenderTarget();
            if (failedTarget && failedTarget !== previousTarget) failedTarget.dispose();
            throw error;
          } finally { renderer.setRenderTarget(previousTarget); disposeScene(source); generator?.dispose(); }
          current = id;
        }
      }
      scene.environment = target?.texture ?? null;
      scene.environmentIntensity = style.environmentIntensity;
      scene.environmentRotation.set(0, THREE.MathUtils.degToRad(style.environmentRotation), 0);
    },
    invalidate: clear,
    dispose: clear
  };
}
