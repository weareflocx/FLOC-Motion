import { nudgeAmount } from './nudge.js';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { canvasWheelSize, carouselPlacement, freePlacement, gridPlacement, nearestGridPoint, nudgePlacement } from '../editor-controls.js';
import { FORMATS } from '../project.js';
import { alignmentPlacement, DEFAULT_LAYOUT } from '../layout.js';
import { dragOrientation, wrapDegrees } from '../orientation.js';
import { evaluateChoreography } from '../choreography.js';
import { canvasMediaPlacement, centeredResize, layerResizeBounds, snapCenteredResize } from './canvas-resize.js';

// Drag previews commit on release; wheel previews commit after scrolling or before history/selection changes.
export function useCanvasInteraction({ nudge, root, engine, project, sceneKey, selected, time, onSelect, onPatch, onPreview, onPendingEdit, enabled = true }) {
  const gesture = useRef(null);
  const wheelDraft = useRef(null);
  const playhead = useRef(time); playhead.current = time;
  const [draft, setDraft] = useState(null);
  const sourceLayer = project.layers.find(l => l.id === selected);
  const layer = sourceLayer && evaluateChoreography(sourceLayer, time);
  const layout = project.layout ?? DEFAULT_LAYOUT;
  const nodeFor = id => [...(root.current?.querySelectorAll('[data-floc-layer]') || [])].find(n => n.dataset.flocLayer === id);
  const cancelWheel = useCallback(() => {
    if (!wheelDraft.current) return;
    clearTimeout(wheelDraft.current.timer); wheelDraft.current = null;
    onPendingEdit?.(null); onPreview(null);
  }, [onPendingEdit, onPreview]);
  const commitWheel = useCallback(() => {
    const edit = wheelDraft.current; if (!edit) return;
    clearTimeout(edit.timer); wheelDraft.current = null;
    onPendingEdit?.(null); onPreview(null);
    if (edit.patch.size !== edit.layer.size) onPatch(edit.layer.id, edit.patch);
  }, [onPendingEdit, onPreview, onPatch]);
  function cancel() { gesture.current = null; cancelWheel(); setDraft(null); onPreview(null); }
  useEffect(() => {
    if (gesture.current && (!enabled || gesture.current.layer.id !== selected || gesture.current.project !== project)) cancel();
    const edit = wheelDraft.current;
    if (edit && (!enabled || edit.project !== project)) cancelWheel();
    else if (edit && edit.layer.id !== selected) commitWheel();
  }, [selected, project, enabled, cancelWheel, commitWheel]);
  useEffect(() => () => { cancelWheel(); onPreview?.(null); }, [cancelWheel, onPreview]);
  useEffect(() => {
    const node = root.current?.parentElement ?? root.current;
    function wheel(event) {
      if (!enabled || event.ctrlKey || gesture.current || !layer || layer.locked || !['text', 'logo', 'carousel', 'media', 'model'].includes(layer.type) || pick(event.clientX, event.clientY)?.id !== selected) return;
      event.preventDefault();
      onSelect(layer.id);
      const size = canvasWheelSize(layer, event.deltaY, wheelDraft.current?.size ?? layer.size);
      const bounds = wheelDraft.current?.bounds ?? layerResizeBounds(layer, root.current);
      const patch = bounds ? centeredResize(layer, size, bounds) : { size };
      clearTimeout(wheelDraft.current?.timer);
      onPreview({ id: layer.id, x: layer.x, y: layer.y, ...patch });
      wheelDraft.current = { layer, project, size, bounds, patch, timer: setTimeout(commitWheel, 250) };
      onPendingEdit?.(commitWheel);
    }
    node?.addEventListener('wheel', wheel, { passive: false });
    return () => node?.removeEventListener('wheel', wheel);
  }, [project, selected, time, layer?.size, enabled, commitWheel, onPendingEdit, onPreview, onSelect]);
  useEffect(() => {
    for (const l of project.layers) {
      const node = nodeFor(l.id); if (!node || !['text', 'logo', 'carousel', 'media', 'model', 'background'].includes(l.type)) continue;
      node.classList.toggle('canvas-selected', l.id === selected && l.type !== 'carousel');
      const visible = l.visible && time >= l.start && time < l.end;
      node.tabIndex = visible && enabled ? 0 : -1; node.setAttribute('role', 'button');
      node.setAttribute('aria-disabled', String(!enabled));
      node.setAttribute('aria-hidden', String(!visible));
      node.setAttribute('aria-label', `Edit ${l.name}${l.locked ? ' (locked)' : ['carousel', 'model'].includes(l.type) ? ': drag to move; Shift-drag to orient X/Y; Shift+Alt-drag to rotate Z; Escape cancels' : ': drag to move; Shift+Alt-drag or drag rotation handle to rotate Z; Escape cancels'}`);
      node.style.pointerEvents = enabled ? 'auto' : 'none';
      node.draggable = false;
    }
  }, [project, selected, time, sceneKey, enabled]);
  function pick(x, y) {
    const box = root.current.getBoundingClientRect();
    for (const source of [...project.layers].reverse()) {
      const l = evaluateChoreography(source, playhead.current);
      if (!l.visible || playhead.current < l.start || playhead.current >= l.end || l.type === 'music') continue;
      const node = nodeFor(l.id); if (!node || Number(node.style.opacity) <= 0) continue;
      const b = node.getBoundingClientRect();
      if (x < b.left || x > b.right || y < b.top || y > b.bottom) continue;
      if (['text', 'logo', 'media', 'model'].includes(l.type)) return l;
      if (l.type === 'carousel' && engine.current?.hitTest((x - box.left) / box.width, (y - box.top) / box.height, l.id)) return l;
      if (l.type === 'background') return l.id === selected ? l : null;
    }
    return null;
  }
  function begin(event) {
    if (!enabled || event.button !== 0 || gesture.current) return;
    const ring = event.target.closest('[data-canvas-ring]');
    const resize = event.target.closest('[data-canvas-resize]');
    const selection = event.target.closest('[data-canvas-move]');
    const ringLayer = (ring || resize || selection) && project.layers.find(l => l.id === selected && l.type !== 'music');
    const l = ringLayer ? evaluateChoreography(ringLayer, playhead.current) : pick(event.clientX, event.clientY);
    if (!l) { commitWheel(); onSelect(null); onPreview(null); return; }
    if (wheelDraft.current) return;
    event.preventDefault(); onSelect(l.id);
    nodeFor(l.id)?.focus({ preventScroll: true });
    if (l.locked) return;
    const box = root.current.getBoundingClientRect();
    const b = nodeFor(l.id).getBoundingClientRect();
    const spatial = ['carousel', 'model'].includes(l.type);
    const rollDrag = !resize && !event.metaKey && !event.ctrlKey && event.shiftKey && event.altKey;
    const orient = !!ring || !resize && !event.metaKey && !event.ctrlKey && (spatial && event.shiftKey || rollDrag);
    const center = l.type === 'carousel' ? { x: box.left + box.width * l.x / 100, y: box.top + box.height * l.y / 100 } : { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
    const measured = ['logo', 'media', 'model'].includes(l.type) && layerResizeBounds(l, root.current);
    const angle = (l.type === 'model' ? 0 : l.roll ?? 0) * Math.PI / 180;
    const dx = event.clientX - center.x, dy = event.clientY - center.y;
    const localX = dx * Math.cos(angle) + dy * Math.sin(angle), localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
    const halfWidth = measured && measured.width / 100 * box.width / 2, halfHeight = measured && measured.height / 100 * box.height / 2;
    const tolerance = Math.min(12, halfWidth / 2, halfHeight / 2);
    const nearCorner = measured && Math.abs(Math.abs(localX) - halfWidth) <= tolerance && Math.abs(Math.abs(localY) - halfHeight) <= tolerance;
    const resizing = !orient && (!!resize || l.id === selected && (event.metaKey || event.ctrlKey) && nearCorner);
    if (resizing && Math.hypot(dx, dy) < 1) return;
    const bounds = resizing && measured;
    const initial = orient ? spatial ? { tilt: l.tilt, yaw: l.yaw ?? 0, roll: l.roll } : { roll: l.roll ?? 0 } : ['carousel', 'background'].includes(l.type) ? { x: l.x ?? 0, y: l.y ?? 0 } : { x: parseFloat(nodeFor(l.id).style.left), y: parseFloat(nodeFor(l.id).style.top), ...(resizing ? { size: l.size } : {}) };
    const visualOffset = !orient && ['text', 'logo', 'media'].includes(l.type) ? { x: (b.left - box.left) / box.width * 100 - initial.x, y: (b.top - box.top) / box.height * 100 - initial.y } : { x: 0, y: 0 };
    const targets = project.layers.filter(other => other.id !== l.id && other.visible && playhead.current >= other.start && playhead.current < other.end).map(other => evaluateChoreography(other, playhead.current)).flatMap(other => {
      if (other.type === 'carousel') return [{ x: other.x, y: other.y, width: 0, height: 0 }];
      const node = nodeFor(other.id); if (!node || !['text', 'logo', 'media', 'model'].includes(other.type)) return [];
      const rect = node.getBoundingClientRect();
      return [{ x: (rect.left - box.left) / box.width * 100, y: (rect.top - box.top) / box.height * 100, width: rect.width / box.width * 100, height: rect.height / box.height * 100 }];
    });
    const visualBounds = { x: (b.left - box.left) / box.width * 100, y: (b.top - box.top) / box.height * 100, width: b.width / box.width * 100, height: b.height / box.height * 100 };
    gesture.current = { id: event.pointerId, layer: l, project, box, initial, visualOffset, visualBounds, targets, latest: initial, orient, spatial, rollDrag, center, bounds, resize: resizing, vector: { x: event.clientX - center.x, y: event.clientY - center.y }, ring: !!ring, x: event.clientX, y: event.clientY, width: b.width / box.width * 100, height: b.height / box.height * 100, angle: Math.atan2(event.clientY - center.y, event.clientX - center.x), delta: 0, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event) {
    const g = gesture.current; if (!enabled || !g || g.id !== event.pointerId) return;
    const dx = event.clientX - g.x, dy = event.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) < 3) return;
    g.moved = true;
    if (g.resize && g.bounds) {
      const v = g.vector;
      const ratio = ((event.clientX - g.center.x) * v.x + (event.clientY - g.center.y) * v.y) / (v.x * v.x + v.y * v.y);
      const size = g.layer.size * ratio;
      g.latest = event.shiftKey ? centeredResize(g.layer, size, g.bounds) : snapCenteredResize(g.layer, size, g.bounds, g.visualBounds, layout, { x: 600 / g.box.width, y: 600 / g.box.height });
    } else if (g.orient) {
      const angle = Math.atan2(event.clientY - g.center.y, event.clientX - g.center.x);
      g.delta += wrapDegrees((angle - g.angle) * 180 / Math.PI); g.angle = angle;
      const rollDelta = g.ring ? g.delta : g.rollDrag ? dx / g.box.width * 180 : null;
      g.latest = g.spatial ? dragOrientation(g.initial, dx / g.box.width, dy / g.box.height, rollDelta, g.layer.type === 'model' ? 180 : 65) : { roll: wrapDegrees(g.initial.roll + rollDelta) };
    } else if (g.layer.type === 'background') {
      g.latest = { x: Math.max(-100, Math.min(100, g.initial.x + dx / g.box.width * 100)), y: Math.max(-100, Math.min(100, g.initial.y + dy / g.box.height * 100)) };
    } else if (g.layer.type === 'carousel') {
      g.latest = carouselPlacement(g.initial.x + dx / g.box.width * 100, g.initial.y + dy / g.box.height * 100);
    } else if (['logo', 'media', 'model'].includes(g.layer.type)) {
      g.latest = canvasMediaPlacement(g.initial.x + dx / g.box.width * 100, g.initial.y + dy / g.box.height * 100);
      if (!event.shiftKey) {
        const visual = { x: g.latest.x + g.visualOffset.x, y: g.latest.y + g.visualOffset.y };
        const snapped = alignmentPlacement(visual, g, layout.guides ? g.targets : [], layout, { x: 600 / g.box.width, y: 600 / g.box.height }, { constrain: false });
        g.latest = { ...canvasMediaPlacement(snapped.x - g.visualOffset.x, snapped.y - g.visualOffset.y), guides: snapped.guides };
      }
    } else {
      const x = g.initial.x + g.visualOffset.x + dx / g.box.width * 100, y = g.initial.y + g.visualOffset.y + dy / g.box.height * 100;
      const point = event.altKey ? gridPlacement(nearestGridPoint(x + g.width / 2, y + g.height / 2), g.width, g.height) : { x, y };
      g.latest = { ...point, ...freePlacement(point.x, point.y, g.width, g.height, project.layout) };
      if (!event.altKey && !event.shiftKey && layout.guides) g.latest = alignmentPlacement(g.latest, g, g.targets, layout, { x: 600 / g.box.width, y: 600 / g.box.height });
      g.latest = { ...g.latest, x: Math.max(0, Math.min(95, g.latest.x - g.visualOffset.x)), y: Math.max(0, Math.min(95, g.latest.y - g.visualOffset.y)) };
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
    if (!enabled) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      const editing = gesture.current || wheelDraft.current;
      cancel();
      if (!editing) onSelect(null);
      return;
    }
    const target = event.target.closest('[data-floc-layer]');
    const source = target ? project.layers.find(l => l.id === target.dataset.flocLayer) : sourceLayer;
    const l = source && evaluateChoreography(source, playhead.current);
    if (!l || !l.visible || playhead.current < l.start || playhead.current >= l.end) return;
    if (event.key === 'Enter') { event.preventDefault(); onSelect(l.id); return; }
    if (l.locked || gesture.current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); onSelect(l.id);
    commitWheel();
    const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (event.target.closest('[data-canvas-resize]')) {
      const size = canvasWheelSize(l, -(dx || -dy));
      const bounds = layerResizeBounds(l, root.current);
      if (bounds) onPatch(l.id, centeredResize(l, size, bounds));
    } else if (l.type !== 'carousel' && l.type !== 'music' && (event.altKey || event.target.closest('[data-canvas-ring]'))) {
      onPatch(l.id, { roll: wrapDegrees((l.roll ?? 0) + (dx || dy) * (event.shiftKey ? 5 : 1)) });
    } else if (l.type === 'background') {
      const [w, h] = FORMATS[project.format], step = nudgeAmount(nudge, event.shiftKey);
      onPatch(l.id, { x: Math.max(-100, Math.min(100, l.x + dx * step / w * 100)), y: Math.max(-100, Math.min(100, l.y + dy * step / h * 100)) });
    } else if (l.type === 'carousel' && (event.altKey || event.target.closest('[data-canvas-ring]'))) {
      const step = event.shiftKey ? 5 : 1;
      onPatch(l.id, dragOrientation({ tilt: l.tilt, yaw: l.yaw ?? 0, roll: l.roll }, dx * step / 180, dy * step / 180, event.altKey || event.target.closest('[data-canvas-ring]') ? (dx || dy) * step : null));
    } else if (l.type === 'carousel') {
      const [w, h] = FORMATS[project.format];
      onPatch(l.id, carouselPlacement(l.x + dx * nudgeAmount(nudge, event.shiftKey) / w * 100, l.y + dy * nudgeAmount(nudge, event.shiftKey) / h * 100));
    } else if (['logo', 'media', 'model'].includes(l.type)) {
      const [w, h] = FORMATS[project.format], step = nudgeAmount(nudge, event.shiftKey);
      onPatch(l.id, canvasMediaPlacement(l.x + dx * step / w * 100, l.y + dy * step / h * 100));
    } else if (l.type === 'text') {
      const box = root.current.getBoundingClientRect(), b = nodeFor(l.id).getBoundingClientRect();
      const w = b.width / box.width * 100, h = b.height / box.height * 100;
      const node = nodeFor(l.id), position = { x: parseFloat(node.style.left), y: parseFloat(node.style.top) };
      const visual = { x: (b.left - box.left) / box.width * 100, y: (b.top - box.top) / box.height * 100 };
      const next = nudgePlacement(visual, dx, dy, FORMATS[project.format], { width: w, height: h }, nudgeAmount(nudge, event.shiftKey), project.layout);
      onPatch(l.id, { x: Math.max(0, Math.min(95, position.x + next.x - visual.x)), y: Math.max(0, Math.min(95, position.y + next.y - visual.y)) });
    }
  }
  const editable = enabled && layer && !['music', 'effect'].includes(layer.type) && layer.visible && time >= layer.start && time < layer.end && !layer.locked ? layer : null;
  const node = editable && nodeFor(editable.id);
  const frame = root.current?.getBoundingClientRect();
  const box = node?.getBoundingClientRect();
  const center = editable?.type === 'carousel' ? { x: draft?.x ?? editable.x, y: draft?.y ?? editable.y }
    : box && frame ? { x: (box.left + box.width / 2 - frame.left) / frame.width * 100, y: (box.top + box.height / 2 - frame.top) / frame.height * 100 } : null;
  const angle = (draft?.roll ?? editable?.roll ?? 0) * Math.PI / 180;
  const ring = editable && center ? editable.type === 'carousel' ? <svg className="canvas-orientation-ring" style={{ left: `${center.x}%`, top: `${center.y}%` }} viewBox="0 0 100 100" data-canvas-ring="true" role="button" tabIndex={0} aria-label="Rotate carousel Z: drag ring or use arrow keys; Escape cancels"><circle cx="50" cy="50" r="45"/><circle className="canvas-ring-handle" cx={50 + 45 * Math.cos(angle)} cy={50 + 45 * Math.sin(angle)} r="2"/></svg>
    : <svg className="canvas-orientation-ring canvas-layer-rotation" style={{ left: `${center.x}%`, top: `${center.y}%` }} viewBox="0 0 100 100" data-canvas-ring="true" role="button" tabIndex={0} aria-label={`Rotate ${editable.name}: drag handle or use arrow keys; Escape cancels`}><circle cx="50" cy="50" r="45"/><circle className="canvas-ring-handle" cx={50 + 45 * Math.cos(angle)} cy={50 + 45 * Math.sin(angle)} r="3"/></svg> : null;
  const scale = frame?.width / FORMATS[project.format][0] || 1;
  const fitsWidth = box && frame && Math.abs(box.left - frame.left) < .5 && Math.abs(box.right - frame.right) < .5;
  const fitsHeight = box && frame && Math.abs(box.top - frame.top) < .5 && Math.abs(box.bottom - frame.bottom) < .5;
  const fitLabel = fitsWidth && fitsHeight ? 'Fits width & height' : fitsWidth ? 'Fits width' : fitsHeight ? 'Fits height' : null;
  const selection = editable && center && ['logo', 'media', 'model'].includes(editable.type) && node ? <div className="canvas-transform-box" data-canvas-move="true" style={{ left: `${center.x}%`, top: `${center.y}%`, width: `${node.offsetWidth}px`, height: `${node.offsetHeight}px`, transform: `translate(-50%,-50%) rotate(${editable.type === 'model' ? 0 : draft?.roll ?? editable.roll ?? 0}deg)`, '--handle-size': `${10 / scale}px`, '--handle-offset': `${24 / scale}px`, '--selection-line': `${1 / scale}px`, '--fit-font-size': `${11 / scale}px`, '--fit-padding': `${4 / scale}px` }}>
    {['nw', 'ne', 'sw', 'se'].map(corner => <button key={corner} type="button" className={`canvas-resize-handle ${corner}`} data-canvas-resize={corner} title="Resize from center · ⌘/Ctrl-drag an object corner · Shift bypasses snapping · Escape cancels" aria-label={`Resize ${editable.name} from ${corner}: drag from center or use arrow keys; Command/Control-drag an object corner; Shift bypasses snapping; Escape cancels`}/>)}
    <button type="button" className="canvas-rotate-handle" data-canvas-ring="true" aria-label={`Rotate ${editable.name}: drag or use arrow keys; Escape cancels`}/>
    {fitLabel && <span className="canvas-fit-label" role="status">{fitLabel}</span>}
  </div> : null;
  return { ring: selection ?? ring, handlers: { onPointerDown: begin, onPointerMove: move, onPointerUp: finish, onPointerCancel: e => finish(e, true), onLostPointerCapture: e => finish(e, true), onKeyDown: keys, onDragStart: e => e.preventDefault() } };
}
