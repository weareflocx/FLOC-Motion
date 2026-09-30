const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const rounded = n => Math.round(n * 1e6) / 1e6;

export function placeElement(x, y, width, height, snap = true) {
  const axis = (value, size) => {
    let result = clamp(value, 0, 95); let guide = null; let distance = 0.7;
    if (snap) for (const target of [0, 5, 50, 95, 100]) for (const offset of [0, size / 2, size]) {
      const candidate = target - offset;
      const delta = Math.abs(candidate - result);
      if (candidate >= 0 && candidate <= 95 && delta < distance) { distance = delta; guide = target; }
    }
    if (guide !== null) {
      const candidates = [guide, guide - size / 2, guide - size].filter(n => n >= 0 && n <= 95);
      result = candidates.reduce((a, b) => Math.abs(b - result) < Math.abs(a - result) ? b : a);
    }
    return { value: rounded(result), guide };
  };
  const horizontal = axis(x, width), vertical = axis(y, height);
  return { x: horizontal.value, y: vertical.value, guideX: horizontal.guide, guideY: vertical.guide };
}

export function editClip(layer, kind, delta, duration, fps) {
  const step = 1 / fps;
  const quantized = Math.round(delta * fps) / fps;
  const span = layer.end - layer.start;
  const minimum = Math.max(0.01, Math.min(step, span));
  // Do not round timestamps: imported short clips must keep their valid duration.
  const range = (start, end) => ({ start: start + 0.01 > end ? Math.max(0, end - 0.01 - Number.EPSILON * Math.max(1, duration)) : start, end });
  if (kind === 'move') {
    const start = clamp(layer.start + quantized, 0, duration - span);
    return range(start, Math.min(duration, start + span));
  }
  if (kind === 'start') return range(clamp(layer.start + quantized, 0, layer.end - minimum), layer.end);
  if (kind === 'end') return range(layer.start, clamp(layer.end + quantized, layer.start + minimum, duration));
  throw new Error('Unknown clip action.');
}

export function timeAtPointer(clientX, rect, duration, fps) {
  return clamp(Math.round((clientX - rect.left) / rect.width * duration * fps) / fps, 0, duration - 1 / fps);
}
