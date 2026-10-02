import React, { useEffect, useId, useMemo, useState } from 'react';
import { Check, MagnifyingGlass, X } from '@phosphor-icons/react';
import { CATALOG, listCatalog } from '../../catalog.js';
import { TEMPLATES } from '../../project.js';
import { MotionPreview } from './MotionPreview.jsx';
import { IconButton, Modal } from '../controls.jsx';

const families = [...new Set(CATALOG.map(preset => preset.family))];
export function PresetBrowser({ layer, onApply, onClose }) {
  const titleId = useId();
  const panelId = useId();
  const [kind, setKind] = useState('templates');
  const [playing, setPlaying] = useState(() => typeof window === 'undefined' || !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPlaying(!preference.matches);
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState('');
  const [selectedId, setSelectedId] = useState(layer.template);
  const items = useMemo(() => kind === 'catalog' ? listCatalog({ query, family }) : TEMPLATES.filter(item => `${item.name} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase())), [kind, query, family]);
  const selected = items.find(item => item.id === selectedId) || items[0];
  function changeKind(next) { setKind(next); setQuery(''); setFamily(''); setSelectedId(next === 'templates' ? layer.template : ''); }
  function navigate(event) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll('.preset-tile')];
    const current = buttons.indexOf(document.activeElement);
    if (current < 0) return;
    event.preventDefault();
    const columns = getComputedStyle(event.currentTarget).gridTemplateColumns.split(' ').length;
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key] || 0;
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, current + delta));
    buttons[index]?.focus();
    buttons[index]?.click();
  }
  function apply() {
    if (!selected) return;
    const patch = kind === 'catalog' ? selected.carouselPatch : { template: selected.id, ...(['arc', 'flip'].includes(selected.id) ? { tilt: 0, yaw: 0, roll: 0 } : {}) };
    onApply(patch);
    onClose();
  }
  return <Modal labelledBy={titleId} onClose={onClose}><div className="preset-window">
    <header className="preset-header"><div><h2 id={titleId}>Motion library</h2></div><div className="preset-header-actions"><button type="button" className="subtle-button" onClick={() => setPlaying(value => !value)}>{playing ? 'Pause previews' : 'Play previews'}</button><IconButton label="Close motion library" onClick={onClose}><X size={20}/></IconButton></div></header>
    <div className="preset-toolbar"><div className="preset-switch" role="tablist" aria-label="Library collection">{[['templates', 'Motion templates', TEMPLATES.length], ['catalog', 'Preset catalog', CATALOG.length]].map(([id, label, count]) => <button key={id} id={`${titleId}-${id}`} type="button" role="tab" aria-selected={kind === id} aria-controls={panelId} tabIndex={kind === id ? 0 : -1} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const next = kind === 'templates' ? 'catalog' : 'templates'; changeKind(next); document.getElementById(`${titleId}-${next}`)?.focus(); } }} onClick={() => changeKind(id)}>{label}<span>{count}</span></button>)}</div><label className="preset-search"><MagnifyingGlass size={17}/><input autoFocus type="search" aria-label="Search motion library" placeholder="Search movements, names, families…" value={query} onChange={event => setQuery(event.target.value)}/></label></div>
    <div className="preset-content" id={panelId} role="tabpanel" aria-labelledby={`${titleId}-${kind}`}>
      <div className="preset-gallery"><div className="preset-filters">{kind === 'catalog' && <div className="preset-family-list" role="group" aria-label="Filter by family">{['', ...families].map(name => <button key={name} aria-pressed={family === name} onClick={() => { setFamily(name); setSelectedId(''); }}>{name || 'All families'}</button>)}</div>}<p role="status">{items.length} {items.length === 1 ? 'result' : 'results'}</p></div>
        {items.length ? <div className="preset-grid" role="list" aria-label="Available movements" onKeyDown={navigate}>{items.map(item => <div key={item.id} role="listitem"><button type="button" className={`preset-tile ${selected?.id === item.id ? 'selected' : ''}`} aria-pressed={selected?.id === item.id} onClick={() => setSelectedId(item.id)}>
          <div className="preset-art"><MotionPreview item={item} collection={kind} playing={playing}/></div>
          <div className="preset-tile-label"><div>{kind === 'catalog' && <small>{item.family}</small>}<strong>{item.name}</strong></div>{selected?.id === item.id && <Check size={16}/>}</div>
        </button></div>)}</div> : <div className="preset-empty"><h3>No matching movements</h3><p>Try another name or clear your filters.</p><button className="outline-button" onClick={() => { setQuery(''); setFamily(''); }}>Clear filters</button></div>}
      </div>
      <aside className="preset-detail" aria-label="Selected movement">{selected ? <><small>{kind === 'catalog' ? selected.group : 'Original motion'}</small><h3>{selected.name}</h3><p>{selected.description}</p>{kind === 'catalog' && <><dl><div><dt>Cards</dt><dd>{selected.carouselPatch.cardCount || 'Media count'}</dd></div><div><dt>Ratio</dt><dd>{selected.cardAspectRatio || 'Default'}</dd></div><div><dt>Rhythm</dt><dd>{selected.carouselPatch.motion.mode === 'steps' ? 'Actions' : 'Continuous'}</dd></div><div><dt>Curve</dt><dd>{selected.carouselPatch.motion.curve}</dd></div></dl>{selected.thumbnail && <details className="preset-reference"><summary>Reference sheet</summary><img src={selected.thumbnail} alt={`${selected.name} documentary reference sheet`} loading="lazy"/></details>}<details><summary>Implementation limits</summary><ul>{selected.support.notApplied.map(limit => <li key={limit}>{limit}</li>)}</ul></details></>}<div className="preset-apply"><button className="primary-button" onClick={apply}>{kind === 'catalog' ? 'Apply preset' : 'Use motion'}</button></div></> : <p>Select a movement to see its details.</p>}</aside>
    </div>

  </div></Modal>;
}
