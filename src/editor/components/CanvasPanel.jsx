import React, { useCallback, useRef, useState } from 'react';
import { ArrowCounterClockwise, ArrowClockwise, Hand, Minus, Plus } from '@phosphor-icons/react';
import { FORMATS } from '../../project.js';
import { IconButton } from '../controls.jsx';
import { Stage } from '../Stage.jsx';

export function CanvasPanel({ project, carousel, history, future, canvasEditing, ready, positionPreview, time, playing, onError, onReady, onChangeName, onUndo, onRedo, selected, onSelect, onPatch, onPreview, onPendingEdit }) {
  const [zoom, setZoom] = useState('fit');
  const [panning, setPanning] = useState(false);
  const [viewport, setViewport] = useState({ scale: 1, canPan: false });
  const pendingEdit = useRef();
  const registerEdit = useCallback(commit => { pendingEdit.current = commit; onPendingEdit?.(commit); }, [onPendingEdit]);
  const updateViewport = useCallback(next => {
    if (!next.canPan) setPanning(false);
    setViewport(current => current.scale === next.scale && current.canPan === next.canPan ? current : next);
  }, []);
  function changeZoom(value) { pendingEdit.current?.(); setPanning(false); setZoom(value); }
  return <section className="center-panel">
    <div className="canvas-toolbar">
      <div><input aria-label="Project name" className="project-name" maxLength={100} value={project.name} onChange={event => onChangeName(event.target.value)}/></div>
      <div className="canvas-meta"><span>{FORMATS[project.format].join(' × ')}</span><IconButton label="Undo last edit (⌘/Ctrl+Z)" disabled={!history.length && !canvasEditing} onClick={onUndo}><ArrowCounterClockwise size={17}/></IconButton><IconButton label="Redo last edit (⌘/Ctrl+Shift+Z)" disabled={!future.length || canvasEditing} onClick={onRedo}><ArrowClockwise size={17}/></IconButton></div>
      <div className="canvas-zoom" role="group" aria-label="Canvas view">
        <button type="button" aria-pressed={zoom === 'fit'} onClick={() => changeZoom('fit')}>Fit</button>
        <button type="button" aria-label="View canvas at 100 percent" aria-pressed={zoom === 1} onClick={() => changeZoom(1)}>100%</button>
        <IconButton label="Zoom out" disabled={viewport.scale <= 0.05} onClick={() => changeZoom(Math.max(0.05, viewport.scale / 1.25))}><Minus size={14}/></IconButton>
        <output aria-label="Canvas zoom">{Math.round(viewport.scale * 100)}%</output>
        <IconButton label="Zoom in" disabled={viewport.scale >= 2} onClick={() => changeZoom(Math.min(2, viewport.scale * 1.25))}><Plus size={14}/></IconButton>
        <IconButton label="Pan canvas: drag or use arrow keys" aria-pressed={panning} disabled={!viewport.canPan} onClick={() => { pendingEdit.current?.(); setPanning(value => !value); }}><Hand size={16}/></IconButton>
      </div>
    </div>
    <div className="preview-wrap"><Stage selected={selected} onSelect={onSelect} onPatch={onPatch} onPreview={onPreview} onPendingEdit={registerEdit} project={project} positionPreview={positionPreview} time={time} playing={playing} onError={onError} onReady={onReady} zoom={zoom} panning={panning && viewport.canPan} onViewport={updateViewport} onExitPan={() => setPanning(false)}/>{!ready && <div className="preview-loading">Preparing composition…</div>}</div>
  </section>;
}
