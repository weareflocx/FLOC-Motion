import React, { useEffect, useRef, useState } from 'react';
import { useCanvasInteraction } from './useCanvasInteraction.jsx';
import { FORMATS } from '../project.js';
import { createScene, stageMarkup } from '../scene.js';
import { updateTextPreview } from './text-preview.js';
import { updatePlacementPreview } from './placement-preview.js';
import { createPreviewSession } from './preview-session.js';
import { PlacementGuides } from './PlacementGuides.jsx';
import { DEFAULT_LAYOUT } from '../layout.js';
import { canvasViewport } from './canvas-viewport.js';

export function Stage({ project, time, playing, onError, onReady, positionPreview, selected, onSelect, onPatch, onPreview, onPendingEdit, zoom = 'fit', panning = false, onViewport, onExitPan }) {
  const [activeProject, setActiveProject] = useState(project);
  const [sceneReady, setSceneReady] = useState(false);
  const [geometry, setGeometry] = useState({ rect: null, targets: [] });
  const holder = useRef();
  const root = useRef();
  const ringRoot = useRef();
  const engine = useRef();
  const fitRef = useRef();
  const offset = useRef({ x: 0, y: 0 });
  const panGesture = useRef();
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const synchronized = sceneReady && activeProject === project;
  const timeRef = useRef({ time, playing });
  timeRef.current = { time, playing };

  const session = useRef();
  const callbacks = useRef();
  callbacks.current = { onReady, onError, onViewport };
  const previewRef = useRef(positionPreview);
  previewRef.current = positionPreview;

  useEffect(() => {
    const fit = () => {
      const active = session.current?.current;
      if (!holder.current || !root.current || !active) return;
      const [w, h] = FORMATS[active.project.format];
      const box = holder.current.getBoundingClientRect();
      const viewport = canvasViewport([w, h], box, zoomRef.current, offset.current);
      const { scale, x, y } = viewport;
      offset.current = { x, y };
      callbacks.current.onViewport?.(viewport);
      setGeometry(value => value.scale === scale ? value : { ...value, scale });
      root.current.style.width = `${w}px`;
      root.current.style.height = `${h}px`;
      root.current.style.transform = `translate(calc(-50% + ${x}px),calc(-50% + ${y}px)) scale(${scale})`;
      if (ringRoot.current) { ringRoot.current.style.width = `${w}px`; ringRoot.current.style.height = `${h}px`; ringRoot.current.style.transform = root.current.style.transform; }
      const resolution = Math.min(1, scale * Math.min(window.devicePixelRatio || 1, 2));
      active.scene.setResolution(Math.max(1, Math.round(w * resolution)), Math.max(1, Math.round(h * resolution)));
      active.scene.seek(timeRef.current.time, timeRef.current.playing);
    };
    fitRef.current = fit;
    const manager = createPreviewSession({
      async prepare(project) {
        const node = document.createElement('div');
        node.style.cssText = 'position:absolute;inset:0';
        node.innerHTML = stageMarkup(project);
        const grid = document.createElement('div');
        grid.className = 'position-grid-overlay'; grid.hidden = true; grid.setAttribute('aria-hidden', 'true');
        grid.append(document.createElement('i')); node.append(grid);
        const scene = await createScene(node, project, { onMediaError: error => callbacks.current.onError(error.message) });
        return { node, scene, project };
      },
      update(current, project) {
        if (!updateTextPreview(current, project) && !updatePlacementPreview(current, project)) return false;
        setActiveProject(project);
        return true;
      },
      activate(next) {
        const focused = root.current.contains(document.activeElement) ? document.activeElement.dataset.flocLayer : null;
        next.scene.setOrientation(previewRef.current?.id === next.project.layers.find(l => l.id === previewRef.current?.id && l.type === 'carousel')?.id ? previewRef.current : null);
        next.scene.setPlacement(previewRef.current);
        next.scene.seek(timeRef.current.time, timeRef.current.playing);
        root.current.replaceChildren(next.node);
        const layer = next.project.layers.find(l => l.id === focused);
        if (layer?.visible && timeRef.current.time >= layer.start && timeRef.current.time < layer.end) {
          const node = [...next.node.querySelectorAll('[data-floc-layer]')].find(n => n.dataset.flocLayer === focused);
          if (node) { node.tabIndex = 0; node.focus({ preventScroll: true }); }
        }
        engine.current = next.scene;
        setActiveProject(next.project);
        // The manager publishes current after activation.
        queueMicrotask(fit);
      },
      onError(error) { callbacks.current.onError(error.message); },
      onReady(value) { setSceneReady(value); callbacks.current.onReady?.(value); }
    });
    session.current = manager;
    const observer = new ResizeObserver(fit);
    observer.observe(holder.current);
    return () => { observer.disconnect(); manager.dispose(); session.current = null; engine.current = null; fitRef.current = null; };
  }, []);

  useEffect(() => { session.current?.request(project); }, [project]);
  useEffect(() => { offset.current = { x: 0, y: 0 }; fitRef.current?.(); }, [zoom, activeProject.format]);
  useEffect(() => {
    if (!panning) return;
    const node = holder.current;
    const blockResize = event => { if (!event.ctrlKey) { event.preventDefault(); event.stopPropagation(); } };
    node.addEventListener('wheel', blockResize, { capture: true, passive: false });
    return () => node.removeEventListener('wheel', blockResize, true);
  }, [panning]);

  function panStart(event) {
    if (!panning || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    holder.current.focus({ preventScroll: true });
    panGesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, offset: { ...offset.current } };
    holder.current.setPointerCapture(event.pointerId);
  }
  function panMove(event) {
    const gesture = panGesture.current; if (!gesture || gesture.id !== event.pointerId) return;
    event.stopPropagation();
    offset.current = { x: gesture.offset.x + event.clientX - gesture.x, y: gesture.offset.y + event.clientY - gesture.y };
    fitRef.current?.();
  }
  function panEnd(event, cancelled = false) {
    const gesture = panGesture.current; if (!gesture || gesture.id !== event.pointerId) return;
    event.stopPropagation(); panGesture.current = null;
    if (cancelled) { offset.current = gesture.offset; fitRef.current?.(); }
    if (holder.current.hasPointerCapture(gesture.id)) holder.current.releasePointerCapture(gesture.id);
  }
  function panKeys(event) {
    if (!panning) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (panGesture.current) panEnd({ pointerId: panGesture.current.id, stopPropagation() {} }, true);
      onExitPan?.(); return;
    }
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!delta) return;
    event.preventDefault(); event.stopPropagation();
    const step = event.shiftKey ? 80 : 20;
    offset.current = { x: offset.current.x + delta[0] * step, y: offset.current.y + delta[1] * step };
    fitRef.current?.();
  }

  useEffect(() => {
    let cancelled = false;
    const grid = root.current?.querySelector('.position-grid-overlay');
    if (grid) {
      const index = positionPreview?.gridIndex;
      grid.hidden = index === undefined;
      if (index !== undefined) {
        const marker = grid.firstElementChild;
        marker.className = index === 36 ? 'center' : '';
        marker.style.left = `${index === 36 ? 50 : index % 6 * 100 / 6}%`;
        marker.style.top = `${index === 36 ? 50 : Math.floor(index / 6) * 100 / 6}%`;
      }
    }
    engine.current?.setOrientation(synchronized && positionPreview?.id === activeProject.layers.find(l => l.id === positionPreview?.id && l.type === 'carousel')?.id ? positionPreview : null);
    engine.current?.setPlacement(synchronized ? positionPreview : null);
    const ready = engine.current?.seek(time, playing);
    Promise.resolve(ready).then(() => {
      if (cancelled || !synchronized || playing || !(activeProject.layout ?? DEFAULT_LAYOUT).guides) return;
      const frame = root.current.getBoundingClientRect(); if (!frame.width || !frame.height) return;
      const nodes = [...root.current.querySelectorAll('[data-floc-layer]')];
      const rects = activeProject.layers.filter(l => l.visible && time >= l.start && time < l.end).flatMap(l => {
        if (l.type === 'carousel') return [{ id: l.id, x: l.x, y: l.y, width: 0, height: 0 }];
        if (!['text', 'logo'].includes(l.type)) return [];
        const node = nodes.find(n => n.dataset.flocLayer === l.id); if (!node) return [];
        const box = node.getBoundingClientRect();
        return [{ id: l.id, x: (box.left - frame.left) / frame.width * 100, y: (box.top - frame.top) / frame.height * 100, width: box.width / frame.width * 100, height: box.height / frame.height * 100 }];
      });
      setGeometry({ rect: rects.find(r => r.id === selected), targets: rects.filter(r => r.id !== selected), scale: frame.width / FORMATS[activeProject.format][0] });
    });
    return () => { cancelled = true; };
  }, [positionPreview, project, activeProject, selected, time, playing, synchronized]);

  const { ring, handlers } = useCanvasInteraction({ root, engine, project: activeProject, sceneKey: activeProject, selected, time, onSelect, onPatch, onPreview, onPendingEdit, enabled: synchronized });
  return <div ref={holder} className={`stage-holder${panning ? ' is-panning' : ''}`} tabIndex={panning ? 0 : undefined} aria-label={panning ? 'Pan canvas: drag or use arrow keys; Escape exits' : undefined} onPointerDownCapture={panStart} onPointerMoveCapture={panMove} onPointerUpCapture={event => panEnd(event)} onPointerCancelCapture={event => panEnd(event, true)} onLostPointerCapture={event => panEnd(event, true)} onKeyDownCapture={panKeys}><div ref={root} className="stage" aria-label="Video composition preview" aria-busy={!synchronized} {...handlers}/><div ref={ringRoot} className="canvas-interaction-ring" {...handlers} style={{ width: `${FORMATS[activeProject.format][0]}px`, height: `${FORMATS[activeProject.format][1]}px`, transform: root.current?.style.transform }}>{ring}<PlacementGuides layout={activeProject.layout} rect={synchronized && !playing ? geometry.rect : null} targets={geometry.targets} dimensions={FORMATS[activeProject.format]} lines={synchronized ? positionPreview?.guides : undefined} scale={geometry.scale} fontSize={10 / (geometry.scale || 1)}/></div></div>;
}
