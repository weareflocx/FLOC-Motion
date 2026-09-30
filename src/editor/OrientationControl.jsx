import React, { useEffect, useRef, useState } from 'react';
import { dragOrientation, wrapDegrees } from '../orientation.js';
import { NumberField } from './controls.jsx';

export function OrientationControl({ layer, onCommit, onPreview }) {
  const gesture = useRef(null);
  const [draft, setDraft] = useState(null);
  const value = draft || { tilt: layer.tilt, yaw: layer.yaw ?? 0, roll: layer.roll };
  useEffect(() => () => onPreview(null), [onPreview]);
  function finish(event, cancel = false) {
    const g = gesture.current;
    if (!g || event.pointerId !== g.id) return;
    gesture.current = null;
    setDraft(null);
    onPreview(null);
    if (!cancel && JSON.stringify(g.latest) !== JSON.stringify(g.initial)) onCommit(g.latest);
    if (event.currentTarget?.hasPointerCapture(g.id)) event.currentTarget.releasePointerCapture(g.id);
  }
  function begin(event) {
    if (event.button !== 0 || gesture.current) return;
    event.preventDefault();
    event.currentTarget.focus();
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    gesture.current = { id: event.pointerId, box, x, y, ring: Math.hypot(x, y) > 0.36, initial: value, latest: value, angle: Math.atan2(y, x), delta: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
    onPreview({ id: layer.id, ...value });
  }
  function move(event) {
    const g = gesture.current;
    if (!g || event.pointerId !== g.id) return;
    const x = (event.clientX - g.box.left) / g.box.width - 0.5;
    const y = (event.clientY - g.box.top) / g.box.height - 0.5;
    const angle = Math.atan2(y, x);
    g.delta += wrapDegrees((angle - g.angle) * 180 / Math.PI);
    g.angle = angle;
    g.latest = dragOrientation(g.initial, x - g.x, y - g.y, g.ring ? g.delta : null);
    setDraft(g.latest);
    onPreview({ id: layer.id, ...g.latest });
  }
  function keys(event) {
    if (event.key === 'Escape') { finish({ pointerId: gesture.current?.id, currentTarget: event.currentTarget }, true); return; }
    if (gesture.current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 5 : 1;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    onCommit(dragOrientation(value, dx / 180, dy / 180, event.altKey ? dx || dy : null));
  }
  return <div className="orientation-control">
    <div className="orientation-fields">
      {['tilt', 'yaw', 'roll'].map((axis, index) => <NumberField key={axis} label={`Orientation ${'XYZ'[index]}`} value={Math.round(value[axis])} min={axis === 'tilt' ? -65 : -180} max={axis === 'tilt' ? 65 : 180} onChange={number => onCommit({ [axis]: number })}/>)}
    </div>
    <div className="orientation-sphere" role="button" tabIndex={0} aria-label="Carousel orientation: drag center for X and Y, outer ring for Z. Arrow keys adjust X and Y; Alt adjusts Z; Escape cancels." onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)} onKeyDown={keys}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="55" className="orientation-ring"/>
        <g transform={`rotate(${value.roll} 60 60)`}>
          <circle cx="60" cy="60" r="41"/>
          <ellipse cx="60" cy="60" rx={Math.max(4, 41 * Math.abs(Math.cos(value.yaw * Math.PI / 180)))} ry="41"/>
          <ellipse cx="60" cy="60" rx="41" ry={Math.max(4, 41 * Math.abs(Math.sin(value.tilt * Math.PI / 180)))}/>
          <line x1="19" y1="60" x2="101" y2="60"/>
          <circle cx={60 + Math.sin(value.yaw * Math.PI / 180) * 35} cy={60 + Math.sin(value.tilt * Math.PI / 180) * 35} r="3" className="orientation-handle"/>
          <circle cx="115" cy="60" r="3" className="orientation-handle"/>
        </g>
      </svg>
    </div>
    <button className="outline-button" onClick={() => onCommit({ tilt: 0, yaw: 0, roll: 0 })}>Reset orientation</button>
    <p className="helper">Drag center: X/Y · outer ring: Z. Arrows fine-tune; Alt adjusts Z, Shift moves faster.</p>
  </div>;
}
