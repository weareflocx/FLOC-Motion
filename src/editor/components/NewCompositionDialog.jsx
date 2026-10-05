import React, { useId, useState } from 'react';
import { Modal } from '../controls.jsx';

export function NewCompositionDialog({ onCreate, onClose }) {
  const title = useId();
  const [name, setName] = useState('Untitled');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true); setError('');
    try { await onCreate(name); onClose(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <Modal labelledBy={title} onClose={() => { if (!busy) onClose(); }}><section className="modal">
    <h2 id={title}>New composition</h2>
    <p>Start with an empty canvas. Your current work will be saved in Compositions.</p>
    <form className="saved-template-form" onSubmit={submit}>
      <label>Name<input autoFocus required maxLength={100} value={name} disabled={busy} onChange={event => setName(event.target.value)}/></label>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create composition'}</button>
      <button type="button" className="outline-button" disabled={busy} onClick={onClose}>Cancel</button>
    </form>
  </section></Modal>;
}
