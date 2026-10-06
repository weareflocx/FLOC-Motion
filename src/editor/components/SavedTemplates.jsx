import React, { useEffect, useId, useRef, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { carouselImages, FORMAT_LABELS } from '../../project.js';
import { contentFields } from '../../template-content.js';
import { request } from '../request.js';
import { IconButton, Modal } from '../controls.jsx';
import { Stage } from '../Stage.jsx';
import { usePlayback } from '../usePlayback.js';

const noop = () => {};
export function TemplatePreview({ project }) {
  const projectRef = useRef(project);
  projectRef.current = project;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const { time, playing, setPlaying } = usePlayback({ projectRef, duration: project.duration });
  useEffect(() => {
    const pause = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange', pause);
    return () => document.removeEventListener('visibilitychange', pause);
  }, [setPlaying]);
  return <><div className="saved-template-preview" inert><Stage project={project} time={time} playing={playing} onReady={setReady} onError={setError} onPreview={noop} onSelect={noop} onPatch={noop}/></div>{error && <p role="alert">{error}</p>}<button type="button" className="outline-button" disabled={!ready} onClick={() => setPlaying(value => !value)}>{playing ? 'Pause preview' : 'Play preview'}</button></>;
}
export function SavedTemplates({ project, onMetadata, onSaveCurrent, onApply, onUseTemplate, onClose, picker = false, disabled = false, selectedId: initialSelectedId = '', onSelect }) {
  const title = useId();
  const [entries, setEntries] = useState([]);
  const [selectedId, setSelectedId] = useState(initialSelectedId);
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
  function choose(entry) { setSelectedId(entry.id); setName(entry.name); setTags(entry.tags.join(', ')); setConfirm(''); setError(''); if (picker) onSelect(entry); }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const entry = await request(`/api/templates/${selected.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, updatedAt: selected.updatedAt, tags: tags.split(',').map(tag => tag.trim()).filter(Boolean) }) });
      setEntries(items => [entry, ...items.filter(item => item.id !== entry.id)]); choose(entry); onMetadata(entry);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError('');
    try { await request(`/api/templates/${selected.id}`, { method: 'DELETE' }); setEntries(items => items.filter(item => item.id !== selected.id)); setSelectedId(''); setConfirm(''); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const filtered = entries.filter(entry => `${entry.name} ${entry.tags.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  const gallery = <div className="preset-gallery"><p className="helper" role="status">{busy ? 'Loading…' : `${filtered.length} saved compositions`}</p><div className="preset-grid">{filtered.map(entry => {
      const carousel = entry.project.layers.find(layer => layer.type === 'carousel');
      const cover = (carousel ? carouselImages(entry.project, carousel) : entry.project.images).find(image => !/\.(mp4|webm)$/i.test(image.src));
      const fieldCount = contentFields(entry.project).length;
      return <button type="button" key={entry.id} disabled={busy || disabled} className={`preset-tile ${selectedId === entry.id ? 'selected' : ''}`} aria-pressed={selectedId === entry.id} onClick={() => choose(entry)}><div className="preset-art">{cover ? <img src={cover.src} alt="" loading="lazy"/> : <span>{FORMAT_LABELS[entry.project.format]}</span>}<span>{FORMAT_LABELS[entry.project.format]}</span></div><div className="preset-tile-label"><div><small>{[...(fieldCount ? [`${fieldCount} content fields`] : []), ...entry.tags].join(' · ')}</small><strong>{entry.name}</strong></div></div></button>;
    })}</div>{!busy && !filtered.length && <div className="preset-empty"><h3>{entries.length ? 'No matching compositions' : 'No saved compositions'}</h3><p>{entries.length ? 'Try another search.' : picker ? 'Create a composition in Aspect, then save it to find it here.' : 'Save the current composition to get started.'}</p></div>}</div>;
  if (picker) return <div className="composition-picker">
    <label className="preset-search"><input type="search" aria-label="Search saved compositions" placeholder="Search names and tags…" value={query} disabled={busy || disabled} onChange={event => setQuery(event.target.value)}/></label>
    {error && <p role="alert">{error}</p>}
    {gallery}
    {selected && <div className="composition-picker-selection"><strong>{selected.name}</strong><span>{FORMAT_LABELS[selected.project.format]} · {selected.project.duration}s · {selected.project.layers.length} layers</span></div>}
  </div>;
  return <Modal labelledBy={title} onClose={onClose}><div className="preset-window saved-templates">
    <header className="preset-header"><div><h2 id={title}>Compositions</h2></div><IconButton label="Close saved compositions" onClick={onClose}><X size={20}/></IconButton></header>
    <div className="preset-toolbar"><button className="subtle-button" disabled={busy} onClick={onSaveCurrent}>Save a copy of current composition</button><label className="preset-search"><input autoFocus type="search" aria-label="Search saved compositions" placeholder="Search names and tags…" value={query} onChange={event => setQuery(event.target.value)}/></label></div>
    {error && <p className="saved-template-error" role="alert">{error}</p>}
    <div className="preset-content">{gallery}
      <aside className="preset-detail" aria-label="Saved template details">{selected ? <><h3>{selected.name}</h3><TemplatePreview key={selected.id} project={selected.project}/><form className="saved-template-form" onSubmit={save}><label>Name<input required maxLength={100} value={name} onChange={event => setName(event.target.value)}/></label><label>Tags<input value={tags} placeholder="Brand, campaign, format…" onChange={event => setTags(event.target.value)}/></label><button className="outline-button" disabled={busy}>Save name and tags</button></form>{selected && <div className="preset-apply">{confirm ? <><p>{confirm === 'apply' ? 'Open this composition? Further edits will automatically save to it. Your current work will be saved before switching.' : 'Delete this saved composition? Media files and your current composition will remain.'}</p><button disabled={busy} onClick={confirm === 'delete' ? remove : async () => { setBusy(true); setError(''); try { if (await onApply(selected)) onClose(); } catch (failure) { setError(failure.message); } finally { setBusy(false); } }}>{confirm === 'delete' ? 'Confirm delete' : 'Open composition'}</button><button className="outline-button" disabled={busy} onClick={() => setConfirm('')}>Cancel</button></> : <>{contentFields(selected.project).length > 0 && <button disabled={busy} onClick={() => onUseTemplate(selected)}>Use as template</button>}<button disabled={busy} onClick={() => setConfirm('apply')}>Open composition</button><button className="outline-button" disabled={busy} onClick={() => setConfirm('delete')}>Delete template</button></>}</div>}</> : <p>Select a template to preview it.</p>}</aside>
    </div>
  </div></Modal>;
}
