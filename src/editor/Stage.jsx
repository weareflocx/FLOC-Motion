import React, { useEffect, useRef } from 'react';
import { FORMATS } from '../project.js';
import { createScene, stageMarkup } from '../scene.js';

export function Stage({ project, time, playing, onError, onReady, positionPreview }) {
  const holder = useRef();
  const root = useRef();
  const engine = useRef();
  const timeRef = useRef({ time, playing });
  timeRef.current = { time, playing };

  useEffect(() => {
    const [w, h] = FORMATS[project.format];
    let cancelled = false;
    let loaded;
    root.current.innerHTML = stageMarkup(project);
    const fit = () => {
      if (!holder.current || !root.current) return;
      const box = holder.current.getBoundingClientRect();
      const scale = Math.min((box.width - 24) / w, (box.height - 24) / h);
      root.current.style.width = `${w}px`;
      root.current.style.height = `${h}px`;
      root.current.style.transform = `translate(-50%,-50%) scale(${Math.max(0.05, scale)})`;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(holder.current);
    fit();
    onReady(false);
    createScene(root.current, project).then(scene => {
      loaded = scene;
      if (cancelled) scene.dispose();
      else {
        engine.current = scene;
        scene.seek(timeRef.current.time, timeRef.current.playing);
        onReady(true);
      }
    }).catch(error => { if (!cancelled) onError(error.message); });
    return () => { cancelled = true; observer.disconnect(); engine.current = null; loaded?.dispose(); };
  }, [project, onError, onReady]);

  useEffect(() => { engine.current?.seek(time, playing); }, [time, playing]);

  useEffect(() => {
    engine.current?.setOrientation(positionPreview?.id === project.layers.find(l => l.type === 'carousel').id ? positionPreview : null);
    engine.current?.seek(timeRef.current.time, timeRef.current.playing);
    // Editor-only positioning preview; the project and GPU scene change once per gesture.
    for (const layer of project.layers.filter(layer => ['text', 'logo'].includes(layer.type))) {
      const node = [...root.current.querySelectorAll('[data-floc-layer]')].find(n => n.dataset.flocLayer === layer.id);
      if (!node) continue;
      const position = positionPreview?.id === layer.id ? positionPreview : layer;
      node.style.left = `${position.x}%`;
      node.style.top = `${position.y}%`;
    }
  }, [positionPreview, project]);

  return <div ref={holder} className="stage-holder"><div ref={root} className="stage" aria-label="Video composition preview"/></div>;
}
