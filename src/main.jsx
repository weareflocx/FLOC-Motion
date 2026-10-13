import { AddLayerDialog } from './editor/components/AddLayerDialog.jsx';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { fontFaceCss } from './fonts.js';
const fontStyles = document.createElement('style');
fontStyles.textContent = fontFaceCss('/fonts/');
document.head.appendChild(fontStyles);
import './style.css';
import { PROJECT_LIMITS, resizeDuration } from './project.js';
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
import { useEditorShortcuts } from './editor/useEditorShortcuts.js';
import { useSelection } from './editor/useSelection.js';
import { arrangeAvailability, groupFlagValue, selectAllIds } from './editor/selection.js';
import { alignTargetLabel, editorCommands } from './editor/commands.js';
import { CommandPalette } from './editor/components/CommandPalette.jsx';
import { NewCompositionDialog } from './editor/components/NewCompositionDialog.jsx';
import { SaveCompositionDialog } from './editor/components/SaveCompositionDialog.jsx';
import { SavedTemplates } from './editor/components/SavedTemplates.jsx';
import { VersionHistoryDialog } from './editor/components/VersionHistoryDialog.jsx';
import { restoreCompositionVersion } from './editor/version-history.js';
import { TemplateContentDialog } from './editor/components/TemplateContentDialog.jsx';
import { BatchVariantsDialog } from './editor/components/BatchVariantsDialog.jsx';
import { VisualAlternativesDialog } from './editor/components/VisualAlternativesDialog.jsx';
import { Dialogs } from './editor/components/Dialogs.jsx';
import { CanvasPanel } from './editor/components/CanvasPanel.jsx';
import { ErrorBanner, Header } from './editor/components/Header.jsx';
import { InspectorPanel } from './editor/components/InspectorPanel.jsx';
import { LayerPanel } from './editor/components/LayerPanel.jsx';
import { NudgeDialog } from './editor/components/NudgeDialog.jsx';
import { loadNudge, saveNudge } from './editor/nudge.js';
import { TimelinePanel } from './editor/components/TimelinePanel.jsx';
import { AuthGate } from './editor/components/AuthGate.jsx';
import { AccountDialog } from './editor/components/AccountDialog.jsx';

const MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');
function App({ user, onSignOut }) {
  const { project, composition, openSavedComposition, updateCompositionMetadata, saveCopy, newComposition, importDraft, detachComposition, projectRef, loaded, status, error, setError, history, future, canvasEditing, setCanvasEdit, change, patch, save, undo, redo, reload } = useProject({ userId: user.id });
  const [accountOpen, setAccountOpen] = useState(false);
  const { selection, selected, setSelection, setSelected, selectLayer } = useSelection({ layers: project.layers, initial: 'carousel' }); const [leftTab, setLeftTab] = useState('layers'); const [rightTab, setRightTab] = useState('composition');
  const [nudge, setNudge] = useState(loadNudge);
  const [nudgeOpen, setNudgeOpen] = useState(false);
  useEffect(() => saveNudge(nudge), [nudge]);
  const [ready, setReady] = useState(false);
  const [positionPreview, setPositionPreview] = useState(null);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [zoom, setZoom] = useState('fit');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [addTarget, setAddTarget] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [contentTarget, setContentTarget] = useState(null);
  const [batchTemplate, setBatchTemplate] = useState(null);
  const layer = project.layers.find(l => l.id === selected);
  const carousel = project.layers.find(l => l.type === 'carousel');
  // App-level time holds the playback origin while playing; the stage, timeline playhead and timecode follow the clock directly.
  const { clock, time, playing, setTime, setPlaying } = usePlayback({ projectRef, duration: project.duration, step: Infinity });
  const displayedProject = useMemo(() => project.layers.some(item => item.choreography?.length)
    ? { ...project, layers: project.layers.map(item => evaluateChoreography(item, time)) } : project, [project, time]);
  const displayedLayer = displayedProject.layers.find(item => item.id === layer?.id);
  const editLayer = useCallback((id, fields) => {
    const current = projectRef.current, at = clock.get().time;
    const target = current.layers.find(item => item.id === id);
    if (!target) return;
    try {
      if (Object.keys(fields).length === 1 && Object.hasOwn(fields, 'size') && ['logo', 'media', 'model'].includes(target.type)) {
        const displayed = evaluateChoreography(target, at);
        const bounds = layerResizeBounds(displayed, document.querySelector('.workspace .stage[aria-busy="false"]'));
        if (bounds) fields = centeredResize(displayed, fields.size, bounds);
      }
      const next = choreographyPatch(target, fields, at, current.fps);
      setPlaying(false);
      return patch(id, next);
    } catch (error) { setError(error.message); }
  }, [patch, projectRef, clock, setPlaying, setError]);
  const seek = useCallback(value => { setTime(Math.max(0, Math.min(projectRef.current.duration, value))); setPlaying(false); }, [projectRef, setTime, setPlaying]);
  const { job, jobRef, busy, recent, settings: exportSettings, setSettings: setExportSettings, render, cancel } = useExportJob({ projectRef, setError, setPlaying, open: exportOpen });
  const dialogBlocked = canvasEditing || accountOpen || nudgeOpen || exportOpen || newOpen || saveOpen || templatesOpen || versionsOpen || contentTarget !== null || batchTemplate !== null || addTarget !== null;
  const alternativesBlocked = dialogBlocked || paletteOpen;
  const alternatives = useVisualAlternatives({ projectRef, change, setPlaying, blocked: alternativesBlocked });
  const proposeAlternatives = useCallback(proposal => { alternatives.propose(proposal); setAgentOpen(false); }, [alternatives.propose]);
  const { agentState, audit } = useAgentBridge({ loaded, projectRef, change, save, setError, setTime, setPlaying, setExportOpen, jobRef, proposeAlternatives });
  const { uploading, fileInput, importInput, pick, handleFileChange, handleImportChange, downloadProject } = useProjectFiles({ projectRef, change, importDraft, patch, setError, setSelected, setLeftTab });
  const { addLayer, addText, reorderImage, moveLayer, dropLayer, copyLayer, removeImage, removeText, removeLayers, duplicateLayers, setLayersFlag, positionLayers, arrangeLayers } = useCompositionActions({ project, projectRef, selected, setSelected, setSelection, setLeftTab, change, report: setError });
  const selectAll = useCallback(() => { setPlaying(false); setSelection(selectAllIds(projectRef.current, clock.get().time)); }, [projectRef, clock, setPlaying, setSelection]);
  const collapseSelection = useCallback(() => setSelected(selected), [selected, setSelected]);
  const openPalette = useCallback(() => { setPlaying(false); setPaletteOpen(true); }, [setPlaying]);
  useEditorShortcuts({ blocked: !loaded || !ready || canvasEditing || Boolean(positionPreview), projectRef, selected, selection, setPlaying, removeLayer: removeText, removeLayers, onSelectAll: selectAll, onCollapseSelection: collapseSelection, onOpenPalette: openPalette });
  const selectCanvasLayer = useCallback(id => { setSelected(id); setPlaying(false); }, [setPlaying, setSelected]);
  const toggleCanvasLayer = useCallback(id => { selectLayer(id, 'toggle'); setPlaying(false); }, [selectLayer, setPlaying]);
  const moveGroup = useCallback(positions => { setPlaying(false); positionLayers(positions, clock.get().time); }, [positionLayers, clock, setPlaying]);
  const arrange = useCallback(mode => { setPlaying(false); arrangeLayers(mode, selection, clock.get().time, document.querySelector('.workspace .stage[aria-busy="false"]')); }, [arrangeLayers, selection, clock, setPlaying]);
  const selectedLayers = useMemo(() => project.layers.filter(item => selection.includes(item.id)), [project.layers, selection]);
  const arrangeState = useMemo(() => ({ ...arrangeAvailability(project, selection, time), target: alignTargetLabel(selection.length, project.layout) }), [project, selection, time]);
  const unlockedSelected = selectedLayers.filter(item => !item.locked);
  const canDuplicate = unlockedSelected.length > 0 && project.layers.length + unlockedSelected.length <= PROJECT_LIMITS.maxLayers;
  const groupActions = {
    toggleLock: () => setLayersFlag(selection, 'locked'), toggleVisibility: () => setLayersFlag(selection, 'visible'),
    duplicate: () => duplicateLayers(selection), remove: () => { setPlaying(false); removeLayers(selection); }
  };
  const summary = selection.length > 1 ? { layers: selectedLayers, canAlign: arrangeState.align, canDistribute: arrangeState.distribute, canDuplicate, onArrange: arrange, onToggleLock: groupActions.toggleLock, onToggleVisibility: groupActions.toggleVisibility, onDuplicate: groupActions.duplicate, onRemove: groupActions.remove } : null;
  const exploreReady = project.layers.some(item => item.visible && !item.locked && item.type !== 'music');
  const paletteCommands = () => editorCommands({
    loaded, ready, playing, layerCount: project.layers.length, maxLayers: PROJECT_LIMITS.maxLayers, canUndo: history.length > 0, canRedo: future.length > 0,
    saved: Boolean(composition), canExplore: loaded && !dialogBlocked && exploreReady, timelineOpen, layout: project.layout,
    selectionCount: selection.length, canAlign: arrangeState.align, canDistribute: arrangeState.distribute, canDuplicate, canDelete: unlockedSelected.length > 0,
    lockSelection: groupFlagValue(selectedLayers, 'locked'), showSelection: groupFlagValue(selectedLayers, 'visible'),
    openAddLayer: () => setAddTarget('layers'), addText, addLayer, togglePlayback: () => setPlaying(value => !value), undo, redo, selectAll,
    openExport: () => { setPlaying(false); setExportOpen(true); }, newComposition: () => { setPlaying(false); setNewOpen('aspect'); },
    save: () => composition ? save().catch(() => {}) : setSaveOpen(true), saveCopy: () => setSaveOpen(true),
    openComposition: () => { setPlaying(false); setNewOpen('compositions'); }, openVersions: () => { setPlaying(false); setVersionsOpen(true); },
    explore: () => { try { alternatives.explore(); } catch (exploreError) { setError(exploreError.message); } },
    toggleTimeline: () => setTimelineOpen(value => !value), zoom: setZoom, arrange, ...groupActions,
    openAccount: () => { setPlaying(false); setAccountOpen(true); }
  }, { mac: MAC });
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
      if (!change(draft, { allow: ['content'] })) throw new Error('Content could not be applied.');
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
    <Header onOpenAccount={() => { setPlaying(false); setAccountOpen(true); }} name={project.name} onChangeName={name => change({ ...project, name })} composition={composition} onNew={() => { setPlaying(false); setNewOpen(true); }} onSave={() => composition ? save().catch(() => {}) : setSaveOpen(true)} onSaveCopy={() => setSaveOpen(true)} onOpenVersions={() => { setPlaying(false); setVersionsOpen(true); }} hasContent={contentFields(project).length > 0} onOpenContent={() => { setPlaying(false); setContentTarget({ project: projectRef.current, copy: false }); }} onOpenTemplates={() => { setPlaying(false); setTemplatesOpen(true); }} onExplore={() => { try { alternatives.explore(); } catch (error) { setError(error.message); } }} canExplore={!alternativesBlocked && project.layers.some(layer => layer.visible && !layer.locked && layer.type !== 'music')} status={status} agentState={agentState} loaded={loaded} onOpenAgent={() => setAgentOpen(true)} onImport={() => importInput.current.click()} onDownload={downloadProject} onExport={() => { setPlaying(false); setExportOpen(true); }}/>
    <ErrorBanner error={error} status={status} onRetry={() => save().catch(() => {})} onReload={() => { if (window.confirm("Discard your local changes and load the latest saved project? Download your project JSON first to keep a copy.")) reload().catch(reloadError => setError(reloadError.message)); }} onDismiss={() => setError('')}/>
    <div className="workspace">
      <LayerPanel project={project} selected={selected} selection={selection} leftTab={leftTab} uploading={uploading} onSelectLayer={selectLayer} onSetLeftTab={setLeftTab} onPatch={patch} onOpenAdd={() => setAddTarget('layers')} onRemoveLayer={removeText} onMoveLayer={moveLayer} onDropLayer={dropLayer} onDuplicateLayer={copyLayer} onChangeProject={change} onChangeDuration={duration => change(resizeDuration(project, duration), { allow: ['timing'] })} onChangeFps={fps => change({ ...project, fps })} onReorderImage={reorderImage} onRemoveImage={removeImage}/>
      <CanvasPanel nudge={nudge} onOpenNudge={() => { setPlaying(false); setNudgeOpen(true); }} selected={selected} selection={selection} onSelect={selectCanvasLayer} onToggle={toggleCanvasLayer} onPatch={editLayer} onMoveGroup={moveGroup} onPreview={previewPosition} onPendingEdit={setCanvasEdit} canvasEditing={canvasEditing} project={project} carousel={carousel} history={history} future={future} ready={ready} positionPreview={positionPreview} clock={clock} time={time} playing={playing} onTimeChange={setTime} onSetPlaying={setPlaying} onError={showError} onReady={sceneReady} onUndo={undo} onRedo={redo} zoom={zoom} onZoom={setZoom} arrange={{ canAlign: arrangeState.align, canDistribute: arrangeState.distribute, target: arrangeState.target }} onArrange={arrange}/>
      <InspectorPanel key={summary ? 'selection' : displayedLayer?.id} nudge={nudge} project={displayedProject} layer={displayedLayer} summary={summary} rightTab={rightTab} uploading={uploading} onSetRightTab={setRightTab} onSetLeftTab={setLeftTab} onPatch={editLayer} onPick={target => setAddTarget(target)} onPreview={previewPosition} onRemoveText={removeText}/>
      <TimelinePanel project={project} selected={selected} clock={clock} time={time} timelineOpen={timelineOpen} onTimeChange={setTime} onSetPlaying={setPlaying} onSetTimelineOpen={setTimelineOpen} onSelect={setSelected} onSeek={seek} onPatch={patch} onEditLayer={editLayer}/>
    </div>
    {nudgeOpen && <NudgeDialog value={nudge} onChange={setNudge} onClose={() => setNudgeOpen(false)}/>}
    {newOpen && <NewCompositionDialog project={project} initialTab={newOpen === 'compositions' ? 'compositions' : 'aspect'} onClose={() => setNewOpen(false)} onCreate={async (name, options) => { const next = await newComposition(name, options); setTime(0); setPlaying(false); setSelected(next.layers.at(-1)?.id ?? null); setLeftTab('layers'); setRightTab('composition'); setPositionPreview(null); }} onOpen={async entry => { const next = await openSavedComposition(entry); setTime(0); setPlaying(false); setSelected(next.layers[0]?.id ?? null); setLeftTab('layers'); setRightTab('composition'); setPositionPreview(null); return true; }}/>}
    {saveOpen && <SaveCompositionDialog name={project.name} onClose={() => setSaveOpen(false)} onSave={saveCopy}/>}
    {templatesOpen && <SavedTemplates project={project} onMetadata={updateCompositionMetadata} onRemove={detachComposition} onUseTemplate={useTemplate} onSaveCurrent={() => { setTemplatesOpen(false); setSaveOpen(true); }} onClose={() => setTemplatesOpen(false)} onApply={async entry => { const next = await openSavedComposition(entry); setTime(0.65); setPlaying(false); setSelected(next.layers[0]?.id ?? null); return next; }}/>}
    {versionsOpen && composition && <VersionHistoryDialog compositionId={composition.id} onClose={() => setVersionsOpen(false)} onRestore={version => restoreCompositionVersion(version, { save, change, updateCompositionMetadata })}/>}
    {accountOpen && <AccountDialog user={user} onClose={() => setAccountOpen(false)} onSignOut={async () => { await save(); await onSignOut(); }}/>}
    {addTarget !== null && <AddLayerDialog project={project} initialTarget={addTarget} uploading={uploading} onClose={() => setAddTarget(null)} onPick={pick} onAddText={addText} onAddLayer={addLayer}/>}
    {contentTarget && <TemplateContentDialog project={contentTarget.project} copy={contentTarget.copy} name={contentTarget.name} onClose={() => setContentTarget(null)} onSubmit={applyContent} onBatch={() => { setBatchTemplate(contentTarget.project); setContentTarget(null); }}/>}
    {batchTemplate && <BatchVariantsDialog project={batchTemplate} exportSettings={exportSettings} onClose={() => setBatchTemplate(null)}/>}
    {alternatives.proposal && <VisualAlternativesDialog proposal={alternatives.proposal} stale={project !== alternatives.proposal.base || canvasEditing} onClose={alternatives.close} onApply={alternatives.apply}/> }
    <Dialogs project={project} exportOpen={exportOpen} agentOpen={agentOpen} job={job} busy={busy} recent={recent} settings={exportSettings} onSettingsChange={setExportSettings} agentState={agentState} audit={audit} onCloseExport={() => setExportOpen(false)} onCloseAgent={() => setAgentOpen(false)} onRender={render} onCancelExport={cancel}/>
    {paletteOpen && <CommandPalette commands={paletteCommands()} onClose={() => setPaletteOpen(false)}/>}
  </main>;
}
createRoot(document.getElementById('root')).render(<AuthGate>{(user, onSignOut) => <App key={user.id} user={user} onSignOut={onSignOut}/>}</AuthGate>);
