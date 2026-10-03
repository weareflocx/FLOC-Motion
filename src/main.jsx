import { AddLayerDialog } from './editor/components/AddLayerDialog.jsx';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { fontFaceCss } from './fonts.js';
const fontStyles = document.createElement('style');
fontStyles.textContent = fontFaceCss('/fonts/');
document.head.appendChild(fontStyles);
import './style.css';
import { resizeDuration } from './project.js';
import { evaluateChoreography } from './choreography.js';
import { choreographyPatch } from './editor/choreography-edit.js';
import { useProject } from './editor/useProject.js';
import { useCompositionActions } from './editor/useCompositionActions.js';
import { useProjectFiles } from './editor/useProjectFiles.js';
import { useAgentBridge } from './editor/useAgentBridge.js';
import { useExportJob } from './editor/useExportJob.js';
import { usePlayback } from './editor/usePlayback.js';
import { SaveCompositionDialog } from './editor/components/SaveCompositionDialog.jsx';
import { SavedTemplates } from './editor/components/SavedTemplates.jsx';
import { Dialogs } from './editor/components/Dialogs.jsx';
import { CanvasPanel } from './editor/components/CanvasPanel.jsx';
import { ErrorBanner, Header } from './editor/components/Header.jsx';
import { InspectorPanel } from './editor/components/InspectorPanel.jsx';
import { LayerPanel } from './editor/components/LayerPanel.jsx';
import { TimelinePanel } from './editor/components/TimelinePanel.jsx';

