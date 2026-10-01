import React, { useEffect, useRef, useState } from 'react';
import { useCanvasInteraction } from './useCanvasInteraction.jsx';
import { FORMATS } from '../project.js';
import { createScene, stageMarkup } from '../scene.js';
import { createPreviewSession } from './preview-session.js';

export function Stage({ project, time, playing, onError, onReady, positionPreview, selected, onSelect, onPatch, onPreview }) {
  const [activeProject, setActiveProject] = useState(project);
  const holder = useRef();
  const root = useRef();
  const ringRoot = useRef();
  const engine = useRef();
  const timeRef = useRef({ time, playing });
  timeRef.current = { time, playing };

  const session = useRef();
  const callbacks = useRef();
  callbacks.current = { onReady, onError };
  const previewRef = useRef(positionPreview);
  previewRef.current = positionPreview;

  useEffect(() => {
    const fit = () => {
      const active = session.current?.current;
      if (!holder.current || !root.current || !active) return;
      const [w, h] = FORMATS[active.project.format];
      const box = holder.current.getBoundingClientRect();
      const scale = Math.max(0.05, Math.min((box.width - 24) / w, (box.height - 24) / h));
      root.current.style.width = `${w}px`;
      root.current.style.height = `${h}px`;
      root.current.style.transform = `translate(-50%,-50%) scale(${scale})`;
      if (ringRoot.current) { ringRoot.current.style.width = `${w}px`; ringRoot.current.style.height = `${h}px`; ringRoot.current.style.transform = root.current.style.transform; }
      const resolution = Math.min(1, scale * Math.min(window.devicePixelRatio || 1, 2));
      active.scene.setResolution(Math.max(1, Math.round(w * resolution)), Math.max(1, Math.round(h * resolution)));
      active.scene.seek(timeRef.current.time, timeRef.current.playing);
    };
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
      activate(next) {
        next.scene.setOrientation(previewRef.current?.id === next.project.layers.find(l => l.type === 'carousel').id ? previewRef.current : null);
        next.scene.seek(timeRef.current.time, timeRef.current.playing);
        root.current.replaceChildren(next.node);
        engine.current = next.scene;
        setActiveProject(next.project);
        callbacks.current.onReady(true);
        // The manager publishes current after activation.
        queueMicrotask(fit);
      },
      onError(error) { callbacks.current.onError(error.message); }
    });
    session.current = manager;
    callbacks.current.onReady(false);
    const observer = new ResizeObserver(fit);
    observer.observe(holder.current);
    return () => { observer.disconnect(); manager.dispose(); session.current = null; engine.current = null; };
  }, []);

  useEffect(() => { session.current?.request(project); }, [project]);

  useEffect(() => { engine.current?.seek(time, playing); }, [time, playing]);

  useEffect(() => {
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
    engine.current?.setOrientation(positionPreview?.id === project.layers.find(l => l.type === 'carousel').id ? positionPreview : null);
    engine.current?.seek(timeRef.current.time, timeRef.current.playing);
    // Editor-only positioning preview; the project and GPU scene change once per gesture.
    for (const layer of project.layers.filter(layer => ['text', 'logo'].includes(layer.type))) {
      const node = [...root.current.querySelectorAll('[data-floc-layer]')].find(n => n.dataset.flocLayer === layer.id);
      if (!node) continue;
      const position = positionPreview?.id === layer.id ? positionPreview : layer;
      node.style.left = `${position.x}%`;
      node.style.top = `${position.y}%`;
      if (layer.type === 'text') node.style.fontSize = `${(position.size ?? layer.size) * FORMATS[project.format][0] / 1080}px`;
      if (layer.type === 'logo') node.style.width = `${position.size ?? layer.size}%`;
    }
  }, [positionPreview, project]);

  const { ring, handlers } = useCanvasInteraction({ root, engine, project, sceneKey: activeProject, selected, time, onSelect, onPatch, onPreview });
  return <div ref={holder} className="stage-holder"><div ref={root} className="stage" aria-label="Video composition preview" {...handlers}/><div ref={ringRoot} className="canvas-interaction-ring" {...handlers} style={{ width: `${FORMATS[activeProject.format][0]}px`, height: `${FORMATS[activeProject.format][1]}px`, transform: root.current?.style.transform }}>{ring}</div></div>;
}
