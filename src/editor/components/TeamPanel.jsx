import React, { useEffect, useState } from 'react';
import { request } from '../request.js';

const ROLE_OPTIONS = [['editor', 'Editor'], ['admin', 'Admin']];
const json = (method, value) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
const when = value => value ? new Date(value).toLocaleDateString() : 'unknown';

export function TeamPanel({ user, onRoleChange }) {
  const [users, setUsers] = useState(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [invitation, setInvitation] = useState(null);
  const [reset, setReset] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    request('/api/users').then(data => { if (alive) setUsers(data.users); }).catch(failure => { if (alive) { setUsers([]); setError(failure.message); } });
    return () => { alive = false; };
  }, []);
  async function act(action) {
    setBusy(true); setError('');
    try { await action(); } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  const invite = event => { event.preventDefault(); setInvitation(null); setReset(null); act(async () => { setInvitation(await request('/api/auth/invitations', json('POST', { email, role }))); setEmail(''); }); };
  const createReset = member => { setInvitation(null); setReset(null); act(async () => setReset(await request(`/api/users/${member.id}/password-reset`, { method: 'POST' }))); };
  const changeRole = (member, next) => act(async () => {
    const { user: updated } = await request(`/api/users/${member.id}`, json('PATCH', { role: next }));
    setUsers(current => current.map(item => item.id === updated.id ? { ...item, role: updated.role } : item));
    if (updated.id === user.id) onRoleChange(updated.role);
  });
  const remove = () => act(async () => {
    await request(`/api/users/${removing.id}`, { method: 'DELETE' });
    setUsers(current => current.filter(item => item.id !== removing.id)); setRemoving(null);
  });
  if (removing) return <div className="account-panel account-confirm" role="alertdialog" aria-label={`Remove ${removing.email}`}>
    <p>Remove {removing.email}? They are signed out everywhere and can no longer sign in. Compositions they created stay in the shared library.</p>
    {error && <p role="alert">{error}</p>}
    <button type="button" className="export-button" disabled={busy} onClick={remove}>{busy ? 'Removing…' : 'Remove account'}</button>
    <button type="button" className="outline-button" disabled={busy} onClick={() => { setRemoving(null); setError(''); }}>Cancel</button>
  </div>;
  return <div className="account-panel" role="tabpanel">
    <form className="access-form" onSubmit={invite}>
      <div className="invite-fields">
        <label>Invite by email<input required type="email" autoComplete="off" maxLength={254} value={email} onChange={event => setEmail(event.target.value)}/></label>
        <label>Role<select value={role} onChange={event => setRole(event.target.value)}>{ROLE_OPTIONS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      </div>
      <button type="submit" className="outline-button" disabled={busy}>{busy ? 'Please wait…' : 'Create invitation'}</button>
    </form>
    {invitation && <div className="access-form"><label>Invitation link<textarea readOnly rows={3} value={invitation.url} onFocus={event => event.target.select()}/></label><p className="helper">Share this link with {invitation.email}. They join as {invitation.role === 'admin' ? 'an Admin' : 'an Editor'}. It expires in 48 hours and can be used once.</p></div>}
    {reset && <div className="access-form"><label>Password reset link<textarea readOnly rows={3} value={reset.url} onFocus={event => event.target.select()}/></label><p className="helper">Share this link privately with {reset.email}. It expires in 24 hours and can be used once; their current password keeps working until then. Setting a new password signs them out everywhere.</p></div>}
    <p className="helper">Admins manage the team, storage cleanup and activity. Editors can edit, save, upload and export. A workspace always keeps at least one admin.</p>
    {error && <p role="alert">{error}</p>}
    {!users ? <p className="helper" role="status">Loading…</p> : <ul className="team-list team-members">{users.map(member => <li key={member.id}>
      <div><strong>{member.email}{member.id === user.id ? ' · You' : ''}</strong><small>Joined {when(member.createdAt)} · Last seen {when(member.lastSeen)}</small></div>
      <select aria-label={`Role for ${member.email}`} value={member.role} disabled={busy} onChange={event => changeRole(member, event.target.value)}>{ROLE_OPTIONS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      <div className="team-actions">
        <button type="button" className="text-button" disabled={busy} aria-label={`Reset password for ${member.email}`} onClick={() => createReset(member)}>Reset password</button>
        {member.id !== user.id && <button type="button" className="text-button" disabled={busy} onClick={() => { setRemoving(member); setError(''); }}>Remove</button>}
      </div>
    </li>)}</ul>}
  </div>;
}
