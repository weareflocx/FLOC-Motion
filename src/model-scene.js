import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function createModelScene(canvas, layer, width, height) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
  camera.position.z = 4.5;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 3));
  const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(3, 4, 5); scene.add(light);
  const group = new THREE.Group(); scene.add(group);
  let model, mixer;
  function dispose() {
    mixer?.stopAllAction();
    const textures = new Set();
    model?.traverse(node => {
      node.geometry?.dispose();
      for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) {
        Object.values(material).forEach(value => { if (value?.isTexture) textures.add(value); });
        material.dispose();
      }
    });
    textures.forEach(texture => texture.dispose());
    renderer.dispose(); renderer.forceContextLoss();
  }
  try {
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(url => {
      if (url === layer.src || /^(data:|blob:)/i.test(url)) return url;
      throw new Error('3D models must contain all textures and geometry in one GLB file.');
    });
    const gltf = await new GLTFLoader(manager).loadAsync(layer.src);
    model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(extent) || extent <= 0) throw new Error('Model has no visible geometry.');
    const normalizer = new THREE.Group();
    model.position.sub(box.getCenter(new THREE.Vector3()));
    normalizer.add(model); normalizer.scale.setScalar(2 / extent); group.add(normalizer);
    mixer = new THREE.AnimationMixer(model);
    const clip = gltf.animations[0];
    const action = clip ? mixer.clipAction(clip) : null;
    if (action) { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
    return {
      id: layer.id,
      updateLayer(value) { layer = value; },
      draw(time) {
        if (action) {
          const elapsed = Math.max(0, time - layer.start) + layer.offset;
          const sample = layer.loop && clip.duration > 0 ? elapsed % clip.duration : Math.min(elapsed, clip.duration);
          action.reset().play();
          mixer.setTime(sample);
        }
        group.rotation.set(...[layer.tilt, layer.yaw, layer.roll].map(THREE.MathUtils.degToRad));
        renderer.render(scene, camera);
      },
      setResolution(w, h) { renderer.setSize(w, h, false); }, dispose
    };
  } catch (error) { dispose(); throw error; }
}
