import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useCanvasInteraction } from './useCanvasInteraction.jsx';
import { FORMATS } from '../project.js';
import { createScene, stageMarkup } from '../scene.js';
import { createResourceCache } from '../scene-resources.js';
import { createPreviewSession } from './preview-session.js';
import { PlacementGuides } from './PlacementGuides.jsx';
import { DEFAULT_LAYOUT } from '../layout.js';
import { canvasViewport } from './canvas-viewport.js';
import { evaluateChoreography } from '../choreography.js';
import { usePlaybackTime } from './usePlayback.js';
import { measureLayerBounds } from './layer-bounds.js';
import { selectionBounds } from './arrange.js';
import { workspaceFontsReady } from './workspace-fonts.js';
import { ASSET_DRAG_TYPE } from '../media-library.js';

export function Stage({ nudge, project, clock, onError, onReady, positionPreview, selected, selection, onSelect, onToggle, onPatch, onMoveGroup, onPreview, onPendingEdit, onDropAsset, zoom = 'fit', panning = false, onViewport, onExitPan }) {
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
  // React re-renders on play, pause and seek; playback frames seek the scene from the clock subscription below.
  const playing = useSyncExternalStore(clock.subscribe, () => clock.get().playing);
  const time = usePlaybackTime(clock, Infinity);
  const clockRef = useRef(clock); clockRef.current = clock;

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
      const now = clockRef.current.get();
      active.scene.seek(now.time, now.playing);
    };
    fitRef.current = fit;
    // Rebuilds within this session reuse decoded card media and parsed models.
    const resources = createResourceCache();
    const manager = createPreviewSession({
      async prepare(project) {
        // Workspace @font-face rules must exist before the scene loads the faces it needs.
        await workspaceFontsReady();
        const node = document.createElement('div');
        node.style.cssText = 'position:absolute;inset:0';
        node.innerHTML = stageMarkup(project);
        const grid = document.createElement('div');
        grid.className = 'position-grid-overlay'; grid.hidden = true; grid.setAttribute('aria-hidden', 'true');
        grid.append(document.createElement('i')); node.append(grid);
        const scene = await createScene(node, project, { resources, onMediaError: error => callbacks.current.onError(error.message) });
        return { node, scene, project };
      },
      update(current, project) {
        if (!current.scene.update(project)) return false;
        setActiveProject(project);
        return true;
      },
      activate(next) {
        const focused = root.current.contains(document.activeElement) ? document.activeElement.dataset.flocLayer : null;
        next.scene.setOrientation(previewRef.current?.id === next.project.layers.find(l => l.id === previewRef.current?.id && l.type === 'carousel')?.id ? previewRef.current : null);
        next.scene.setPlacement(previewRef.current);
        const now = clockRef.current.get();
        next.scene.seek(now.time, now.playing);
        root.current.replaceChildren(next.node);
        const layer = next.project.layers.find(l => l.id === focused);
        if (layer?.visible && now.time >= layer.start && now.time < layer.end) {
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
  useEffect(() => clock.subscribe(() => { const now = clock.get(); if (now.playing) engine.current?.seek(now.time, true); }), [clock]);
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
    // `time` is exact while paused; while playing, the clock holds the frame to show.
    const now = clock.get();
    const ready = engine.current?.seek(now.time, now.playing);
    Promise.resolve(ready).then(() => {
      if (cancelled || !synchronized || now.playing) return;
      const frame = root.current.getBoundingClientRect(); if (!frame.width || !frame.height) return;
      const rects = measureLayerBounds(root.current, activeProject.layers.filter(l => l.visible && now.time >= l.start && now.time < l.end).map(l => evaluateChoreography(l, now.time)));
      // A multi-selection is guided as one box against the unselected layers.
      const ids = selection?.length > 1 ? selection : [selected];
      const chosen = rects.filter(r => ids.includes(r.id));
      setGeometry({ rect: ids.length > 1 ? selectionBounds(chosen) ?? undefined : chosen[0], targets: rects.filter(r => !ids.includes(r.id)), scale: frame.width / FORMATS[activeProject.format][0] });
    });
    return () => { cancelled = true; };
  }, [positionPreview, project, activeProject, selected, selection, time, playing, synchronized, clock]);

  const { ring, handlers } = useCanvasInteraction({ nudge, root, engine, project: activeProject, sceneKey: activeProject, selected, selection, time, clock, onSelect, onToggle, onPatch, onMoveGroup, onPreview, onPendingEdit, enabled: synchronized });
  // Media library items dropped on the canvas become layers centered on the pointer.
  const [assetOver, setAssetOver] = useState(false);
  const carriesAsset = event => Boolean(onDropAsset) && event.dataTransfer.types.includes(ASSET_DRAG_TYPE);
  const assetDrop = {
    onDragOver: event => { if (!carriesAsset(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setAssetOver(true); },
    onDragLeave: event => { if (!event.currentTarget.contains(event.relatedTarget)) setAssetOver(false); },
    onDrop: event => {
      if (!carriesAsset(event)) return;
      event.preventDefault(); setAssetOver(false);
      const box = root.current.getBoundingClientRect(), clamp = value => Math.max(0, Math.min(100, value));
      const asset = JSON.parse(event.dataTransfer.getData(ASSET_DRAG_TYPE));
      onDropAsset(asset, { x: clamp((event.clientX - box.left) / box.width * 100), y: clamp((event.clientY - box.top) / box.height * 100), aspect: asset.aspect });
    }
  };
  // Selection chrome is measured at render time, so it is hidden while frames advance without renders.
  return <div ref={holder} className={`stage-holder${panning ? ' is-panning' : ''}${assetOver ? ' is-asset-over' : ''}`} {...assetDrop} tabIndex={0} aria-label={panning ? 'Pan canvas: drag or use arrow keys; Escape exits' : 'Canvas workspace: click empty space or press Escape to deselect'} onPointerDown={event => { if (!panning && event.target === event.currentTarget) { event.currentTarget.focus({ preventScroll: true }); handlers.onPointerDown(event); } }} onKeyDown={event => { if (!panning && event.target === event.currentTarget) handlers.onKeyDown(event); }} onPointerDownCapture={panStart} onPointerMoveCapture={panMove} onPointerUpCapture={event => panEnd(event)} onPointerCancelCapture={event => panEnd(event, true)} onLostPointerCapture={event => panEnd(event, true)} onKeyDownCapture={panKeys}><div ref={root} className="stage" aria-label="Video composition preview" aria-busy={!synchronized} {...handlers}/><div ref={ringRoot} className="canvas-interaction-ring" {...handlers} style={{ width: `${FORMATS[activeProject.format][0]}px`, height: `${FORMATS[activeProject.format][1]}px`, transform: root.current?.style.transform }}>{!playing && ring}<PlacementGuides layout={activeProject.layout} rect={synchronized && !playing ? geometry.rect : null} targets={geometry.targets} dimensions={FORMATS[activeProject.format]} lines={synchronized ? positionPreview?.guides : undefined} scale={geometry.scale} fontSize={10 / (geometry.scale || 1)}/></div></div>;
}
