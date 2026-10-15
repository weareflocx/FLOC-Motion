import React, { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, X } from '@phosphor-icons/react';
import { ASSET_DRAG_TYPE, isVisualAsset } from '../media-library.js';
import { IconButton } from '../controls.jsx';
import { AssetThumb } from './AssetThumb.jsx';

// A carousel's cards in order. Rows reorder by dragging or the arrows; images, GIFs and videos
// dragged from the media library are appended.
export function CardList({ layer, images, onMove, onRemove, onAddAsset }) {
  const dragging = useRef(null);
  const [target, setTarget] = useState(null);
  const acceptsAsset = event => !layer.locked && event.dataTransfer.types.includes(ASSET_DRAG_TYPE);
  function dropAsset(event) {
    if (!acceptsAsset(event)) return;
    event.preventDefault(); setTarget(null);
    const asset = JSON.parse(event.dataTransfer.getData(ASSET_DRAG_TYPE));
    if (isVisualAsset(asset)) onAddAsset(asset);
  }
  return <div className={`card-list${target === 'asset' ? ' is-drop-target' : ''}`}
    onDragOver={event => { if (acceptsAsset(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setTarget('asset'); } }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setTarget(null); }}
    onDrop={dropAsset}>
    {images.length ? <ol className="asset-list" aria-label={`${layer.name} cards`}>{images.map((image, index) => <li key={image.id} className={`asset${target === index ? ' is-drop-target' : ''}`} draggable={!layer.locked}
      onDragStart={event => { dragging.current = index; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', image.name); }}
      onDragOver={event => { if (dragging.current === null || dragging.current === index) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setTarget(index); }}
      onDrop={event => { if (dragging.current === null) return; event.preventDefault(); event.stopPropagation(); onMove(dragging.current, index); dragging.current = null; setTarget(null); }}
      onDragEnd={() => { dragging.current = null; setTarget(null); }}>
      <span className="asset-number">{String(index + 1).padStart(2, '0')}</span>
      <AssetThumb asset={image}/>
      <span className="asset-name" title={image.name}>{image.name}</span>
      <div className="asset-actions">
        <IconButton label={`Move card ${index + 1} earlier`} onClick={() => onMove(index, index - 1)} disabled={index === 0}><ArrowUp size={13}/></IconButton>
        <IconButton label={`Move card ${index + 1} later`} onClick={() => onMove(index, index + 1)} disabled={index === images.length - 1}><ArrowDown size={13}/></IconButton>
        <IconButton label={`Remove card ${index + 1}`} onClick={() => onRemove(index)}><X size={13}/></IconButton>
      </div>
    </li>)}</ol> : <p className="helper">No cards yet.</p>}
  </div>;
}
