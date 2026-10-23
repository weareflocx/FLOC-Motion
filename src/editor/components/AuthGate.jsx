import React, { useEffect, useState } from 'react';
import { request } from '../request.js';
import { CURRENT_PROJECT_VERSION } from '../../project-migrations.js';
import { LoginBackground } from './LoginBackground.jsx';
import { BrandLockup } from './BrandLockup.jsx';
import '../access.css';

function checkProjectVersion(data) {
  if (data.projectVersion !== CURRENT_PROJECT_VERSION) {
    const server = Number.isInteger(data.projectVersion) ? `v${data.projectVersion}` : 'unknown';
    throw new Error(`Editor v${CURRENT_PROJECT_VERSION} and server ${server} use different project versions. Reload this page. For a local editor, restart the server first. Your saved projects have not been changed.`);
  }
}

// Invitation and password reset links carry a single-use token in the URL fragment.
const LINKS = { invite: { route: '/api/auth/accept', title: 'Join FLOC Motion', action: 'Create account', helper: 'Use the invited email address and a password with at least 12 characters.' },
  reset: { route: '/api/auth/reset', title: 'Choose a new password', action: 'Set password', helper: 'Use your account email and a new password with at least 12 characters. This signs you out on every other device.' } };

export function AuthGate({ children }) {
  const [link, setLink] = useState(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const kind = ['invite', 'reset'].find(name => params.get(name));
    if (kind) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    return kind ? { kind, token: params.get(kind) } : null;
  });
  const mode = link && LINKS[link.kind];
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [expired, setExpired] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    request('/api/auth/session').then(data => {
      if (!alive) return;
      checkProjectVersion(data);
      if (!link) { setUser(data.user); setEmail(data.user?.email || ''); }
    }).catch(error => { if (alive) setError(error.message); }).finally(() => { if (alive) setChecking(false); });
    const expire = () => { setExpired(true); setPassword(''); };
    window.addEventListener('floc-session-expired', expire);
    return () => { alive = false; window.removeEventListener('floc-session-expired', expire); };
  }, []);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await request(mode ? mode.route : '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, ...(link ? { token: link.token } : {}) }) });
      checkProjectVersion(result);
      setUser(result.user); setEmail(result.user.email); setPassword(''); setLink(null); setExpired(false);
      window.dispatchEvent(new Event('floc-session-restored'));
    } catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  async function signOut() {
    await request('/api/auth/logout', { method: 'POST' });
    setUser(null); setPassword(''); setExpired(false);
  }
  return <>
    {user && <div hidden={expired} inert={expired || undefined}>{children(user, signOut)}</div>}
    {(!user || expired) && <main className="auth-screen"><LoginBackground/><section className="modal access-card">
      <BrandLockup className="auth-brand"/>
      <h1>{checking ? 'Loading…' : mode ? mode.title : 'Sign in'}</h1>
      {expired && <p className="helper">Your session expired. Sign in again to continue with your current work.</p>}
      {!checking && <form className="access-form" onSubmit={submit}>
        <label>Email<input autoFocus required type="email" autoComplete="username" maxLength={254} value={email} readOnly={expired && Boolean(user)} onChange={event => setEmail(event.target.value)}/></label>
        <label>Password<input required type="password" autoComplete={link ? 'new-password' : 'current-password'} minLength={link ? 12 : undefined} maxLength={128} value={password} onChange={event => setPassword(event.target.value)}/></label>
        {mode && <p className="helper">{mode.helper}</p>}
        {error && <p role="alert">{error}</p>}
        <button type="submit" className="export-button full-width" disabled={busy}>{busy ? 'Please wait…' : mode ? mode.action : 'Sign in'}</button>
      </form>}
      {!checking && !link && <p className="helper">Access is by invitation. Ask someone in the studio for an invitation link. Forgot your password? Ask an admin for a reset link.</p>}
      {link && <button type="button" className="text-button" disabled={busy} onClick={() => { setLink(null); setError(''); }}>{link.kind === 'reset' ? 'Remember your password? Sign in' : 'Already have an account? Sign in'}</button>}
    </section></main>}
  </>;
}
