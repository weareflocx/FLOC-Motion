import React, { useEffect, useRef, useState } from 'react';
import { FORMATS } from './project.js';
import { placeElement } from './editor-controls.js';

export function PlacementMap({ project, layer, onCommit, onPreview }) {
  const frame = useRef(); const element = useRef(); const gesture = useRef(null);
  const [width, setWidth] = useState(200); const [draft, setDraft] = useState(null);
  const [w, h] = FORMATS[project.format];
  useEffect(() => {
    const observer = new ResizeObserver(() => setWidth(frame.current.clientWidth));
    observer.observe(frame.current); setWidth(frame.current.clientWidth);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { gesture.current = null; setDraft(null); onPreview(null); }, [layer.id, layer.x, layer.y, project.format, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);
  function point(e, g) {
    const box = frame.current.getBoundingClientRect();
    return placeElement((e.clientX - box.left - frame.current.clientLeft) / frame.current.clientWidth * 100 - g.grabX,
      (e.clientY - box.top - frame.current.clientTop) / frame.current.clientHeight * 100 - g.grabY, g.width, g.height, !e.altKey);
  }
  function begin(e) {
    if (e.button !== 0 || gesture.current) return;
    e.preventDefault(); element.current.focus({ preventScroll: true });
    const rect = element.current.getBoundingClientRect();
    const dragging = !!e.target.closest('.map-node.selected');
    const g = { pointerId: e.pointerId, width: rect.width / frame.current.clientWidth * 100, height: rect.height / frame.current.clientHeight * 100,
      grabX: (dragging ? e.clientX - rect.left : rect.width / 2) / frame.current.clientWidth * 100,
      grabY: (dragging ? e.clientY - rect.top : rect.height / 2) / frame.current.clientHeight * 100 };
    g.latest = dragging ? { x: layer.x, y: layer.y } : point(e, g);
    gesture.current = g; frame.current.setPointerCapture(e.pointerId);
    setDraft(g.latest); onPreview({ id: layer.id, ...g.latest });
  }
  function move(e) {
    const g = gesture.current; if (!g || g.pointerId !== e.pointerId) return;
    g.latest = point(e, g); setDraft(g.latest); onPreview({ id: layer.id, ...g.latest });
  }
  function finish(e, cancel = false) {
    const g = gesture.current; if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null; setDraft(null); onPreview(null);
    if (frame.current.hasPointerCapture(e.pointerId)) frame.current.releasePointerCapture(e.pointerId);
    if (!cancel && (g.latest.x !== layer.x || g.latest.y !== layer.y)) onCommit({ x: g.latest.x, y: g.latest.y });
  }
  function keys(e) {
    if (e.key === 'Escape' && gesture.current) {
      e.preventDefault(); finish({ pointerId: gesture.current.pointerId }, true); return;
    }
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key) || gesture.current) return;
    e.preventDefault(); const step = e.shiftKey ? 5 : 0.5;
    const p = placeElement(layer.x + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0), layer.y + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0), 0, 0, false);
    if (p.x !== layer.x || p.y !== layer.y) onCommit({ x: p.x, y: p.y });
  }
  return <div className="placement-control">
    <div className="placement-map" ref={frame} role="group" aria-label={`Position map for ${layer.name}`} style={{ aspectRatio: `${w} / ${h}`, width: `min(100%, ${240 * w / h}px)` }} onPointerDown={begin} onPointerMove={move} onPointerUp={e => finish(e)} onPointerCancel={e => finish(e, true)} onLostPointerCapture={e => finish(e, true)}>
      <div className="map-safe-area" aria-hidden="true"/>
      {project.layers.filter(l => ['text','logo'].includes(l.type)).map(l => {
        const active = l.id === layer.id; const pos = active && draft ? draft : l;
        return <div key={l.id} ref={active ? element : null} className={`map-node ${active ? 'selected' : 'ghost'}`} role={active ? 'button' : undefined} tabIndex={active ? 0 : undefined} aria-label={active ? `Position ${l.name} with arrow keys` : undefined} onKeyDown={active ? keys : undefined} style={{ left: `${pos.x}%`, top: `${pos.y}%`, width: `${l.type === 'text' ? l.width : l.size}%`, fontSize: `${l.type === 'text' ? l.size * width / 1080 : 8}px`, fontWeight: l.weight, opacity: active ? 1 : 0.25 }}>
          {l.type === 'logo' ? l.src ? <img src={l.src} alt="" draggable={false}/> : <span>Logo</span> : l.text}
        </div>;
      })}
      {draft?.guideX !== null && draft?.guideX !== undefined && <i className="map-guide vertical" style={{ left: `${draft.guideX}%` }}/>} 
      {draft?.guideY !== null && draft?.guideY !== undefined && <i className="map-guide horizontal" style={{ top: `${draft.guideY}%` }}/>} 
    </div>
    <p className="helper">Layout map · click to place the center, or drag the selected element. Alt skips snapping. Arrow keys fine-tune; Shift moves faster.</p>
    <output className="map-coordinates" aria-live="polite">{(draft?.x ?? layer.x).toFixed(1)}% · {(draft?.y ?? layer.y).toFixed(1)}%</output>
  </div>;
}
