import { nudgeAmount } from './nudge.js';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { canvasWheelSize, carouselPlacement, gridPlacement, nearestGridPoint, nudgePlacement } from '../editor-controls.js';
import { FORMATS } from '../project.js';
import { alignmentPlacement, DEFAULT_LAYOUT } from '../layout.js';
import { dragModelOrientation, dragOrientation, wrapDegrees } from '../orientation.js';
import { evaluateChoreography } from '../choreography.js';
import { canvasMediaPlacement, centeredResize, layerResizeBounds, snapCenteredResize } from './canvas-resize.js';
import { layerPosition, measureLayerBounds, projectedRect, projectedShift } from './layer-bounds.js';
import { transformableLayers } from './selection.js';
import { groupPositions, placeLayer, selectionBounds } from './arrange.js';

// Drag previews commit on release; wheel previews commit after scrolling or before history/selection changes.
// With several layers selected, dragging or nudging any member moves every transformable member as one edit.
export function useCanvasInteraction({ nudge, root, engine, project, sceneKey, selected, selection: selectionIds, time, clock, onSelect, onToggle, onPatch, onMoveGroup, onPreview, onPendingEdit, enabled = true }) {
  const selectedIds = selectionIds ?? (selected == null ? [] : [selected]);
  const multi = selectedIds.length > 1;
  const gesture = useRef(null);
  const wheelDraft = useRef(null);
  // Gestures read the live clock: while playing, `time` stays at the playback origin.
  const playhead = () => clock.get().time;
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
    if (gesture.current && (!enabled || !gesture.current.group && !gesture.current.toggle && gesture.current.layer.id !== selected || gesture.current.project !== project)) cancel();
    const edit = wheelDraft.current;
    if (edit && (!enabled || edit.project !== project)) cancelWheel();
    else if (edit && edit.layer.id !== selected) commitWheel();
  }, [selected, project, enabled, cancelWheel, commitWheel]);
  useEffect(() => () => { cancelWheel(); onPreview?.(null); }, [cancelWheel, onPreview]);
  useEffect(() => {
    const node = root.current?.parentElement ?? root.current;
    function wheel(event) {
      if (!enabled || multi || event.ctrlKey || gesture.current || !layer || layer.locked || !['text', 'logo', 'carousel', 'media', 'model'].includes(layer.type) || pick(event.clientX, event.clientY)?.id !== selected) return;
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
  }, [project, selected, multi, time, layer?.size, enabled, commitWheel, onPendingEdit, onPreview, onSelect]);
  useEffect(() => {
    for (const l of project.layers) {
      const node = nodeFor(l.id); if (!node || !['text', 'logo', 'carousel', 'media', 'model', 'background'].includes(l.type)) continue;
      node.classList.toggle('canvas-selected', enabled && selectedIds.includes(l.id) && l.type !== 'carousel');
      const visible = l.visible && time >= l.start && time < l.end;
      node.tabIndex = visible && enabled ? 0 : -1; node.setAttribute('role', 'button');
      node.setAttribute('aria-disabled', String(!enabled));
      node.setAttribute('aria-hidden', String(!visible));
      node.setAttribute('aria-label', `Edit ${l.name}${l.locked ? ' (locked)' : ['carousel', 'model'].includes(l.type) ? ': drag to move; Shift-drag to orient X/Y; Shift+Alt-drag to rotate Z; Escape cancels' : ': drag to move; Shift+Alt-drag or drag rotation handle to rotate Z; Escape cancels'}`);
      node.style.pointerEvents = 'none';
      node.draggable = false;
    }
  }, [project, selected, selectionIds, time, sceneKey, enabled]);
  function pick(x, y) {
    const box = root.current.getBoundingClientRect();
    const id = engine.current?.pick((x - box.left) / box.width, (y - box.top) / box.height);
    const source = project.layers.find(item => item.id === id);
    if (!source) return null;
    const at = playhead(), candidate = evaluateChoreography(source, at);
    return candidate.visible && at >= candidate.start && at < candidate.end && !['music', 'effect'].includes(candidate.type) && (candidate.type !== 'background' || candidate.id === selected) ? candidate : null;
  }
  function begin(event) {
    if (!enabled || event.button !== 0 || gesture.current) return;
    const ring = event.target.closest('[data-canvas-ring]');
    const resize = event.target.closest('[data-canvas-resize]');
    const ringLayer = (ring || resize) && project.layers.find(l => l.id === selected && l.type !== 'music');
    const l = ringLayer ? evaluateChoreography(ringLayer, playhead()) : pick(event.clientX, event.clientY);
    // Shift/⌘/Ctrl-click toggles a layer; the same modifiers keep their drag meanings.
    const toggle = !ringLayer && !event.altKey && (event.shiftKey || event.metaKey || event.ctrlKey);
    if (!l) { if (!toggle) { commitWheel(); onSelect(null); onPreview(null); } return; }
    if (wheelDraft.current) return;
    event.preventDefault();
    nodeFor(l.id)?.focus({ preventScroll: true });
    if (multi && !ringLayer && selectedIds.includes(l.id)) { beginGroup(event, l, toggle); return; }
    if (toggle && l.locked) { onToggle?.(l.id); return; }
    if (!toggle) onSelect(l.id);
    if (l.locked) return;
    const box = root.current.getBoundingClientRect();
    const shown = projectedRect(root.current, l.id, engine.current);
    if (!shown) return;
    const spatial = ['carousel', 'model'].includes(l.type);
    const rollDrag = !resize && !event.metaKey && !event.ctrlKey && event.shiftKey && event.altKey;
    const orient = !!ring || !resize && !event.metaKey && !event.ctrlKey && (spatial && event.shiftKey && ['carousel', 'model'].includes(l.type) || rollDrag);
    const center = { x: (shown.left + shown.right) / 2, y: (shown.top + shown.bottom) / 2 };
    const measured = ['logo', 'media', 'model'].includes(l.type) && layerResizeBounds(l, root.current);
    const dx = event.clientX - center.x, dy = event.clientY - center.y;
    const halfWidth = shown.width / 2, halfHeight = shown.height / 2;
    const tolerance = Math.min(12, halfWidth / 2, halfHeight / 2);
    const nearCorner = measured && Math.abs(Math.abs(dx) - halfWidth) <= tolerance && Math.abs(Math.abs(dy) - halfHeight) <= tolerance;
    const resizing = !orient && (!!resize || l.id === selected && (event.metaKey || event.ctrlKey) && nearCorner);
    if (resizing && Math.hypot(dx, dy) < 1) return;
    const bounds = resizing && measured;
    const initial = orient ? spatial ? { tilt: l.tilt ?? 0, yaw: l.yaw ?? 0, roll: l.roll ?? 0 } : { roll: l.roll ?? 0 } : { ...layerPosition(root.current, l), ...(resizing ? { size: l.size } : {}) };
    const at = playhead(), targets = measureLayerBounds(root.current, project.layers.filter(other => other.id !== l.id && other.visible && at >= other.start && at < other.end).map(other => evaluateChoreography(other, at)), engine.current);
    const visualBounds = { x: (shown.left - box.left) / box.width * 100, y: (shown.top - box.top) / box.height * 100, width: shown.width / box.width * 100, height: shown.height / box.height * 100 };
    const pointer = engine.current?.projectPointer((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height, l.id);
    if (!orient && !resizing && l.type !== 'background' && !pointer) return;
    gesture.current = { id: event.pointerId, layer: l, project, box, initial, visualBounds, targets, latest: initial, orient, spatial, rollDrag, center, bounds, resize: resizing, pointer, vector: { x: event.clientX - center.x, y: event.clientY - center.y }, ring: !!ring, x: event.clientX, y: event.clientY, width: visualBounds.width, height: visualBounds.height, angle: Math.atan2(event.clientY - center.y, event.clientX - center.x), delta: 0, moved: false, toggle };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function members(at) {
    const layers = transformableLayers(project, selectedIds, at);
    return { layers, members: layers.map(item => ({ id: item.id, type: item.type, start: layerPosition(root.current, item) })) };
  }
  const changedPositions = (positions, list) => positions.filter(position => {
    const member = list.find(item => item.id === position.id);
    return position.x !== member.start.x || position.y !== member.start.y;
  });
  function beginGroup(event, l, toggle) {
    const at = playhead(), box = root.current.getBoundingClientRect(), group = members(at);
    const others = project.layers.filter(other => !selectedIds.includes(other.id) && other.visible && at >= other.start && at < other.end).map(other => evaluateChoreography(other, at));
    gesture.current = { id: event.pointerId, group: true, toggle, layer: l, project, box, members: group.members, bounds: selectionBounds(measureLayerBounds(root.current, group.layers, engine.current)), targets: measureLayerBounds(root.current, others, engine.current), latest: null, x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event) {
    const g = gesture.current; if (!enabled || !g || g.id !== event.pointerId) return;
    const dx = event.clientX - g.x, dy = event.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) < 3) return;
    g.moved = true;
    if (g.group) {
      if (!g.members.length) return;
      let shiftX = dx / g.box.width * 100, shiftY = dy / g.box.height * 100, guides;
      if (!event.shiftKey && layout.guides && g.bounds) {
        const snapped = alignmentPlacement({ x: g.bounds.x + shiftX, y: g.bounds.y + shiftY }, g.bounds, g.targets, layout, { x: 600 / g.box.width, y: 600 / g.box.height }, { constrain: false });
        shiftX = snapped.x - g.bounds.x; shiftY = snapped.y - g.bounds.y; guides = snapped.guides;
      }
      const shifts = g.members.map(member => ({ member, delta: projectedShift(root.current, member.id, (g.x - g.box.left) / g.box.width * 100, (g.y - g.box.top) / g.box.height * 100, shiftX, shiftY, engine.current) }));
      if (shifts.some(item => !item.delta)) return;
      // Stop the whole visible arrangement when its first member reaches a stored-position limit.
      const fraction = shifts.reduce((limit, { member, delta }) => {
        const bounded = placeLayer(member.type, member.start, delta.x, delta.y);
        return Math.min(limit, ...['x', 'y'].filter(axis => Math.abs(delta[axis]) > 1e-8).map(axis => Math.max(0, Math.min(1, (bounded[axis] - member.start[axis]) / delta[axis]))));
      }, 1);
      g.latest = shifts.map(({ member, delta }) => ({ id: member.id, ...placeLayer(member.type, member.start, delta.x * fraction, delta.y * fraction) }));
      setDraft({ group: true });
      onPreview({ layers: Object.fromEntries(g.latest.map(({ id, x, y }) => [id, { x, y }])), guides });
      return;
    }
    if (g.resize && g.bounds) {
      const v = g.vector;
      const ratio = ((event.clientX - g.center.x) * v.x + (event.clientY - g.center.y) * v.y) / (v.x * v.x + v.y * v.y);
      const size = g.layer.size * ratio;
      const pivot = g.layer.space === 'spatial' ? { x: g.visualBounds.x + g.visualBounds.width / 2, y: g.visualBounds.y + g.visualBounds.height / 2 } : null;
      g.latest = event.shiftKey ? centeredResize(g.layer, size, g.bounds) : snapCenteredResize(g.layer, size, g.bounds, g.visualBounds, layout, { x: 600 / g.box.width, y: 600 / g.box.height }, pivot);
    } else if (g.orient) {
      const angle = Math.atan2(event.clientY - g.center.y, event.clientX - g.center.x);
      g.delta += wrapDegrees((angle - g.angle) * 180 / Math.PI); g.angle = angle;
      const rollDelta = g.ring ? g.delta : g.rollDrag ? dx / g.box.width * 180 : null;
      g.latest = g.layer.type === 'model' ? dragModelOrientation(g.initial, dx / g.box.width, dy / g.box.height, rollDelta) : g.spatial ? dragOrientation(g.initial, dx / g.box.width, dy / g.box.height, rollDelta) : { roll: wrapDegrees(g.initial.roll + rollDelta) };
    } else if (g.layer.type === 'background') {
      g.latest = { x: Math.max(-100, Math.min(100, g.initial.x + dx / g.box.width * 100)), y: Math.max(-100, Math.min(100, g.initial.y + dy / g.box.height * 100)) };
    } else {
      let shiftX = dx / g.box.width * 100, shiftY = dy / g.box.height * 100, guides;
      const visual = { x: g.visualBounds.x + shiftX, y: g.visualBounds.y + shiftY };
      if (g.layer.type === 'text' && event.altKey) {
        const point = gridPlacement(nearestGridPoint(visual.x + g.width / 2, visual.y + g.height / 2), g.width, g.height);
        shiftX = point.x - g.visualBounds.x; shiftY = point.y - g.visualBounds.y;
      } else if (!event.shiftKey && layout.guides) {
        const snapped = alignmentPlacement(visual, g.visualBounds, g.targets, layout, { x: 600 / g.box.width, y: 600 / g.box.height }, { constrain: g.layer.type === 'text' && g.layer.space === 'flat' });
        shiftX = snapped.x - g.visualBounds.x; shiftY = snapped.y - g.visualBounds.y; guides = snapped.guides;
      }
      const pointer = engine.current?.projectPointer((g.x - g.box.left) / g.box.width + shiftX / 100, (g.y - g.box.top) / g.box.height + shiftY / 100, g.layer.id);
      if (!pointer || !g.pointer) return;
      g.latest = { ...placeLayer(g.layer.type, g.initial, pointer.x - g.pointer.x, pointer.y - g.pointer.y), guides };
    }
    setDraft(g.latest); onPreview({ id: g.layer.id, ...g.latest });
  }
  function finish(event, aborted = false) {
    const g = gesture.current; if (!g || g.id !== event.pointerId) return;
    cancel();
    if (event.currentTarget.hasPointerCapture(g.id)) event.currentTarget.releasePointerCapture(g.id);
    if (g.group) {
      if (aborted) return;
      const positions = g.moved && g.latest ? changedPositions(g.latest, g.members) : [];
      if (positions.length) onMoveGroup(positions);
      else if (!g.moved) { if (g.toggle) onToggle?.(g.layer.id); else onSelect(g.layer.id); }
      return;
    }
    if (!aborted && g.moved) {
      const { gridIndex, guides, ...patch } = g.latest;
      if (g.toggle) onSelect(g.layer.id);
      if (Object.keys(patch).some(key => patch[key] !== g.initial[key])) onPatch(g.layer.id, patch);
    } else if (!aborted && g.toggle) onToggle?.(g.layer.id);
  }
  function keys(event) {
    if (!enabled) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      const editing = gesture.current || wheelDraft.current;
      cancel();
      if (!editing) onSelect(multi ? selected : null);
      return;
    }
    const target = event.target.closest('[data-floc-layer]');
    const source = target ? project.layers.find(l => l.id === target.dataset.flocLayer) : sourceLayer;
    const at = playhead(), l = source && evaluateChoreography(source, at);
    if (!l || !l.visible || at < l.start || at >= l.end) return;
    if (event.key === 'Enter') { event.preventDefault(); onSelect(l.id); return; }
    const arrow = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key);
    if (arrow && multi && !gesture.current && selectedIds.includes(l.id) && !event.altKey && !event.target.closest('[data-canvas-ring], [data-canvas-resize]')) {
      event.preventDefault();
      commitWheel();
      const [w, h] = FORMATS[project.format], step = nudgeAmount(nudge, event.shiftKey);
      const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
      const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
      const group = members(at).members;
      const positions = changedPositions(groupPositions(group, dx * step / w * 100, dy * step / h * 100), group);
      if (positions.length) onMoveGroup(positions);
      return;
    }
    if (l.locked || gesture.current || !arrow) return;
    event.preventDefault(); onSelect(l.id);
    commitWheel();
    const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (event.target.closest('[data-canvas-resize]')) {
      const size = canvasWheelSize(l, -(dx || -dy));
      const bounds = layerResizeBounds(l, root.current);
      if (bounds) onPatch(l.id, centeredResize(l, size, bounds));
    } else if (l.type !== 'carousel' && l.type !== 'music' && (event.altKey || event.target.closest('[data-canvas-ring]'))) {
      const delta = (dx || dy) * (event.shiftKey ? 5 : 1);
      onPatch(l.id, l.type === 'model' ? dragModelOrientation({ tilt: l.tilt, yaw: l.yaw, roll: l.roll }, 0, 0, delta) : { roll: wrapDegrees((l.roll ?? 0) + delta) });
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
      const box = root.current.getBoundingClientRect(), b = projectedRect(root.current, l.id, engine.current);
      if (!b) return;
      const w = b.width / box.width * 100, h = b.height / box.height * 100;
      const position = layerPosition(root.current, l);
      const visual = { x: (b.left - box.left) / box.width * 100, y: (b.top - box.top) / box.height * 100 };
      const [canvasWidth, canvasHeight] = FORMATS[project.format], step = nudgeAmount(nudge, event.shiftKey);
      const next = l.space === 'spatial'
        ? { x: visual.x + dx * step / canvasWidth * 100, y: visual.y + dy * step / canvasHeight * 100 }
        : nudgePlacement(visual, dx, dy, FORMATS[project.format], { width: w, height: h }, step, project.layout);
      const shift = projectedShift(root.current, l.id, visual.x, visual.y, next.x - visual.x, next.y - visual.y, engine.current);
      if (shift) onPatch(l.id, placeLayer(l.type, position, shift.x, shift.y));
    }
  }
  const editable = enabled && !multi && layer && !['music', 'effect'].includes(layer.type) && layer.visible && time >= layer.start && time < layer.end && !layer.locked ? layer : null;
  const frame = root.current?.getBoundingClientRect();
  const box = editable && projectedRect(root.current, editable.id, engine.current);
  const center = box && frame ? { x: (box.left + box.width / 2 - frame.left) / frame.width * 100, y: (box.top + box.height / 2 - frame.top) / frame.height * 100 } : null;
  const angle = (draft?.roll ?? editable?.roll ?? 0) * Math.PI / 180;
  const ring = editable && center ? editable.type === 'carousel' ? <svg className="canvas-orientation-ring" style={{ left: `${center.x}%`, top: `${center.y}%` }} viewBox="0 0 100 100" data-canvas-ring="true" role="button" tabIndex={0} aria-label="Rotate carousel Z: drag ring or use arrow keys; Escape cancels"><circle cx="50" cy="50" r="45"/><circle className="canvas-ring-handle" cx={50 + 45 * Math.cos(angle)} cy={50 + 45 * Math.sin(angle)} r="2"/></svg>
    : <svg className="canvas-orientation-ring canvas-layer-rotation" style={{ left: `${center.x}%`, top: `${center.y}%` }} viewBox="0 0 100 100" data-canvas-ring="true" role="button" tabIndex={0} aria-label={`Rotate ${editable.name}: drag handle or use arrow keys; Escape cancels`}><circle cx="50" cy="50" r="45"/><circle className="canvas-ring-handle" cx={50 + 45 * Math.cos(angle)} cy={50 + 45 * Math.sin(angle)} r="3"/></svg> : null;
  const scale = frame?.width / FORMATS[project.format][0] || 1;
  const [boxWidth, boxHeight] = box ? [box.width / scale, box.height / scale] : [0, 0];
  const fitsWidth = box && frame && Math.abs(box.left - frame.left) < .5 && Math.abs(box.right - frame.right) < .5;
  const fitsHeight = box && frame && Math.abs(box.top - frame.top) < .5 && Math.abs(box.bottom - frame.bottom) < .5;
  const fitLabel = fitsWidth && fitsHeight ? 'Fits width & height' : fitsWidth ? 'Fits width' : fitsHeight ? 'Fits height' : null;
  const selection = editable && center && ['text', 'logo', 'media', 'model'].includes(editable.type) ? <div className="canvas-transform-box" data-canvas-move="true" style={{ left: `${center.x}%`, top: `${center.y}%`, width: `${boxWidth}px`, height: `${boxHeight}px`, transform: 'translate(-50%,-50%)', '--handle-size': `${10 / scale}px`, '--handle-offset': `${24 / scale}px`, '--selection-line': `${1 / scale}px`, '--fit-font-size': `${11 / scale}px`, '--fit-padding': `${4 / scale}px` }}>
    {['logo', 'media', 'model'].includes(editable.type) && ['nw', 'ne', 'sw', 'se'].map(corner => <button key={corner} type="button" className={`canvas-resize-handle ${corner}`} data-canvas-resize={corner} title="Resize from center · ⌘/Ctrl-drag an object corner · Shift bypasses snapping · Escape cancels" aria-label={`Resize ${editable.name} from ${corner}: drag from center or use arrow keys; Command/Control-drag an object corner; Shift bypasses snapping; Escape cancels`}/>)}
    <button type="button" className="canvas-rotate-handle" data-canvas-ring="true" aria-label={`Rotate ${editable.name}: drag or use arrow keys; Escape cancels`}/>
    {fitLabel && <span className="canvas-fit-label" role="status">{fitLabel}</span>}
  </div> : null;
  // The group outline is measured at render time like the transform box; members keep their own outlines while dragging.
  const groupRect = enabled && multi && !draft?.group && root.current ? selectionBounds(measureLayerBounds(root.current, project.layers.filter(l => selectedIds.includes(l.id) && l.visible && time >= l.start && time < l.end).map(l => evaluateChoreography(l, time)), engine.current)) : null;
  const groupBox = groupRect ? <div className="canvas-group-box" aria-hidden="true" style={{ left: `${groupRect.x}%`, top: `${groupRect.y}%`, width: `${groupRect.width}%`, height: `${groupRect.height}%`, '--selection-line': `${1 / scale}px` }}/> : null;
  return { ring: selection ?? ring ?? groupBox, handlers: { onPointerDown: begin, onPointerMove: move, onPointerUp: finish, onPointerCancel: e => finish(e, true), onLostPointerCapture: e => finish(e, true), onKeyDown: keys, onDragStart: e => e.preventDefault() } };
}
