import React, { useEffect, useState } from 'react';
import { BRAND } from '../../brand.js';
import { request } from '../request.js';
import { LoginBackground } from './LoginBackground.jsx';
import '../access.css';

export function AuthGate({ children }) {
  const [invitation, setInvitation] = useState(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('invite');
    if (token) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    return token;
  });
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [expired, setExpired] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    request('/api/auth/session').then(data => { if (alive && !invitation) { setUser(data.user); setEmail(data.user?.email || ''); } }).catch(error => { if (alive) setError(error.message); }).finally(() => { if (alive) setChecking(false); });
    const expire = () => { setExpired(true); setPassword(''); };
    window.addEventListener('floc-session-expired', expire);
    return () => { alive = false; window.removeEventListener('floc-session-expired', expire); };
  }, []);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await request(invitation ? '/api/auth/accept' : '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, ...(invitation ? { token: invitation } : {}) }) });
      setUser(result.user); setEmail(result.user.email); setPassword(''); setInvitation(null); setExpired(false);
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
      <div className="auth-brand" role="img" aria-label="FLOC Motion">
        <img className="auth-brand-lettering" src={BRAND.assets.loginLettering} alt=""/>
        <img className="auth-brand-asterisk" src={BRAND.assets.loginAsterisk} alt=""/>
        <img className="auth-brand-motion" src={BRAND.assets.loginMotion} alt=""/>
      </div>
      <h1>{checking ? 'Loading…' : invitation ? 'Join FLOC Motion' : 'Sign in'}</h1>
      {expired && <p className="helper">Your session expired. Sign in again to continue with your current work.</p>}
      {!checking && <form className="access-form" onSubmit={submit}>
        <label>Email<input autoFocus required type="email" autoComplete="username" maxLength={254} value={email} readOnly={expired && Boolean(user)} onChange={event => setEmail(event.target.value)}/></label>
        <label>Password<input required type="password" autoComplete={invitation ? 'new-password' : 'current-password'} minLength={invitation ? 12 : undefined} maxLength={128} value={password} onChange={event => setPassword(event.target.value)}/></label>
        {invitation && <p className="helper">Use the invited email address and a password with at least 12 characters.</p>}
        {error && <p role="alert">{error}</p>}
        <button type="submit" className="export-button full-width" disabled={busy}>{busy ? 'Please wait…' : invitation ? 'Create account' : 'Sign in'}</button>
      </form>}
      {!checking && !invitation && <p className="helper">Access is by invitation. Ask someone in the studio for an invitation link.</p>}
      {invitation && <button type="button" className="text-button" disabled={busy} onClick={() => { setInvitation(null); setError(''); }}>Already have an account? Sign in</button>}
    </section></main>}
  </>;
}
