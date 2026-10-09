import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import path from 'node:path';
import { readJson, writeJsonAtomic } from './json-store.mjs';

const derive = promisify(scrypt);
const digest = value => createHash('sha256').update(value).digest('hex');
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const publicUser = ({ id, email }) => ({ id, email });
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;
export function sessionCookie(token, secure, clear = false) {
  return `floc_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : sessionLifetime / 1000}${secure ? '; Secure' : ''}`;
}
function emailAddress(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw failure('Enter a valid email address.');
  return value.trim().toLowerCase();
}
function passwordValue(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) throw failure('Use a password with 12–128 characters.');
  return value;
}
async function passwordHash(password, salt) {
  return (await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex');
}

export function createAuthStore(data, { now = Date.now } = {}) {
  const directory = path.join(data, 'access'), filename = path.join(directory, 'auth.json');
  let queue = Promise.resolve();
  const attempts = new Map();
  const serial = action => { const pending = queue.catch(() => {}).then(action); queue = pending; return pending; };
  async function read() { return readJson(filename, { missing: { users: [], invitations: [], sessions: [] } }); }
  async function write(state) {
    state.invitations = state.invitations.filter(item => item.expiresAt > now());
    state.sessions = state.sessions.filter(item => item.expiresAt > now());
    await writeJsonAtomic(filename, state, { mode: 0o600, directoryMode: 0o700 });
  }
  function throttle(key) {
    for (const [id, attempt] of attempts) if (attempt.until <= now()) attempts.delete(id);
    const attempt = attempts.get(key) || { count: 0, until: now() + 15 * 60 * 1000 };
    if (attempt.count >= 10 || (!attempts.has(key) && attempts.size >= 1000)) throw failure('Too many attempts. Try again in 15 minutes.', 429);
    attempt.count++; attempts.set(key, attempt);
  }
  function addSession(state, user) {
    const token = randomBytes(32).toString('hex');
    const active = state.sessions.filter(item => item.userId === user.id && item.expiresAt > now()).slice(-19);
    state.sessions = state.sessions.filter(item => item.userId !== user.id).concat(active);
    state.sessions.push({ hash: digest(token), userId: user.id, expiresAt: now() + sessionLifetime });
    return { user: publicUser(user), token };
  }
  async function invite(state, input) {
    const email = emailAddress(input);
    if (state.users.some(user => user.email === email)) throw failure('This account already exists.', 409);
    if (state.invitations.filter(item => item.expiresAt > now()).length >= 100) throw failure('Too many pending invitations.', 429);
    const token = randomBytes(32).toString('hex'), expiresAt = now() + 48 * 60 * 60 * 1000;
    state.invitations = state.invitations.filter(item => item.email !== email);
    state.invitations.push({ email, hash: digest(token), expiresAt });
    await write(state);
    return { email, token, expiresAt };
  }
  const tokenFromCookie = (cookie = '') => cookie.split(';').map(part => part.trim()).find(part => part.startsWith('floc_session='))?.slice('floc_session='.length);
  return {
    bootstrap: email => serial(async () => {
      const state = await read();
      if (state.users.length || state.invitations.some(item => item.expiresAt > now())) throw failure('Access is already configured. Create invitations from Account in the editor.', 409);
      return invite(state, email);
    }),
    invite: email => serial(async () => invite(await read(), email)),
    user: cookie => serial(async () => {
      const token = tokenFromCookie(cookie);
      if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
      const state = await read();
      const session = state.sessions.find(item => item.hash === digest(token) && item.expiresAt > now());
      const user = session && state.users.find(item => item.id === session.userId);
      return user ? publicUser(user) : null;
    }),
    accept: (input, address) => serial(async () => {
      throttle(`accept:${address}`);
      const email = emailAddress(input.email), password = passwordValue(input.password);
      const state = await read();
      const invitation = typeof input.token === 'string' && /^[a-f0-9]{64}$/.test(input.token) && state.invitations.find(item => item.hash === digest(input.token) && item.email === email && item.expiresAt > now());
      if (!invitation || state.users.some(user => user.email === email)) throw failure('This invitation is invalid or expired.', 400);
      const salt = randomBytes(32).toString('hex');
      const user = { id: randomUUID(), email, salt, passwordHash: await passwordHash(password, salt) };
      state.users.push(user);
      state.invitations = state.invitations.filter(item => item !== invitation);
      const result = addSession(state, user);
      await write(state);
      attempts.delete(`accept:${address}`);
      return result;
    }),
    login: (input, address) => serial(async () => {
      throttle(`login:${address}`);
      let email;
      try { email = emailAddress(input.email); } catch { throw failure('Email or password is incorrect.', 401); }
      if (typeof input.password !== 'string' || input.password.length > 128) throw failure('Email or password is incorrect.', 401);
      const state = await read(), user = state.users.find(item => item.email === email);
      // Unknown accounts use the same work factor and response as existing accounts.
      const hash = await passwordHash(input.password, user?.salt || 'floc-unknown-account');
      if (!user || !timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.passwordHash, 'hex'))) throw failure('Email or password is incorrect.', 401);
      const result = addSession(state, user);
      await write(state);
      attempts.delete(`login:${address}`);
      return result;
    }),
    logout: cookie => serial(async () => {
      const token = tokenFromCookie(cookie);
      if (!token) return;
      const state = await read();
      state.sessions = state.sessions.filter(item => item.hash !== digest(token));
      await write(state);
    })
  };
}
