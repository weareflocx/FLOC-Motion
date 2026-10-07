import React, { useEffect, useId, useMemo, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { CATALOG } from '../../catalog.js';
import { TEMPLATES } from '../../project.js';
import { DEFAULT_MOTION, motionBaseline } from '../../motion-timing.js';
import { MotionPreview } from './MotionPreview.jsx';
import { IconButton, Modal } from '../controls.jsx';

const templateFamilies = { circular: 'Orbit', depth: 'Stack', arc: 'Stack', horizontal: 'Sliders', flip: 'Sliders' };
const movements = [
  ...TEMPLATES.map(item => ({ ...item, collection: 'templates', family: templateFamilies[item.id] || item.name })),
  ...CATALOG.map(item => ({ ...item, collection: 'catalog' }))
];
const families = [...new Set(movements.map(item => item.family))];
const movementKey = item => `${item.collection}:${item.id}`;
export function PresetBrowser({ layer, onApply, onSelect, onClose, error }) {
  const titleId = useId();
  const [playing, setPlaying] = useState(() => typeof window === 'undefined' || !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPlaying(!preference.matches);
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);
  const [family, setFamily] = useState('');
  const items = useMemo(() => movements.filter(item => !family || item.family === family), [family]);
  function apply(item) {
    const patch = item.collection === 'catalog' ? item.carouselPatch : { template: item.id, motion: { ...DEFAULT_MOTION }, ...item.defaults, motionBaseline: motionBaseline({ ...layer, motion: DEFAULT_MOTION, ...item.defaults }, item.name), ...(['arc', 'flip'].includes(item.id) ? { tilt: 0, yaw: 0, roll: 0 } : {}) };
    if (onSelect) onSelect(patch, item);
    else { onApply(patch); onClose(); }
  }
  return <Modal labelledBy={titleId} onClose={onClose}><div className="preset-window preset-direct-library">
    <header className="preset-header"><div><h2 id={titleId}>{onSelect ? 'Choose carousel' : 'Motion library'}</h2></div><div className="preset-header-actions"><button type="button" className="subtle-button" onClick={() => setPlaying(value => !value)}>{playing ? 'Pause previews' : 'Play previews'}</button><IconButton label={onSelect ? 'Cancel carousel creation' : 'Close motion library'} onClick={onClose}><X size={20}/></IconButton></div></header>
    <div className="preset-content">
      <div className="preset-gallery preset-unified-gallery">{error && <p role="alert">{error}</p>}<div className="preset-filters preset-visual-filters"><div className="preset-family-list" role="group" aria-label="Filter by movement family"><button type="button" aria-pressed={!family} onClick={() => setFamily('')}>All movements<span>{movements.length}</span></button>{families.map(name => {
        const sample = movements.find(item => item.collection === 'templates' && item.family === name);
        return <button type="button" key={name} aria-pressed={family === name} onClick={() => setFamily(name)}><div className="preset-filter-art"><MotionPreview item={sample} collection={sample.collection} playing={playing}/></div><span>{name}</span></button>;
      })}</div><p role="status">{items.length} {items.length === 1 ? 'movement' : 'movements'}</p></div>
        {items.length ? <div className="preset-grid" role="list" aria-label="Available movements">{items.map(item => <div key={movementKey(item)} role="listitem" className="preset-tile preset-direct-tile">
          <div className="preset-art"><MotionPreview item={item} collection={item.collection} playing={playing}/><button type="button" className="preset-card-apply" aria-label={`${onSelect ? 'Select carousel' : 'Apply preset'}: ${item.name} (${item.family})`} onClick={() => apply(item)}>{onSelect ? 'Select carousel' : 'Apply preset'}</button></div>
          <div className="preset-tile-label"><strong title={item.name}>{item.name}</strong><small>{item.family}</small></div>
        </div>)}</div> : <div className="preset-empty"><h3>No matching movements</h3><p>Choose another family or show all movements.</p><button className="outline-button" onClick={() => { setFamily(''); }}>Clear filters</button></div>}
      </div>

    </div>

  </div></Modal>;
}