function App() {
  const { project, composition, openComposition, updateCompositionMetadata, saveCopy, importDraft, projectRef, loaded, status, error, setError, history, future, canvasEditing, setCanvasEdit, change, patch, save, undo, redo, reload } = useProject();
  const [selected, setSelected] = useState('carousel'); const [leftTab, setLeftTab] = useState('layers'); const [rightTab, setRightTab] = useState('composition');
  const [ready, setReady] = useState(false);
  const [positionPreview, setPositionPreview] = useState(null);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [addTarget, setAddTarget] = useState(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const layer = project.layers.find(l => l.id === selected) || project.layers[0];
  const carousel = project.layers.find(l => l.type === 'carousel');
  useEffect(() => { if (!project.layers.some(layer => layer.id === selected)) setSelected(project.layers[0]?.id ?? null); }, [project.layers, selected]);
  const { time, playing, setTime, setPlaying } = usePlayback({ projectRef, duration: project.duration });
  const displayedProject = useMemo(() => project.layers.some(item => item.choreography?.length)
    ? { ...project, layers: project.layers.map(item => evaluateChoreography(item, time)) } : project, [project, time]);
  const displayedLayer = displayedProject.layers.find(item => item.id === layer?.id);
  const editLayer = useCallback((id, fields) => {
    const current = projectRef.current;
    const target = current.layers.find(item => item.id === id);
    if (!target) return;
    try {
      const next = choreographyPatch(target, fields, time, current.fps);
      setPlaying(false);
      return patch(id, next);
    } catch (error) { setError(error.message); }
  }, [patch, projectRef, time, setPlaying, setError]);
  const seek = useCallback(value => { setTime(Math.max(0, Math.min(projectRef.current.duration, value))); setPlaying(false); }, [projectRef, setTime, setPlaying]);
  const { job, jobRef, busy, render } = useExportJob({ projectRef, setError, setPlaying });
  const { agentState, audit } = useAgentBridge({ loaded, projectRef, change, save, setError, setTime, setPlaying, setExportOpen, jobRef });
  const { uploading, fileInput, importInput, pick, handleFileChange, handleImportChange, downloadProject } = useProjectFiles({ projectRef, change, importDraft, patch, setError, setSelected, setLeftTab });
  const { addLayer, addText, reorderImage, moveLayer, dropLayer, copyLayer, removeImage, removeText } = useCompositionActions({ project, projectRef, selected, setSelected, setLeftTab, change });
  const selectCanvasLayer = useCallback(id => { setSelected(id); setPlaying(false); }, [setPlaying]);
  const showError = useCallback(message => setError(message), [setError]);
  const sceneReady = useCallback(value => setReady(value), []);
  const previewPosition = useCallback(value => { setPositionPreview(value); if (value) setPlaying(false); }, []);
  return <main className="app-shell">
    <input ref={fileInput} hidden type="file" onChange={handleFileChange}/>
    <input ref={importInput} hidden type="file" accept="application/json,.json" onChange={handleImportChange}/>
    <Header name={project.name} composition={composition} onSave={() => composition ? save().catch(() => {}) : setSaveOpen(true)} onSaveCopy={() => setSaveOpen(true)} onOpenTemplates={() => { setPlaying(false); setTemplatesOpen(true); }} status={status} agentState={agentState} loaded={loaded} onOpenAgent={() => setAgentOpen(true)} onImport={() => importInput.current.click()} onDownload={downloadProject} onExport={() => { setPlaying(false); setExportOpen(true); }}/>
    <ErrorBanner error={error} status={status} onRetry={() => save().catch(() => {})} onReload={() => { if (window.confirm("Discard your local changes and load the latest saved project? Download your project JSON first to keep a copy.")) reload().catch(reloadError => setError(reloadError.message)); }} onDismiss={() => setError('')}/>
    <div className="workspace">
      <LayerPanel project={project} selected={selected} leftTab={leftTab} uploading={uploading} onSelectLayer={setSelected} onSetLeftTab={setLeftTab} onPatch={patch} onOpenAdd={() => setAddTarget('layers')} onRemoveLayer={removeText} onMoveLayer={moveLayer} onDropLayer={dropLayer} onDuplicateLayer={copyLayer} onChangeProject={change} onChangeDuration={duration => change(resizeDuration(project, duration))} onChangeFps={fps => change({ ...project, fps })} onReorderImage={reorderImage} onRemoveImage={removeImage}/>
      <CanvasPanel selected={selected} onSelect={selectCanvasLayer} onPatch={editLayer} onPreview={previewPosition} onPendingEdit={setCanvasEdit} canvasEditing={canvasEditing} project={project} carousel={carousel} history={history} future={future} ready={ready} positionPreview={positionPreview} time={time} playing={playing} onError={showError} onReady={sceneReady} onChangeName={name => change({ ...project, name })} onUndo={undo} onRedo={redo}/>
      <InspectorPanel project={displayedProject} layer={displayedLayer} time={time} onSeek={seek} rightTab={rightTab} uploading={uploading} onSetRightTab={setRightTab} onSetLeftTab={setLeftTab} onPatch={editLayer} onPick={target => setAddTarget(target)} onPreview={previewPosition} onRemoveText={removeText}/>
      <TimelinePanel project={project} selected={selected} time={time} playing={playing} ready={ready} timelineOpen={timelineOpen} onTimeChange={setTime} onSetPlaying={setPlaying} onSetTimelineOpen={setTimelineOpen} onSelect={setSelected} onSeek={seek} onPatch={patch}/>
    </div>
    {saveOpen && <SaveCompositionDialog name={project.name} onClose={() => setSaveOpen(false)} onSave={saveCopy}/>}
    {templatesOpen && <SavedTemplates project={project} onMetadata={updateCompositionMetadata} onSaveCurrent={() => { setTemplatesOpen(false); setSaveOpen(true); }} onClose={() => setTemplatesOpen(false)} onApply={async next => { await save(); const valid = openComposition(next); if (valid) { setTime(0.65); setPlaying(false); setSelected(next.project.layers[0]?.id ?? null); } return valid; }}/>}
    {addTarget !== null && <AddLayerDialog project={project} initialTarget={addTarget} uploading={uploading} onClose={() => setAddTarget(null)} onPick={pick} onAddText={addText} onAddLayer={addLayer}/>}
    <Dialogs project={project} exportOpen={exportOpen} agentOpen={agentOpen} job={job} busy={busy} agentState={agentState} audit={audit} onCloseExport={() => setExportOpen(false)} onCloseAgent={() => setAgentOpen(false)} onRender={render}/>
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
