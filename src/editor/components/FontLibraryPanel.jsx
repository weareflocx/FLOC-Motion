import React, { useRef, useState } from 'react';
import { FONT_STYLES, FONT_WEIGHTS, MAX_FONT_FAMILY_LENGTH, workspaceFontFamily } from '../../fonts.js';
import { request } from '../request.js';
import { setWorkspaceFonts, useWorkspaceFonts } from '../workspace-fonts.js';

const MAX_FONT_BYTES = 10 * 1024 * 1024;
const SAMPLE = 'Weekly Design Recap 0123';
const WEIGHTS = Object.keys(FONT_WEIGHTS).map(Number);
const json = (method, value) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
const faceName = face => `${face.family} ${FONT_WEIGHTS[face.weight]}${face.style === 'italic' ? ' Italic' : ''}`;
const kilobytes = bytes => `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KB`;

// Admins curate the workspace font library; every editor picks these fonts in the text inspector.
export function FontLibraryPanel() {
  const { faces, loaded, error: loadError } = useWorkspaceFonts();
  const fileInput = useRef(null);
  const [family, setFamily] = useState('');
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function act(action) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  const refresh = async () => setWorkspaceFonts((await request('/api/fonts')).fonts);
  const upload = file => act(async () => {
    if (file.size > MAX_FONT_BYTES) throw new Error(`${file.name} exceeds the 10 MB font limit.`);
    const query = new URLSearchParams({ name: file.name });
    if (family.trim()) query.set('family', family.trim());
    const { font } = await request(`/api/fonts?${query}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
    await refresh(); setFamily('');
    setNotice(`Added ${faceName(font)}. Check the family name, weight and style below.`);
  });
  const save = event => { event.preventDefault(); act(async () => {
    await request(`/api/fonts/${editing.id}`, json('PATCH', { family: editing.family, weight: editing.weight, style: editing.style }));
    await refresh(); setEditing(null);
  }); };
  const remove = () => act(async () => {
    await request(`/api/fonts/${removing.id}`, { method: 'DELETE' });
    await refresh(); setRemoving(null);
  });
  if (removing) return <div className="account-panel account-confirm" role="alertdialog" aria-label={`Delete ${faceName(removing)}`}>
    <p>Delete {faceName(removing)}? Editors can no longer choose it. Fonts used by a composition, a saved version or a draft cannot be deleted.</p>
    {error && <p role="alert">{error}</p>}
    <button type="button" className="export-button" disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Delete font'}</button>
    <button type="button" className="outline-button" disabled={busy} onClick={() => { setRemoving(null); setError(''); }}>Cancel</button>
  </div>;
  return <div className="account-panel" role="tabpanel">
    <div className="access-form">
      <label>Family name<input type="text" maxLength={MAX_FONT_FAMILY_LENGTH} placeholder="Read from the font file" value={family} onChange={event => setFamily(event.target.value)}/></label>
      <input ref={fileInput} hidden type="file" accept=".woff2,.woff,.otf,.ttf" onChange={event => { const [file] = event.target.files; event.target.value = ''; if (file) upload(file); }}/>
      <button type="button" className="outline-button" disabled={busy} onClick={() => fileInput.current.click()}>{busy ? 'Please wait…' : 'Upload font'}</button>
    </div>
    <p className="helper">WOFF2, WOFF, OTF or TTF up to 10 MB, one file per weight and style. Only upload fonts your studio is licensed to use in videos.</p>
    {notice && <p className="helper" role="status">{notice}</p>}
    {(error || loadError) && <p role="alert">{error || loadError}</p>}
    {!loaded ? <p className="helper" role="status">Loading…</p> : faces.length === 0 ? <p className="helper">No workspace fonts yet. Text layers use the studio fonts.</p> : <ul className="team-list font-list">{faces.map(face => <li key={face.id}>
      {editing?.id === face.id ? <form className="font-edit" onSubmit={save}>
        <input aria-label="Family name" required maxLength={MAX_FONT_FAMILY_LENGTH} value={editing.family} onChange={event => setEditing({ ...editing, family: event.target.value })}/>
        <select aria-label="Weight" value={editing.weight} onChange={event => setEditing({ ...editing, weight: Number(event.target.value) })}>{WEIGHTS.map(weight => <option key={weight} value={weight}>{weight} {FONT_WEIGHTS[weight]}</option>)}</select>
        <select aria-label="Style" value={editing.style} onChange={event => setEditing({ ...editing, style: event.target.value })}>{FONT_STYLES.map(style => <option key={style} value={style}>{style === 'italic' ? 'Italic' : 'Normal'}</option>)}</select>
        <button type="submit" className="outline-button" disabled={busy}>Save</button>
        <button type="button" className="text-button" disabled={busy} onClick={() => { setEditing(null); setError(''); }}>Cancel</button>
      </form> : <>
        <div>
          <span className="font-sample" style={{ fontFamily: `${workspaceFontFamily(face.id)},Geist`, fontWeight: face.weight }}>{SAMPLE}</span>
          <strong>{faceName(face)}</strong>
          <small>{face.fileName} · {kilobytes(face.size)}</small>
        </div>
        <button type="button" className="text-button" disabled={busy} onClick={() => { setEditing({ id: face.id, family: face.family, weight: face.weight, style: face.style }); setError(''); }}>Rename</button>
        <button type="button" className="text-button" disabled={busy} onClick={() => { setRemoving(face); setError(''); }}>Delete</button>
      </>}
    </li>)}</ul>}
  </div>;
}
