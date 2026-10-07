import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Trash, UploadSimple, X } from '@phosphor-icons/react';
import { blankProject, demoProject, patchLayer, validateProject } from '../../project.js';
import { IconButton, Modal } from '../controls.jsx';
import { uploadAssets } from '../upload-assets.js';
import { MotionPreview } from './MotionPreview.jsx';
import { PresetBrowser } from './PresetBrowser.jsx';
import '../template-content.css';
import '../carousel-creation.css';

const acceptedFiles = '.png,.jpg,.jpeg,.webp,.gif,.avif,.svg,.mp4,.webm';

function FilePreview({ file }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  if (!src) return null;
  return /\.(mp4|webm)$/i.test(file.name)
    ? <video src={src} muted playsInline preload="metadata" aria-label={file.name}/>
    : <img src={src} alt={file.name}/>;
}

export function CarouselCreationDialog({ project, onCreate, onClose }) {
  const title = useId();
  const [base] = useState(() => validateProject({ ...blankProject(), format: project.format, duration: project.duration, fps: project.fps,
    layers: [{ ...demoProject().layers.find(layer => layer.type === 'carousel'), id: 'carousel-draft', images: [], end: project.duration }] }));
  const [draft, setDraft] = useState(base);
  const [selected, setSelected] = useState(null);
  const [browsing, setBrowsing] = useState(true);
  const [files, setFiles] = useState([]);
  const filesRef = useRef(files);
  filesRef.current = files;
  const fileInput = useRef();
  const uploaded = useRef(new Map());
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function close() { if (!pending.current) onClose(); }
  function select(patch, item) {
    try {
      setDraft(patchLayer(base, base.layers[0].id, patch));
      setSelected(item); setBrowsing(false); setError('');
    } catch (failure) { setError(failure.message); }
  }
  function updateFiles(next) { filesRef.current = next; setFiles(next); setError(''); }
  function chooseFiles(event) {
    const chosen = Array.from(event.target.files);
    event.target.value = '';
    if (!chosen.length || pending.current) return;
    if (filesRef.current.length + chosen.length > 24) { setError('Use up to 24 carousel files.'); return; }
    const unsupported = chosen.find(file => !acceptedFiles.split(',').includes(`.${file.name.split('.').at(-1).toLowerCase()}`));
    if (unsupported) { setError(`Unsupported file: ${unsupported.name}. Choose an image, SVG or video.`); return; }
    const oversized = chosen.find(file => file.size > 75e6);
    if (oversized) { setError(`${oversized.name} exceeds the 75 MB file limit.`); return; }
    updateFiles([...filesRef.current, ...chosen]);
  }
  function reorder(index, direction) {
    if (pending.current) return;
    const next = [...filesRef.current], target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    updateFiles(next);
  }
  async function submit(event) {
    event.preventDefault();
    if (pending.current || !selected || !filesRef.current.length) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const images = [];
      for (const file of filesRef.current) {
        if (!uploaded.current.has(file)) uploaded.current.set(file, (await uploadAssets([file]))[0]);
        const { id, src, name } = uploaded.current.get(file);
        images.push({ id, src, name });
      }
      const next = patchLayer(draft, draft.layers[0].id, { images });
      if (await onCreate(next.layers[0]) === false) throw new Error('Unable to create carousel. Use up to 20 layers.');
      onClose();
    } catch (failure) { setError(failure.message); }
    finally { pending.current = false; setBusy(false); }
  }

  if (browsing) return <PresetBrowser layer={base.layers[0]} onSelect={select} onClose={close} error={error}/>;
  return <Modal labelledBy={title} onClose={close}><form className="template-content-window carousel-creation-window" onSubmit={submit}>
    <header className="template-content-header"><h2 id={title}>Add photos</h2><IconButton label="Cancel carousel creation" disabled={busy} onClick={close}><X size={20}/></IconButton></header>
    <div className="template-content-body">
      <aside className="template-content-preview carousel-choice">
        <div className="preset-art"><MotionPreview key={`${selected.collection}:${selected.id}`} item={selected} collection={selected.collection} playing={false}/></div>
        <strong>{selected.name}</strong>
        <button type="button" className="outline-button" disabled={busy} onClick={() => { if (!pending.current) { setBrowsing(true); setError(''); } }}><ArrowLeft size={16}/>Change carousel</button>
      </aside>
      <section className="template-content-fields carousel-photos" aria-label="Carousel photos">
        <div className="section-heading"><h3>Photos</h3><span>{files.length} / 24</span></div>
        <button type="button" className="outline-button" disabled={busy || files.length >= 24} onClick={() => fileInput.current.click()}><UploadSimple size={16}/>Add photos</button>
        <input ref={fileInput} hidden type="file" accept={acceptedFiles} multiple disabled={busy} onChange={chooseFiles}/>
        <div className="template-content-cards">{files.map((file, index) => <div className="template-content-card" key={index}>
          <FilePreview file={file}/>
          <span className="carousel-file-name" title={file.name}>{file.name}</span>
          <div className="template-content-card-actions"><span>{index + 1}</span><IconButton label={`Move photo ${index + 1} earlier`} disabled={busy || index === 0} onClick={() => reorder(index, -1)}><ArrowLeft size={14}/></IconButton><IconButton label={`Move photo ${index + 1} later`} disabled={busy || index === files.length - 1} onClick={() => reorder(index, 1)}><ArrowRight size={14}/></IconButton><IconButton label={`Remove photo ${index + 1}: ${file.name}`} disabled={busy} onClick={() => { if (!pending.current) updateFiles(filesRef.current.filter((_, i) => i !== index)); }}><Trash size={14}/></IconButton></div>
        </div>)}</div>
      </section>
    </div>
    <footer className="template-content-footer"><div className="template-content-feedback">{error && <p role="alert">{error}</p>}{busy && <p role="status">Creating carousel…</p>}</div><button type="button" className="subtle-button" disabled={busy} onClick={close}>Cancel</button><button type="submit" className="export-button" disabled={busy || !files.length}>{busy ? 'Creating…' : 'Create carousel'}</button></footer>
  </form></Modal>;
}
