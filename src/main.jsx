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
import { centeredResize, layerResizeBounds } from './editor/canvas-resize.js';
import { contentFields } from './template-content.js';
import { useProject } from './editor/useProject.js';
import { useCompositionActions } from './editor/useCompositionActions.js';
import { useProjectFiles } from './editor/useProjectFiles.js';
import { useAgentBridge } from './editor/useAgentBridge.js';
import { useVisualAlternatives } from './editor/useVisualAlternatives.js';
import { useExportJob } from './editor/useExportJob.js';
import { usePlayback } from './editor/usePlayback.js';
import { NewCompositionDialog } from './editor/components/NewCompositionDialog.jsx';
import { SaveCompositionDialog } from './editor/components/SaveCompositionDialog.jsx';
import { SavedTemplates } from './editor/components/SavedTemplates.jsx';
import { TemplateContentDialog } from './editor/components/TemplateContentDialog.jsx';
import { VisualAlternativesDialog } from './editor/components/VisualAlternativesDialog.jsx';
import { Dialogs } from './editor/components/Dialogs.jsx';
import { CanvasPanel } from './editor/components/CanvasPanel.jsx';
import { ErrorBanner, Header } from './editor/components/Header.jsx';
import { InspectorPanel } from './editor/components/InspectorPanel.jsx';
import { LayerPanel } from './editor/components/LayerPanel.jsx';
import { TimelinePanel } from './editor/components/TimelinePanel.jsx';

