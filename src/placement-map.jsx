import React, { useEffect, useRef, useState } from 'react';
import { fontDefinition } from './fonts.js';
import { FORMATS } from './project.js';
import { GRID_POINTS, gridPlacement, nearestGridPoint, stepGridPoint } from './editor-controls.js';

export function PlacementMap({ project, layer, onCommit, onPreview }) {
  const frame = useRef(); const element = useRef(); const gesture = useRef(null);
  const [width, setWidth] = useState(200); const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState(null); const [alignment, setAlignment] = useState('center'); const [chosen, setChosen] = useState(null);
  const [w, h] = FORMATS[project.format];
  function measure() {
    const rect = element.current.getBoundingClientRect();
    return { width: rect.width / frame.current.clientWidth * 100, height: rect.height / frame.current.clientHeight * 100 };
  }
  useEffect(() => {
    const update = () => { setWidth(frame.current.clientWidth); setBounds(measure()); };
    const observer = new ResizeObserver(update);
    observer.observe(frame.current); observer.observe(element.current); update();
    return () => observer.disconnect();
  }, [layer.id]);
  useEffect(() => { gesture.current = null; setDraft(null); onPreview(null); }, [layer.id, layer.x, layer.y, project.format, onPreview]);
  useEffect(() => { setChosen(null); setAlignment('center'); }, [layer.id]);
  useEffect(() => () => onPreview(null), [onPreview]);
  const matches = index => {
    const position = gridPlacement(index, bounds.width, bounds.height, alignment);
    return Math.abs(position.x - layer.x) < 0.001 && Math.abs(position.y - layer.y) < 0.001;
  };
  const selected = draft?.gridIndex ?? (bounds.width > 0 ? chosen !== null && matches(chosen) ? chosen : [36, ...Array.from({ length: 36 }, (_, i) => i)].find(matches) : undefined);
  function commit(position) {
    setChosen(position.gridIndex);
    if (position.x !== layer.x || position.y !== layer.y) onCommit({ x: position.x, y: position.y });
  }
  function choose(index, nextAlignment = alignment) {
    const size = measure();
    commit(gridPlacement(index, size.width, size.height, nextAlignment));
  }
  function point(e, g) {
    const box = frame.current.getBoundingClientRect();
    const anchorX = (e.clientX - box.left - frame.current.clientLeft) / frame.current.clientWidth * 100 - g.grabX + g.width * ({ left: 0, center: 0.5, right: 1 }[alignment]);
    const anchorY = (e.clientY - box.top - frame.current.clientTop) / frame.current.clientHeight * 100 - g.grabY + g.height / 2;
    return gridPlacement(nearestGridPoint(anchorX, anchorY), g.width, g.height, alignment);
  }
  function begin(e) {
    if (e.button !== 0 || gesture.current || e.target.closest('.map-grid-point')) return;
    e.preventDefault(); element.current.focus({ preventScroll: true });
    const rect = element.current.getBoundingClientRect(); const size = measure();
    const dragging = !!e.target.closest('.map-node.selected');
    const g = { pointerId: e.pointerId, ...size,
      grabX: (dragging ? e.clientX - rect.left : rect.width * ({ left: 0, center: 0.5, right: 1 }[alignment])) / frame.current.clientWidth * 100,
      grabY: (dragging ? e.clientY - rect.top : rect.height / 2) / frame.current.clientHeight * 100 };
    g.latest = null; gesture.current = g; frame.current.setPointerCapture(e.pointerId);
    if (!dragging) move(e);
  }
  function move(e) {
    const g = gesture.current; if (!g || g.pointerId !== e.pointerId) return;
    g.latest = point(e, g); setDraft(g.latest); onPreview({ id: layer.id, ...g.latest });
  }
  function finish(e, cancel = false) {
    const g = gesture.current; if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null; setDraft(null); onPreview(null);
    if (frame.current.hasPointerCapture(e.pointerId)) frame.current.releasePointerCapture(e.pointerId);
    if (!cancel && g.latest) commit(g.latest);
  }
  function keys(e, index = selected) {
    if (e.key === 'Escape' && gesture.current) { e.preventDefault(); finish({ pointerId: gesture.current.pointerId }, true); return; }
    if (gesture.current) return;
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!directions[e.key] && !['Enter', ' '].includes(e.key)) return;
    e.preventDefault();
    const size = measure();
    const current = index ?? nearestGridPoint(layer.x + size.width * ({ left: 0, center: 0.5, right: 1 }[alignment]), layer.y + size.height / 2);
    const next = directions[e.key] ? stepGridPoint(current, ...directions[e.key]) : current;
    choose(next);
    if (e.target.closest('.map-grid-point') && next < 36) frame.current.querySelector(`[data-grid-index="${next}"]`)?.focus();
  }
  return <div className="placement-control">
    <div className="placement-map" ref={frame} role="group" aria-label={`6 by 6 position grid for ${layer.name}`} style={{ aspectRatio: `${w} / ${h}`, width: `min(100%, ${240 * w / h}px)` }} onPointerDown={begin} onPointerMove={move} onPointerUp={e => finish(e)} onPointerCancel={e => finish(e, true)} onLostPointerCapture={e => finish(e, true)}>
      <div className="map-grid">{GRID_POINTS.slice(0, 36).map((point, index) => <button key={index} type="button" data-grid-index={index} className={`map-grid-point ${selected === index ? 'active' : ''}`} tabIndex={selected === index || selected === undefined && index === 0 || selected === 36 && index === 0 ? 0 : -1} aria-label={`Row ${point.row + 1}, column ${point.column + 1}`} aria-pressed={selected === index} onClick={() => choose(index)} onKeyDown={e => keys(e, index)}/>)}</div>
      <div className={`map-center-anchor ${selected === 36 ? 'active' : ''}`} aria-hidden="true"/>
      {project.layers.filter(l => ['text', 'logo'].includes(l.type) && (l.visible || l.id === layer.id)).map(l => {
        const active = l.id === layer.id; const pos = active && draft ? draft : l;
        return <div key={l.id} ref={active ? element : null} className={`map-node ${active ? 'selected' : 'ghost'}`} role={active ? 'button' : undefined} tabIndex={active ? 0 : undefined} aria-label={active ? `Move ${l.name} between grid positions with arrow keys` : undefined} onKeyDown={active ? e => keys(e) : undefined} style={{ left: `${pos.x}%`, top: `${pos.y}%`, width: `${l.type === 'text' ? l.width : l.size}%`, fontSize: `${l.type === 'text' ? l.size * width / 1080 : 8}px`, fontWeight: l.weight, fontFamily: l.type === 'text' ? fontDefinition(l.font).family : undefined, opacity: active ? 1 : 0.25 }}>
          {l.type === 'logo' ? l.src ? <img src={l.src} alt="" draggable={false}/> : <span>Logo</span> : l.text}
        </div>;
      })}
    </div>
    <div className="map-position-actions"><span className="map-coordinates" aria-live="polite">{selected === 36 ? 'Exact center' : selected !== undefined ? `Row ${GRID_POINTS[selected].row + 1} · Column ${GRID_POINTS[selected].column + 1}` : 'Custom position'}</span><button type="button" className="text-button" aria-pressed={selected === 36} onClick={() => choose(36)}>Center</button></div>
    <div className="map-alignment"><span>Element anchor</span><div className="segmented" role="group" aria-label="Horizontal element anchor">{['left', 'center', 'right'].map(value => <button type="button" key={value} aria-pressed={alignment === value} className={alignment === value ? 'selected' : ''} onClick={() => { setAlignment(value); if (selected !== undefined) choose(selected, value); }}>{value}</button>)}</div></div>
    <p className="helper">Click a cell or drag between positions. Arrow keys move one cell; Escape cancels a drag. Large elements stop at safe margins. Precise position remains available below.</p>
  </div>;
}
