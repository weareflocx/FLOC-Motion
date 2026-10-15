import { Euler, MathUtils, Quaternion, Vector3 } from 'three';

export const wrapDegrees = value => ((value + 180) % 360 + 360) % 360 - 180;

export function dragOrientation(initial, dx, dy, angleDelta = null, tiltLimit = 65) {
  if (angleDelta !== null) return { ...initial, roll: wrapDegrees(initial.roll + angleDelta) };
  return {
    ...initial,
    tilt: Math.max(-tiltLimit, Math.min(tiltLimit, initial.tilt + dy * 180)),
    yaw: wrapDegrees(initial.yaw + dx * 180)
  };
}

const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
// A model turns about the screen like a trackball: horizontal drags about the
// view's vertical axis, vertical drags about its horizontal axis and the ring
// about the view direction, whatever its current pose. Returns XYZ Euler degrees.
export function dragModelOrientation(initial, dx, dy, angleDelta = null) {
  const euler = new Euler(MathUtils.degToRad(initial.tilt), MathUtils.degToRad(initial.yaw), MathUtils.degToRad(initial.roll), 'XYZ');
  const pose = new Quaternion().setFromEuler(euler), turn = new Quaternion();
  if (angleDelta !== null) pose.premultiply(turn.setFromAxisAngle(Z, MathUtils.degToRad(angleDelta)));
  else pose.premultiply(turn.setFromAxisAngle(X, dy * Math.PI)).premultiply(turn.setFromAxisAngle(Y, dx * Math.PI));
  euler.setFromQuaternion(pose, 'XYZ');
  const degrees = value => wrapDegrees(Number(MathUtils.radToDeg(value).toFixed(6)));
  return { ...initial, tilt: degrees(euler.x), yaw: degrees(euler.y), roll: degrees(euler.z) };
}
