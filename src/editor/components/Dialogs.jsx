import React, { useState } from 'react';
import { DownloadSimple, FilmStrip, Robot, X } from '@phosphor-icons/react';
import { createTools } from '../../webmcp.js';
import { FORMAT_LABELS } from '../../project.js';
import { EXPORT_QUALITIES, EXPORT_RESOLUTIONS, exportDimensions } from '../../export-settings.js';
import { Field, IconButton, Modal } from '../controls.jsx';

export function Dialogs({ project, exportOpen, agentOpen, job, busy, agentState, audit, onCloseExport, onCloseAgent, onRender }) {
  const [quality, setQuality] = useState('high');
  const [resolution, setResolution] = useState('1080p');
  const dimensions = exportDimensions(project.format, resolution);
  return <>{exportOpen && <Modal onClose={onCloseExport} labelledBy="export-heading"><section className="modal">
    <div className="modal-heading"><FilmStrip size={22}/><IconButton label="Close export dialog" onClick={onCloseExport}><X size={19}/></IconButton></div>
    <h2 id="export-heading">Export video</h2>
    <div className="export-summary"><span>{FORMAT_LABELS[project.format]}<small>{dimensions.join(' × ')}</small></span><span>{project.duration}s<small>Duration</small></span><span>{project.fps}<small>Frames / sec</small></span></div>
    <Field label="Quality"><select aria-label="Export quality" value={quality} disabled={busy} onChange={event => setQuality(event.target.value)}>{EXPORT_QUALITIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>

    <Field label="Resolution"><select aria-label="Export resolution" value={resolution} disabled={busy} onChange={event => setResolution(event.target.value)}>{EXPORT_RESOLUTIONS.map(item => <option key={item.id} value={item.id}>{item.label} · {exportDimensions(project.format, item.id).join(' × ')}</option>)}</select></Field>

    {job && <div className={`job-status ${job.state === 'failed' ? 'failed' : ''}`} role="status"><strong>{job.message}</strong>{job.width && <p className="helper">{job.width} × {job.height} · {job.fps} fps · {EXPORT_QUALITIES.find(item => item.id === job.quality)?.label}</p>}{!['done', 'failed'].includes(job.state) && <progress value={job.progress} max="100"/>}{job.state === 'done' && <a className="export-button" href={job.url} download={`${job.name}.mp4`}><DownloadSimple size={17}/>Download MP4</a>}</div>}
    <button className="export-button full-width" disabled={busy || !project.layers.some(layer => layer.visible && layer.type !== 'music')} onClick={() => onRender({ quality, resolution })}>{busy ? 'Rendering locally…' : 'Render MP4'}<DownloadSimple size={17}/></button>
    {busy && <p className="helper" role="status">Keep the app and local server running until rendering finishes.</p>}
  </section></Modal>}
    {agentOpen && <Modal onClose={onCloseAgent} labelledBy="agent-heading"><section className="modal agent-modal"><div className="modal-heading"><Robot size={24}/><IconButton label="Close agent tools" onClick={onCloseAgent}><X size={19}/></IconButton></div><h2 id="agent-heading">Agent tools</h2><div className="native-status"><span className={`status-dot ${agentState === 'Connected' ? 'saved' : ''}`}/>{agentState === 'Unavailable' ? 'WebMCP is not available in this browser.' : `WebMCP · ${agentState}`}</div><details className="context-help"><summary>Available tools</summary><div className="tool-list">{createTools({}).map(tool => <div key={tool.name}><code>{tool.name}</code><span>{tool.annotations.readOnlyHint ? 'READ' : 'ACTION'}</span></div>)}</div></details><p className="helper">Exports require confirmation in the app.</p>{audit.length > 0 && <div className="audit"><h3>Recent agent actions</h3>{audit.map((entry, index) => <div key={index}><code>{entry.name}</code><span>{entry.time}</span></div>)}</div>}</section></Modal>}</>;
}
