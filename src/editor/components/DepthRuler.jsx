import React, { useEffect, useRef, useState } from 'react';
import { SCENE_DEPTH_RANGE } from '../../scene-settings.js';
import { clampDepth, depthLabel, depthScale, nextDepth, outerDepth, snapDepth } from '../depth.js';

const SNAP_PIXELS = 8;

// Places the selected layer among the other layers' pieces without leaving the output camera.
// Top is nearest the default front camera. The scale stays fixed while dragging so the marker
// follows the pointer; it refits to the current frame afterwards.
export function DepthRuler({ layer, z, guide, names, onBegin, onPreview, onPatch, onGesture }) {
  const track = useRef(), drag = useRef(null);
  const [frozen, setFrozen] = useState(null);
  const base = layer.z ?? 0;
  const { low, high } = frozen ?? depthScale(guide, [base, z]);
  const top = value => `${(high - value) / (high - low) * 100}%`;
  // Selection changes remount the ruler; an unfinished drag must not leave its preview behind.
  useEffect(() => () => { if (drag.current) onPreview(null); }, [onPreview]);

  function valueAt(event, scale) {
    const box = track.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientY - box.top) / box.height));
    const raw = scale.high - ratio * (scale.high - scale.low);
    return event.shiftKey ? clampDepth(raw) : snapDepth(guide, raw, SNAP_PIXELS / box.height * (scale.high - scale.low));
  }
  function move(event) {
    const gesture = drag.current; if (!gesture || gesture.id !== event.pointerId) return;
    gesture.latest = valueAt(event, gesture.scale);
    onPreview({ id: layer.id, z: gesture.latest });
  }
  function finish(event, cancelled = false) {
    const gesture = drag.current; if (!gesture || gesture.id !== event.pointerId) return;
    drag.current = null; setFrozen(null); onPreview(null);
    if (track.current.hasPointerCapture(gesture.id)) track.current.releasePointerCapture(gesture.id);
    if (!cancelled && gesture.latest !== base) onPatch(layer.id, { z: gesture.latest });
  }
  function begin(event) {
    if (event.button !== 0 || drag.current) return;
    event.preventDefault();
    track.current.focus({ preventScroll: true });
    onBegin();
    const scale = { low, high };
    drag.current = { id: event.pointerId, scale, latest: base };
    setFrozen(scale);
    track.current.setPointerCapture(event.pointerId);
    move(event);
  }
  function keys(event) {
    if (event.key === 'Escape') {
      if (!drag.current) return;
      event.preventDefault();
      finish({ pointerId: drag.current.id }, true);
      return;
    }
    if (drag.current || event.metaKey || event.ctrlKey || event.altKey) return;
    const step = event.shiftKey ? 10 : 1;
    const next = { ArrowUp: from => clampDepth(from + step), ArrowDown: from => clampDepth(from - step),
      PageUp: from => nextDepth(guide, from, 1), PageDown: from => nextDepth(guide, from, -1),
      Home: from => outerDepth(guide, from, 1), End: from => outerDepth(guide, from, -1) }[event.key];
    if (!next) return;
    event.preventDefault();
    // A pending Alt+wheel burst on this layer is handed over: continue from its previewed depth
    // as one edit. Any other pending canvas edit commits first.
    const continued = onBegin(layer.id) === true;
    const value = next(continued ? z : base);
    if (value !== base) onPatch(layer.id, { z: value });
    onGesture();
  }

  const label = depthLabel(guide, z);
  return <div className="depth-ruler">
    <span className="depth-ruler-end" aria-hidden="true">Front</span>
    <div ref={track} className="depth-ruler-track" role="slider" tabIndex={0} aria-orientation="vertical" aria-label={`Depth of ${layer.name}`}
      aria-valuemin={SCENE_DEPTH_RANGE[0]} aria-valuemax={SCENE_DEPTH_RANGE[1]} aria-valuenow={z} aria-valuetext={`${z}% · ${label}`}
      title={`${label}. Drag to set depth; Shift drags without snapping. Arrow keys step 1 (Shift 10), Page Up/Down pass one piece, Home/End go in front of or behind everything.`}
      onPointerDown={begin} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)} onKeyDown={keys}>
      {guide.layers.map(item => item.pieces.map((piece, index) => {
        const name = `${names[item.id] ?? 'Layer'}${item.pieces.length > 1 ? ` · piece ${index + 1}` : ''}`;
        return piece.max - piece.min < 0.5
          ? <span key={`${item.id}:${index}`} className="depth-ruler-plane" style={{ top: top(piece.max) }} title={name}/>
          : <span key={`${item.id}:${index}`} className="depth-ruler-piece" style={{ top: top(piece.max), height: `${(piece.max - piece.min) / (high - low) * 100}%` }} title={name}/>;
      }))}
      <span className="depth-ruler-marker" style={{ top: top(z) }} aria-hidden="true"/>
    </div>
    <span className="depth-ruler-end" aria-hidden="true">Back</span>
    <output className="depth-ruler-value" aria-hidden="true">{z}%</output>
  </div>;
}
