import React, { useState } from 'react';
import { Eye, EyeSlash, LockSimple, LockSimpleOpen, UploadSimple } from '@phosphor-icons/react';
import { IconButton } from '../controls.jsx';
import { layerKind } from '../layer-kinds.js';

// Layers backed by a file offer replacement; the add-layer dialog validates the file chosen.
const SOURCES = {
  logo: ['Replace logo'],
  media: ['Replace file'],
  model: ['Replace file', 'GLB, or OBJ with its declared MTL and textures'],
  music: ['Replace soundtrack']
};

// Every inspector starts with the same header: editable name, kind, visibility and lock,
// and the source replacement for layers backed by a file.
export function LayerHeader({ layer, uploading, onPatch, onPick }) {
  const [name, setName] = useState(null);
  const source = SOURCES[layer.type];
  const label = layer.type === 'music' && !layer.src ? 'Choose soundtrack' : source?.[0];
  function commit() {
    const value = name?.trim();
    setName(null);
    if (value && value !== layer.name) onPatch(layer.id, { name: value });
  }
  return <div className="layer-header">
    <div className="layer-header-title">
      <input className="layer-header-name" aria-label="Layer name" maxLength={100} disabled={layer.locked} value={name ?? layer.name}
        onChange={event => setName(event.target.value)} onBlur={commit}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setName(null); } }}/>
      <span className="layer-header-kind">{layerKind(layer)}</span>
    </div>
    <div className="layer-header-actions">
      <IconButton label={layer.visible ? 'Hide layer' : 'Show layer'} aria-pressed={!layer.visible} onClick={() => onPatch(layer.id, { visible: !layer.visible })}>{layer.visible ? <Eye size={15}/> : <EyeSlash size={15}/>}</IconButton>
      <IconButton label={layer.locked ? 'Unlock layer' : 'Lock layer'} aria-pressed={layer.locked} onClick={() => onPatch(layer.id, { locked: !layer.locked })}>{layer.locked ? <LockSimple size={15}/> : <LockSimpleOpen size={15}/>}</IconButton>
    </div>
    {source && <button type="button" className="outline-button layer-header-source" title={source[1]} disabled={uploading || layer.locked} onClick={() => onPick(layer.id)}><UploadSimple size={15}/>{label}</button>}
  </div>;
}
