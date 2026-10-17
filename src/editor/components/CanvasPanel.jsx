import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowCounterClockwise, ArrowClockwise, SlidersHorizontal, Hand, Minus, Plus, Play, Pause, SkipBack } from '@phosphor-icons/react';
import { FORMATS } from '../../project.js';
import { evaluateChoreography } from '../../choreography.js';
import { SPATIAL_LAYER_TYPES } from '../../scene-settings.js';
import { IconButton } from '../controls.jsx';
import { Stage } from '../Stage.jsx';
import { usePlaybackTime } from '../usePlayback.js';
import { depthGuide, depthLabel, sameDepthInfo } from '../depth.js';
import { ArrangeControls } from './ArrangeControls.jsx';
import { DepthRuler } from './DepthRuler.jsx';

const timeLabel = (seconds, fps) => {
  const totalFrames = Math.floor(seconds * fps + 0.00001);
  const minutes = Math.floor(totalFrames / (fps * 60));
  const wholeSeconds = Math.floor(totalFrames / fps) % 60;
  const frames = totalFrames % fps;
  return [minutes, wholeSeconds, frames].map(value => value.toString().padStart(2, '0')).join(':');
};

// The readout samples the clock at 10 Hz so playback does not re-render the canvas panel.
function Timecode({ clock, fps, duration }) {
  const currentTime = timeLabel(usePlaybackTime(clock, 0.1), fps), totalTime = timeLabel(duration, fps);
  return <span className="timecode" title="Minutes:seconds:frames" aria-label={`Current time ${currentTime} of ${totalTime}, minutes:seconds:frames`}>
    <span className="timecode-current">{currentTime}</span>
    <span className="timecode-total">/ {totalTime}</span>
  </span>;
}

