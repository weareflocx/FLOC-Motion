import React, { useRef, useState } from 'react';
import { Copy, DotsSixVertical, Eye, EyeSlash, LockSimple, LockSimpleOpen, PencilSimple, Trash } from '@phosphor-icons/react';
import { IconButton } from '../controls.jsx';
import { LAYER_COLORS } from '../layer-colors.js';
import { PROJECT_LIMITS, TEMPLATES } from '../../project.js';

const layerTypes = { background: 'Background', carousel: 'Carousel', text: 'Text', logo: 'Logo', music: 'Audio', media: 'Media', model: '3D model', effect: 'Effect' };

// Click selects one layer; ⌘/Ctrl-click toggles and Shift-click selects the listed range.
// Rows show the layer name with its kind or content underneath. Visibility and lock stay
// visible; rename, duplicate and delete appear on hover or keyboard focus (always on touch).
export function LayerList({ project, selected, selection = selected == null ? [] : [selected], icons, onSelect, onPatch, onMove, onDrop, onDuplicate, onRemove }) {
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
  const order = [...project.layers].reverse().map(item => item.id);
  const choose = (item, event) => event.shiftKey ? onSelect(item.id, 'range', order) : event.metaKey || event.ctrlKey ? onSelect(item.id, 'toggle', order) : onSelect(item.id);
  return <>
    <div className="layer-list" aria-label="Composition layers">{[...project.layers].reverse().map(item => {
      const Icon = icons[item.type];
      const kind = item.type === 'effect' && item.effectScope === 'below' ? 'Adjustment' : layerTypes[item.type];
      const content = item.type === 'text' ? item.text.replace(/\s+/g, ' ').trim() : item.type === 'carousel' ? TEMPLATES.find(template => template.id === item.template)?.name : '';
      const detail = [kind !== item.name && kind, content].filter(Boolean).join(' · ');
      return <div key={item.id} className={`layer-row ${selection.includes(item.id) ? 'active' : ''} ${item.locked ? 'locked' : ''} ${item.visible ? '' : 'hidden-layer'} ${drop?.id === item.id ? `drop-${drop.side}` : ''}`}
        draggable={!item.locked && editing !== item.id}
        onDragStart={event => { dragging.current = item.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id); onSelect(item.id); }}
        onDragOver={event => { if (!dragging.current || dragging.current === item.id) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; const rect = event.currentTarget.getBoundingClientRect(); setDrop({ id: item.id, side: event.clientY < rect.top + rect.height / 2 ? 'above' : 'below' }); }}
        onDrop={event => { event.preventDefault(); if (dragging.current && dragging.current !== item.id) { const rect = event.currentTarget.getBoundingClientRect(); onDrop(dragging.current, item.id, event.clientY < rect.top + rect.height / 2 ? 'above' : 'below'); } dragging.current = null; setDrop(null); }}
        onDragEnd={() => { dragging.current = null; setDrop(null); }}>
        <span className="layer-grip" aria-hidden="true"><DotsSixVertical size={12}/></span>
        {editing === item.id ? <input autoFocus className="layer-name-input" aria-label={`Rename ${item.name}`} maxLength={100} value={name} onChange={event => setName(event.target.value)} onBlur={() => commit(item)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(item); } if (event.key === 'Escape') { event.preventDefault(); setEditing(null); } }}/>
          : <button className="layer-select" title={item.type === 'text' ? item.text : item.name} aria-label={detail ? `${item.name} · ${detail}` : item.name} aria-pressed={selection.includes(item.id)} onClick={event => choose(item, event)} onDoubleClick={() => rename(item)} onKeyDown={event => { if (event.key === 'F2') { event.preventDefault(); rename(item); } if ((event.key === ' ' || event.key === 'Enter') && (event.shiftKey || event.metaKey || event.ctrlKey)) { event.preventDefault(); choose(item, event); } if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key) && !item.locked) { event.preventDefault(); onMove(event.key === 'ArrowUp' ? 1 : -1, item.id); } }}><Icon size={17} style={{ color: LAYER_COLORS[item.type] }}/><span className="layer-text"><span className="layer-label">{item.name}</span>{detail && <span className="layer-detail">{detail}</span>}</span></button>}
        {editing !== item.id && <div className="layer-row-actions" aria-label={`Actions for ${item.name}`} onDragStart={event => event.preventDefault()}>
          <IconButton label={`${item.visible ? 'Hide' : 'Show'} ${item.name}`} onClick={() => onPatch(item.id, { visible: !item.visible })}>{item.visible ? <Eye size={14}/> : <EyeSlash size={14}/>}</IconButton>
          <IconButton label={`${item.locked ? 'Unlock' : 'Lock'} ${item.name}`} onClick={() => onPatch(item.id, { locked: !item.locked })}>{item.locked ? <LockSimple size={14}/> : <LockSimpleOpen size={14}/>}</IconButton>
          <span className="layer-row-more">
            <IconButton label={`Rename ${item.name}`} disabled={item.locked} onClick={() => rename(item)}><PencilSimple size={14}/></IconButton>
            <IconButton label={`Duplicate ${item.name}`} disabled={item.locked || project.layers.length >= PROJECT_LIMITS.maxLayers} onClick={() => onDuplicate(item.id)}><Copy size={14}/></IconButton>
            <IconButton label={`Delete ${item.name}`} disabled={item.locked} onClick={() => onRemove(item.id)}><Trash size={14}/></IconButton>
          </span>
        </div>}
      </div>;
    })}</div>


  </>;
}
