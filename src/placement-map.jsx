import React, { useEffect, useRef, useState } from 'react';
import { fontDefinition } from './fonts.js';
import { FORMATS } from './project.js';
import { GRID_POINTS, freePlacement, gridPlacement, nearestGridPoint, nudgePlacement, stepGridPoint } from './editor-controls.js';
import { NumberField } from './editor/controls.jsx';
import { alignmentPlacement, DEFAULT_LAYOUT, fitsSafeArea, safeArea } from './layout.js';
import { PlacementGuides } from './editor/PlacementGuides.jsx';

export function PlacementMap({ project, layer, onCommit, onPreview }) {
  const frame = useRef(); const element = useRef(); const gesture = useRef(null);
  const [width, setWidth] = useState(200); const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState(null); const [alignment, setAlignment] = useState('center'); const [chosen, setChosen] = useState(null);
  const [snap, setSnap] = useState(false);
  const [sizes, setSizes] = useState({});
  const layout = project.layout ?? DEFAULT_LAYOUT, area = safeArea(layout);
  const [w, h] = FORMATS[project.format];
  function measure() {
    const rect = element.current.getBoundingClientRect();
    return { width: layer.type === 'text' ? layer.width : layer.size, height: rect.height / frame.current.clientHeight * 100 };
  }
  useEffect(() => {
    const update = () => {
      setWidth(frame.current.clientWidth); setBounds(measure());
      setSizes(Object.fromEntries([...frame.current.querySelectorAll('[data-map-layer]')].map(node => { const box = node.getBoundingClientRect(), l = project.layers.find(l => l.id === node.dataset.mapLayer); return [l.id, { width: l.type === 'text' ? l.width : l.size, height: box.height / frame.current.clientHeight * 100 }]; })));
    };
    const observer = new ResizeObserver(update);
    observer.observe(frame.current); frame.current.querySelectorAll('[data-map-layer]').forEach(node => observer.observe(node)); update();
    return () => observer.disconnect();
  }, [layer.id, project.layers, project.format]);
  useEffect(() => { gesture.current = null; setDraft(null); onPreview(null); }, [layer.id, layer.x, layer.y, project.format, onPreview]);
  useEffect(() => { setChosen(null); setAlignment('center'); }, [layer.id]);
  useEffect(() => () => onPreview(null), [onPreview]);
  const positionFor = l => layout.enabled && sizes[l.id] ? freePlacement(l.x, l.y, sizes[l.id].width, sizes[l.id].height, layout) : l;
  const position = positionFor(layer);
  const targets = project.layers.filter(l => l.visible && l.id !== layer.id && ['text', 'logo'].includes(l.type) && sizes[l.id]).map(l => ({ ...positionFor(l), ...sizes[l.id] }));
  const gridPosition = (index, size, anchor = alignment) => {
    const point = gridPlacement(index, size.width, size.height, anchor);
    return { ...point, ...freePlacement(point.x, point.y, size.width, size.height, layout) };
  };
  const matches = index => {
    const point = gridPosition(index, bounds);
    return Math.abs(point.x - position.x) < 0.001 && Math.abs(point.y - position.y) < 0.001;
  };
  const selected = draft?.gridIndex ?? (bounds.width > 0 ? chosen !== null && matches(chosen) ? chosen : [36, ...Array.from({ length: 36 }, (_, i) => i)].find(matches) : undefined);
  function commit(position) {
    setChosen(position.gridIndex ?? null);
    if (position.x !== layer.x || position.y !== layer.y) onCommit({ x: position.x, y: position.y });
  }
  function choose(index, nextAlignment = alignment) {
    const size = measure();
    commit(gridPosition(index, size, nextAlignment));
  }
  function point(e, g) {
    const box = frame.current.getBoundingClientRect();
    const anchorX = (e.clientX - box.left - frame.current.clientLeft) / frame.current.clientWidth * 100 - g.grabX + g.width * ({ left: 0, center: 0.5, right: 1 }[alignment]);
    const anchorY = (e.clientY - box.top - frame.current.clientTop) / frame.current.clientHeight * 100 - g.grabY + g.height / 2;
    if (snap || e.altKey) return gridPosition(nearestGridPoint(anchorX, anchorY), g);
    const point = freePlacement(anchorX - g.width * ({ left: 0, center: 0.5, right: 1 }[alignment]), anchorY - g.height / 2, g.width, g.height, layout);
    return layout.guides && !e.shiftKey ? alignmentPlacement(point, g, targets, layout, { x: 600 / box.width, y: 600 / box.height }) : point;
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
    if (!e.target.closest('.map-grid-point')) {
      if (directions[e.key]) commit(nudgePlacement(position, ...directions[e.key], [w, h], size, e.shiftKey ? 10 : 1, layout));
      return;
    }
    const current = index ?? nearestGridPoint(layer.x + size.width * ({ left: 0, center: 0.5, right: 1 }[alignment]), layer.y + size.height / 2);
    const next = directions[e.key] ? stepGridPoint(current, ...directions[e.key]) : current;
    choose(next);
    if (e.target.closest('.map-grid-point') && next < 36) frame.current.querySelector(`[data-grid-index="${next}"]`)?.focus();
  }
  return <div className="placement-control">
    <label className="check-field"><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)}/>Snap to grid</label>
    <div className="placement-map" ref={frame} role="group" aria-label={`Position map for ${layer.name}`} style={{ aspectRatio: `${w} / ${h}`, width: `min(100%, ${240 * w / h}px)` }} onPointerDown={begin} onPointerMove={move} onPointerUp={e => finish(e)} onPointerCancel={e => finish(e, true)} onLostPointerCapture={e => finish(e, true)}>
      {snap && <div className="map-grid">{GRID_POINTS.slice(0, 36).map((point, index) => <button key={index} type="button" data-grid-index={index} className={`map-grid-point ${selected === index ? 'active' : ''}`} tabIndex={selected === index || selected === undefined && index === 0 || selected === 36 && index === 0 ? 0 : -1} aria-label={`Row ${point.row + 1}, column ${point.column + 1}`} aria-pressed={selected === index} onClick={() => choose(index)} onKeyDown={e => keys(e, index)}/>)}</div>}
      <div className={`map-center-anchor ${selected === 36 ? 'active' : ''}`} aria-hidden="true"/>
      {project.layers.filter(l => ['text', 'logo'].includes(l.type) && (l.visible || l.id === layer.id)).map(l => {
        const active = l.id === layer.id; const pos = active && draft ? draft : positionFor(l);
        return <div key={l.id} data-map-layer={l.id} ref={active ? element : null} className={`map-node ${active ? 'selected' : 'ghost'}`} role={active ? 'button' : undefined} tabIndex={active ? 0 : undefined} aria-label={active ? `Move ${l.name}: arrows 1 pixel, Shift 10 pixels; Escape cancels` : undefined} onKeyDown={active ? e => keys(e) : undefined} style={{ left: `${pos.x}%`, top: `${pos.y}%`, width: `${l.type === 'text' ? l.width : l.size}%`, fontSize: `${l.type === 'text' ? l.size * width / 1080 : 8}px`, fontWeight: l.weight, fontFamily: l.type === 'text' ? fontDefinition(l.font).family : undefined, opacity: active ? 1 : 0.25 }}>
          {l.type === 'logo' ? l.src ? <img src={l.src} alt="" draggable={false}/> : <span>Logo</span> : l.text}
        </div>;
      })}
      <PlacementGuides layout={layout} rect={{ ...(draft ?? position), ...bounds }} targets={targets} dimensions={[w, h]} lines={draft?.guides} scale={width / w}/>
    </div>
    <div className="map-position-actions"><span className="map-coordinates" aria-live="polite">{snap && selected !== undefined ? selected === 36 ? 'Exact center' : `Row ${GRID_POINTS[selected].row + 1} · Column ${GRID_POINTS[selected].column + 1}` : 'Free position'}</span><button type="button" className="text-button" aria-pressed={selected === 36} onClick={() => { const size = measure(); commit(freePlacement(50 - size.width / 2, 50 - size.height / 2, size.width, size.height, layout)); }}>Center</button></div>
    <div className="two-fields placement-coordinates">{[['x', w, 'width'], ['y', h, 'height']].map(([axis, dimension, size]) => <NumberField key={axis} label={`Position ${axis.toUpperCase()} (px)`} value={Math.round((draft ?? position)[axis] / 100 * dimension * 10) / 10} min={area[axis] * dimension / 100} max={Math.max(area[axis], Math.min(95, area[axis] + area[size] - bounds[size])) * dimension / 100} step={1} onChange={value => commit(freePlacement(axis === 'x' ? value / dimension * 100 : position.x, axis === 'y' ? value / dimension * 100 : position.y, bounds.width, bounds.height, layout))}/>)}</div>
    {snap && <div className="map-alignment"><span>Element anchor</span><div className="segmented" role="group" aria-label="Horizontal element anchor">{['left', 'center', 'right'].map(value => <button type="button" key={value} aria-pressed={alignment === value} className={alignment === value ? 'selected' : ''} onClick={() => { setAlignment(value); if (selected !== undefined) choose(selected, value); }}>{value}</button>)}</div></div>}
    {layout.enabled && !fitsSafeArea(bounds, layout) && <p className="helper layout-warning" role="alert">This layer exceeds the safe area. Reduce its width or size before exporting.</p>}
    <p className="helper">Drag freely here or on the canvas. Alt snaps to grid; Shift bypasses smart snapping. Arrows move 1 px; Shift moves 10 px. Escape cancels. X/Y use the top-left corner.</p>
  </div>;
}
