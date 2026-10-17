import React, { useEffect, useId, useRef, useState } from 'react';
import { SquaresFour, UploadSimple, X } from '@phosphor-icons/react';
import { carouselImages } from '../../project.js';
import { isVisualAsset, matchesLibrary, replaceCardImages } from '../media-library.js';
import { useMediaLibrary } from '../useMediaLibrary.js';
import { uploadAssets } from '../upload-assets.js';
import { IconButton, Modal } from '../controls.jsx';
import { AssetThumb } from './AssetThumb.jsx';

const acceptedFiles = '.png,.jpg,.jpeg,.webp,.gif,.avif,.svg,.mp4,.webm';

function CardMediaChoices({ cardNumber, disabled, onChoose }) {
  const { assets, loading, error } = useMediaLibrary();
  const [query, setQuery] = useState('');
  const shown = assets.filter(isVisualAsset).filter(asset => matchesLibrary(asset, 'all', query));
  return <div className="card-media-choices">
    <div className="library-tools"><input autoFocus type="search" aria-label="Search replacement media" placeholder="Search images, GIFs and videos" value={query} onChange={event => setQuery(event.target.value)}/></div>
    {loading && <p className="helper" role="status">Loading media…</p>}
    {error && <p className="helper library-error" role="alert">{error}</p>}
    <ul className="library-grid card-media-grid" aria-label="Replacement media">{shown.map(asset => <li key={asset.src}>
      <button type="button" className="card-media-option" aria-label={`Use ${asset.name} for card ${cardNumber}`} disabled={disabled} onClick={() => onChoose(asset)}>
        <AssetThumb asset={asset} className="library-thumb"/>
        <span className="library-name" title={asset.name}>{asset.name}</span>
      </button>
    </li>)}</ul>
    {!loading && !error && !shown.length && <p className="helper">{query ? 'No matching media.' : 'No images, GIFs or videos in Media. Use Upload file to add one.'}</p>}
  </div>;
}

// A native modal keeps this replacement local to one stable card ID. Only the
// completed selection commits; an upload never overwrites intervening edits.
export function ReplaceCardDialog({ project, projectRef, layerId, cardId, onPatch, onClose }) {
  const title = useId();
  const input = useRef(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const [browsing, setBrowsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const layer = project.layers.find(item => item.id === layerId && item.type === 'carousel');
  const images = layer ? carouselImages(project, layer) : [];
  const index = images.findIndex(image => image.id === cardId), card = images[index];
  const unavailable = !layer ? 'This carousel no longer exists.' : layer.locked ? 'Unlock the carousel before replacing a card.' : !card ? 'This card no longer exists.' : '';
  const disabled = busy || Boolean(unavailable);
  const close = () => { if (!pending.current) onClose(); };
  function apply(asset, expectedProject = projectRef.current) {
    const current = projectRef.current;
    if (current !== expectedProject) throw new Error('The composition changed during upload. Please try again.');
    const images = replaceCardImages(current, layerId, cardId, asset);
    if (!onPatch(layerId, { images })) throw new Error('Unable to replace this card.');
    onClose();
  }
  function choose(asset) {
    if (pending.current || unavailable) return;
    setError('');
    try { apply(asset); } catch (failure) { setError(failure.message); }
  }
  async function upload(event) {
    const files = [...event.target.files];
    event.target.value = '';
    if (!files.length || pending.current || unavailable) return;
    if (files.length !== 1) { setError('Choose one file to replace this card.'); return; }
    if (!acceptedFiles.split(',').includes(`.${files[0].name.split('.').at(-1).toLowerCase()}`)) { setError('Choose an image, GIF or video.'); return; }
    const snapshot = projectRef.current;
    pending.current = true; setBusy(true); setError('');
    try {
      const assets = await uploadAssets(files, { maxFiles: 1 });
      if (mounted.current) apply(assets[0], snapshot);
    } catch (failure) { if (mounted.current) setError(failure.message); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  return <Modal labelledBy={title} onClose={close}><section className="modal replace-card-modal" aria-busy={busy}>
    <div className="modal-heading"><h2 id={title}>Replace card{index >= 0 ? ` ${index + 1}` : ''}</h2><IconButton label="Close replace card dialog" disabled={busy} onClick={close}><X size={19}/></IconButton></div>
    {card && <p className="helper replacement-card-name">{layer.name} · {card.name}</p>}
    {unavailable && <p className="helper library-error" role="alert">{unavailable}</p>}
    <div className="add-layer-options add-layer-replace">
      <button type="button" className="add-layer-option" disabled={disabled} onClick={() => input.current.click()}><UploadSimple size={24} weight="light" aria-hidden="true"/><span><strong>Upload file</strong><small>Image, SVG, GIF, MP4 or WebM</small></span></button>
      <button type="button" className="add-layer-option" disabled={disabled} aria-expanded={browsing} onClick={() => { setError(''); setBrowsing(true); }}><SquaresFour size={24} weight="light" aria-hidden="true"/><span><strong>From Media</strong><small>Reuse an existing image, GIF or video</small></span></button>
    </div>
    {browsing && <CardMediaChoices cardNumber={index + 1} disabled={disabled} onChoose={choose}/>}
    <input ref={input} hidden type="file" accept={acceptedFiles} disabled={disabled} onChange={upload}/>
    {busy && <p className="helper" role="status">Uploading replacement…</p>}
    {error && <p className="helper library-error" role="alert">{error}</p>}
  </section></Modal>;
}
