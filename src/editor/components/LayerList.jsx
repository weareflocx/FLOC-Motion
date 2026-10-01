import React, { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, DotsSixVertical, Eye, EyeSlash, LockSimple, LockSimpleOpen, PencilSimple } from '@phosphor-icons/react';
import { TEMPLATES } from '../../project.js';
import { IconButton } from '../controls.jsx';

export function LayerList({ project, selected, icons, onSelect, onPatch, onMove, onDrop, onDuplicate }) {
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [drop, setDrop] = useState(null);
  const dragging = useRef(null);
  const layer = project.layers.find(l => l.id === selected);
  function rename(item) { if (item.locked) return; onSelect(item.id); setEditing(item.id); setName(item.name); }
  function commit(item) {
    if (editing !== item.id) return;
    const value = name.trim(); setEditing(null);
    if (value && value !== item.name) onPatch(item.id, { name: value });
  }
  return <>
    <div className="layer-list" aria-label="Composition layers">{[...project.layers].reverse().map(item => {
      const Icon = icons[item.type];
      return <div key={item.id} className={`layer-row ${selected === item.id ? 'active' : ''} ${item.locked ? 'locked' : ''} ${drop?.id === item.id ? `drop-${drop.side}` : ''}`}
        draggable={!item.locked && editing !== item.id}
        onDragStart={event => { dragging.current = item.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id); onSelect(item.id); }}
        onDragOver={event => { if (!dragging.current || dragging.current === item.id) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; const rect = event.currentTarget.getBoundingClientRect(); setDrop({ id: item.id, side: event.clientY < rect.top + rect.height / 2 ? 'above' : 'below' }); }}
        onDrop={event => { event.preventDefault(); if (dragging.current && dragging.current !== item.id) { const rect = event.currentTarget.getBoundingClientRect(); onDrop(dragging.current, item.id, event.clientY < rect.top + rect.height / 2 ? 'above' : 'below'); } dragging.current = null; setDrop(null); }}
        onDragEnd={() => { dragging.current = null; setDrop(null); }}>
        <span className="layer-grip" aria-hidden="true"><DotsSixVertical size={12}/></span>
        {editing === item.id ? <input autoFocus className="layer-name-input" aria-label={`Rename ${item.name}`} maxLength={100} value={name} onChange={event => setName(event.target.value)} onBlur={() => commit(item)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(item); } if (event.key === 'Escape') { event.preventDefault(); setEditing(null); } }}/>
          : <button className="layer-select" aria-pressed={selected === item.id} onClick={() => onSelect(item.id)} onDoubleClick={() => rename(item)} onKeyDown={event => { if (event.key === 'F2') { event.preventDefault(); rename(item); } if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key) && !item.locked) { event.preventDefault(); onMove(event.key === 'ArrowUp' ? 1 : -1, item.id); } }}><Icon size={17}/><span>{item.name}<small>{item.type === 'carousel' ? TEMPLATES.find(t => t.id === item.template).name : item.type === 'music' && !item.src ? 'No track added' : item.type}</small></span></button>}
        <IconButton label={`${item.locked ? 'Unlock' : 'Lock'} ${item.name}`} onClick={() => onPatch(item.id, { locked: !item.locked })}>{item.locked ? <LockSimple size={14}/> : <LockSimpleOpen size={14}/>}</IconButton>
        <IconButton label={`${item.visible ? 'Hide' : 'Show'} ${item.name}`} onClick={() => onPatch(item.id, { visible: !item.visible })}>{item.visible ? <Eye size={14}/> : <EyeSlash size={14}/>}</IconButton>
      </div>;
    })}</div>
    <div className="layer-actions" aria-label="Selected layer actions">
      <IconButton label="Rename selected layer" disabled={!layer || layer.locked} onClick={() => rename(layer)}><PencilSimple size={15}/></IconButton>
      <IconButton label="Duplicate selected layer" disabled={!layer || layer.locked || !['text', 'logo'].includes(layer.type) || project.layers.length >= 20} onClick={() => onDuplicate(layer.id)}><Copy size={15}/></IconButton>
      <span/>
      <IconButton label="Move layer forward" onClick={() => onMove(1)} disabled={!layer || layer.locked || project.layers.at(-1)?.id === selected}><ArrowUp size={15}/></IconButton>
      <IconButton label="Move layer backward" onClick={() => onMove(-1)} disabled={!layer || layer.locked || project.layers[0]?.id === selected}><ArrowDown size={15}/></IconButton>
    </div>
    <p className="layer-list-hint">Top layers appear in front. Drag to reorder · Double-click to rename.</p>
  </>;
}
