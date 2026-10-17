import React, { useCallback } from 'react';
import { PROJECT_LIMITS, resizeDuration } from '../../project.js';
import { CanvasPanel } from './CanvasPanel.jsx';
import { InspectorPanel } from './InspectorPanel.jsx';
import { LayerPanel } from './LayerPanel.jsx';
import { TimelinePanel } from './TimelinePanel.jsx';

// The four editor panels: layers, canvas, inspector and timeline.
export function EditorWorkspace({ session, selection: { selected, selection, setSelected, selectLayer }, playback, view, dialogs, editing, files, actions, group }) {
  const { project, loaded, history, future, canvasEditing, setCanvasEdit, change, patch, undo, redo, setError } = session;
  const { clock, time, playing, setTime, setPlaying } = playback;
  const { nudge, leftTab, setLeftTab, rightTab, setRightTab, ready, sceneReady, positionPreview, previewPosition, timelineOpen, setTimelineOpen, zoom, setZoom, sceneView, setSceneView } = view;
  const { displayedProject, editLayer, seek } = editing;
  const { arrangeState, summary } = group;
  const layer = project.layers.find(l => l.id === selected);
  const carousel = project.layers.find(l => l.type === 'carousel');
  const displayedLayer = displayedProject.layers.find(item => item.id === layer?.id);
  const showError = useCallback(message => setError(message), [setError]);
  return <div className="workspace" inert={!loaded || undefined} aria-busy={!loaded}>
    <LayerPanel project={project} selected={selected} selection={selection} leftTab={leftTab} uploading={files.uploading} onSelectLayer={selectLayer} onSetLeftTab={setLeftTab} onPatch={patch}
      onOpenAdd={() => dialogs.setAddTarget('layers')} onRemoveLayer={actions.removeText} onMoveLayer={actions.moveLayer} onDropLayer={actions.dropLayer} onDuplicateLayer={actions.copyLayer}
      onPlaceAsset={(asset, target) => files.placeAssets([asset], target)}/>
    <CanvasPanel nudge={nudge} onOpenNudge={dialogs.openNudge} selected={selected} selection={selection} onSelect={group.selectCanvasLayer} onToggle={group.toggleCanvasLayer} onPatch={editLayer} onMoveGroup={group.moveGroup}
      onPreview={previewPosition} onPendingEdit={setCanvasEdit} canvasEditing={canvasEditing} project={project} carousel={carousel} history={history} future={future} ready={ready} positionPreview={positionPreview}
      sceneView={sceneView} onSceneViewChange={setSceneView}
      clock={clock} time={time} playing={playing} onTimeChange={setTime} onSetPlaying={setPlaying} onError={showError} onReady={sceneReady} onUndo={undo} onRedo={redo} zoom={zoom} onZoom={setZoom} onDropAsset={(asset, point) => files.placeAssets([asset], 'layers', point)}
      arrange={{ canAlign: arrangeState.align, canDistribute: arrangeState.distribute, target: arrangeState.target }} onArrange={group.arrange}/>
    <InspectorPanel key={summary ? 'selection' : displayedLayer?.id ?? 'composition'} project={displayedProject} projectRef={session.projectRef} layer={displayedLayer} summary={summary} rightTab={rightTab} uploading={files.uploading}
      settings={{ project, onChangeProject: change, onChangeDuration: duration => change(resizeDuration(project, duration), { allow: ['timing'] }), onChangeFps: fps => change({ ...project, fps }) }}
      cards={{ onMove: actions.moveImage, onRemove: actions.removeImage, onAddAsset: (asset, target) => files.placeAssets([asset], target) }}
      onSetRightTab={setRightTab} onPatch={editLayer} onPick={target => dialogs.setAddTarget(target)} onRemoveText={actions.removeText}/>
    <TimelinePanel project={project} selected={selected} clock={clock} time={time} timelineOpen={timelineOpen} onTimeChange={setTime} onSetPlaying={setPlaying} onSetTimelineOpen={setTimelineOpen}
      onSelect={setSelected} onSeek={seek} onPatch={patch} onEditLayer={editLayer}
      audioDisabled={files.uploading || project.layers.length >= PROJECT_LIMITS.maxLayers}
      onAddAudio={() => files.pick('layers', '.mp3,.wav,.m4a,.ogg', true, { time: clock.get().time })}
      onDropAudio={(asset, time) => files.placeAssets([asset], 'layers', { time })}
      onDropAudioFiles={(audio, time) => files.uploadFiles(audio, 'layers', { time })}/>
  </div>;
}
