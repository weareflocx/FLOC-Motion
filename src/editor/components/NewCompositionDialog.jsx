import React, { useId, useRef, useState } from 'react';
import { UploadSimple, X } from '@phosphor-icons/react';
import { FORMATS, FORMAT_LABELS } from '../../project.js';
import { IconButton, Modal } from '../controls.jsx';
import { uploadAssets } from '../upload-assets.js';
import { SavedTemplates } from './SavedTemplates.jsx';

const acceptedFiles = '.png,.jpg,.jpeg,.webp,.gif,.avif,.svg,.mp4,.webm,.mp3,.wav,.m4a,.ogg,.glb';

export function NewCompositionDialog({ project, onCreate, onOpen, onClose }) {
  const title = useId();
  const [tab, setTab] = useState('aspect');
  const [selected, setSelected] = useState(null);
  const [name, setName] = useState('Untitled');
  const [format, setFormat] = useState('square');
  const [files, setFiles] = useState([]);
  const fileInput = useRef();
  const uploaded = useRef(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  function close() { if (!busy) onClose(); }
  function switchTab(value) { if (!busy) { setTab(value); setError(''); } }
  function chooseFiles(event) {
    const selected = Array.from(event.target.files);
    event.target.value = '';
    if (!selected.length || busy) return;
    const next = [...files, ...selected];
    if (next.length > 20) { setError('Use up to 20 files. Each file becomes a layer.'); return; }
    const unsupported = selected.find(file => !acceptedFiles.split(',').includes(`.${file.name.split('.').at(-1).toLowerCase()}`));
    if (unsupported) { setError(`Unsupported file: ${unsupported.name}. Choose an image, video, audio or GLB file.`); return; }
    const oversized = selected.find(file => file.size > 75e6);
    if (oversized) { setError(`${oversized.name} exceeds the 75 MB file limit.`); return; }
    uploaded.current = null;
    setFiles(next); setError('');
  }
  function removeFile(index) {
    if (busy) return;
    uploaded.current = null;
    setFiles(files.filter((_, i) => i !== index)); setError('');
  }
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (tab === 'compositions') {
      if (!selected) return;
      setBusy('open'); setError('');
      try {
        if (await onOpen(selected) === false) throw new Error('Unable to open composition.');
        onClose();
      } catch (failure) { setError(failure.message); }
      finally { setBusy(''); }
      return;
    }
    if (!name.trim()) return;
    setBusy(files.length && !uploaded.current ? 'upload' : 'create'); setError('');
    try {
      if (!uploaded.current) uploaded.current = await uploadAssets(files);
      setBusy('create');
      await onCreate(name, { format, assets: uploaded.current });
      onClose();
    }
    catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  }
  return <Modal labelledBy={title} onClose={close}><section className="modal new-composition-modal">
    <div className="new-composition-heading">
      <h2 id={title}>New composition</h2>
      <IconButton label="Close new composition" disabled={Boolean(busy)} onClick={close}><X size={19}/></IconButton>
    </div>
    <div className="new-composition-tabs" role="radiogroup" aria-label="New composition tabs">{[['aspect', 'Aspect'], ['compositions', 'Compositions']].map(([id, label]) => <label key={id}>
      <input type="radio" name={`${title}-tab`} value={id} checked={tab === id} disabled={Boolean(busy)} aria-controls={`${title}-${id}`} onChange={() => switchTab(id)}/><span>{label}</span>
    </label>)}</div>
    <form className="new-composition-form" onSubmit={submit}>
      <div id={`${title}-aspect`} className="saved-template-form new-composition-aspect" hidden={tab !== 'aspect'}>
      <label>Name<input autoFocus required={tab === 'aspect'} maxLength={100} value={name} disabled={Boolean(busy)} onChange={event => setName(event.target.value)}/></label>
      <fieldset className="new-composition-formats" disabled={Boolean(busy)}>
        <legend>Aspect ratio</legend>
        <div className="new-composition-ratios">{Object.entries(FORMATS).map(([id, [width, height]]) => <label className="new-composition-ratio" key={id}>
          <input type="radio" name={`${title}-format`} value={id} checked={format === id} onChange={() => setFormat(id)}/>
          <span className="new-composition-ratio-card"><span className="new-composition-ratio-preview" aria-hidden="true"><span style={{ width: 48 * width / Math.max(width, height), height: 48 * height / Math.max(width, height) }}/></span><strong>{FORMAT_LABELS[id]}</strong></span>
        </label>)}</div>
        <p className="helper new-composition-dimensions">{FORMATS[format].join(' × ')} px</p>
      </fieldset>
      <section className="new-composition-files" aria-labelledby={`${title}-files`}>
        <div className="new-composition-files-heading"><h3 id={`${title}-files`}>Files <span>Optional</span></h3><span>{files.length} / 20</span></div>
        <button type="button" className="outline-button" disabled={Boolean(busy) || files.length >= 20} onClick={() => fileInput.current.click()}><UploadSimple size={17}/>Add files</button>
        <input ref={fileInput} hidden type="file" accept={acceptedFiles} multiple disabled={Boolean(busy)} onChange={chooseFiles}/>
        <p className="helper">Images, SVG, GIF, video, audio or GLB · Each file becomes a layer.</p>
        {files.length > 0 && <ul className="new-composition-file-list">{files.map((file, index) => <li key={index}><span title={file.name}>{file.name}</span><IconButton label={`Remove file ${index + 1}: ${file.name}`} disabled={Boolean(busy)} onClick={() => removeFile(index)}><X size={15}/></IconButton></li>)}</ul>}
      </section>
      </div>
      <div id={`${title}-compositions`} hidden={tab !== 'compositions'}>
        {tab === 'compositions' && <SavedTemplates project={project} picker disabled={Boolean(busy)} selectedId={selected?.id} onSelect={entry => { setSelected(entry); setError(''); }}/>}
      </div>
      {error && <p role="alert">{error}</p>}
      {busy === 'upload' && <p className="helper" role="status">Uploading files…</p>}
      <p className="helper">Your current work will be saved in Compositions.</p>
      <div className="new-composition-actions"><button type="button" className="subtle-button" disabled={Boolean(busy)} onClick={close}>Cancel</button><button type="submit" className="export-button" disabled={Boolean(busy) || (tab === 'aspect' ? !name.trim() : !selected)}>{busy ? busy === 'upload' ? 'Uploading…' : busy === 'open' ? 'Opening…' : 'Creating…' : tab === 'aspect' ? 'Create composition' : 'Open composition'}</button></div>
    </form>
  </section></Modal>;
}
