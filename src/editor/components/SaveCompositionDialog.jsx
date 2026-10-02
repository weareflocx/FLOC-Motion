import React, { useId, useState } from 'react';
import { Modal } from '../controls.jsx';

export function SaveCompositionDialog({ name: initialName, onSave, onClose }) {
  const title = useId();
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try { await onSave(name); onClose(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <Modal labelledBy={title} onClose={() => { if (!busy) onClose(); }}><section className="modal"><h2 id={title}>Save composition</h2><p>Save to your compositions. Further edits will save automatically to this composition.</p><form className="saved-template-form" onSubmit={submit}><label>Name<input autoFocus required maxLength={100} value={name} disabled={busy} onChange={event => setName(event.target.value)}/></label>{error && <p role="alert">{error}</p>}<button disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save composition'}</button><button type="button" className="outline-button" disabled={busy} onClick={onClose}>Cancel</button></form></section></Modal>;
}
