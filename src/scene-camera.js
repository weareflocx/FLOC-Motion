import * as THREE from 'three';
import { FORMATS } from './project.js';
import { normalizeScene } from './scene-settings.js';

// The former 38-degree carousel's Z=0 frame, now one common world-space scale.
export const SCENE_VIEW_HEIGHT = 2 * Math.tan(19 * Math.PI / 180) * 8;
const radians = value => value * Math.PI / 180;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function sceneDimensions(format) {
  const [width, height] = FORMATS[format];
  return { width: SCENE_VIEW_HEIGHT * width / height, height: SCENE_VIEW_HEIGHT };
}

export function scenePosition(format, x, y, z = 0, target = new THREE.Vector3()) {
  const size = sceneDimensions(format);
  return target.set((x / 100 - .5) * size.width, (.5 - y / 100) * size.height, z / 100 * size.height);
}

function cameraPair() {
  return {
    orthographic: new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 1000),
    perspective: new THREE.PerspectiveCamera(38, 1, .01, 1000)
  };
}

// Output settings are canonical project data: preview and export share this one camera.
export function createSceneCameras(project) {
  const pair = cameraPair();
  const target = new THREE.Vector3(), raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1));
  const intersection = new THREE.Vector3();
  let current = project, settings, output;
  function configure() {
    const frame = sceneDimensions(current.format), camera = pair[settings.projection];
    const yaw = radians(settings.yaw);
    const pitch = radians(clamp(settings.pitch, -89, 89));
    const distance = settings.projection === 'perspective' ? frame.height / (2 * Math.tan(radians(settings.perspective / 2))) : 8;
    scenePosition(current.format, settings.targetX, settings.targetY, settings.targetZ, target);
    camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * distance,
      target.y + Math.sin(pitch) * distance, target.z + Math.cos(yaw) * Math.cos(pitch) * distance);
    camera.up.set(0, 1, 0); camera.lookAt(target); camera.rotateZ(radians(settings.roll));
    camera.zoom = settings.zoom;
    if (camera.isOrthographicCamera) {
      camera.left = -frame.width / 2; camera.right = frame.width / 2;
      camera.top = frame.height / 2; camera.bottom = -frame.height / 2;
    } else { camera.fov = settings.perspective; camera.aspect = frame.width / frame.height; }
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    return camera;
  }
  function update(value) { current = value; settings = normalizeScene(value.scene).camera; output = configure(); }
  update(project);
  return {
    get output() { return output; },
    update,
    pointerOnPlane(u, v, depth = 0) {
      pointer.set(u * 2 - 1, 1 - v * 2); raycaster.setFromCamera(pointer, output);
      plane.constant = -depth / 100 * SCENE_VIEW_HEIGHT;
      if (Math.abs(raycaster.ray.direction.z) < 1e-6 || !raycaster.ray.intersectPlane(plane, intersection)) return null;
      const size = sceneDimensions(current.format);
      return { x: (intersection.x / size.width + .5) * 100, y: (.5 - intersection.y / size.height) * 100, z: depth };
    }
  };
}

// Axis-aligned projected bounds are editor chrome, not the picking primitive.
// Picking uses the actual rendered coverage/depth; near-plane crossings get a
// conservative viewport bound rather than an unbounded selection rectangle.
export function projectedObjectBounds(object, camera, { padding = 0 } = {}) {
  object.updateWorldMatrix(true, true); camera.updateMatrixWorld(true);
  const matrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(matrix);
  const point = new THREE.Vector3(), clip = new THREE.Vector4(), box = new THREE.Box3();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, crossed = false;
  const add = (x, y, z, world) => {
    point.set(x, y, z).applyMatrix4(world);
    clip.set(point.x, point.y, point.z, 1).applyMatrix4(matrix);
    if (clip.w <= 0 || clip.z < -clip.w) { crossed = true; return; }
    const px = clip.x / clip.w, py = clip.y / clip.w;
    minX = Math.min(minX, px); maxX = Math.max(maxX, px);
    minY = Math.min(minY, py); maxY = Math.max(maxY, py);
  };
  object.traverseVisible(node => {
    if (!node.geometry) return;
    if (node.isSkinnedMesh) {
      const count = node.geometry.attributes.position.count, step = Math.ceil(count / 20000);
      for (let i = 0; i < count; i += step) { node.getVertexPosition(i, point); add(point.x, point.y, point.z, node.matrixWorld); }
      return;
    }
    if (node.isInstancedMesh) { if (!node.boundingBox) node.computeBoundingBox(); box.copy(node.boundingBox); }
    else { if (!node.geometry.boundingBox) node.geometry.computeBoundingBox(); box.copy(node.geometry.boundingBox); }
    if (box.isEmpty()) return;
    if (padding) box.expandByScalar(padding);
    const worldBox = box.clone().applyMatrix4(node.matrixWorld);
    if (!frustum.intersectsBox(worldBox)) return;
    for (let i = 0; i < 8; i++) add(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z, node.matrixWorld);
  });
  if (crossed) return { x: 0, y: 0, width: 100, height: 100 };
  if (!(maxX > minX && maxY > minY)) return null;
  const left = Math.max(-1, minX), right = Math.min(1, maxX), bottom = Math.max(-1, minY), top = Math.min(1, maxY);
  if (!(right > left && top > bottom)) return null;
  return { x: (left + 1) * 50, y: (1 - top) * 50, width: (right - left) * 50, height: (top - bottom) * 50 };
}