// `zoom` is owned by the app so commands can fit or reset the view.
export function CanvasPanel({ nudge, onOpenNudge, project, carousel, history, future, canvasEditing, ready, positionPreview, clock, time, playing, onTimeChange, onSetPlaying, onError, onReady, onUndo, onRedo, selected, selection = selected == null ? [] : [selected], onSelect, onToggle, onPatch, onMoveGroup, onPreview, onPendingEdit, onDropAsset, zoom, onZoom, sceneView = null, onSceneViewChange, arrange, onArrange }) {
  const [panning, setPanning] = useState(false);
  const [viewport, setViewport] = useState({ scale: 1, canPan: false });
  const pendingEdit = useRef();
  const registerEdit = useCallback(commit => { pendingEdit.current = commit; onPendingEdit?.(commit); }, [onPendingEdit]);
  const updateViewport = useCallback(next => {
    if (!next.canPan) setPanning(false);
    setViewport(current => current.scale === next.scale && current.canPan === next.canPan ? current : next);
  }, []);
  function changeZoom(value) { pendingEdit.current?.(); setPanning(false); onZoom(value); }
  function changeSceneView(value) { pendingEdit.current?.(); setPanning(false); onSceneViewChange?.(value); }
  const multi = selection.length > 1;
  const exploring = sceneView !== null;
  const selectedLayer = !multi && project.layers.find(layer => layer.id === selected && layer.visible && !layer.locked && time >= layer.start && time < layer.end && !['music', 'effect'].includes(layer.type));
  // Depth controls: the posed frame's pieces come from the stage after each paused seek.
  const [depthInfo, setDepthInfo] = useState(null);
  const reportDepth = useCallback(next => setDepthInfo(current => sameDepthInfo(current, next) ? current : next), []);
  const [depthActive, setDepthActive] = useState(false);
  const depthTimer = useRef();
  const flashDepth = useCallback(() => { setDepthActive(true); clearTimeout(depthTimer.current); depthTimer.current = setTimeout(() => setDepthActive(false), 1500); }, []);
  useEffect(() => () => clearTimeout(depthTimer.current), []);
  const depthLayer = selectedLayer && SPATIAL_LAYER_TYPES.includes(selectedLayer.type) ? evaluateChoreography(selectedLayer, time) : null;
  const guide = useMemo(() => depthGuide(depthInfo ?? [], selected), [depthInfo, selected]);
  const previewDepth = positionPreview?.id === selected && Number.isFinite(positionPreview.z) ? positionPreview.z : null;
  const depth = previewDepth ?? depthLayer?.z ?? 0;
  const depthReady = ready && !exploring && !panning && !playing && depthLayer && depthInfo;
  const depthHint = depthReady && (previewDepth !== null || depthActive) ? depthLabel(guide, depth) : null;
  const names = useMemo(() => Object.fromEntries(project.layers.map(layer => [layer.id, layer.name])), [project.layers]);
  return <section className="center-panel">
    <div className="preview-wrap">
      <Stage nudge={nudge} selected={selected} selection={selection} onSelect={onSelect} onToggle={onToggle} onPatch={onPatch} onMoveGroup={onMoveGroup} onPreview={onPreview} onPendingEdit={registerEdit} onDepthInfo={reportDepth} onDepthGesture={flashDepth} onDropAsset={onDropAsset && ((asset, point) => { pendingEdit.current?.(); onDropAsset(asset, point); })} project={project} positionPreview={positionPreview} clock={clock} onError={onError} onReady={onReady} zoom={zoom} panning={panning && viewport.canPan} onViewport={updateViewport} onExitPan={() => setPanning(false)} sceneView={sceneView} onSceneViewChange={onSceneViewChange}/>
      {!ready && <div className="preview-loading">Preparing composition…</div>}
      {ready && exploring && <div className="canvas-gesture-hint" role="status">Drag to orbit · Shift-drag to pan · Wheel to dolly · Escape returns to Camera view</div>}
      {depthHint && <div className="canvas-gesture-hint" role="status">{depthHint}</div>}
      {ready && !exploring && !panning && selectedLayer && !depthHint && <div className="canvas-gesture-hint">Drag to move · {['carousel', 'model'].includes(selectedLayer.type) && 'Shift-drag X/Y · '}Shift+Alt-drag Z · {depthLayer && 'Alt+wheel depth · '}Esc cancels</div>}
      {ready && !exploring && !panning && multi && <div className="canvas-gesture-hint">{selection.length} layers · Drag any to move together · Shift-click toggles · Esc clears</div>}
      {depthReady && <DepthRuler key={selected} layer={depthLayer} z={depth} guide={guide} names={names} onBegin={id => pendingEdit.current?.(id ?? null)} onPreview={onPreview} onPatch={onPatch} onGesture={flashDepth}/>}
      <div className="canvas-toolbar">
        <div className="canvas-meta" role="group" aria-label="Edit history"><IconButton label="Undo last edit (⌘/Ctrl+Z)" disabled={!history.length && !canvasEditing} onClick={onUndo}><ArrowCounterClockwise size={17}/></IconButton><IconButton label="Redo last edit (⌘/Ctrl+Shift+Z)" disabled={!future.length || canvasEditing} onClick={onRedo}><ArrowClockwise size={17}/></IconButton></div>
        <IconButton label="Nudge amount" onClick={onOpenNudge}><SlidersHorizontal size={17}/></IconButton>
        {arrange?.canAlign && <ArrangeControls className="canvas-arrange" target={arrange.target} canAlign={arrange.canAlign} canDistribute={arrange.canDistribute} onArrange={value => { pendingEdit.current?.(); onArrange(value); }}/>}
        <div className="canvas-scene-view" role="group" aria-label="Scene navigation">
          <button type="button" aria-pressed={!exploring} title="Return to the authored output camera" onClick={() => changeSceneView(null)}>Camera view</button>
          <button type="button" aria-pressed={exploring} title="Explore the scene without changing the output camera" onClick={() => { if (!exploring) changeSceneView({ yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 }); }}>Explore 3D</button>
        </div>
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
        <Timecode clock={clock} fps={project.fps} duration={project.duration}/>
      </div>
    </div>
  </section>;
}
