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
  // Every pose has two XYZ solutions; keep the one nearest the starting angles so a plain
  // turn past 90° stores yaw 120 rather than the flipped (-180, 60, -180), which keyframes
  // would interpolate through a tumble.
  const degrees = value => wrapDegrees(Number(MathUtils.radToDeg(value).toFixed(6)));
  const first = [euler.x, euler.y, euler.z].map(degrees);
  const second = [first[0] + 180, 180 - first[1], first[2] + 180].map(value => wrapDegrees(Number(value.toFixed(6))));
  const start = [initial.tilt, initial.yaw, initial.roll];
  const distance = angles => angles.reduce((sum, value, i) => sum + Math.abs(wrapDegrees(value - start[i])), 0);
  const [tilt, yaw, roll] = distance(second) < distance(first) ? second : first;
  return { ...initial, tilt, yaw, roll };
}
