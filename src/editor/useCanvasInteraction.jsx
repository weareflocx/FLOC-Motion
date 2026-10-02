import React, { useEffect, useRef, useState } from 'react';
import { canvasWheelSize, carouselPlacement, freePlacement, gridPlacement, nearestGridPoint, nudgePlacement } from '../editor-controls.js';
import { FORMATS } from '../project.js';
import { alignmentPlacement, DEFAULT_LAYOUT } from '../layout.js';
import { dragOrientation, wrapDegrees } from '../orientation.js';

// Editor-only interaction: previews never mutate project data until release.
export function useCanvasInteraction({ root, engine, project, sceneKey, selected, time, onSelect, onPatch, onPreview }) {
  const gesture = useRef(null);
  const wheelDraft = useRef(null);
  const playhead = useRef(time); playhead.current = time;
  const [draft, setDraft] = useState(null);
  const layer = project.layers.find(l => l.id === selected);
  const layout = project.layout ?? DEFAULT_LAYOUT;
  const nodeFor = id => [...(root.current?.querySelectorAll('[data-floc-layer]') || [])].find(n => n.dataset.flocLayer === id);
  function cancel() { gesture.current = null; clearTimeout(wheelDraft.current?.timer); wheelDraft.current = null; setDraft(null); onPreview(null); }
  useEffect(() => { if (gesture.current && (gesture.current.layer.id !== selected || gesture.current.project !== project)) cancel(); }, [selected, project]);
  useEffect(() => () => onPreview(null), [onPreview]);
  useEffect(() => {
    const node = root.current;
    function wheel(event) {
      if (event.ctrlKey || gesture.current || !layer || layer.locked || !['text', 'logo', 'carousel', 'media', 'model'].includes(layer.type) || pick(event.clientX, event.clientY)?.id !== selected) return;
      event.preventDefault();
      onSelect(layer.id);
      const size = canvasWheelSize(layer, event.deltaY, wheelDraft.current?.size ?? layer.size);
      clearTimeout(wheelDraft.current?.timer);
      onPreview({ id: layer.id, x: layer.x, y: layer.y, size });
      wheelDraft.current = { size, timer: setTimeout(() => { wheelDraft.current = null; onPreview(null); if (size !== layer.size) onPatch(layer.id, { size }); }, 250) };
    }
    node?.addEventListener('wheel', wheel, { passive: false });
    return () => { node?.removeEventListener('wheel', wheel); if (wheelDraft.current) { clearTimeout(wheelDraft.current.timer); wheelDraft.current = null; onPreview(null); } };
  }, [project, selected, onPatch, onPreview, onSelect]);
  useEffect(() => {
    for (const l of project.layers) {
      const node = nodeFor(l.id); if (!node || !['text', 'logo', 'carousel', 'media', 'model'].includes(l.type)) continue;
      node.classList.toggle('canvas-selected', l.id === selected && l.type !== 'carousel');
      const visible = l.visible && time >= l.start && time < l.end;
      node.tabIndex = visible ? 0 : -1; node.setAttribute('role', 'button');
      node.setAttribute('aria-hidden', String(!visible));
      node.setAttribute('aria-label', `Edit ${l.name}${l.locked ? ' (locked)' : l.type === 'carousel' ? ': drag to move; Shift-drag to orient; scroll to resize' : ''}`);
      node.style.pointerEvents = 'auto';
    }
  }, [project, selected, time, sceneKey]);
  function pick(x, y) {
    const box = root.current.getBoundingClientRect();
    for (const l of [...project.layers].reverse()) {
      if (!l.visible || playhead.current < l.start || playhead.current >= l.end || l.type === 'music') continue;
      const node = nodeFor(l.id); if (!node || Number(node.style.opacity) <= 0) continue;
      const b = node.getBoundingClientRect();
      if (x < b.left || x > b.right || y < b.top || y > b.bottom) continue;
      if (['text', 'logo', 'media', 'model'].includes(l.type)) return l;
      if (l.type === 'carousel' && engine.current?.hitTest((x - box.left) / box.width, (y - box.top) / box.height, l.id)) return l;
      if (l.type === 'background') return null;
    }
    return null;
  }
  function begin(event) {
    if (event.button !== 0 || gesture.current || wheelDraft.current) return;
    const ring = event.target.closest('[data-canvas-ring]');
    const l = ring ? project.layers.find(l => l.id === selected && l.type === 'carousel') : pick(event.clientX, event.clientY);
    if (!l) return;
    event.preventDefault(); onSelect(l.id);
    nodeFor(l.id)?.focus({ preventScroll: true });
    if (l.locked) return;
    const box = root.current.getBoundingClientRect();
    const b = nodeFor(l.id).getBoundingClientRect();
    const orient = l.type === 'carousel' && (!!ring || event.shiftKey);
    const initial = orient ? { tilt: l.tilt, yaw: l.yaw ?? 0, roll: l.roll } : l.type === 'carousel' ? { x: l.x, y: l.y } : { x: parseFloat(nodeFor(l.id).style.left), y: parseFloat(nodeFor(l.id).style.top) };
    const targets = project.layers.filter(other => other.id !== l.id && other.visible && playhead.current >= other.start && playhead.current < other.end).flatMap(other => {
      if (other.type === 'carousel') return [{ x: other.x, y: other.y, width: 0, height: 0 }];
      const node = nodeFor(other.id); if (!node || !['text', 'logo', 'media', 'model'].includes(other.type)) return [];
      const rect = node.getBoundingClientRect();
      return [{ x: (rect.left - box.left) / box.width * 100, y: (rect.top - box.top) / box.height * 100, width: rect.width / box.width * 100, height: rect.height / box.height * 100 }];
    });
    gesture.current = { id: event.pointerId, layer: l, project, box, initial, targets, latest: initial, orient, ring: !!ring, x: event.clientX, y: event.clientY, width: b.width / box.width * 100, height: b.height / box.height * 100, angle: Math.atan2(event.clientY - (box.top + box.height * l.y / 100), event.clientX - (box.left + box.width * l.x / 100)), delta: 0, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event) {
    const g = gesture.current; if (!g || g.id !== event.pointerId) return;
    const dx = event.clientX - g.x, dy = event.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) < 3) return;
    g.moved = true;
    if (g.orient) {
      const angle = Math.atan2(event.clientY - (g.box.top + g.box.height * g.layer.y / 100), event.clientX - (g.box.left + g.box.width * g.layer.x / 100));
      g.delta += wrapDegrees((angle - g.angle) * 180 / Math.PI); g.angle = angle;
      g.latest = dragOrientation(g.initial, dx / g.box.width, dy / g.box.height, g.ring ? g.delta : null);
    } else if (g.layer.type === 'carousel') {
      g.latest = carouselPlacement(g.initial.x + dx / g.box.width * 100, g.initial.y + dy / g.box.height * 100);
    } else {
      const x = g.initial.x + dx / g.box.width * 100, y = g.initial.y + dy / g.box.height * 100;
      const point = event.altKey ? gridPlacement(nearestGridPoint(x + g.width / 2, y + g.height / 2), g.width, g.height) : { x, y };
      g.latest = { ...point, ...freePlacement(point.x, point.y, g.width, g.height, project.layout) };
      if (!event.altKey && !event.shiftKey && layout.guides) g.latest = alignmentPlacement(g.latest, g, g.targets, layout, { x: 600 / g.box.width, y: 600 / g.box.height });
    }
    setDraft(g.latest); onPreview({ id: g.layer.id, ...g.latest });
  }
  function finish(event, aborted = false) {
    const g = gesture.current; if (!g || g.id !== event.pointerId) return;
    cancel();
    if (event.currentTarget.hasPointerCapture(g.id)) event.currentTarget.releasePointerCapture(g.id);
    if (!aborted && g.moved) {
      const { gridIndex, guides, ...patch } = g.latest;
      if (Object.keys(patch).some(key => patch[key] !== g.initial[key])) onPatch(g.layer.id, patch);
    }
  }
  function keys(event) {
    if (event.key === 'Escape') { event.preventDefault(); cancel(); return; }
    const target = event.target.closest('[data-floc-layer]');
    const l = target ? project.layers.find(l => l.id === target.dataset.flocLayer) : layer;
    if (!l || !l.visible || playhead.current < l.start || playhead.current >= l.end) return;
    if (['Enter', ' '].includes(event.key)) { event.preventDefault(); onSelect(l.id); return; }
    if (l.locked || gesture.current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); onSelect(l.id);
    const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (l.type === 'carousel' && (event.shiftKey || event.altKey || event.target.closest('[data-canvas-ring]'))) {
      const step = event.shiftKey ? 5 : 1;
      onPatch(l.id, dragOrientation({ tilt: l.tilt, yaw: l.yaw ?? 0, roll: l.roll }, dx * step / 180, dy * step / 180, event.altKey || event.target.closest('[data-canvas-ring]') ? (dx || dy) * step : null));
    } else if (l.type === 'carousel') {
      const [w, h] = FORMATS[project.format];
      onPatch(l.id, carouselPlacement(l.x + dx / w * 100, l.y + dy / h * 100));
    } else if (['text', 'logo', 'media', 'model'].includes(l.type)) {
      const box = root.current.getBoundingClientRect(), b = nodeFor(l.id).getBoundingClientRect();
      const w = b.width / box.width * 100, h = b.height / box.height * 100;
      const node = nodeFor(l.id), position = { x: parseFloat(node.style.left), y: parseFloat(node.style.top) };
      onPatch(l.id, nudgePlacement(position, dx, dy, FORMATS[project.format], { width: w, height: h }, event.shiftKey ? 10 : 1, project.layout));
    }
  }
  const carousel = layer?.type === 'carousel' && layer.visible && time >= layer.start && time < layer.end ? layer : null;
  const ring = carousel && !carousel.locked ? <svg className="canvas-orientation-ring" style={{ left: `${draft?.x ?? carousel.x}%`, top: `${draft?.y ?? carousel.y}%` }} viewBox="0 0 100 100" data-canvas-ring="true" role="button" tabIndex={0} aria-label="Rotate carousel Z: drag ring or use arrow keys; Escape cancels"><circle cx="50" cy="50" r="45"/><circle className="canvas-ring-handle" cx={50 + 45 * Math.cos((draft?.roll ?? carousel.roll) * Math.PI / 180)} cy={50 + 45 * Math.sin((draft?.roll ?? carousel.roll) * Math.PI / 180)} r="2"/></svg> : null;
  return { ring, handlers: { onPointerDown: begin, onPointerMove: move, onPointerUp: finish, onPointerCancel: e => finish(e, true), onLostPointerCapture: e => finish(e, true), onKeyDown: keys } };
}
