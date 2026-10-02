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
    <h2 id="export-heading">Make it a video.</h2><p>Render the current composition locally. No uploads, accounts or cloud credits.</p>
    <div className="export-summary"><span>{FORMAT_LABELS[project.format]}<small>{dimensions.join(' × ')}</small></span><span>{project.duration}s<small>Duration</small></span><span>{project.fps}<small>Frames / sec</small></span></div>
    <Field label="Quality"><select aria-label="Export quality" value={quality} disabled={busy} onChange={event => setQuality(event.target.value)}>{EXPORT_QUALITIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
    <p className="helper">{EXPORT_QUALITIES.find(item => item.id === quality).description}</p>
    <Field label="Resolution"><select aria-label="Export resolution" value={resolution} disabled={busy} onChange={event => setResolution(event.target.value)}>{EXPORT_RESOLUTIONS.map(item => <option key={item.id} value={item.id}>{item.label} · {exportDimensions(project.format, item.id).join(' × ')}</option>)}</select></Field>
    <p className="helper">{resolution === '2160p' ? 'Renders text and the carousel at twice the canvas resolution. More detail, longer render time; source media still limits sharpness.' : 'Original canvas resolution. Faster rendering and smaller files.'}</p>
    {job && <div className={`job-status ${job.state === 'failed' ? 'failed' : ''}`} role="status"><strong>{job.message}</strong>{job.width && <p className="helper">{job.width} × {job.height} · {job.fps} fps · {EXPORT_QUALITIES.find(item => item.id === job.quality)?.label}</p>}{!['done', 'failed'].includes(job.state) && <progress value={job.progress} max="100"/>}{job.state === 'done' && <a className="export-button" href={job.url} download={`${job.name}.mp4`}><DownloadSimple size={17}/>Download MP4</a>}</div>}
    <button className="export-button full-width" disabled={busy || !project.images.length} onClick={() => onRender({ quality, resolution })}>{busy ? 'Rendering locally…' : 'Render MP4'}<DownloadSimple size={17}/></button>
    <p className="helper">MP4 · H.264 · AAC audio at 320 kbps when a soundtrack is included. Local rendering can take a few minutes. Keep the server running.</p>
  </section></Modal>}
    {agentOpen && <Modal onClose={onCloseAgent} labelledBy="agent-heading"><section className="modal agent-modal"><div className="modal-heading"><Robot size={24}/><IconButton label="Close agent tools" onClick={onCloseAgent}><X size={19}/></IconButton></div><h2 id="agent-heading">Built for agents, too.</h2><p>Native WebMCP tools use the same validated project actions as the editor.</p><div className="native-status"><span className={`status-dot ${agentState === 'Connected' ? 'saved' : ''}`}/>{agentState === 'Unavailable' ? 'WebMCP is not available in this browser.' : `WebMCP · ${agentState}`}</div><p className="helper">Requires a browser and agent that support document.modelContext. Nothing is enabled through browser flags automatically.</p><div className="tool-list">{createTools({}).map(tool => <div key={tool.name}><code>{tool.name}</code><span>{tool.annotations.readOnlyHint ? 'READ' : 'ACTION'}</span></div>)}</div><p className="helper">Exports require a click in the app. New carousel and shader implementations are added in source, never evaluated from uploaded code.</p>{audit.length > 0 && <div className="audit"><h3>Recent agent actions</h3>{audit.map((entry, index) => <div key={index}><code>{entry.name}</code><span>{entry.time}</span></div>)}</div>}</section></Modal>}</>;
}
