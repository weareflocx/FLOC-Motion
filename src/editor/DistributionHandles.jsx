import React, { useRef } from 'react';

const rounded = value => Math.round(value * 10) / 10;

// Editor-only handles for a distribution preview, drawn in composition pixels. The
// center handle moves the arrangement; a circle or arc also gets a radius handle.
// Both edit the same settings as the inspector through `onChange(patch)`.
export function DistributionHandles({ value, dimensions: [width, height], scale = 1, onChange }) {
  const drag = useRef(null);
  if (!value?.center || !onChange) return null;
  const short = Math.min(width, height), ring = Number.isFinite(value.radius) && Number.isFinite(value.angle);
  const center = { x: value.center.x / 100 * width, y: value.center.y / 100 * height };
  const angle = (value.angle ?? 0) * Math.PI / 180, radius = ring ? value.radius / 100 * short : 0;
  const knob = { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  const point = event => {
    const box = event.currentTarget.ownerSVGElement.getBoundingClientRect();
    return { x: (event.clientX - box.left) / box.width * width, y: (event.clientY - box.top) / box.height * height };
  };
  const edit = (kind, at) => kind === 'center'
    ? onChange({ center: { x: rounded(at.x / width * 100), y: rounded(at.y / height * 100) } })
    : onChange({ [value.layout]: { radius: Math.max(1, rounded(Math.hypot(at.x - center.x, at.y - center.y) / short * 100)) } });
  const handlers = kind => ({
    onPointerDown(event) {
      event.stopPropagation(); event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      drag.current = { kind, pointerId: event.pointerId };
    },
    onPointerMove(event) { if (drag.current?.kind === kind && drag.current.pointerId === event.pointerId) edit(kind, point(event)); },
    onPointerUp() { drag.current = null; },
    onPointerCancel() { drag.current = null; },
    onKeyDown(event) {
      const step = event.shiftKey ? 5 : 1;
      const dx = { ArrowLeft: -step, ArrowRight: step }[event.key] ?? 0, dy = { ArrowUp: -step, ArrowDown: step }[event.key] ?? 0;
      if (!dx && !dy) return;
      event.preventDefault(); event.stopPropagation();
      if (kind === 'center') onChange({ center: { x: rounded(value.center.x + dx), y: rounded(value.center.y + dy) } });
      else onChange({ [value.layout]: { radius: Math.max(1, rounded(value.radius + (dx || -dy))) } });
    }
  });
  const size = 7 / scale;
  return <svg className="distribution-handles" viewBox={`0 0 ${width} ${height}`} style={{ strokeWidth: 1 / scale }}>
    {ring && <circle className="distribution-ring" cx={center.x} cy={center.y} r={radius} style={{ strokeDasharray: `${4 / scale} ${4 / scale}` }}/>}
    {ring && <line className="distribution-ring" x1={center.x} y1={center.y} x2={knob.x} y2={knob.y}/>}
    <circle className="distribution-handle" cx={center.x} cy={center.y} r={size} role="slider" tabIndex={0} aria-label="Distribution center: drag or use arrow keys" aria-valuetext={`X ${rounded(value.center.x)}%, Y ${rounded(value.center.y)}%`} {...handlers('center')}/>
    {ring && <circle className="distribution-handle radius" cx={knob.x} cy={knob.y} r={size} role="slider" tabIndex={0} aria-label="Distribution radius: drag or use arrow keys" aria-valuenow={rounded(value.radius)} aria-valuetext={`${rounded(value.radius)}% of the short side`} {...handlers('radius')}/>}
  </svg>;
}
