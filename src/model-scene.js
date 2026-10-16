import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { evaluateChoreography } from './choreography.js';
import { createResourceCache } from './scene-resources.js';
import { normalizeModelStyle, automaticModelMotion, modelMotionReach } from './model-style.js';
import { registerModelMetadata } from './model-metadata.js';
import { createModelMaterials } from './model-materials.js';
import { createModelEnvironment } from './model-environment.js';
import { modelRenderer, modelResolution } from './model-renderer.js';
import { registerModelCanvas } from './model-canvas.js';
import { scenePosition, sceneDimensions, projectedObjectBounds } from './scene-camera.js';
import { SCENE_PASS } from './scene-pass.js';

// Fixed framing is the pre-v11 camera: 38° from 4.5 units, model scaled to two units.
const FIXED_DISTANCE = 4.5, FIXED_HALF_FOV = THREE.MathUtils.degToRad(19);
// Fit framing keeps the motion envelope within this fraction of the view.
const FIT_MARGIN = .97;
const CLIP_SAMPLES = 24;
// Skinned vertices are evaluated on the CPU; larger meshes are sampled evenly.
const SKINNED_SAMPLES = 20000;
// Envelope radius per decoded source and clip (-1: none), shared by its instances.
const reaches = new WeakMap();
const TONE_MAPPINGS = { none: THREE.NoToneMapping, neutral: THREE.NeutralToneMapping, agx: THREE.AgXToneMapping };
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

