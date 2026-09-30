export const wrapDegrees = value => ((value + 180) % 360 + 360) % 360 - 180;

export function dragOrientation(initial, dx, dy, angleDelta = null) {
  if (angleDelta !== null) return { ...initial, roll: wrapDegrees(initial.roll + angleDelta) };
  return {
    ...initial,
    tilt: Math.max(-65, Math.min(65, initial.tilt + dy * 180)),
    yaw: wrapDegrees(initial.yaw + dx * 180)
  };
}
