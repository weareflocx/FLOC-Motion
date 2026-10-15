import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAuthStore, sessionCookie } from '../server/auth-store.mjs';
import { createAuditLog, AUDIT_RETENTION } from '../server/audit-log.mjs';
import { createTemplateStore } from '../server/template-store.mjs';
import { closeDatabase, database, transaction, DATABASE_FILE } from '../server/database.mjs';
import { demoProject } from '../src/project.js';

const password = 'A long test password';
async function folder(t) {
  const data = await mkdtemp(path.join(tmpdir(), 'floc-roles-'));
  t.after(() => { closeDatabase(data); return rm(data, { recursive: true, force: true }); });
  return data;
}
async function team(t) {
  const data = await folder(t), auth = createAuthStore(data);
  const admin = await auth.accept({ ...await auth.bootstrap('admin@example.com'), password }, 'setup');
  const join = async (email, role) => auth.accept({ ...await auth.invite({ email, role }, admin.user.id), password }, 'setup');
  return { data, auth, admin, join };
}

test('invitations carry the chosen role and the last admin can be neither demoted nor removed', async t => {
  const { auth, admin, join } = await team(t);
  const editor = await join('editor@example.com');
  assert.equal(editor.user.role, 'editor', 'invitations default to editor');
  await assert.rejects(auth.invite({ email: 'x@example.com', role: 'owner' }, admin.user.id), error => error.status === 400);
  await assert.rejects(auth.setRole(admin.user.id, 'editor', admin.user.id), error => error.status === 409);
  await assert.rejects(auth.remove(admin.user.id, admin.user.id), error => error.status === 409);
  assert.equal((await auth.user(sessionCookie(admin.token, false))).role, 'admin');
  await auth.setRole(editor.user.id, 'admin', admin.user.id);
  assert.equal((await auth.user(sessionCookie(editor.token, false))).role, 'admin', 'role changes apply to existing sessions');
  await auth.setRole(admin.user.id, 'editor', editor.user.id);
  await assert.rejects(auth.setRole(editor.user.id, 'editor', editor.user.id), error => error.status === 409);
  const second = await join('second-admin@example.com', 'admin');
  assert.equal(second.user.role, 'admin');
  assert.deepEqual((await auth.users()).map(user => [user.email, user.role]), [['admin@example.com', 'editor'], ['editor@example.com', 'admin'], ['second-admin@example.com', 'admin']]);
  await assert.rejects(auth.setRole('00000000-0000-4000-8000-000000000000', 'editor', admin.user.id), error => error.status === 404);
});

test('removing an account revokes every session and keeps its activity attributable', async t => {
  const { data, auth, admin, join } = await team(t);
  const editor = await join('leaving@example.com');
  const other = await auth.login({ email: 'leaving@example.com', password }, 'second-device');
  await auth.remove(editor.user.id, admin.user.id);
  assert.equal(await auth.user(sessionCookie(editor.token, false)), null);
  assert.equal(await auth.user(sessionCookie(other.token, false)), null);
  await assert.rejects(auth.login({ email: 'leaving@example.com', password }, 'again'), error => error.status === 401);
  assert.deepEqual((await auth.users()).map(user => user.email), ['admin@example.com']);
  const { entries } = createAuditLog(data).page();
  const signIn = entries.find(entry => entry.action === 'user.signed_in');
  assert.equal(signIn.actor.email, 'leaving@example.com', 'removed accounts keep their email in activity');
  assert.deepEqual(entries.find(entry => entry.action === 'user.removed').details, { email: 'leaving@example.com', role: 'editor' });
});

