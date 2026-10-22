import React, { useEffect, useState } from 'react';
import { request } from '../request.js';
import { exportFormat } from '../../export-settings.js';

const roleName = role => role === 'admin' ? 'Admin' : 'Editor';
const megabytes = bytes => `${(bytes / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;
const exportLabel = details => [exportFormat(details.format)?.name, details.resolution].filter(Boolean).join(' · ');
const fontLabel = face => `${face.family} ${face.weight}${face.style === 'italic' ? ' italic' : ''}`;

// One readable sentence per audit entry; unknown actions still show who did what.
function describe({ action, actor, details: d }) {
  const who = actor ? actor.email || 'A removed account' : 'Someone';
  const output = d.format ? ` (${exportLabel(d)})` : '';
  switch (action) {
    case 'invitation.created': return actor ? `${who} invited ${d.email} as ${roleName(d.role)}` : `First account invitation created for ${d.email} as ${roleName(d.role)}`;
    case 'invitation.accepted': return `${d.email} joined as ${roleName(d.role)}`;
    case 'user.signed_in': return `${who} signed in`;
    case 'user.role_changed': return `${who} changed ${d.email} from ${roleName(d.from)} to ${roleName(d.to)}`;
    case 'user.removed': return `${who} removed ${d.email} (${roleName(d.role)})`;
    case 'composition.created': return `${who} created “${d.name}”`;
    case 'composition.renamed': return `${who} renamed “${d.from}” to “${d.to}”`;
    case 'composition.deleted': return `${who} deleted “${d.name}”`;
    case 'composition.restored': return `${who} restored version ${d.version} of “${d.name}”`;
    case 'storage.cleanup': return `${who} cleaned up storage and removed ${d.removedFiles} unused ${d.removedFiles === 1 ? 'file' : 'files'} (${megabytes(d.removedBytes)})`;
    case 'storage.deduplicated': return `Duplicate media merged: ${d.mergedFiles} ${d.mergedFiles === 1 ? 'copy' : 'copies'} relinked, ${d.removedFiles} ${d.removedFiles === 1 ? 'file' : 'files'} removed (${megabytes(d.removedBytes)})`;
    case 'export.queued': return `${who} queued an export of “${d.name}”${output}`;
    case 'export.cancelled': return `${who} cancelled the export of “${d.name}”${output}`;
    case 'export.finished': return `Export of “${d.name}”${output} finished${actor ? ` for ${who}` : ''}`;
    case 'export.failed': return `Export of “${d.name}”${output} failed${actor ? ` for ${who}` : ''}${d.message ? `: ${d.message}` : ''}`;
    case 'renderer.paired': return `${who} connected the renderer “${d.name}”`;
    case 'font.uploaded': return `${who} added the font ${fontLabel(d)}`;
    case 'font.renamed': return `${who} changed the font ${fontLabel(d.from)} to ${fontLabel(d.to)}`;
    case 'font.deleted': return `${who} deleted the font ${fontLabel(d)}`;
    default: return `${who} · ${action}`;
  }
}

export function ActivityPanel() {
  const [entries, setEntries] = useState(null);
  const [next, setNext] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load(before) {
    setBusy(true); setError('');
    try {
      const page = await request(`/api/audit?limit=50${before ? `&before=${before}` : ''}`);
      setEntries(current => before ? [...current, ...page.entries] : page.entries); setNext(page.next);
    } catch (failure) { setEntries(current => current || []); setError(failure.message); }
    finally { setBusy(false); }
  }
  useEffect(() => { load(); }, []);
  return <div className="account-panel" role="tabpanel">
    <p className="helper">Sign-ins, team changes, composition, font, storage and export activity. The newest 10,000 events are kept.</p>
    {error && <p role="alert">{error}</p>}
    {!entries ? <p className="helper" role="status">Loading…</p> : entries.length === 0 ? <p className="helper">No activity yet.</p> : <ol className="activity-list">{entries.map(entry => <li key={entry.id}>
      {describe(entry)}<small>{new Date(entry.time).toLocaleString()}</small>
    </li>)}</ol>}
    {next && <button type="button" className="outline-button" disabled={busy} onClick={() => load(next)}>{busy ? 'Loading…' : 'Show older activity'}</button>}
  </div>;
}
