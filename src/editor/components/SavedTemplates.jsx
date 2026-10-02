import React, { useEffect, useId, useRef, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { FORMAT_LABELS } from '../../project.js';
import { request } from '../request.js';
import { IconButton, Modal } from '../controls.jsx';
import { Stage } from '../Stage.jsx';
import { usePlayback } from '../usePlayback.js';

const noop = () => {};
function TemplatePreview({ project }) {
  const projectRef = useRef(project);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const { time, playing, setPlaying } = usePlayback({ projectRef, duration: project.duration });
  useEffect(() => {
    const pause = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange', pause);
    return () => document.removeEventListener('visibilitychange', pause);
  }, [setPlaying]);
  return <><div className="saved-template-preview" inert><Stage project={project} time={time} playing={playing} onReady={setReady} onError={setError} onPreview={noop} onSelect={noop} onPatch={noop}/></div>{error && <p role="alert">{error}</p>}<button className="outline-button" disabled={!ready} onClick={() => setPlaying(value => !value)}>{playing ? 'Pause preview' : 'Play preview'}</button></>;
}
export function SavedTemplates({ project, onApply, onClose }) {
  const title = useId();
  const [entries, setEntries] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [name, setName] = useState(project.name);
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState('');
  const selected = entries.find(entry => entry.id === selectedId);
  useEffect(() => {
    let alive = true;
    request('/api/templates').then(data => { if (alive) setEntries(data.templates); }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, []);
  function choose(entry) { setSelectedId(entry.id); setCreating(false); setName(entry.name); setTags(entry.tags.join(', ')); setConfirm(''); setError(''); }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const entry = await request(creating ? '/api/templates' : `/api/templates/${selected.id}`, { method: creating ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, tags: tags.split(',').map(tag => tag.trim()).filter(Boolean), ...(creating ? { project } : {}) }) });
      setEntries(items => [entry, ...items.filter(item => item.id !== entry.id)]); choose(entry);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError('');
    try { await request(`/api/templates/${selected.id}`, { method: 'DELETE' }); setEntries(items => items.filter(item => item.id !== selected.id)); setSelectedId(''); setConfirm(''); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const filtered = entries.filter(entry => `${entry.name} ${entry.tags.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <Modal labelledBy={title} onClose={onClose}><div className="preset-window saved-templates">
    <header className="preset-header"><div><h2 id={title}>Saved templates</h2></div><IconButton label="Close saved templates" onClick={onClose}><X size={20}/></IconButton></header>
    <div className="preset-toolbar"><button className="subtle-button" disabled={busy} onClick={() => { setCreating(true); setSelectedId(''); setName(project.name); setTags(''); setConfirm(''); setError(''); }}>Save current composition</button><label className="preset-search"><input autoFocus type="search" aria-label="Search saved templates" placeholder="Search names and tags…" value={query} onChange={event => setQuery(event.target.value)}/></label></div>
    {error && <p className="saved-template-error" role="alert">{error}</p>}
    <div className="preset-content"><div className="preset-gallery"><p className="helper" role="status">{busy ? 'Loading…' : `${filtered.length} saved templates`}</p><div className="preset-grid">{filtered.map(entry => {
      const cover = entry.project.images.find(image => !/\.(mp4|webm)$/i.test(image.src));
      return <button key={entry.id} disabled={busy} className={`preset-tile ${selectedId === entry.id ? 'selected' : ''}`} aria-pressed={selectedId === entry.id} onClick={() => choose(entry)}><div className="preset-art">{cover ? <img src={cover.src} alt="" loading="lazy"/> : <span>{FORMAT_LABELS[entry.project.format]}</span>}<span>{FORMAT_LABELS[entry.project.format]}</span></div><div className="preset-tile-label"><div><small>{entry.tags.join(' · ')}</small><strong>{entry.name}</strong></div></div></button>;
    })}</div>{!busy && !filtered.length && <div className="preset-empty"><h3>{entries.length ? 'No matching templates' : 'No saved templates'}</h3><p>Save the current composition to get started.</p></div>}</div>
      <aside className="preset-detail" aria-label="Saved template details">{(selected || creating) ? <><h3>{creating ? 'Save composition' : selected.name}</h3><TemplatePreview key={creating ? 'current' : selected.id} project={creating ? project : selected.project}/><form className="saved-template-form" onSubmit={save}><label>Name<input required maxLength={100} value={name} onChange={event => setName(event.target.value)}/></label><label>Tags<input value={tags} placeholder="Brand, campaign, format…" onChange={event => setTags(event.target.value)}/></label><button className="outline-button" disabled={busy}>{creating ? 'Save template' : 'Save name and tags'}</button></form>{selected && <div className="preset-apply">{confirm ? <><p>{confirm === 'apply' ? 'Replace the current composition? You can undo this in the editor.' : 'Delete this saved template? Media files and your current composition will remain.'}</p><button disabled={busy} onClick={confirm === 'delete' ? remove : () => { if (onApply(selected.project)) onClose(); }}>{confirm === 'delete' ? 'Confirm delete' : 'Confirm apply'}</button><button className="outline-button" disabled={busy} onClick={() => setConfirm('')}>Cancel</button></> : <><button disabled={busy} onClick={() => setConfirm('apply')}>Apply composition</button><button className="outline-button" disabled={busy} onClick={() => setConfirm('delete')}>Delete template</button></>}</div>}</> : <p>Select a template to preview it.</p>}</aside>
    </div>
  </div></Modal>;
}