test('existing workspaces make the earliest account admin and every other account editor', async t => {
  const data = await folder(t);
  database(data); closeDatabase(data);
  // Return the database to its schema before roles, then add accounts in creation order.
  const raw = new DatabaseSync(path.join(data, DATABASE_FILE));
  // Migration 4 added roles; later migrations (workspace fonts, media names) are rolled back too so all re-run in order.
  const roleMigration = 4;
  const fontTriggers = ['drafts', 'templates', 'composition_versions'].flatMap(table => ['insert', 'update', 'delete'].map(event => `DROP TRIGGER ${table}_fonts_${event};`)).join(' ');
  raw.exec(`${fontTriggers} DROP TABLE font_references; DROP TABLE fonts; DROP TABLE asset_names;
    ALTER TABLE users DROP COLUMN role; ALTER TABLE users DROP COLUMN created_at; ALTER TABLE users DROP COLUMN last_seen;
    ALTER TABLE invitations DROP COLUMN role; DROP TABLE audit_log; DELETE FROM schema_migrations WHERE version >= ${roleMigration};`);
  const insert = raw.prepare('INSERT INTO users (id, email, salt, password_hash) VALUES (?, ?, ?, ?)');
  for (const [index, email] of ['zed@example.com', 'amy@example.com', 'max@example.com'].entries()) insert.run(`0000000${index}-0000-4000-8000-000000000000`, email, 'salt', 'ab'.repeat(64));
  raw.prepare('INSERT INTO invitations (email, hash, expires_at) VALUES (?, ?, ?)').run('pending@example.com', 'c'.repeat(64), Date.now() + 60000);
  raw.close();
  const db = database(data);
  assert.deepEqual(db.prepare('SELECT email, role FROM users ORDER BY rowid').all().map(row => [row.email, row.role]), [['zed@example.com', 'admin'], ['amy@example.com', 'editor'], ['max@example.com', 'editor']]);
  assert.equal(db.prepare('SELECT role FROM invitations').get().role, 'editor', 'pending invitations of a configured workspace stay editor');
});

test('activity records composition events, pages newest first and keeps the newest 10,000 rows', async t => {
  const { data, admin } = await team(t);
  const templates = createTemplateStore(data), author = { userId: admin.user.id };
  const created = await templates.create({ name: 'Loop', tags: [], project: demoProject() }, author);
  const renamed = await templates.update(created.id, { name: 'Loop v2', updatedAt: created.updatedAt }, author);
  await templates.restore(created.id, 1, { updatedAt: renamed.updatedAt }, author);
  await templates.remove(created.id, author);
  const audit = createAuditLog(data);
  const first = audit.page({ limit: 3 });
  assert.deepEqual(first.entries.map(entry => entry.action), ['composition.deleted', 'composition.restored', 'composition.renamed']);
  assert.deepEqual(first.entries.map(entry => entry.details), [{ name: 'Loop' }, { name: 'Loop', version: 1 }, { from: 'Loop', to: 'Loop v2' }]);
  assert(first.entries.every(entry => entry.actor.email === 'admin@example.com' && entry.target.id === created.id));
  const rest = audit.page({ before: first.next, limit: 200 });
  assert.deepEqual(rest.entries.map(entry => entry.action), ['composition.created', 'invitation.accepted', 'invitation.created']);
  assert.equal(rest.next, null);
  assert.equal(rest.entries.at(-1).actor, null, 'the bootstrap invitation has no actor');
  assert.deepEqual(rest.entries.at(-1).details, { email: 'admin@example.com', role: 'admin' });
  for (const query of [{ limit: 0 }, { limit: 201 }, { before: 'x' }, { before: -1 }]) assert.throws(() => audit.page(query), error => error.status === 400);
  const db = database(data);
  transaction(db, () => { for (let index = 0; index < AUDIT_RETENTION + 5; index++) audit.record({ action: 'test.fill', details: { index } }); });
  assert.equal(db.prepare('SELECT count(*) AS count FROM audit_log').get().count, AUDIT_RETENTION);
  assert.equal(audit.page({ limit: 1 }).entries[0].details.index, AUDIT_RETENTION + 4);
  assert.equal(db.prepare("SELECT count(*) AS count FROM audit_log WHERE action LIKE 'composition.%'").get().count, 0, 'the oldest rows are dropped first');
});

test('export outcomes are recorded once and attributed to the account that queued them', async t => {
  const { data, admin } = await team(t);
  const audit = createAuditLog(data);
  const job = { id: '11111111-1111-4111-8111-111111111111', name: 'Loop', format: 'mov', resolution: '1080p', state: 'queued' };
  audit.exportQueued(admin.user.id, job);
  audit.exportEnded({ ...job, state: 'rendering' });
  audit.exportEnded({ ...job, state: 'failed', message: 'FFmpeg exited.' });
  audit.exportEnded({ ...job, state: 'failed', message: 'Reported twice.' });
  const exportEntries = audit.page().entries.filter(entry => entry.target?.type === 'export');
  assert.deepEqual(exportEntries.map(entry => [entry.action, entry.actor.email]), [['export.failed', 'admin@example.com'], ['export.queued', 'admin@example.com']]);
  assert.deepEqual(exportEntries[0].details, { name: 'Loop', format: 'mov', resolution: '1080p', message: 'FFmpeg exited.' });
});
