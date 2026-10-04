import React, { useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Trash, UploadSimple, X } from '@phosphor-icons/react';
import { carouselImages, patchTemplateContent, validateProject } from '../../project.js';
import { contentFields } from '../../template-content.js';
import { IconButton, Modal } from '../controls.jsx';
import { uploadAssets } from '../upload-assets.js';
import { TemplatePreview } from './SavedTemplates.jsx';
import '../template-content.css';

const video = src => /\.(mp4|webm)$/i.test(src);
const acceptedFiles = {
  carousel: 'image/*,video/mp4,video/webm',
  logo: 'image/*',
  media: 'image/*,video/mp4,video/webm',
  music: '.mp3,.wav,.m4a,.ogg,audio/*'
};

function AssetPreview({ layer }) {
  if (!layer.src) return null;
  if (layer.type === 'music') return <audio className="template-content-audio" aria-label={`${layer.contentField} audio preview`} src={layer.src} controls preload="metadata"/>;
  if (video(layer.src)) return <video className="template-content-media" aria-label={`${layer.contentField} video preview`} src={layer.src} controls playsInline preload="metadata"/>;
  return <img className="template-content-media" src={layer.src} alt={layer.contentField}/>;
}

export function TemplateContentDialog({ project, copy = false, name: initialName = project.name, onClose, onSubmit }) {
  const title = useId();
  const [draft, setDraft] = useState(() => validateProject(project));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const pending = useRef(false);
  const fileInput = useRef();
  const fileTarget = useRef('');
  const fields = contentFields(draft);

  function close() { if (!pending.current) onClose(); }
  function update(id, value) {
    if (pending.current) return;
    try {
      const next = patchTemplateContent(draftRef.current, id, value);
      draftRef.current = next;
      setDraft(next);
      setError('');
    } catch (failure) { setError(failure.message); }
  }
  function pick(layer) {
    if (pending.current) return;
    fileTarget.current = layer.id;
    fileInput.current.accept = acceptedFiles[layer.type];
    fileInput.current.multiple = layer.type === 'carousel';
    fileInput.current.click();
  }
  async function upload(event) {
    const files = [...event.target.files];
    event.target.value = '';
    if (!files.length || pending.current) return;
    const id = fileTarget.current;
    pending.current = true;
    setBusy('upload');
    setError('');
    try {
      const layer = contentFields(draftRef.current).find(item => item.id === id);
      if (!layer) throw new Error('Content field no longer exists.');
      if (layer.type === 'carousel' && files.length > 24) throw new Error('Use up to 24 carousel assets.');
      if (layer.type !== 'carousel' && files.length !== 1) throw new Error('Choose one file.');
      const assets = await uploadAssets(files);
      const value = layer.type === 'carousel' ? assets.map(({ id: assetId, src, name: assetName }) => ({ id: assetId, src, name: assetName })) : assets[0].src;
      const next = patchTemplateContent(draftRef.current, id, value);
      draftRef.current = next;
      setDraft(next);
    } catch (failure) { setError(failure.message); }
    finally { pending.current = false; setBusy(''); }
  }
  function reorder(layer, index, direction) {
    const images = [...carouselImages(draftRef.current, layer)];
    const target = index + direction;
    if (target < 0 || target >= images.length) return;
    [images[index], images[target]] = [images[target], images[index]];
    update(layer.id, images);
  }
  async function submit(event) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy('submit');
    setError('');
    try {
      const compositionName = name.trim();
      if (copy && !compositionName) throw new Error('Composition name is required.');
      const next = validateProject(draftRef.current);
      if (await onSubmit(next, compositionName) === false) throw new Error('Unable to apply content.');
      onClose();
    } catch (failure) { setError(failure.message); }
    finally { pending.current = false; setBusy(''); }
  }

  return <Modal labelledBy={title} onClose={close}><form className="template-content-window" onSubmit={submit}>
    <header className="template-content-header"><h2 id={title}>{copy ? 'Use as template' : 'Content'}</h2><IconButton label="Close content" disabled={Boolean(busy)} onClick={close}><X size={20}/></IconButton></header>
    <div className="template-content-body">
      <aside className="template-content-preview" aria-label="Composition preview"><TemplatePreview project={draft}/></aside>
      <div className="template-content-fields">
        <fieldset disabled={Boolean(busy)}>
          {copy && <label className="template-content-field">Composition name<input autoFocus required maxLength={100} value={name} onChange={event => setName(event.target.value)}/></label>}
          {fields.map((layer, fieldIndex) => <section className="template-content-field" key={layer.id}>
            {layer.type === 'text' ? <label>{layer.contentField}<textarea autoFocus={!copy && fieldIndex === 0} maxLength={500} rows={4} value={layer.text} onChange={event => update(layer.id, event.target.value)}/></label> : <>
              <h3>{layer.contentField}</h3>
              {layer.type === 'carousel' ? <div className="template-content-cards">{carouselImages(draft, layer).map((image, index) => <div className="template-content-card" key={`${image.id}-${index}`}>
                {video(image.src) ? <video src={image.src} muted playsInline preload="metadata" aria-label={image.name}/> : <img src={image.src} alt={image.name}/>}
                <div className="template-content-card-actions"><span>{index + 1}</span><IconButton label={`Move card ${index + 1} earlier`} disabled={index === 0 || Boolean(busy)} onClick={() => reorder(layer, index, -1)}><ArrowLeft size={14}/></IconButton><IconButton label={`Move card ${index + 1} later`} disabled={index === carouselImages(draft, layer).length - 1 || Boolean(busy)} onClick={() => reorder(layer, index, 1)}><ArrowRight size={14}/></IconButton><IconButton label={`Remove card ${index + 1}`} disabled={Boolean(busy)} onClick={() => update(layer.id, carouselImages(draft, layer).filter((_, item) => item !== index))}><Trash size={14}/></IconButton></div>
              </div>)}</div> : <AssetPreview layer={layer}/>}
              <div className="template-content-asset-actions"><button type="button" className="outline-button" onClick={() => pick(layer)}><UploadSimple size={16}/>{layer.type === 'carousel' ? carouselImages(draft, layer).length ? 'Replace cards' : 'Upload cards' : layer.src ? 'Replace file' : 'Upload file'}</button>{['logo', 'music'].includes(layer.type) && layer.src && <IconButton label={`Remove ${layer.contentField}`} onClick={() => update(layer.id, '')}><Trash size={16}/></IconButton>}</div>
            </>}
          </section>)}
        </fieldset>
        {!fields.length && <p className="template-content-empty">No content fields.</p>}
      </div>
    </div>
    <input hidden ref={fileInput} type="file" onChange={upload}/>
    <footer className="template-content-footer"><div className="template-content-feedback">{error && <p role="alert">{error}</p>}{busy === 'upload' && <p role="status">Uploading…</p>}</div><button type="button" className="subtle-button" disabled={Boolean(busy)} onClick={close}>Cancel</button><button type="submit" className="export-button" disabled={Boolean(busy)}>{busy === 'submit' ? copy ? 'Creating…' : 'Applying…' : copy ? 'Create composition' : 'Apply content'}</button></footer>
  </form></Modal>;
}
