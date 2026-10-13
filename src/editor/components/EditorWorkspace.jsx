import React, { useCallback } from 'react';
import { resizeDuration } from '../../project.js';
import { CanvasPanel } from './CanvasPanel.jsx';
import { InspectorPanel } from './InspectorPanel.jsx';
import { LayerPanel } from './LayerPanel.jsx';
import { TimelinePanel } from './TimelinePanel.jsx';

// The four editor panels: layers, canvas, inspector and timeline.
export function EditorWorkspace({ session, selection: { selected, selection, setSelected, selectLayer }, playback, view, dialogs, editing, files, actions, group }) {
  const { project, history, future, canvasEditing, setCanvasEdit, change, patch, undo, redo, setError } = session;
  const { clock, time, playing, setTime, setPlaying } = playback;
  const { nudge, leftTab, setLeftTab, rightTab, setRightTab, ready, sceneReady, positionPreview, previewPosition, timelineOpen, setTimelineOpen, zoom, setZoom } = view;
  const { displayedProject, editLayer, seek } = editing;
  const { arrangeState, summary } = group;
  const layer = project.layers.find(l => l.id === selected);
  const carousel = project.layers.find(l => l.type === 'carousel');
  const displayedLayer = displayedProject.layers.find(item => item.id === layer?.id);
  const showError = useCallback(message => setError(message), [setError]);
  return <div className="workspace">
    <LayerPanel project={project} selected={selected} selection={selection} leftTab={leftTab} uploading={files.uploading} onSelectLayer={selectLayer} onSetLeftTab={setLeftTab} onPatch={patch}
      onOpenAdd={() => dialogs.setAddTarget('layers')} onRemoveLayer={actions.removeText} onMoveLayer={actions.moveLayer} onDropLayer={actions.dropLayer} onDuplicateLayer={actions.copyLayer} onChangeProject={change}
      onChangeDuration={duration => change(resizeDuration(project, duration), { allow: ['timing'] })} onChangeFps={fps => change({ ...project, fps })} onReorderImage={actions.reorderImage} onRemoveImage={actions.removeImage}/>
    <CanvasPanel nudge={nudge} onOpenNudge={dialogs.openNudge} selected={selected} selection={selection} onSelect={group.selectCanvasLayer} onToggle={group.toggleCanvasLayer} onPatch={editLayer} onMoveGroup={group.moveGroup}
      onPreview={previewPosition} onPendingEdit={setCanvasEdit} canvasEditing={canvasEditing} project={project} carousel={carousel} history={history} future={future} ready={ready} positionPreview={positionPreview}
      clock={clock} time={time} playing={playing} onTimeChange={setTime} onSetPlaying={setPlaying} onError={showError} onReady={sceneReady} onUndo={undo} onRedo={redo} zoom={zoom} onZoom={setZoom}
      arrange={{ canAlign: arrangeState.align, canDistribute: arrangeState.distribute, target: arrangeState.target }} onArrange={group.arrange}/>
    <InspectorPanel key={summary ? 'selection' : displayedLayer?.id} nudge={nudge} project={displayedProject} layer={displayedLayer} summary={summary} rightTab={rightTab} uploading={files.uploading}
      onSetRightTab={setRightTab} onSetLeftTab={setLeftTab} onPatch={editLayer} onPick={target => dialogs.setAddTarget(target)} onPreview={previewPosition} onRemoveText={actions.removeText}/>
    <TimelinePanel project={project} selected={selected} clock={clock} time={time} timelineOpen={timelineOpen} onTimeChange={setTime} onSetPlaying={setPlaying} onSetTimelineOpen={setTimelineOpen}
      onSelect={setSelected} onSeek={seek} onPatch={patch} onEditLayer={editLayer}/>
  </div>;
}
