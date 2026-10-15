import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { evaluateChoreography } from './choreography.js';
import { createResourceCache, watchContextLoss } from './scene-resources.js';
import { normalizeModelStyle, automaticModelMotion } from './model-style.js';
import { registerModelMetadata } from './model-metadata.js';
import { createModelMaterials } from './model-materials.js';
import { createModelEnvironment } from './model-environment.js';

async function loadModel(src) {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => {
    if (url === src || /^(data:|blob:)/i.test(url)) return url;
    throw new Error('3D models must contain all textures and geometry in one GLB file.');
  });
  const gltf = await new GLTFLoader(manager).loadAsync(src);
  let unlit = false;
  gltf.scene.traverse(node => {
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) unlit ||= !!material.isMeshBasicMaterial;
  });
  gltf.releaseMetadata = registerModelMetadata(src, {
    clips: gltf.animations.map((clip, index) => ({ index, name: clip.name, duration: clip.duration })), unlit
  });
  return gltf;
}
// Cache owns decoded source resources; instances own only cloned materials/skeletons.
function disposeModel(gltf) {
  gltf.releaseMetadata?.();
  const textures = new Set(), geometries = new Set(), materials = new Set(), skeletons = new Set();
  gltf.scene.traverse(node => {
    if (node.geometry) geometries.add(node.geometry);
    if (node.skeleton) skeletons.add(node.skeleton);
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) {
      Object.values(material).forEach(value => { if (value?.isTexture) textures.add(value); });
      materials.add(material);
    }
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  skeletons.forEach(skeleton => skeleton.dispose());
  textures.forEach(texture => texture.dispose());
}

export async function createModelScene(canvas, layer, width, height, { resources = createResourceCache(), renderMode = false, onError = () => {} } = {}) {
  let style = normalizeModelStyle(layer.modelStyle);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: renderMode });
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
  camera.position.z = 4.5;
  const ambient = new THREE.HemisphereLight(0xffffff, 0x444444, 3); scene.add(ambient);
  const rig = new THREE.Group(); scene.add(rig);
  const key = new THREE.DirectionalLight(0xffffff, 3); key.position.set(3, 4, 5); rig.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0); fill.position.set(-4, 2, 2); rig.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0); rim.position.set(2, 3, -4); rig.add(rim);
  const group = new THREE.Group(); scene.add(group);
  const environment = createModelEnvironment(renderer, scene);
  const handle = resources.acquire(`model\n${layer.src}`, () => loadModel(layer.src), disposeModel);
  const motion = { phase: 0, advance: 0, stepped: false, rotationX: 0, rotationY: 0, rotationZ: 0, offsetX: 0, offsetY: 0, offsetZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 }, skeletons = new Set();
  let mixer, model, materials, clips, action, clip, clipIndex, lastTime, lastDraft, disposed = false;
  const context = watchContextLoss(canvas, {
    restored: () => {
      if (disposed) return;
      try { environment.invalidate(); environment.update(style); if (lastTime !== undefined) draw(lastTime, lastDraft); }
      catch (error) { onError(error); }
    },
    failed: () => { if (!disposed) onError(new Error(`${layer.name} lost its graphics context. Reload the editor to show it again.`)); }
  });
  function selectClip(index) {
    if (index >= clips.length && !(index === 0 && clips.length === 0)) throw new Error(`3D model animation clip ${index} does not exist.`);
    if (clipIndex === index) return;
    mixer.stopAllAction();
    clipIndex = index;
    clip = index < 0 ? null : clips[index];
    action = clip ? mixer.clipAction(clip) : null;
    if (action) { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
  }
  function applyStyle(next) {
    selectClip(next.animationClip);
    materials.update(next);
    ambient.intensity = next.ambientIntensity;
    key.intensity = next.keyIntensity; fill.intensity = next.fillIntensity; rim.intensity = next.rimIntensity;
    rig.rotation.y = THREE.MathUtils.degToRad(next.lightRotation);
    if (!context.lost) environment.update(next);
    style = next;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    mixer?.stopAllAction();
    if (model) mixer?.uncacheRoot(model);
    context.dispose();
    materials?.dispose();
    skeletons.forEach(skeleton => skeleton.dispose());
    environment.dispose();
    handle.release();
    renderer.dispose(); renderer.forceContextLoss();
  }
  function draw(time, draft) {
    lastTime = time; lastDraft = draft;
    if (context.lost) {
      if (renderMode) throw new Error('The graphics context was lost while rendering a 3D model.');
      return;
    }
    const elapsed = Math.max(0, time - layer.start);
    if (action) {
      const clock = elapsed * style.animationSpeed + layer.offset;
      const wrapped = clip.duration > 0 ? clock % clip.duration : 0;
      const sample = layer.loop && clip.duration > 0 ? (wrapped < 0 ? wrapped + clip.duration : wrapped) : Math.max(0, Math.min(clock, clip.duration));
      action.reset().play();
      mixer.setTime(sample);
    }
    const state = evaluateChoreography(layer, time);
    automaticModelMotion(style, elapsed, motion);
    group.rotation.set(
      THREE.MathUtils.degToRad(draft?.tilt ?? state.tilt) + motion.rotationX,
      THREE.MathUtils.degToRad(draft?.yaw ?? state.yaw) + motion.rotationY,
      THREE.MathUtils.degToRad(draft?.roll ?? state.roll) + motion.rotationZ
    );
    group.position.set(motion.offsetX, motion.offsetY, motion.offsetZ);
    group.scale.set(motion.scaleX, motion.scaleY, motion.scaleZ);
    renderer.render(scene, camera);
  }
  try {
    const gltf = await handle.value;
    model = clone(gltf.scene);
    model.traverse(node => { if (node.skeleton) skeletons.add(node.skeleton); });
    materials = createModelMaterials(model);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(extent) || extent <= 0) throw new Error('Model has no visible geometry.');
    const normalizer = new THREE.Group();
    model.position.sub(box.getCenter(new THREE.Vector3()));
    normalizer.add(model); normalizer.scale.setScalar(2 / extent); group.add(normalizer);
    mixer = new THREE.AnimationMixer(model);
    clips = gltf.animations;
    applyStyle(style);
    return {
      id: layer.id,
      updateLayer(value) { const next = normalizeModelStyle(value.modelStyle); applyStyle(next); layer = value; },
      draw,
      setResolution(w, h) { renderer.setSize(w, h, false); }, dispose
    };
  } catch (error) { dispose(); throw error; }
}
