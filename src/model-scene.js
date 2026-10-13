import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { evaluateChoreography } from './choreography.js';
import { createResourceCache, watchContextLoss } from './scene-resources.js';

async function loadModel(src) {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => {
    if (url === src || /^(data:|blob:)/i.test(url)) return url;
    throw new Error('3D models must contain all textures and geometry in one GLB file.');
  });
  return new GLTFLoader(manager).loadAsync(src);
}
// Scenes render clones that share the cached geometry, materials and textures.
function disposeModel(gltf) {
  const textures = new Set();
  gltf.scene.traverse(node => {
    node.geometry?.dispose();
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) {
      Object.values(material).forEach(value => { if (value?.isTexture) textures.add(value); });
      material.dispose();
    }
  });
  textures.forEach(texture => texture.dispose());
}

export async function createModelScene(canvas, layer, width, height, { resources = createResourceCache(), renderMode = false, onError = () => {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: renderMode });
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
  camera.position.z = 4.5;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 3));
  const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(3, 4, 5); scene.add(light);
  const group = new THREE.Group(); scene.add(group);
  const handle = resources.acquire(`model\n${layer.src}`, () => loadModel(layer.src), disposeModel);
  let mixer, last, disposed = false;
  const context = watchContextLoss(canvas, {
    restored: () => { if (!disposed && last) draw(...last); },
    failed: () => { if (!disposed) onError(new Error(`${layer.name} lost its graphics context. Reload the editor to show it again.`)); }
  });
  function dispose() {
    if (disposed) return;
    disposed = true;
    mixer?.stopAllAction();
    context.dispose();
    handle.release();
    renderer.dispose(); renderer.forceContextLoss();
  }
  let action, clip;
  function draw(time, draft) {
    last = [time, draft];
    if (context.lost && renderMode) throw new Error('The graphics context was lost while rendering a 3D model.');
    if (action) {
      const elapsed = Math.max(0, time - layer.start) + layer.offset;
      const sample = layer.loop && clip.duration > 0 ? elapsed % clip.duration : Math.min(elapsed, clip.duration);
      action.reset().play();
      mixer.setTime(sample);
    }
    const state = { ...evaluateChoreography(layer, time), ...draft };
    group.rotation.set(...[state.tilt, state.yaw, state.roll].map(THREE.MathUtils.degToRad));
    renderer.render(scene, camera);
  }
  try {
    const gltf = await handle.value;
    const model = clone(gltf.scene);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(extent) || extent <= 0) throw new Error('Model has no visible geometry.');
    const normalizer = new THREE.Group();
    model.position.sub(box.getCenter(new THREE.Vector3()));
    normalizer.add(model); normalizer.scale.setScalar(2 / extent); group.add(normalizer);
    mixer = new THREE.AnimationMixer(model);
    clip = gltf.animations[0];
    action = clip ? mixer.clipAction(clip) : null;
    if (action) { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
    return {
      id: layer.id,
      updateLayer(value) { layer = value; },
      draw,
      setResolution(w, h) { renderer.setSize(w, h, false); }, dispose
    };
  } catch (error) { dispose(); throw error; }
}
