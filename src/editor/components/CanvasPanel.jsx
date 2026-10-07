import React, { useCallback, useRef, useState } from 'react';
import { ArrowCounterClockwise, ArrowClockwise, SlidersHorizontal, Hand, Minus, Plus, Play, Pause, SkipBack } from '@phosphor-icons/react';
import { FORMATS } from '../../project.js';
import { IconButton } from '../controls.jsx';
import { Stage } from '../Stage.jsx';

const timeLabel = (seconds, fps) => {
  const totalFrames = Math.floor(seconds * fps + 0.00001);
  const minutes = Math.floor(totalFrames / (fps * 60));
  const wholeSeconds = Math.floor(totalFrames / fps) % 60;
  const frames = totalFrames % fps;
  return [minutes, wholeSeconds, frames].map(value => value.toString().padStart(2, '0')).join(':');
};

export function CanvasPanel({ nudge, onOpenNudge, project, carousel, history, future, canvasEditing, ready, positionPreview, time, playing, onTimeChange, onSetPlaying, onError, onReady, onUndo, onRedo, selected, onSelect, onPatch, onPreview, onPendingEdit }) {
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
  const currentTime = timeLabel(time, project.fps);
  const totalTime = timeLabel(project.duration, project.fps);
  const selectedLayer = project.layers.find(layer => layer.id === selected && layer.visible && !layer.locked && time >= layer.start && time < layer.end && !['music', 'effect'].includes(layer.type));
  return <section className="center-panel">
    <div className="preview-wrap">
      <Stage nudge={nudge} selected={selected} onSelect={onSelect} onPatch={onPatch} onPreview={onPreview} onPendingEdit={registerEdit} project={project} positionPreview={positionPreview} time={time} playing={playing} onError={onError} onReady={onReady} zoom={zoom} panning={panning && viewport.canPan} onViewport={updateViewport} onExitPan={() => setPanning(false)}/>
      {!ready && <div className="preview-loading">Preparing composition…</div>}
      {ready && !panning && selectedLayer && <div className="canvas-gesture-hint">Drag to move · {['carousel', 'model'].includes(selectedLayer.type) && 'Shift-drag X/Y · '}Shift+Alt-drag Z · Esc cancels</div>}
      <div className="canvas-toolbar">
        <div className="canvas-meta" role="group" aria-label="Edit history"><IconButton label="Undo last edit (⌘/Ctrl+Z)" disabled={!history.length && !canvasEditing} onClick={onUndo}><ArrowCounterClockwise size={17}/></IconButton><IconButton label="Redo last edit (⌘/Ctrl+Shift+Z)" disabled={!future.length || canvasEditing} onClick={onRedo}><ArrowClockwise size={17}/></IconButton></div>
        <IconButton label="Nudge amount" onClick={onOpenNudge}><SlidersHorizontal size={17}/></IconButton>
        <div className="canvas-zoom" role="group" aria-label="Canvas view">
          <button type="button" title={`Fit ${FORMATS[project.format].join(' × ')} canvas to view`} aria-pressed={zoom === 'fit'} onClick={() => changeZoom('fit')}>Fit</button>
          <IconButton label="Zoom out" disabled={viewport.scale <= 0.05} onClick={() => changeZoom(Math.max(0.05, viewport.scale / 1.25))}><Minus size={14}/></IconButton>
          <button type="button" className="canvas-zoom-value" aria-label={`Canvas zoom ${Math.round(viewport.scale * 100)} percent. Reset to 100 percent`} title="Reset zoom to 100%" onClick={() => changeZoom(1)}>{Math.round(viewport.scale * 100)}%</button>
          <IconButton label="Zoom in" disabled={viewport.scale >= 2} onClick={() => changeZoom(Math.min(2, viewport.scale * 1.25))}><Plus size={14}/></IconButton>
          <IconButton label="Pan canvas: drag or use arrow keys" aria-pressed={panning} disabled={!viewport.canPan} onClick={() => { pendingEdit.current?.(); setPanning(value => !value); }}><Hand size={16}/></IconButton>
        </div>
      </div>
      <div className="canvas-playback" role="group" aria-label="Preview playback">
        <IconButton label="Back to start" onClick={() => { onTimeChange(0); onSetPlaying(false); }}><SkipBack size={18}/></IconButton>
        <IconButton className="icon-button canvas-play" label={playing ? 'Pause preview' : 'Play preview'} title={playing ? 'Pause preview (Space)' : 'Play preview (Space)'} aria-keyshortcuts="Space" onClick={() => onSetPlaying(value => !value)} disabled={!ready}>
          {playing ? <Pause size={20} weight="fill"/> : <Play size={20} weight="fill"/>}
        </IconButton>
        <span className="timecode" title="Minutes:seconds:frames" aria-label={`Current time ${currentTime} of ${totalTime}, minutes:seconds:frames`}>
          <span className="timecode-current">{currentTime}</span>
          <span className="timecode-total">/ {totalTime}</span>
        </span>
      </div>
    </div>
  </section>;
}