export async function createModelScene(canvas, layer, { compositionWidth = canvas.width, resources = createResourceCache(), renderMode = false, deferRefraction = false, rendering, onError = () => {} } = {}) {
  let style = normalizeModelStyle(layer.modelStyle);
  const shared = rendering ?? modelRenderer();
  const spatial = layer.space === 'spatial';
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
  camera.position.z = FIXED_DISTANCE;
  const ambient = new THREE.HemisphereLight(0xffffff, 0x444444, 3); scene.add(ambient);
  const rig = new THREE.Group(); scene.add(rig);
  const key = new THREE.DirectionalLight(0xffffff, 3); key.position.set(3, 4, 5); rig.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0); fill.position.set(-4, 2, 2); rig.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0); rim.position.set(2, 3, -4); rig.add(rim);
  scene.add(key.target, fill.target, rim.target);
  // screen › posed › object › normalizer: automatic motion is applied in the view's
  // frame (screen), the model's posed frame (object), or summed into the pose (euler).
  const placementRoot = new THREE.Group(), screen = new THREE.Group(), posed = new THREE.Group(), object = new THREE.Group();
  scene.add(placementRoot); placementRoot.add(screen); screen.add(posed); posed.add(object);
  const motionGroups = [screen, posed, object];
  const environment = createModelEnvironment(shared.renderer, scene);
  const handle = resources.acquire(`model\n${layer.src}`, () => loadModel(layer.src), disposeModel);
  const motion = { phase: 0, advance: 0, stepped: false, rotationX: 0, rotationY: 0, rotationZ: 0, offsetX: 0, offsetY: 0, offsetZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 }, skeletons = new Set();
  const sphere = new THREE.Sphere(), point = new THREE.Vector3(), raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const inversePlacement = new THREE.Matrix4(), inverseCamera = new THREE.Quaternion();
  let mixer, model, source, materials, clips, action, clip, clipIndex, lastTime, lastDraft, drawnBounds, disposed = false, unregister = () => {};
  let width = compositionWidth;
  let sampled, spatialScale = 1, spatialRadius = 1;
  let refractionMask;
  const refractionOutput = { canvas, mask: null };
  const unwatch = shared.watch({
    restored: () => {
      if (disposed) return;
      try {
        environment.invalidate(); environment.update(style);
        if (lastTime !== undefined) {
          draw(lastTime, lastDraft);
          if (style.shader === 'refractive' && refractionMask) renderRefraction();
        }
      }
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
  // Farthest geometry from the pivot in the current clip pose, in normalized units.
  function poseRadius() {
    placementRoot.updateWorldMatrix(true, true);
    inversePlacement.copy(placementRoot.matrixWorld).invert();
    let radius = 0;
    model.traverse(node => {
      if (!node.geometry || !(node.isMesh || node.isLine || node.isPoints)) return;
      if (node.isSkinnedMesh) {
        const count = node.geometry.attributes.position.count, step = Math.ceil(count / SKINNED_SAMPLES);
        for (let i = 0; i < count; i += step) radius = Math.max(radius, node.getVertexPosition(i, point).applyMatrix4(node.matrixWorld).applyMatrix4(inversePlacement).length());
        return;
      }
      if (node.isInstancedMesh) { if (!node.boundingSphere) node.computeBoundingSphere(); sphere.copy(node.boundingSphere); }
      else { if (!node.geometry.boundingSphere) node.geometry.computeBoundingSphere(); sphere.copy(node.geometry.boundingSphere); }
      sphere.applyMatrix4(node.matrixWorld).applyMatrix4(inversePlacement);
      radius = Math.max(radius, sphere.center.length() + sphere.radius);
    });
    return radius;
  }
  // Any authored rotation keeps geometry within this radius of the pivot; an
  // embedded clip is sampled across its duration.
  function envelopeRadius() {
    const key = action ? clipIndex : -1;
    let measured = reaches.get(source);
    if (!measured) reaches.set(source, measured = new Map());
    if (!measured.has(key)) {
      for (const node of motionGroups) { node.rotation.set(0, 0, 0); node.position.set(0, 0, 0); node.scale.set(1, 1, 1); }
      let radius = 0;
      for (let i = 0; i <= (action ? CLIP_SAMPLES : 0); i++) {
        if (action) { action.reset().play(); mixer.setTime(clip.duration * i / CLIP_SAMPLES); }
        screen.updateMatrixWorld(true);
        radius = Math.max(radius, poseRadius());
      }
      measured.set(key, radius || 1);
      if (lastTime !== undefined) pose(lastTime, lastDraft);
    }
    return measured.get(key);
  }
  function frameCamera() {
    const half = THREE.MathUtils.degToRad(style.perspective / 2);
    camera.fov = style.perspective;
    camera.zoom = style.zoom;
    if (style.framing === 'fixed') {
      camera.position.z = FIXED_DISTANCE * (Math.tan(FIXED_HALF_FOV) / Math.tan(half));
      camera.far = 100;
    } else {
      // A sphere of this radius around the pivot contains every rotation, pulse and float.
      const reach = modelMotionReach(style), radius = envelopeRadius() * reach.scale + reach.offset;
      camera.position.z = radius / (Math.sin(half) * FIT_MARGIN);
      camera.far = Math.max(100, camera.position.z + radius * 2);
    }
    camera.updateProjectionMatrix();
    drawnBounds = undefined;
  }
  function applyStyle(next) {
    selectClip(next.animationClip);
    materials.update(next);
    ambient.intensity = next.ambientIntensity;
    key.intensity = next.keyIntensity; fill.intensity = next.fillIntensity; rim.intensity = next.rimIntensity;
    key.color.set(next.keyColor); fill.color.set(next.fillColor); rim.color.set(next.rimColor);
    rig.rotation.y = THREE.MathUtils.degToRad(next.lightRotation);
    if (!shared.lost) environment.update(next);
    style = next;
    frameCamera();
  }
  function resize() {
    const size = modelResolution(layer, width, shared.maxSide);
    if (canvas.width !== size) canvas.width = size;
    if (canvas.height !== size) canvas.height = size;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    unregister();
    unwatch();
    mixer?.stopAllAction();
    if (model) mixer?.uncacheRoot(model);
    materials?.dispose();
    skeletons.forEach(skeleton => skeleton.dispose());
    environment.dispose();
    handle.release();
    if (refractionMask) refractionMask.width = refractionMask.height = 1;
  }
  function pose(time, draft) {
    const elapsed = Math.max(0, time - layer.start);
    if (action) {
      const clock = elapsed * style.animationSpeed + layer.offset;
      const wrapped = clip.duration > 0 ? clock % clip.duration : 0;
      const sample = layer.loop && clip.duration > 0 ? (wrapped < 0 ? wrapped + clip.duration : wrapped) : Math.max(0, Math.min(clock, clip.duration));
      action.reset().play();
      mixer.setTime(sample);
    }
    const state = sampled = evaluateChoreography(layer, time);
    automaticModelMotion(style, elapsed, motion);
    const tilt = THREE.MathUtils.degToRad(draft?.tilt ?? state.tilt), yaw = THREE.MathUtils.degToRad(draft?.yaw ?? state.yaw), roll = THREE.MathUtils.degToRad(draft?.roll ?? state.roll);
    for (const node of motionGroups) { node.rotation.set(0, 0, 0); node.position.set(0, 0, 0); node.scale.set(1, 1, 1); }
    // Only one motion angle is nonzero, so the Euler order of the motion group is irrelevant.
    const target = style.motionSpace === 'screen' ? screen : style.motionSpace === 'object' ? object : posed;
    if (style.motionSpace === 'euler') posed.rotation.set(tilt + motion.rotationX, yaw + motion.rotationY, roll + motion.rotationZ);
    else { posed.rotation.set(tilt, yaw, roll); target.rotation.set(motion.rotationX, motion.rotationY, motion.rotationZ); }
    target.position.set(motion.offsetX, motion.offsetY, motion.offsetZ);
    target.scale.set(motion.scaleX, motion.scaleY, motion.scaleZ);
    drawnBounds = undefined;
  }
  function draw(time, draft) {
    lastTime = time; lastDraft = draft;
    pose(time, draft);
    materials.setScenePass(SCENE_PASS.source);
    if (spatial) return;
    // A composition draws these later, when its lower-layer framebuffer is ready.
    if (deferRefraction && style.shader === 'refractive') return;
    if (shared.lost) {
      if (renderMode) throw new Error('The graphics context was lost while rendering a 3D model.');
      return;
    }
    shared.draw(scene, camera, canvas, TONE_MAPPINGS[style.toneMapping], style.exposure);
  }
  function renderRefraction() {
    try {
      materials.setRefractionMask(true);
      shared.draw(scene, camera, refractionMask, THREE.NoToneMapping, 1);
    } finally { materials.setRefractionMask(false); }
    shared.draw(scene, camera, canvas, TONE_MAPPINGS[style.toneMapping], style.exposure);
  }
  function drawRefraction(backdrop, rect, time, draft, planeMatrix = null) {
    if (style.shader !== 'refractive') throw new Error('Refraction requires a Refractive glass material.');
    lastTime = time; lastDraft = draft; pose(time, draft);
    if (!refractionMask) {
      refractionMask = document.createElement('canvas');
      refractionOutput.mask = refractionMask;
    }
    if (refractionMask.width !== canvas.width) refractionMask.width = canvas.width;
    if (refractionMask.height !== canvas.height) refractionMask.height = canvas.height;
    if (shared.lost) {
      if (renderMode) throw new Error('The graphics context was lost while rendering refractive glass.');
      return refractionOutput;
    }
    materials.setRefraction(backdrop, rect, style.refractionResolution, 1, planeMatrix);
    renderRefraction();
    return refractionOutput;
  }
  function prepareSpatial(format, outputCamera) {
    if (!spatial) return null;
    const value = lastDraft ? { ...sampled, ...lastDraft } : sampled;
    const side = sceneDimensions(format).width * value.size / 100;
    const reach = modelMotionReach(style);
    const radius = envelopeRadius() * reach.scale + reach.offset;
    spatialScale = style.zoom * (style.framing === 'fit' ? side * FIT_MARGIN / (2 * radius) : side / (2 * FIXED_DISTANCE * Math.tan(FIXED_HALF_FOV)));
    spatialRadius = radius * spatialScale;
    placementRoot.scale.setScalar(spatialScale);
    scenePosition(format, value.x, value.y, value.z, placementRoot.position);
    placementRoot.position.x += side / 2; placementRoot.position.y -= side / 2;
    rig.position.copy(placementRoot.position);
    for (const light of [key, fill, rim]) light.target.position.copy(placementRoot.position);
    if (style.motionSpace === 'screen') {
      inverseCamera.copy(outputCamera.quaternion).invert();
      screen.quaternion.premultiply(outputCamera.quaternion).multiply(inverseCamera);
      screen.position.applyQuaternion(outputCamera.quaternion);
    }
    scene.updateMatrixWorld(true);
    return placementRoot;
  }
  function renderSpatial(outputCamera, pass, opacity = 1, id = 0, options = {}) {
    materials.setScenePass(pass, opacity, id, options);
    shared.renderer.toneMapping = TONE_MAPPINGS[style.toneMapping];
    shared.renderer.toneMappingExposure = style.exposure;
    shared.renderer.render(scene, outputCamera);
  }
  // Canvas fractions covered by the drawn pose: projected local bounds of each
  // visible part, or the whole canvas when geometry reaches behind the camera.
  function measureBounds() {
    scene.updateMatrixWorld(); camera.updateMatrixWorld();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, behind = false;
    const add = value => {
      value.project(camera);
      if (!(value.z >= -1 && value.z <= 1)) { behind = true; return; }
      minX = Math.min(minX, value.x); maxX = Math.max(maxX, value.x);
      minY = Math.min(minY, value.y); maxY = Math.max(maxY, value.y);
    };
    model.traverseVisible(node => {
      if (behind || !node.geometry || !(node.isMesh || node.isLine || node.isPoints)) return;
      if (node.isSkinnedMesh) {
        const count = node.geometry.attributes.position.count, step = Math.ceil(count / SKINNED_SAMPLES);
        for (let i = 0; i < count; i += step) add(node.getVertexPosition(i, point).applyMatrix4(node.matrixWorld));
        return;
      }
      let box;
      if (node.isInstancedMesh) { if (!node.boundingBox) node.computeBoundingBox(); box = node.boundingBox; }
      else { if (!node.geometry.boundingBox) node.geometry.computeBoundingBox(); box = node.geometry.boundingBox; }
      if (box.isEmpty()) return;
      for (let i = 0; i < 8; i++) add(point.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(node.matrixWorld));
    });
    if (behind) return { x: 0, y: 0, width: 1, height: 1 };
    const left = Math.max(-1, minX), right = Math.min(1, maxX), bottom = Math.max(-1, minY), top = Math.min(1, maxY);
    if (!(right > left && top > bottom)) return null;
    return { x: (left + 1) / 2, y: (1 - top) / 2, width: (right - left) / 2, height: (top - bottom) / 2 };
  }
  const geometry = {
    bounds: () => lastTime === undefined ? null : drawnBounds === undefined ? (drawnBounds = measureBounds()) : drawnBounds,
    hitTest(u, v) {
      if (lastTime === undefined) return false;
      scene.updateMatrixWorld(); camera.updateMatrixWorld();
      raycaster.setFromCamera(pointer.set(u * 2 - 1, 1 - v * 2), camera);
      return raycaster.intersectObject(model, true).length > 0;
    }
  };
  try {
    source = await handle.value;
    model = clone(source.scene);
    model.traverse(node => { if (node.skeleton) skeletons.add(node.skeleton); });
    materials = createModelMaterials(model, { spatial });
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(extent) || extent <= 0) throw new Error('Model has no visible geometry.');
    const normalizer = new THREE.Group();
    model.position.sub(box.getCenter(new THREE.Vector3()));
    normalizer.add(model); normalizer.scale.setScalar(2 / extent); object.add(normalizer);
    mixer = new THREE.AnimationMixer(model);
    clips = source.animations;
    applyStyle(style);
    resize();
    unregister = registerModelCanvas(canvas, geometry);
    return {
      id: layer.id,
      updateLayer(value) { const next = normalizeModelStyle(value.modelStyle); applyStyle(next); layer = value; resize(); },
      draw,
      drawRefraction,
      prepareSpatial,
      renderSpatial,
      get spatialRoot() { return placementRoot; },
      get spatialRadius() { return spatialRadius; },
      get sourceScene() { return scene; },
      get currentStyle() { return style; },
      setScenePass: (...args) => materials.setScenePass(...args),
      setRefractionMask: value => materials.setRefractionMask(value),
      setBackdrop(texture) { materials.setRefraction(texture, { x: 0, y: 0, width: 1, height: 1 }, style.refractionResolution, spatialScale); },
      projectedBounds(outputCamera) { return projectedObjectBounds(placementRoot, outputCamera); },
      // The composition's current pixel width; the canvas follows the layer's size.
      setCompositionWidth(value) { width = value; resize(); },
      dispose
    };
  } catch (error) { dispose(); throw error; }
}
