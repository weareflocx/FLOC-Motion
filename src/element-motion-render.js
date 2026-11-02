import * as THREE from 'three';

const axis = new THREE.Vector3(0, 0, 1);
const rotation = new THREE.Quaternion();
const radians = value => value * Math.PI / 180;

// The composition reference plane uses +Y upward; motion offsets use canvas +Y.
export function hasElementTransform(motion) {
  return Boolean(motion?.active && (motion.offsetX || motion.offsetY || motion.rotation || motion.scale !== 1));
}

// Native leaves already have their authored pose and fit scale. Add only an
// outer, composition-axis transform, never changing their internal clocks/fit.
export function applyElementTransform(root, motion, shortSide) {
  if (!hasElementTransform(motion)) return;
  root.position.x += motion.offsetX / 100 * shortSide;
  root.position.y -= motion.offsetY / 100 * shortSide;
  root.quaternion.premultiply(rotation.setFromAxisAngle(axis, radians(motion.rotation)));
  root.scale.multiplyScalar(motion.scale);
}

// Captured leaves can include asymmetric effect padding. Their pivot is the
// authored content center, not the center of the padded bitmap.
export function elementTransformMatrix(motion, shortSide, center, target) {
  if (!hasElementTransform(motion)) return target.identity();
  const angle = radians(motion.rotation), c = Math.cos(angle) * motion.scale, s = Math.sin(angle) * motion.scale;
  return target.set(
    c, -s, 0, center.x + motion.offsetX / 100 * shortSide - c * center.x + s * center.y,
    s, c, 0, center.y - motion.offsetY / 100 * shortSide - s * center.x - c * center.y,
    0, 0, motion.scale, center.z * (1 - motion.scale),
    0, 0, 0, 1);
}
