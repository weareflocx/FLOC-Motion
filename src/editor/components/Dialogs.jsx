import React, { useState } from 'react';
import { DownloadSimple, FilmStrip, Robot, X } from '@phosphor-icons/react';
import { createTools } from '../../webmcp.js';
import { FORMAT_LABELS } from '../../project.js';
import { EXPORT_QUALITIES, EXPORT_RESOLUTIONS, EXPORT_FORMATS, exportDimensions, exportFormat } from '../../export-settings.js';
import { isTerminalJobState } from '../../export-jobs.js';
import { Field, IconButton, Modal } from '../controls.jsx';
import { RendererConnection } from './RendererConnection.jsx';

const JOB_STATE_LABELS = { queued: 'Queued', rendering: 'Rendering', done: 'Ready', failed: 'Failed', cancelled: 'Cancelled' };
const qualityLabel = id => EXPORT_QUALITIES.find(item => item.id === id)?.label;
// Jobs from before export formats, or with an unknown format, are MP4.
const outputOf = item => exportFormat(item.format) || exportFormat();
const outputLabel = item => `${outputOf(item).name}${item.transparent ? ' · Transparent' : ''}`;
function DownloadLink({ item, className, children }) {
  const output = outputOf(item);
  return <a className={className} href={item.url} download={`${item.name}.${output.extension}`}>{children}Download {output.extension.toUpperCase()}</a>;
}

export function Dialogs({ project, exportOpen, agentOpen, job, busy, recent, settings, onSettingsChange, agentState, audit, onCloseExport, onCloseAgent, onRender, onCancelExport }) {
  const { quality, resolution, format, transparent } = settings;
  const output = exportFormat(format);
  const [renderer, setRenderer] = useState(null);
  const [cancelling, setCancelling] = useState('');
  const dimensions = exportDimensions(project.format, resolution);
  async function cancel(id = job?.id) { setCancelling(id); try { await onCancelExport(id); } finally { setCancelling(''); } }
  return <>{exportOpen && <Modal onClose={onCloseExport} labelledBy="export-heading"><section className="modal">
    <div className="modal-heading"><FilmStrip size={22}/><IconButton label="Close export dialog" onClick={onCloseExport}><X size={19}/></IconButton></div>
    <h2 id="export-heading">Export video</h2>
    <RendererConnection busy={busy} onChange={setRenderer}/>
    <div className="export-summary"><span>{FORMAT_LABELS[project.format]}<small>{dimensions.join(' × ')}</small></span><span>{project.duration}s<small>Duration</small></span><span>{project.fps}<small>Frames / sec</small></span></div>
    <Field label="Quality"><select aria-label="Export quality" value={quality} onChange={event => onSettingsChange({ ...settings, quality: event.target.value })}>{EXPORT_QUALITIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>

    <Field label="Resolution"><select aria-label="Export resolution" value={resolution} onChange={event => onSettingsChange({ ...settings, resolution: event.target.value })}>{EXPORT_RESOLUTIONS.map(item => <option key={item.id} value={item.id}>{item.label} · {exportDimensions(project.format, item.id).join(' × ')}</option>)}</select></Field>

    <Field label="Format"><select aria-label="Export format" value={format} onChange={event => onSettingsChange({ ...settings, format: event.target.value })}>{EXPORT_FORMATS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
    {output.alpha && <label className="check-field"><input type="checkbox" checked={transparent} onChange={event => onSettingsChange({ ...settings, transparent: event.target.checked })}/>Transparent background (leaves out background layers)</label>}

    {job && <div className={`job-status ${job.state === 'failed' ? 'failed' : ''}`} role="status"><strong>{job.message}</strong>{job.width && <p className="helper">{job.width} × {job.height} · {job.fps} fps · {qualityLabel(job.quality)} · {outputLabel(job)}</p>}{!isTerminalJobState(job.state) && <progress value={job.progress} max="100"/>}{busy && <button className="outline-button" disabled={cancelling === job.id} onClick={() => cancel()}>{cancelling === job.id ? 'Cancelling…' : 'Cancel export'}</button>}{job.state === 'done' && (job.url ? <DownloadLink item={job} className="export-button"><DownloadSimple size={17}/></DownloadLink> : job.file && <p className="helper export-file">{job.file}</p>)}</div>}
    {/* While an export runs, another one joins the queue behind it. */}
    <button className="export-button full-width" disabled={!renderer || renderer.connecting || ((renderer.required || renderer.paired) && !(renderer.paired && renderer.online && renderer.compatible)) || !project.layers.some(layer => layer.visible && layer.type !== 'music')} onClick={() => onRender({ quality, resolution, format, transparent: Boolean(output.alpha) && transparent })}>{busy ? `Queue ${output.name}` : `Render ${output.name}`}<DownloadSimple size={17}/></button>
    {busy && <p className="helper" role="status">Keep this computer awake and its renderer running until the export is ready.</p>}
    {recent.length > 0 && <details className="context-help export-history"><summary>Recent exports</summary><ol>{recent.map(item => <li key={item.id}>
      <div><strong>{item.name}</strong><span className={`export-state ${item.state}`}>{JOB_STATE_LABELS[item.state] || item.state}{item.position ? ` · ${item.position}` : ''}</span></div>
      <small>{new Date(item.createdAt).toLocaleString()} · {item.width} × {item.height} · {qualityLabel(item.quality)} · {outputLabel(item)}</small>
      {item.state === 'done' && (item.url ? <DownloadLink item={item}/> : item.file && <small className="export-file">{item.file}</small>)}
      {!isTerminalJobState(item.state) && <button type="button" className="text-button" disabled={cancelling === item.id} onClick={() => cancel(item.id)}>{cancelling === item.id ? 'Cancelling…' : 'Cancel'}</button>}
    </li>)}</ol></details>}
  </section></Modal>}
    {agentOpen && <Modal onClose={onCloseAgent} labelledBy="agent-heading"><section className="modal agent-modal"><div className="modal-heading"><Robot size={24}/><IconButton label="Close agent tools" onClick={onCloseAgent}><X size={19}/></IconButton></div><h2 id="agent-heading">Agent tools</h2><div className="native-status"><span className={`status-dot ${agentState === 'Connected' ? 'saved' : ''}`}/>{agentState === 'Unavailable' ? 'WebMCP is not available in this browser.' : `WebMCP · ${agentState}`}</div><details className="context-help"><summary>Available tools</summary><div className="tool-list">{createTools({}).map(tool => <div key={tool.name}><code>{tool.name}</code><span>{tool.annotations.readOnlyHint ? 'READ' : 'ACTION'}</span></div>)}</div></details><p className="helper">Exports require confirmation in the app.</p>{audit.length > 0 && <div className="audit"><h3>Recent agent actions</h3>{audit.map((entry, index) => <div key={index}><code>{entry.name}</code><span>{entry.time}</span></div>)}</div>}</section></Modal>}</>;
}