function App() {
  const { project, composition, openComposition, updateCompositionMetadata, saveCopy, newComposition, importDraft, projectRef, loaded, status, error, setError, history, future, canvasEditing, setCanvasEdit, change, patch, save, undo, redo, reload } = useProject();
  const [selected, setSelected] = useState('carousel'); const [leftTab, setLeftTab] = useState('layers'); const [rightTab, setRightTab] = useState('composition');
  const [ready, setReady] = useState(false);
  const [positionPreview, setPositionPreview] = useState(null);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [addTarget, setAddTarget] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [contentTarget, setContentTarget] = useState(null);
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
      if (Object.keys(fields).length === 1 && Object.hasOwn(fields, 'size') && ['logo', 'media', 'model'].includes(target.type)) {
        const displayed = evaluateChoreography(target, time);
        const bounds = layerResizeBounds(displayed, document.querySelector('.workspace .stage[aria-busy="false"]'));
        if (bounds) fields = centeredResize(displayed, fields.size, bounds);
      }
      const next = choreographyPatch(target, fields, time, current.fps);
      setPlaying(false);
      return patch(id, next);
    } catch (error) { setError(error.message); }
  }, [patch, projectRef, time, setPlaying, setError]);
  const seek = useCallback(value => { setTime(Math.max(0, Math.min(projectRef.current.duration, value))); setPlaying(false); }, [projectRef, setTime, setPlaying]);
  const { job, jobRef, busy, render } = useExportJob({ projectRef, setError, setPlaying });
  const alternativesBlocked = canvasEditing || exportOpen || newOpen || saveOpen || templatesOpen || contentTarget !== null || addTarget !== null;
  const alternatives = useVisualAlternatives({ projectRef, change, setPlaying, blocked: alternativesBlocked });
  const proposeAlternatives = useCallback(proposal => { alternatives.propose(proposal); setAgentOpen(false); }, [alternatives.propose]);
  const { agentState, audit } = useAgentBridge({ loaded, projectRef, change, save, setError, setTime, setPlaying, setExportOpen, jobRef, proposeAlternatives });
  const { uploading, fileInput, importInput, pick, handleFileChange, handleImportChange, downloadProject } = useProjectFiles({ projectRef, change, importDraft, patch, setError, setSelected, setLeftTab });
  const { addLayer, addText, reorderImage, moveLayer, dropLayer, copyLayer, removeImage, removeText } = useCompositionActions({ project, projectRef, selected, setSelected, setLeftTab, change });
  const selectCanvasLayer = useCallback(id => { setSelected(id); setPlaying(false); }, [setPlaying]);
  const showError = useCallback(message => setError(message), [setError]);
  const sceneReady = useCallback(value => setReady(value), []);
  const previewPosition = useCallback(value => { setPositionPreview(value); if (value) setPlaying(false); }, []);
  async function applyContent(draft, name) {
    if (contentTarget.copy) {
      await save();
      await saveCopy(name, draft);
      setTime(0.65);
      setSelected(draft.layers[0]?.id ?? null);
    } else {
      if (projectRef.current !== contentTarget.project) throw new Error('The composition changed while the form was open. Reopen Content to use its latest values.');
      if (!change(draft)) throw new Error('Content could not be applied.');
    }
    setPlaying(false);
    return true;
  }
  function useTemplate(entry) {
    setTemplatesOpen(false);
    setPlaying(false);
    setContentTarget({ project: entry.project, copy: true, name: `${entry.name.slice(0, 95)} copy` });
  }
  return <main className="app-shell">
    <input ref={fileInput} hidden type="file" onChange={handleFileChange}/>
    <input ref={importInput} hidden type="file" accept="application/json,.json" onChange={handleImportChange}/>
    <Header name={project.name} onChangeName={name => change({ ...project, name })} composition={composition} onNew={() => { setPlaying(false); setNewOpen(true); }} onSave={() => composition ? save().catch(() => {}) : setSaveOpen(true)} onSaveCopy={() => setSaveOpen(true)} hasContent={contentFields(project).length > 0} onOpenContent={() => { setPlaying(false); setContentTarget({ project: projectRef.current, copy: false }); }} onOpenTemplates={() => { setPlaying(false); setTemplatesOpen(true); }} onExplore={() => { try { alternatives.explore(); } catch (error) { setError(error.message); } }} canExplore={!alternativesBlocked && project.layers.some(layer => layer.visible && !layer.locked && layer.type !== 'music')} status={status} agentState={agentState} loaded={loaded} onOpenAgent={() => setAgentOpen(true)} onImport={() => importInput.current.click()} onDownload={downloadProject} onExport={() => { setPlaying(false); setExportOpen(true); }}/>
    <ErrorBanner error={error} status={status} onRetry={() => save().catch(() => {})} onReload={() => { if (window.confirm("Discard your local changes and load the latest saved project? Download your project JSON first to keep a copy.")) reload().catch(reloadError => setError(reloadError.message)); }} onDismiss={() => setError('')}/>
    <div className="workspace">
      <LayerPanel project={project} selected={selected} leftTab={leftTab} uploading={uploading} onSelectLayer={setSelected} onSetLeftTab={setLeftTab} onPatch={patch} onOpenAdd={() => setAddTarget('layers')} onRemoveLayer={removeText} onMoveLayer={moveLayer} onDropLayer={dropLayer} onDuplicateLayer={copyLayer} onChangeProject={change} onChangeDuration={duration => change(resizeDuration(project, duration))} onChangeFps={fps => change({ ...project, fps })} onReorderImage={reorderImage} onRemoveImage={removeImage}/>
      <CanvasPanel selected={selected} onSelect={selectCanvasLayer} onPatch={editLayer} onPreview={previewPosition} onPendingEdit={setCanvasEdit} canvasEditing={canvasEditing} project={project} carousel={carousel} history={history} future={future} ready={ready} positionPreview={positionPreview} time={time} playing={playing} onTimeChange={setTime} onSetPlaying={setPlaying} onError={showError} onReady={sceneReady} onUndo={undo} onRedo={redo}/>
      <InspectorPanel project={displayedProject} layer={displayedLayer} rightTab={rightTab} uploading={uploading} onSetRightTab={setRightTab} onSetLeftTab={setLeftTab} onPatch={editLayer} onPick={target => setAddTarget(target)} onPreview={previewPosition} onRemoveText={removeText}/>
      <TimelinePanel project={project} selected={selected} time={time} timelineOpen={timelineOpen} onTimeChange={setTime} onSetPlaying={setPlaying} onSetTimelineOpen={setTimelineOpen} onSelect={setSelected} onSeek={seek} onPatch={patch} onEditLayer={editLayer}/>
    </div>
    {newOpen && <NewCompositionDialog onClose={() => setNewOpen(false)} onCreate={async name => { await newComposition(name); setTime(0); setPlaying(false); setSelected(null); setLeftTab('layers'); setRightTab('composition'); setPositionPreview(null); }}/>}
    {saveOpen && <SaveCompositionDialog name={project.name} onClose={() => setSaveOpen(false)} onSave={saveCopy}/>}
    {templatesOpen && <SavedTemplates project={project} onMetadata={updateCompositionMetadata} onUseTemplate={useTemplate} onSaveCurrent={() => { setTemplatesOpen(false); setSaveOpen(true); }} onClose={() => setTemplatesOpen(false)} onApply={async next => { await save(); const valid = openComposition(next); if (valid) { setTime(0.65); setPlaying(false); setSelected(next.project.layers[0]?.id ?? null); } return valid; }}/>}
    {addTarget !== null && <AddLayerDialog project={project} initialTarget={addTarget} uploading={uploading} onClose={() => setAddTarget(null)} onPick={pick} onAddText={addText} onAddLayer={addLayer}/>}
    {contentTarget && <TemplateContentDialog project={contentTarget.project} copy={contentTarget.copy} name={contentTarget.name} onClose={() => setContentTarget(null)} onSubmit={applyContent}/>}
    {alternatives.proposal && <VisualAlternativesDialog proposal={alternatives.proposal} stale={project !== alternatives.proposal.base || canvasEditing} onClose={alternatives.close} onApply={alternatives.apply}/> }
    <Dialogs project={project} exportOpen={exportOpen} agentOpen={agentOpen} job={job} busy={busy} agentState={agentState} audit={audit} onCloseExport={() => setExportOpen(false)} onCloseAgent={() => setAgentOpen(false)} onRender={render}/>
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
