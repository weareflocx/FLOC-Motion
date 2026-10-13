import React, { useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { fontFaceCss } from './fonts.js';
// Cascade order: the creation-dialog sheets precede the editor stylesheet.
import './editor/template-content.css';
import './editor/carousel-creation.css';
import './styles/index.css';
import { contentFields } from './template-content.js';
import { useProject } from './editor/useProject.js';
import { useSelection } from './editor/useSelection.js';
import { usePlayback } from './editor/usePlayback.js';
import { useEditorView } from './editor/useEditorView.js';
import { useEditorDialogs } from './editor/useEditorDialogs.js';
import { useLayerEditing } from './editor/useLayerEditing.js';
import { useExportJob } from './editor/useExportJob.js';
import { useVisualAlternatives } from './editor/useVisualAlternatives.js';
import { useAgentBridge } from './editor/useAgentBridge.js';
import { useProjectFiles } from './editor/useProjectFiles.js';
import { useCompositionActions } from './editor/useCompositionActions.js';
import { useSelectionActions } from './editor/useSelectionActions.js';
import { useEditorShortcuts } from './editor/useEditorShortcuts.js';
import { paletteCommands } from './editor/palette-commands.js';
import { EditorDialogs } from './editor/components/EditorDialogs.jsx';
import { EditorWorkspace } from './editor/components/EditorWorkspace.jsx';
import { ErrorBanner, Header } from './editor/components/Header.jsx';
import { AuthGate } from './editor/components/AuthGate.jsx';

const fontStyles = document.createElement('style');
fontStyles.textContent = fontFaceCss('/fonts/');
document.head.appendChild(fontStyles);

function App({ user, onSignOut }) {
  const session = useProject({ userId: user.id });
  const { project, projectRef, composition, loaded, status, error, canvasEditing, change, patch, save, reload, setError } = session;
  const selection = useSelection({ layers: project.layers, initial: 'carousel' });
  // App-level time holds the playback origin while playing; the stage, timeline playhead and timecode follow the clock directly.
  const playback = usePlayback({ projectRef, duration: project.duration, step: Infinity });
  const { clock, time, setTime, setPlaying } = playback;
  const view = useEditorView({ setPlaying });
  const dialogs = useEditorDialogs({ canvasEditing, setPlaying });
  const editing = useLayerEditing({ project, projectRef, clock, time, patch, setTime, setPlaying, setError });
  const exportJob = useExportJob({ projectRef, setError, setPlaying, open: dialogs.exportOpen });
  const alternatives = useVisualAlternatives({ projectRef, change, setPlaying, blocked: dialogs.alternativesBlocked });
  const { setAgentOpen, setExportOpen } = dialogs;
  const proposeAlternatives = useCallback(proposal => { alternatives.propose(proposal); setAgentOpen(false); }, [alternatives.propose, setAgentOpen]);
  const agent = useAgentBridge({ loaded, projectRef, change, save, setError, setTime, setPlaying, setExportOpen, jobRef: exportJob.jobRef, proposeAlternatives });
  const { setSelected, setSelection, selected } = selection;
  const files = useProjectFiles({ projectRef, change, importDraft: session.importDraft, patch, setError, setSelected, setLeftTab: view.setLeftTab });
  const actions = useCompositionActions({ project, projectRef, selected, setSelected, setSelection, setLeftTab: view.setLeftTab, change, report: setError });
  const group = useSelectionActions({ project, projectRef, clock, time, setPlaying, selection, actions });
  useEditorShortcuts({ blocked: !loaded || !view.ready || canvasEditing || Boolean(view.positionPreview), projectRef, selected, selection: selection.selection, setPlaying,
    removeLayer: actions.removeText, removeLayers: actions.removeLayers, onSelectAll: group.selectAll, onCollapseSelection: group.collapseSelection, onOpenPalette: dialogs.openPalette });
  const exploreReady = project.layers.some(layer => layer.visible && !layer.locked && layer.type !== 'music');
  const explore = () => { try { alternatives.explore(); } catch (exploreError) { setError(exploreError.message); } };
  const saveOrName = () => composition ? save().catch(() => {}) : dialogs.setSaveOpen(true);
  const commands = () => paletteCommands({ session, playback, view, dialogs, selection: selection.selection, group, actions, exploreReady, explore, saveOrName });
  const discardLocal = () => {
    if (window.confirm("Discard your local changes and load the latest saved project? Download your project JSON first to keep a copy.")) reload().catch(reloadError => setError(reloadError.message));
  };
  return <main className="app-shell">
    <input ref={files.fileInput} hidden type="file" onChange={files.handleFileChange}/>
    <input ref={files.importInput} hidden type="file" accept="application/json,.json" onChange={files.handleImportChange}/>
    <Header onOpenAccount={dialogs.openAccount} name={project.name} onChangeName={name => change({ ...project, name })} composition={composition} onNew={() => dialogs.openNew()}
      onSave={saveOrName} onSaveCopy={() => dialogs.setSaveOpen(true)} onOpenVersions={dialogs.openVersions} hasContent={contentFields(project).length > 0}
      onOpenContent={() => dialogs.openContent({ project: projectRef.current, copy: false })} onOpenTemplates={dialogs.openTemplates} onExplore={explore}
      canExplore={!dialogs.alternativesBlocked && exploreReady} status={status} agentState={agent.agentState} loaded={loaded} onOpenAgent={() => setAgentOpen(true)}
      onImport={() => files.importInput.current.click()} onDownload={files.downloadProject} onExport={dialogs.openExport}/>
    <ErrorBanner error={error} status={status} onRetry={() => save().catch(() => {})} onReload={discardLocal} onDismiss={() => setError('')}/>
    <EditorWorkspace session={session} selection={selection} playback={playback} view={view} dialogs={dialogs} editing={editing} files={files} actions={actions} group={group}/>
    <EditorDialogs user={user} onSignOut={onSignOut} session={session} playback={playback} setSelected={setSelected} view={view} dialogs={dialogs} files={files} actions={actions}
      exportJob={exportJob} agent={agent} alternatives={alternatives} commands={commands}/>
  </main>;
}

createRoot(document.getElementById('root')).render(<AuthGate>{(user, onSignOut) => <App key={user.id} user={user} onSignOut={onSignOut}/>}</AuthGate>);
