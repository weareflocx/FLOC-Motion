import React, { useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/geist/400.css'; import '@fontsource/geist/600.css'; import '@fontsource/geist/800.css';
import './style.css';
import { validateProject, resizeDuration } from './project.js';
import { BRAND } from './brand.js';
import { request } from './editor/request.js';
import { useProject } from './editor/useProject.js';
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
  const [uploading, setUploading] = useState(false); const [exportOpen, setExportOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false); const fileInput = useRef(); const fileTarget = useRef('images'); const importInput = useRef();
  const layer = project.layers.find(l => l.id === selected) || project.layers.find(l => l.type === 'carousel');
  const carousel = project.layers.find(l => l.type === 'carousel');
  const { time, playing, setTime, setPlaying } = usePlayback({ projectRef, duration: project.duration });
  const { job, jobRef, busy, render } = useExportJob({ projectRef, setError, setPlaying });
  const { agentState, audit } = useAgentBridge({ loaded, projectRef, change, save, setError, setTime, setPlaying, setExportOpen, jobRef });
  const showError = useCallback(message => setError(message), [setError]);
  const sceneReady = useCallback(value => setReady(value), []);
  const previewPosition = useCallback(value => { setPositionPreview(value); if (value) setPlaying(false); }, []);
  async function upload(files, target) {
    setUploading(true); setError('');
    try {
      const values = [];
      for (const f of files) values.push(await request(`/api/assets?name=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'Content-Type': f.type || 'application/octet-stream' }, body: f }));
      if (target === 'images') change({ ...projectRef.current, images: [...projectRef.current.images, ...values.map(({ id, src, name }) => ({ id, src, name }))] });
      else { const item = values[0]; const l = projectRef.current.layers.find(l => l.id === target); patch(target, { src: item.src, ...(l.type === 'background' ? { mode: item.type.startsWith('video') ? 'video' : 'image' } : {}) }); }
    } catch (e) { setError(e.message); } finally { setUploading(false); }
  }
  function pick(target, accept, multiple = false) { fileTarget.current = target; fileInput.current.accept = accept; fileInput.current.multiple = multiple; fileInput.current.click(); }
  function addText() { const p = projectRef.current; const id = crypto.randomUUID(); change({ ...p, layers: [...p.layers, { id, type: 'text', name: 'New text', visible: true, start: 0, end: p.duration, text: 'Your next idea.', x: 8, y: 76, size: 42, color: BRAND.colors.white, weight: 600, width: 78, animation: 'fade' }] }); setSelected(id); setLeftTab('layers'); }
  function reorderImage(index, delta) { const images = [...project.images]; const next = index + delta; if (next < 0 || next >= images.length) return; [images[index], images[next]] = [images[next], images[index]]; change({ ...project, images }); }
  function moveLayer(delta) { const layers = [...project.layers]; const i = layers.findIndex(l => l.id === selected); const to = i + delta; if (to < 0 || to >= layers.length) return; [layers[i], layers[to]] = [layers[to], layers[i]]; change({ ...project, layers }); }
  function downloadProject() { const blob = new Blob([JSON.stringify(projectRef.current, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'floc-motion-project.json'; a.click(); URL.revokeObjectURL(url); }
  return <main className="app-shell">
    <input ref={fileInput} hidden type="file" onChange={event => { if (event.target.files.length) upload([...event.target.files], fileTarget.current); event.target.value = ''; }}/>
    <input ref={importInput} hidden type="file" accept="application/json,.json" onChange={async event => { const file = event.target.files[0]; if (file) { try { change(validateProject(JSON.parse(await file.text()))); } catch (importError) { setError(importError.message); } } event.target.value = ''; }}/>
    <Header status={status} agentState={agentState} loaded={loaded} onOpenAgent={() => setAgentOpen(true)} onImport={() => importInput.current.click()} onDownload={downloadProject} onExport={() => { setPlaying(false); setExportOpen(true); }}/>
    <ErrorBanner error={error} status={status} onReload={() => reload().catch(reloadError => setError(reloadError.message))} onDismiss={() => setError('')}/>
    <div className="workspace">
      <LayerPanel project={project} selected={selected} leftTab={leftTab} uploading={uploading} onSelectLayer={setSelected} onSetLeftTab={setLeftTab} onPatch={patch} onAddText={addText} onMoveLayer={moveLayer} onChangeProject={change} onChangeDuration={duration => change(resizeDuration(project, duration))} onChangeFps={fps => change({ ...project, fps })} onPick={pick} onReorderImage={reorderImage} onRemoveImage={index => change({ ...project, images: project.images.filter((_, imageIndex) => imageIndex !== index) })}/>
      <CanvasPanel project={project} carousel={carousel} history={history} ready={ready} positionPreview={positionPreview} time={time} playing={playing} onError={showError} onReady={sceneReady} onChangeName={name => change({ ...project, name })} onUndo={undo}/>
      <InspectorPanel project={project} layer={layer} rightTab={rightTab} uploading={uploading} onSetRightTab={setRightTab} onSetLeftTab={setLeftTab} onPatch={patch} onPick={pick} onPreview={previewPosition} onRemoveText={id => { change({ ...project, layers: project.layers.filter(layerItem => layerItem.id !== id) }); setSelected(carousel.id); }}/>
    </div>
    <TimelinePanel project={project} selected={selected} time={time} playing={playing} ready={ready} timelineOpen={timelineOpen} onTimeChange={setTime} onSetPlaying={setPlaying} onSetTimelineOpen={setTimelineOpen} onSelect={setSelected} onSeek={value => { setTime(value); setPlaying(false); }} onPatch={patch}/>
    <Dialogs project={project} exportOpen={exportOpen} agentOpen={agentOpen} job={job} busy={busy} agentState={agentState} audit={audit} onCloseExport={() => setExportOpen(false)} onCloseAgent={() => setAgentOpen(false)} onRender={render}/>
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
