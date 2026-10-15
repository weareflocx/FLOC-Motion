import React, { useMemo, useRef, useState } from 'react';
import { ArrowsClockwise, Check, Images, Plus, UploadSimple } from '@phosphor-icons/react';
import { PROJECT_LIMITS } from '../../project.js';
import { ASSET_DRAG_TYPE, ASSET_KINDS, LIBRARY_FILTERS, assetKind, assetUse, matchesLibrary, projectSources } from '../../media-library.js';
import { IconButton } from '../controls.jsx';
import { uploadAssets } from '../upload-assets.js';
import { useMediaLibrary } from '../useMediaLibrary.js';
import { AssetThumb, thumbAspect } from './AssetThumb.jsx';
import { allFiles } from './AddLayerDialog.jsx';

const size = bytes => bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;

// Every upload in the workspace. Items are reused by dragging them onto the canvas (a new layer)
// or a carousel's card list, double-clicking (a new layer), or the selected layer's action.
export function MediaLibrary({ project, layer, onPlace }) {
  const { assets, loading, error } = useMediaLibrary();
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const input = useRef(null);
  const used = useMemo(() => projectSources(project), [project]);
  const shown = assets.filter(asset => matchesLibrary(asset, filter, query));
  const full = project.layers.length >= PROJECT_LIMITS.maxLayers;
  async function upload(files) {
    setUploading(true); setUploadError('');
    try { await uploadAssets(files); } catch (failure) { setUploadError(failure.message); } finally { setUploading(false); }
  }
  const add = asset => { if (!full) onPlace(asset, 'layers'); };
  return <div className="media-library">
    <div className="section-heading media-heading"><h2>Media</h2><span>{loading ? 'Loading…' : `${assets.length} files`}</span></div>
    <div className="library-tools">
      <input type="search" aria-label="Search media" placeholder="Search media" value={query} onChange={event => setQuery(event.target.value)}/>
      <IconButton label="Upload to media" disabled={uploading} onClick={() => input.current.click()}><UploadSimple size={16}/></IconButton>
      <input ref={input} type="file" hidden multiple accept={allFiles} onChange={event => { if (event.target.files.length) upload([...event.target.files]); event.target.value = ''; }}/>
    </div>
    <div className="segmented library-filters" role="group" aria-label="Media type">{LIBRARY_FILTERS.map(([id, label]) => <button key={id} type="button" aria-pressed={filter === id} className={filter === id ? 'selected' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div>
    {(uploadError || error) && <p className="helper library-error" role="alert">{uploadError || error}</p>}
    {uploading && <p className="helper" role="status">Uploading…</p>}
    <p className="helper">Drag to the canvas or double-click to add.</p>
    <ul className="library-grid" aria-label="Workspace media">{shown.map(asset => {
      const use = assetUse(asset, layer, project), inUse = used.has(asset.src);
      return <li key={asset.src} className="library-item" draggable title={asset.name}
        onDragStart={event => { event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify({ ...asset, aspect: thumbAspect(event.currentTarget) })); }}
        onDoubleClick={() => add(asset)}>
        <AssetThumb asset={asset} className="library-thumb"/>
        <span className="library-name">{asset.name}</span>
        <span className="library-meta">{inUse && <Check size={11} weight="bold" role="img" aria-label="In this composition"/>}{ASSET_KINDS[assetKind(asset.src)]} · {size(asset.bytes)}</span>
        <div className="library-actions">
          <IconButton label={`Add ${asset.name} as a layer`} disabled={full} onClick={() => add(asset)}><Plus size={14}/></IconButton>
          {use && <IconButton label={use === 'cards' ? `Add ${asset.name} to ${layer.name} cards` : `Use ${asset.name} in ${layer.name}`} onClick={() => onPlace(asset, use === 'cards' ? `cards:${layer.id}` : layer.id)}>{use === 'cards' ? <Images size={14}/> : <ArrowsClockwise size={14}/>}</IconButton>}
        </div>
      </li>;
    })}</ul>
    {!loading && !shown.length && <p className="helper">{assets.length ? 'No media matches.' : 'No media yet. Upload files to reuse them in any composition.'}</p>}
  </div>;
}
