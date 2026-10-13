import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { database, transaction } from './database.mjs';

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
  const db = database(data);
  let queue = Promise.resolve();
  const attempts = new Map();
  const serial = action => { const pending = queue.catch(() => {}).then(action); queue = pending; return pending; };
  const userByEmail = email => db.prepare('SELECT id, email, salt, password_hash AS passwordHash FROM users WHERE email = ?').get(email);
  const activeInvitations = () => db.prepare('SELECT count(*) AS count FROM invitations WHERE expires_at > ?').get(now()).count;
  function purge() {
    db.prepare('DELETE FROM invitations WHERE expires_at <= ?').run(now());
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
  }
  function throttle(key, limit) {
    for (const [id, attempt] of attempts) if (attempt.until <= now()) attempts.delete(id);
    const attempt = attempts.get(key) || { count: 0, until: now() + 15 * 60 * 1000 };
    if (attempt.count >= limit || (!attempts.has(key) && attempts.size >= 2000)) throw failure('Too many attempts. Try again in 15 minutes.', 429);
    attempt.count++; attempts.set(key, attempt);
  }
  const accountKey = input => { try { return emailAddress(input.email); } catch { return String(input.email || '').trim().toLowerCase().slice(0, 254) || 'invalid'; } };
  // Each account keeps its 19 newest active sessions plus the new one.
  function addSession(user) {
    const token = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id NOT IN (SELECT id FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY id DESC LIMIT 19)').run(user.id, user.id, now());
    db.prepare('INSERT INTO sessions (hash, user_id, expires_at) VALUES (?, ?, ?)').run(digest(token), user.id, now() + sessionLifetime);
    purge();
    return { user: publicUser(user), token };
  }
  function invite(input) {
    const email = emailAddress(input);
    if (userByEmail(email)) throw failure('This account already exists.', 409);
    if (activeInvitations() >= 100) throw failure('Too many pending invitations.', 429);
    const token = randomBytes(32).toString('hex'), expiresAt = now() + 48 * 60 * 60 * 1000;
    db.prepare('INSERT INTO invitations (email, hash, expires_at) VALUES (?, ?, ?) ON CONFLICT (email) DO UPDATE SET hash = excluded.hash, expires_at = excluded.expires_at').run(email, digest(token), expiresAt);
    purge();
    return { email, token, expiresAt };
  }
  const pendingInvitation = (token, email) => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) && db.prepare('SELECT email FROM invitations WHERE hash = ? AND email = ? AND expires_at > ?').get(digest(token), email, now());
  const tokenFromCookie = (cookie = '') => cookie.split(';').map(part => part.trim()).find(part => part.startsWith('floc_session='))?.slice('floc_session='.length);
  return {
    bootstrap: email => serial(async () => transaction(db, () => {
      if (db.prepare('SELECT 1 FROM users LIMIT 1').get() || activeInvitations()) throw failure('Access is already configured. Create invitations from Account in the editor.', 409);
      return invite(email);
    })),
    invite: email => serial(async () => transaction(db, () => invite(email))),
    user: async cookie => {
      const token = tokenFromCookie(cookie);
      if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
      const user = db.prepare('SELECT users.id, users.email FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.hash = ? AND sessions.expires_at > ?').get(digest(token), now());
      return user ? publicUser(user) : null;
    },
    accept: (input, address) => serial(async () => {
      const email = emailAddress(input.email), password = passwordValue(input.password);
      throttle(`accept-client:${address}`, 25); throttle(`accept-account:${email}`, 10);
      if (!pendingInvitation(input.token, email) || userByEmail(email)) throw failure('This invitation is invalid or expired.', 400);
      const salt = randomBytes(32).toString('hex');
      const user = { id: randomUUID(), email, salt, passwordHash: await passwordHash(password, salt) };
      const result = transaction(db, () => {
        // Another process may have used the invitation while the password was hashing.
        if (!pendingInvitation(input.token, email) || userByEmail(email)) throw failure('This invitation is invalid or expired.', 400);
        db.prepare('INSERT INTO users (id, email, salt, password_hash) VALUES (?, ?, ?, ?)').run(user.id, user.email, user.salt, user.passwordHash);
        db.prepare('DELETE FROM invitations WHERE email = ?').run(email);
        return addSession(user);
      });
      attempts.delete(`accept-client:${address}`); attempts.delete(`accept-account:${email}`);
      return result;
    }),
    login: (input, address) => serial(async () => {
      const key = accountKey(input);
      throttle(`login-client:${address}`, 25); throttle(`login-account:${key}`, 10);
      let email;
      try { email = emailAddress(input.email); } catch { throw failure('Email or password is incorrect.', 401); }
      if (typeof input.password !== 'string' || input.password.length > 128) throw failure('Email or password is incorrect.', 401);
      const user = userByEmail(email);
      // Unknown accounts use the same work factor and response as existing accounts.
      const hash = await passwordHash(input.password, user?.salt || 'floc-unknown-account');
      if (!user || !timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.passwordHash, 'hex'))) throw failure('Email or password is incorrect.', 401);
      const result = transaction(db, () => addSession(user));
      attempts.delete(`login-client:${address}`); attempts.delete(`login-account:${email}`);
      return result;
    }),
    logout: cookie => serial(async () => {
      const token = tokenFromCookie(cookie);
      if (!token) return;
      transaction(db, () => { db.prepare('DELETE FROM sessions WHERE hash = ?').run(digest(token)); purge(); });
    })
  };
}
