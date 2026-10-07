import React, { useRef, useState } from 'react';
import { Copy, DotsSixVertical, Eye, EyeSlash, LockSimple, LockSimpleOpen, PencilSimple, Trash } from '@phosphor-icons/react';
import { IconButton } from '../controls.jsx';
import { LAYER_COLORS } from '../layer-colors.js';

const layerTypes = { background: 'Background', carousel: 'Carousel', text: 'Text', logo: 'Logo', music: 'Audio', media: 'Media', model: '3D model', effect: 'Effect' };

export function LayerList({ project, selected, icons, onSelect, onPatch, onMove, onDrop, onDuplicate, onRemove }) {
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [drop, setDrop] = useState(null);
  const dragging = useRef(null);
  function rename(item) { if (item.locked) return; onSelect(item.id); setEditing(item.id); setName(item.name); }
  function commit(item) {
    if (editing !== item.id) return;
    const value = name.trim(); setEditing(null);
    if (value && value !== item.name) onPatch(item.id, { name: value });
  }
  return <>
    <div className="layer-list" aria-label="Composition layers">{[...project.layers].reverse().map(item => {
      const Icon = icons[item.type];
      const label = item.type === 'effect' && item.effectScope === 'below' ? 'Adjustment' : item.type === 'text' ? item.text.replace(/\s+/g, ' ').trim() || layerTypes.text : layerTypes[item.type];
      return <div key={item.id} className={`layer-row ${selected === item.id ? 'active' : ''} ${item.locked ? 'locked' : ''} ${drop?.id === item.id ? `drop-${drop.side}` : ''}`}
        draggable={!item.locked && editing !== item.id}
        onDragStart={event => { dragging.current = item.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id); onSelect(item.id); }}
        onDragOver={event => { if (!dragging.current || dragging.current === item.id) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; const rect = event.currentTarget.getBoundingClientRect(); setDrop({ id: item.id, side: event.clientY < rect.top + rect.height / 2 ? 'above' : 'below' }); }}
        onDrop={event => { event.preventDefault(); if (dragging.current && dragging.current !== item.id) { const rect = event.currentTarget.getBoundingClientRect(); onDrop(dragging.current, item.id, event.clientY < rect.top + rect.height / 2 ? 'above' : 'below'); } dragging.current = null; setDrop(null); }}
        onDragEnd={() => { dragging.current = null; setDrop(null); }}>
        <span className="layer-grip" aria-hidden="true"><DotsSixVertical size={12}/></span>
        {editing === item.id ? <input autoFocus className="layer-name-input" aria-label={`Rename ${item.name}`} maxLength={100} value={name} onChange={event => setName(event.target.value)} onBlur={() => commit(item)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(item); } if (event.key === 'Escape') { event.preventDefault(); setEditing(null); } }}/>
          : <button className="layer-select" title={item.type === 'text' ? item.text : item.name} aria-label={label === item.name ? label : `${label} · ${item.name}`} aria-pressed={selected === item.id} onClick={() => onSelect(item.id)} onDoubleClick={() => rename(item)} onKeyDown={event => { if (event.key === 'F2') { event.preventDefault(); rename(item); } if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key) && !item.locked) { event.preventDefault(); onMove(event.key === 'ArrowUp' ? 1 : -1, item.id); } }}><Icon size={17} style={{ color: LAYER_COLORS[item.type] }}/><span className="layer-label">{label}</span></button>}
        {editing !== item.id && <div className="layer-row-actions" aria-label={`Actions for ${item.name}`} onDragStart={event => event.preventDefault()}>
          <IconButton label={`${item.visible ? 'Hide' : 'Show'} ${item.name}`} onClick={() => onPatch(item.id, { visible: !item.visible })}>{item.visible ? <Eye size={14}/> : <EyeSlash size={14}/>}</IconButton>
          <IconButton label={`${item.locked ? 'Unlock' : 'Lock'} ${item.name}`} onClick={() => onPatch(item.id, { locked: !item.locked })}>{item.locked ? <LockSimple size={14}/> : <LockSimpleOpen size={14}/>}</IconButton>
          <IconButton label={`Rename ${item.name}`} disabled={item.locked} onClick={() => rename(item)}><PencilSimple size={14}/></IconButton>
          <IconButton label={`Duplicate ${item.name}`} disabled={item.locked || project.layers.length >= 20} onClick={() => onDuplicate(item.id)}><Copy size={14}/></IconButton>
          <IconButton label={`Delete ${item.name}`} disabled={item.locked} onClick={() => onRemove(item.id)}><Trash size={14}/></IconButton>
        </div>}
      </div>;
    })}</div>


  </>;
}
