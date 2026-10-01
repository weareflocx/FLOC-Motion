import React, { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/geist/400.css'; import '@fontsource/geist/600.css'; import '@fontsource/geist/800.css';
import './style.css';
import { resizeDuration } from './project.js';
import { useProject } from './editor/useProject.js';
import { useCompositionActions } from './editor/useCompositionActions.js';
import { useProjectFiles } from './editor/useProjectFiles.js';
import { useAgentBridge } from './editor/useAgentBridge.js';
import { useExportJob } from './editor/useExportJob.js';
import { usePlayback } from './editor/usePlayback.js';
import { Dialogs } from './editor/components/Dialogs.jsx';
import { CanvasPanel } from './editor/components/CanvasPanel.jsx';
import { ErrorBanner, Header } from './editor/components/Header.jsx';
import { InspectorPanel } from './editor/components/InspectorPanel.jsx';
import { LayerPanel } from './editor/components/LayerPanel.jsx';
import { TimelinePanel } from './editor/components/TimelinePanel.jsx';

function App() {
  const { project, projectRef, loaded, status, error, setError, history, change, patch, save, undo, reload } = useProject();
  const [selected, setSelected] = useState('carousel'); const [leftTab, setLeftTab] = useState('layers'); const [rightTab, setRightTab] = useState('composition');
  const [ready, setReady] = useState(false);
  const [positionPreview, setPositionPreview] = useState(null);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const layer = project.layers.find(l => l.id === selected) || project.layers.find(l => l.type === 'carousel');
  const carousel = project.layers.find(l => l.type === 'carousel');
  const { time, playing, setTime, setPlaying } = usePlayback({ projectRef, duration: project.duration });
  const { job, jobRef, busy, render } = useExportJob({ projectRef, setError, setPlaying });
  const { agentState, audit } = useAgentBridge({ loaded, projectRef, change, save, setError, setTime, setPlaying, setExportOpen, jobRef });
  const { uploading, fileInput, importInput, pick, handleFileChange, handleImportChange, downloadProject } = useProjectFiles({ projectRef, change, patch, setError });
  const { addText, reorderImage, moveLayer, dropLayer, copyLayer, removeImage, removeText } = useCompositionActions({ project, projectRef, selected, setSelected, setLeftTab, change });
  const showError = useCallback(message => setError(message), [setError]);
  const sceneReady = useCallback(value => setReady(value), []);
  const previewPosition = useCallback(value => { setPositionPreview(value); if (value) setPlaying(false); }, []);
  return <main className="app-shell">
    <input ref={fileInput} hidden type="file" onChange={handleFileChange}/>
    <input ref={importInput} hidden type="file" accept="application/json,.json" onChange={handleImportChange}/>
    <Header status={status} agentState={agentState} loaded={loaded} onOpenAgent={() => setAgentOpen(true)} onImport={() => importInput.current.click()} onDownload={downloadProject} onExport={() => { setPlaying(false); setExportOpen(true); }}/>
    <ErrorBanner error={error} status={status} onReload={() => reload().catch(reloadError => setError(reloadError.message))} onDismiss={() => setError('')}/>
    <div className="workspace">
      <LayerPanel project={project} selected={selected} leftTab={leftTab} uploading={uploading} onSelectLayer={setSelected} onSetLeftTab={setLeftTab} onPatch={patch} onAddText={addText} onMoveLayer={moveLayer} onDropLayer={dropLayer} onDuplicateLayer={copyLayer} onChangeProject={change} onChangeDuration={duration => change(resizeDuration(project, duration))} onChangeFps={fps => change({ ...project, fps })} onPick={pick} onReorderImage={reorderImage} onRemoveImage={removeImage}/>
      <CanvasPanel project={project} carousel={carousel} history={history} ready={ready} positionPreview={positionPreview} time={time} playing={playing} onError={showError} onReady={sceneReady} onChangeName={name => change({ ...project, name })} onUndo={undo}/>
      <InspectorPanel project={project} layer={layer} rightTab={rightTab} uploading={uploading} onSetRightTab={setRightTab} onSetLeftTab={setLeftTab} onPatch={patch} onPick={pick} onPreview={previewPosition} onRemoveText={removeText}/>
    </div>
    <TimelinePanel project={project} selected={selected} time={time} playing={playing} ready={ready} timelineOpen={timelineOpen} onTimeChange={setTime} onSetPlaying={setPlaying} onSetTimelineOpen={setTimelineOpen} onSelect={setSelected} onSeek={value => { setTime(value); setPlaying(false); }} onPatch={patch}/>
    <Dialogs project={project} exportOpen={exportOpen} agentOpen={agentOpen} job={job} busy={busy} agentState={agentState} audit={audit} onCloseExport={() => setExportOpen(false)} onCloseAgent={() => setAgentOpen(false)} onRender={render}/>
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
