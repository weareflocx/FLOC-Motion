import React, { useEffect, useId, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { Modal, IconButton } from '../controls.jsx';
import { request } from '../request.js';
import { TeamPanel } from './TeamPanel.jsx';
import { ActivityPanel } from './ActivityPanel.jsx';
import { FontLibraryPanel } from './FontLibraryPanel.jsx';

const TABS = [['account', 'Account'], ['team', 'Team'], ['fonts', 'Fonts'], ['activity', 'Activity']];

// Team, Fonts and Activity are admin-only; the server enforces this independently of what is shown.
export function AccountDialog({ user, onClose, onSignOut }) {
  const title = useId();
  const [role, setRole] = useState(user.role);
  const [tab, setTab] = useState('account');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The role may have changed since sign-in; the session is the current answer.
  useEffect(() => {
    let alive = true;
    request('/api/auth/session').then(data => { if (alive && data.user) setRole(data.user.role); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const admin = role === 'admin';
  const changeOwnRole = next => { setRole(next); if (next !== 'admin') setTab('account'); };
  return <Modal labelledBy={title} onClose={onClose}><section className={`modal access-card${admin ? ' account-dialog' : ''}`}>
    <div className="modal-heading"><h2 id={title}>Account</h2><IconButton label="Close account dialog" onClick={onClose}><X size={19}/></IconButton></div>
    {admin && <div className="tabs account-tabs" role="tablist" aria-label="Account sections">{TABS.map(([id, name]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'selected' : ''} onClick={() => setTab(id)}>{name}</button>)}</div>}
    {tab === 'team' && admin ? <TeamPanel user={user} onRoleChange={changeOwnRole}/> : tab === 'fonts' && admin ? <FontLibraryPanel/> : tab === 'activity' && admin ? <ActivityPanel/> : <div className="account-panel" role={admin ? 'tabpanel' : undefined}>
      <p>{user.email}</p>
      <p className="account-role">{admin ? 'Admin' : 'Editor'}</p>
      <p className="helper">Everyone in the studio can open and edit all shared compositions.{admin ? '' : ' Admins invite people and manage the team.'}</p>
      {error && <p role="alert">{error}</p>}
      <button type="button" className="text-button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await onSignOut(); } catch (error) { setError(error.message); } finally { setBusy(false); } }}>Save and sign out</button>
    </div>}
  </section></Modal>;
}
