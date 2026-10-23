import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { database, transaction } from './database.mjs';
import { createAuditLog } from './audit-log.mjs';

const derive = promisify(scrypt);
const digest = value => createHash('sha256').update(value).digest('hex');
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const publicUser = ({ id, email, role }) => ({ id, email, role });
const isoTime = value => value === null || value === undefined ? null : new Date(value).toISOString();
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;
const resetLifetime = 24 * 60 * 60 * 1000;
// lastSeen is refreshed at most once a minute per account so authenticated reads stay read-only.
const seenInterval = 60 * 1000;
export const ROLES = ['admin', 'editor'];
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
function roleValue(value) {
  if (!ROLES.includes(value)) throw failure('Choose the Admin or Editor role.');
  return value;
}
async function passwordHash(password, salt) {
  return (await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex');
}

export function createAuthStore(data, { now = Date.now } = {}) {
  const db = database(data), audit = createAuditLog(data, { now });
  let queue = Promise.resolve();
  const attempts = new Map(), seen = new Map();
  const serial = action => { const pending = queue.catch(() => {}).then(action); queue = pending; return pending; };
  const userByEmail = email => db.prepare('SELECT id, email, role, salt, password_hash AS passwordHash FROM users WHERE email = ?').get(email);
  const userById = id => db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(id);
  const activeInvitations = () => db.prepare('SELECT count(*) AS count FROM invitations WHERE expires_at > ?').get(now()).count;
  const admins = () => db.prepare("SELECT count(*) AS count FROM users WHERE role = 'admin'").get().count;
  function purge() {
    db.prepare('DELETE FROM invitations WHERE expires_at <= ?').run(now());
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
    db.prepare('DELETE FROM password_resets WHERE expires_at <= ?').run(now());
  }
  function throttle(key, limit) {
    for (const [id, attempt] of attempts) if (attempt.until <= now()) attempts.delete(id);
    const attempt = attempts.get(key) || { count: 0, until: now() + 15 * 60 * 1000 };
    if (attempt.count >= limit || (!attempts.has(key) && attempts.size >= 2000)) throw failure('Too many attempts. Try again in 15 minutes.', 429);
    attempt.count++; attempts.set(key, attempt);
  }
  function markSeen(id) {
    const time = now();
    if (time - (seen.get(id) ?? -Infinity) < seenInterval) return;
    if (seen.size >= 2000) seen.clear();
    seen.set(id, time);
    db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(time, id);
  }
  const accountKey = input => { try { return emailAddress(input.email); } catch { return String(input.email || '').trim().toLowerCase().slice(0, 254) || 'invalid'; } };
  // Each account keeps its 19 newest active sessions plus the new one.
  function addSession(user) {
    const token = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id NOT IN (SELECT id FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY id DESC LIMIT 19)').run(user.id, user.id, now());
    db.prepare('INSERT INTO sessions (hash, user_id, expires_at) VALUES (?, ?, ?)').run(digest(token), user.id, now() + sessionLifetime);
    seen.set(user.id, now());
    db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now(), user.id);
    purge();
    return { user: publicUser(user), token };
  }
  function invite(input, role, actorId) {
    const email = emailAddress(input);
    if (userByEmail(email)) throw failure('This account already exists.', 409);
    if (activeInvitations() >= 100) throw failure('Too many pending invitations.', 429);
    const token = randomBytes(32).toString('hex'), expiresAt = now() + 48 * 60 * 60 * 1000;
    db.prepare('INSERT INTO invitations (email, hash, expires_at, role) VALUES (?, ?, ?, ?) ON CONFLICT (email) DO UPDATE SET hash = excluded.hash, expires_at = excluded.expires_at, role = excluded.role').run(email, digest(token), expiresAt, role);
    audit.record({ actorId, action: 'invitation.created', target: { type: 'invitation', id: email }, details: { email, role } });
    purge();
    return { email, role, token, expiresAt };
  }
  function existingUser(id) {
    const user = userById(id);
    if (!user) throw failure('Account not found.', 404);
    return user;
  }
  const lastAdmin = user => user.role === 'admin' && admins() <= 1;
  const pendingInvitation = (token, email) => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) && db.prepare('SELECT email, role FROM invitations WHERE hash = ? AND email = ? AND expires_at > ?').get(digest(token), email, now());
  const pendingReset = (token, email) => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) && db.prepare('SELECT users.id, users.email, users.role FROM password_resets JOIN users ON users.id = password_resets.user_id WHERE password_resets.hash = ? AND users.email = ? AND password_resets.expires_at > ?').get(digest(token), email, now());
  const tokenFromCookie = (cookie = '') => cookie.split(';').map(part => part.trim()).find(part => part.startsWith('floc_session='))?.slice('floc_session='.length);
  return {
    // The first account administers the workspace.
    bootstrap: email => serial(async () => transaction(db, () => {
      if (db.prepare('SELECT 1 FROM users LIMIT 1').get() || activeInvitations()) throw failure('Access is already configured. Create invitations from Account in the editor.', 409);
      return invite(email, 'admin', null);
    })),
    invite: (input, actorId) => serial(async () => transaction(db, () => invite(input?.email, roleValue(input?.role ?? 'editor'), actorId))),
    user: async cookie => {
      const token = tokenFromCookie(cookie);
      if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
      const user = db.prepare('SELECT users.id, users.email, users.role FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.hash = ? AND sessions.expires_at > ?').get(digest(token), now());
      if (!user) return null;
      markSeen(user.id);
      return publicUser(user);
    },
    users: async () => db.prepare('SELECT id, email, role, created_at, last_seen FROM users ORDER BY rowid').all().map(user => ({ ...publicUser(user), createdAt: isoTime(user.created_at), lastSeen: isoTime(user.last_seen) })),
    // At least one admin always remains, so the workspace can never lose its administrator.
    setRole: (id, role, actorId) => serial(async () => transaction(db, () => {
      const user = existingUser(id), next = roleValue(role);
      if (user.role === next) return publicUser(user);
      if (lastAdmin(user)) throw failure('Keep at least one admin. Make another account admin first.', 409);
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(next, id);
      audit.record({ actorId, action: 'user.role_changed', target: { type: 'user', id }, details: { email: user.email, from: user.role, to: next } });
      return publicUser({ ...user, role: next });
    })),
    // Removing an account revokes all of its sessions; its compositions and history stay shared.
    remove: (id, actorId) => serial(async () => transaction(db, () => {
      const user = existingUser(id);
      if (lastAdmin(user)) throw failure('Keep at least one admin. Make another account admin first.', 409);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
      seen.delete(id);
      audit.record({ actorId, action: 'user.removed', target: { type: 'user', id }, details: { email: user.email, role: user.role } });
    })),
    // A new link replaces the account's previous one; the password stays valid until the link is used.
    // actorId is null when the operator CLI issues the link.
    createPasswordReset: (id, actorId) => serial(async () => transaction(db, () => {
      const user = existingUser(id);
      const token = randomBytes(32).toString('hex'), expiresAt = now() + resetLifetime;
      db.prepare('INSERT INTO password_resets (user_id, hash, expires_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET hash = excluded.hash, expires_at = excluded.expires_at').run(user.id, digest(token), expiresAt);
      audit.record({ actorId, action: 'user.password_reset_created', target: { type: 'user', id: user.id }, details: { email: user.email } });
      purge();
      return { email: user.email, token, expiresAt };
    })),
    userIdByEmail: email => userByEmail(emailAddress(email))?.id ?? null,
    // Using a reset link signs the account out everywhere, then signs this browser in.
    resetPassword: (input, address) => serial(async () => {
      const email = emailAddress(input.email), password = passwordValue(input.password);
      throttle(`reset-client:${address}`, 25); throttle(`reset-account:${email}`, 10);
      const user = pendingReset(input.token, email);
      if (!user) throw failure('This reset link is invalid or expired.', 400);
      const salt = randomBytes(32).toString('hex'), hash = await passwordHash(password, salt);
      const result = transaction(db, () => {
        // The link may have been used, replaced or its account removed while the password was hashing.
        if (pendingReset(input.token, email)?.id !== user.id) throw failure('This reset link is invalid or expired.', 400);
        db.prepare('UPDATE users SET salt = ?, password_hash = ? WHERE id = ?').run(salt, hash, user.id);
        db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
        audit.record({ actorId: user.id, action: 'user.password_reset', target: { type: 'user', id: user.id }, details: { email } });
        return addSession(user);
      });
      attempts.delete(`reset-client:${address}`); attempts.delete(`reset-account:${email}`);
      return result;
    }),
    accept: (input, address) => serial(async () => {
      const email = emailAddress(input.email), password = passwordValue(input.password);
      throttle(`accept-client:${address}`, 25); throttle(`accept-account:${email}`, 10);
      if (!pendingInvitation(input.token, email) || userByEmail(email)) throw failure('This invitation is invalid or expired.', 400);
      const salt = randomBytes(32).toString('hex');
      const user = { id: randomUUID(), email, salt, passwordHash: await passwordHash(password, salt) };
      const result = transaction(db, () => {
        // Another process may have used the invitation while the password was hashing.
        const invitation = pendingInvitation(input.token, email);
        if (!invitation || userByEmail(email)) throw failure('This invitation is invalid or expired.', 400);
        user.role = invitation.role;
        db.prepare('INSERT INTO users (id, email, salt, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(user.id, user.email, user.salt, user.passwordHash, user.role, now());
        db.prepare('DELETE FROM invitations WHERE email = ?').run(email);
        audit.record({ actorId: user.id, action: 'invitation.accepted', target: { type: 'user', id: user.id }, details: { email, role: user.role } });
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
      const result = transaction(db, () => {
        // The account may have been removed or changed while the password was hashing.
        const current = userByEmail(email);
        if (current?.id !== user.id) throw failure('Email or password is incorrect.', 401);
        audit.record({ actorId: user.id, action: 'user.signed_in', target: { type: 'user', id: user.id } });
        return addSession(current);
      });
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
