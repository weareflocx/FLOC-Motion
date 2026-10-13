export const DEFAULT_LAYOUT = Object.freeze({ enabled: false, marginX: 5, marginY: 5, guides: true });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rounded = value => Math.round(value * 1e6) / 1e6;

export function safeArea(layout = DEFAULT_LAYOUT) {
  const x = layout.enabled ? layout.marginX : 0, y = layout.enabled ? layout.marginY : 0;
  return { x, y, width: 100 - x * 2, height: 100 - y * 2 };
}

export function constrainPlacement(x, y, width, height, layout) {
  const area = safeArea(layout);
  return {
    x: rounded(clamp(x, area.x, Math.max(area.x, Math.min(95, area.x + area.width - width)))),
    y: rounded(clamp(y, area.y, Math.max(area.y, Math.min(95, area.y + area.height - height))))
  };
}

export function fitsSafeArea(bounds, layout) {
  const area = safeArea(layout);
  return bounds.width <= area.width + 1e-6 && bounds.height <= area.height + 1e-6;
}

// Bounds of a text box (CSS pixels on a stage of stageWidth × stageHeight) once rotated
// about its center, as stage percentages; x/y shift from the unrotated box's corner.
export function rotatedTextBounds(boxWidth, boxHeight, roll, stageWidth, stageHeight) {
  const angle = (roll ?? 0) * Math.PI / 180;
  const width = Math.abs(boxWidth * Math.cos(angle)) + Math.abs(boxHeight * Math.sin(angle));
  const height = Math.abs(boxWidth * Math.sin(angle)) + Math.abs(boxHeight * Math.cos(angle));
  return { width: width / stageWidth * 100, height: height / stageHeight * 100, x: (boxWidth - width) / 2 / stageWidth * 100, y: (boxHeight - height) / 2 / stageHeight * 100 };
}

// Text placed at `position` overflows when it cannot fit the safe area (placement then
// clamps it inside) or, without a safe area, when it runs past the frame.
export function textOverflows(position, bounds, layout = DEFAULT_LAYOUT) {
  if (layout.enabled) return !fitsSafeArea(bounds, layout);
  const left = position.x + bounds.x, top = position.y + bounds.y;
  return left < -1e-6 || top < -1e-6 || left + bounds.width > 100 + 1e-6 || top + bounds.height > 100 + 1e-6;
}

// Guides are editor-only. Their tolerance is supplied in surface pixels,
// converted to percentages so small maps and large previews feel consistent.
export function alignmentPlacement(position, bounds, targets, layout, tolerance, { constrain = true } = {}) {
  const area = safeArea(layout);
  const result = { ...position }, lines = [];
  for (const [axis, size] of [['x', 'width'], ['y', 'height']]) {
    const anchors = [0, bounds[size] / 2, bounds[size]];
    const references = [area[axis], area[axis] + area[size] / 2, area[axis] + area[size]];
    if (!constrain) references.push(0, 100);
    for (const target of targets) references.push(target[axis], target[axis] + target[size] / 2, target[axis] + target[size]);
    let best;
    for (const reference of references) for (const anchor of anchors) {
      const delta = reference - position[axis] - anchor;
      if (Math.abs(delta) <= tolerance[axis] && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, reference };
    }
    if (best) { result[axis] += best.delta; lines.push({ axis, value: best.reference }); }
  }
  const bounded = constrain ? constrainPlacement(result.x, result.y, bounds.width, bounds.height, layout) : result;
  return { ...bounded, guides: lines.filter(line => Math.abs(bounded[line.axis] - result[line.axis]) < 1e-5) };
}

export function spacingGuides(rect, targets, layout) {
  const area = safeArea(layout), gaps = [];
  for (const [axis, size, cross, crossSize] of [['x', 'width', 'y', 'height'], ['y', 'height', 'x', 'width']]) {
    let before = area[axis], after = area[axis] + area[size];
    for (const target of targets) {
      if (target[cross] + target[crossSize] < rect[cross] || target[cross] > rect[cross] + rect[crossSize]) continue;
      const end = target[axis] + target[size];
      if (end <= rect[axis]) before = Math.max(before, end);
      if (target[axis] >= rect[axis] + rect[size]) after = Math.min(after, target[axis]);
    }
    const at = rect[cross] + rect[crossSize] / 2;
    if (rect[axis] - before > .05) gaps.push({ axis, start: before, end: rect[axis], at });
    if (after - rect[axis] - rect[size] > .05) gaps.push({ axis, start: rect[axis] + rect[size], end: after, at });
  }
  return gaps;
}
