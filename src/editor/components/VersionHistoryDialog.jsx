import React, { useEffect, useId, useState } from 'react';
import { ClockCounterClockwise, X } from '@phosphor-icons/react';
import { request } from '../request.js';
import { IconButton, Modal } from '../controls.jsx';
import '../version-history.css';

export function VersionHistoryDialog({ compositionId, onRestore, onClose }) {
  const title = useId();
  const [versions, setVersions] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    request(`/api/templates/${compositionId}/versions`).then(data => { if (alive) setVersions(data.versions); }).catch(failure => { if (alive) { setVersions([]); setError(failure.message); } });
    return () => { alive = false; };
  }, [compositionId]);
  async function restore() {
    setBusy(true); setError('');
    try { await onRestore(confirm.version); onClose(); }
    catch (failure) { setError(failure.message); setBusy(false); }
  }
  const close = () => { if (!busy) onClose(); };
  return <Modal labelledBy={title} onClose={close}><section className="modal version-history">
    <div className="modal-heading"><ClockCounterClockwise size={22}/><IconButton label="Close version history" disabled={busy} onClick={close}><X size={19}/></IconButton></div>
    <h2 id={title}>Version history</h2>
    {confirm ? <div className="version-history-confirm" role="alertdialog" aria-labelledby={`${title}-confirm`}>
      <p id={`${title}-confirm`}>Restore version {confirm.version} “{confirm.name}”? Your current work is saved first and kept in history. Undo returns to it.</p>
      {error && <p role="alert">{error}</p>}
      <button className="export-button" disabled={busy} onClick={restore}>{busy ? 'Restoring…' : 'Restore version'}</button>
      <button type="button" className="outline-button" disabled={busy} onClick={() => { setConfirm(null); setError(''); }}>Cancel</button>
    </div> : <>
      <p className="helper">Saves are grouped into one version per 10 minutes of editing by each person. The newest 100 versions are kept.</p>
      {error && <p role="alert">{error}</p>}
      {!versions ? <p className="helper" role="status">Loading…</p> : <ol className="version-history-list">{versions.map((item, index) => <li key={item.version}>
        <div><strong>{item.name}</strong><span>Version {item.version}{index === 0 ? ' · Current' : ''}</span></div>
        <small>{new Date(item.createdAt).toLocaleString()} · {item.author?.email || 'Imported'}{item.restoredFrom ? ` · Restored from version ${item.restoredFrom}` : ''}</small>
        {index > 0 && <button type="button" className="outline-button" onClick={() => { setConfirm(item); setError(''); }}>Restore</button>}
      </li>)}</ol>}
    </>}
  </section></Modal>;
}
