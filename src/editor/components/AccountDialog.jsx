import React, { useId, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { Modal, IconButton } from '../controls.jsx';
import { request } from '../request.js';

export function AccountDialog({ user, onClose, onSignOut }) {
  const title = useId();
  const [email, setEmail] = useState('');
  const [invitation, setInvitation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function invite(event) {
    event.preventDefault(); setBusy(true); setError(''); setInvitation(null);
    try { setInvitation(await request('/api/auth/invitations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  return <Modal labelledBy={title} onClose={onClose}><section className="modal access-card">
    <div className="modal-heading"><h2 id={title}>Account</h2><IconButton label="Close account dialog" onClick={onClose}><X size={19}/></IconButton></div>
    <p>{user.email}</p>
    <p className="helper">Everyone in the studio can open and edit all shared compositions.</p>
    <form className="access-form" onSubmit={invite}>
      <label>Invite by email<input required type="email" autoComplete="off" maxLength={254} value={email} onChange={event => setEmail(event.target.value)}/></label>
      <button type="submit" className="outline-button" disabled={busy}>{busy ? 'Please wait…' : 'Create invitation'}</button>
    </form>
    {invitation && <div className="access-form"><label>Invitation link<textarea readOnly rows={3} value={invitation.url} onFocus={event => event.target.select()}/></label><p className="helper">Share this link with {invitation.email}. It expires in 48 hours and can be used once.</p></div>}
    {error && <p role="alert">{error}</p>}
    <button type="button" className="text-button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await onSignOut(); } catch (error) { setError(error.message); } finally { setBusy(false); } }}>Save and sign out</button>
  </section></Modal>;
}
