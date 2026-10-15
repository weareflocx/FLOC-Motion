import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAuthStore, sessionCookie } from '../server/auth-store.mjs';
import { createDraftStore } from '../server/draft-store.mjs';
import { createTemplateStore } from '../server/template-store.mjs';
import { closeDatabase, database } from '../server/database.mjs';
import { blankProject, demoProject, validateProject } from '../src/project.js';
import { editorSession } from '../src/editor/project-session.js';

const password = 'A long test password';
async function folder(t) {
  const data = await mkdtemp(path.join(tmpdir(), 'floc-access-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  return data;
}

test('invited accounts, hashes, sessions and logout survive restarts without public registration', async t => {
  const data = await folder(t), auth = createAuthStore(data);
  const invitation = await auth.bootstrap(' First@Example.com ');
  await assert.rejects(auth.bootstrap('other@example.com'), error => error.status === 409);
  await assert.rejects(auth.accept({ token: invitation.token, email: 'other@example.com', password }, 'test'), /invalid or expired/);
  await assert.rejects(auth.accept({ token: invitation.token, email: invitation.email, password: 'short' }, 'test'), /12–128/);
  const accepted = await auth.accept({ token: invitation.token, email: invitation.email, password }, 'test');
  assert.equal(accepted.user.email, 'first@example.com');
  assert.deepEqual(Object.keys(accepted.user).sort(), ['email', 'id', 'role']);
  assert.equal(accepted.user.role, 'admin', 'the bootstrap account administers the workspace');
  await assert.rejects(auth.accept({ token: invitation.token, email: invitation.email, password }, 'test'), /invalid or expired/);
  const db = database(data), persisted = JSON.stringify(['users', 'sessions', 'invitations', 'audit_log'].map(table => db.prepare(`SELECT * FROM ${table}`).all()));
  assert(!persisted.includes(password)); assert(!persisted.includes(accepted.token)); assert(!persisted.includes(invitation.token));
  closeDatabase(data);
  const restarted = createAuthStore(data), cookie = sessionCookie(accepted.token, true);
  assert(cookie.includes('HttpOnly; SameSite=Strict')); assert(cookie.endsWith('; Secure'));
  assert.deepEqual(await restarted.user(cookie), accepted.user);
  assert.equal(await restarted.user('floc_session=invalid'), null);
  await assert.rejects(restarted.login({ email: invitation.email, password: 'Wrong' }, 'test'), error => error.status === 401);
  await assert.rejects(restarted.login({ email: 'unknown@example.com', password }, 'test'), error => error.status === 401);
  const loggedIn = await restarted.login({ email: invitation.email, password }, 'test');
  await restarted.logout(cookie);
  assert.equal(await restarted.user(cookie), null);
  assert.deepEqual(await restarted.user(sessionCookie(loggedIn.token, false)), accepted.user);
  assert(sessionCookie('', true, true).includes('Max-Age=0'));
});

test('invitations and sessions expire, and excessive failed sign-ins are rejected', async t => {
  let now = 1000;
  const auth = createAuthStore(await folder(t), { now: () => now });
  const invitation = await auth.bootstrap('expiry@example.com');
  now += 49 * 60 * 60 * 1000;
  await assert.rejects(auth.accept({ token: invitation.token, email: invitation.email, password }, 'expiry'), /invalid or expired/);
  const fresh = await auth.bootstrap(invitation.email);
  const accepted = await auth.accept({ token: fresh.token, email: fresh.email, password }, 'expiry');
  now += 8 * 24 * 60 * 60 * 1000;
  assert.equal(await auth.user(sessionCookie(accepted.token, false)), null);
  for (let i = 0; i < 10; i++) await assert.rejects(auth.login({ email: fresh.email, password: 'wrong' }, 'attacker'), error => error.status === 401);
  await assert.rejects(auth.login({ email: fresh.email, password }, 'attacker'), error => error.status === 429);
  now += 16 * 60 * 1000;
  assert.equal((await auth.login({ email: fresh.email, password }, 'attacker')).user.email, fresh.email);
});

test('login throttles accounts and clients independently without proxy-wide lockout', async t => {
  const auth = createAuthStore(await folder(t));
  const invitation = await auth.bootstrap('owner@example.com');
  await auth.accept({ ...invitation, password }, 'setup');
  for (let index = 0; index < 10; index++) await assert.rejects(auth.login({ email: 'owner@example.com', password: 'wrong' }, `client-${index}`), /incorrect/);
  await assert.rejects(auth.login({ email: 'owner@example.com', password }, 'fresh-client'), error => error.status === 429);
  const second = createAuthStore(await folder(t));
  const secondInvite = await second.bootstrap('second@example.com'); await second.accept({ ...secondInvite, password }, 'setup');
  for (let index = 0; index < 25; index++) await assert.rejects(second.login({ email: `unknown-${index}@example.com`, password: 'wrong' }, 'shared-client'), /incorrect/);
  await assert.rejects(second.login({ email: 'second@example.com', password }, 'shared-client'), error => error.status === 429);
  assert.deepEqual((await second.login({ email: 'second@example.com', password }, 'different-client')).user.email, 'second@example.com');
});

test('each account keeps its 20 newest sessions and older ones are revoked', async t => {
  const auth = createAuthStore(await folder(t));
  const invitation = await auth.bootstrap('many@example.com');
  const sessions = [await auth.accept({ ...invitation, password }, 'setup')];
  for (let index = 0; index < 20; index++) sessions.push(await auth.login({ email: invitation.email, password }, 'setup'));
  assert.equal(await auth.user(sessionCookie(sessions[0].token, false)), null);
  for (const session of sessions.slice(1)) assert.equal((await auth.user(sessionCookie(session.token, false)))?.email, invitation.email);
});

test('different compositions and drafts save independently; stale saves to the same resource conflict', async t => {
  const data = await folder(t), templates = createTemplateStore(data), drafts = createDraftStore(data);
  const [a, b] = await Promise.all(['A', 'B'].map(name => templates.create({ name, project: demoProject(), tags: [] })));
  const results = await Promise.all([a, b].map(entry => templates.update(entry.id, { project: { ...entry.project, duration: 15 }, updatedAt: entry.updatedAt })));
  assert(results.every(entry => entry.project.duration === 15));
  const competing = await Promise.allSettled([16, 17].map(duration => templates.update(a.id, { project: { ...a.project, duration }, updatedAt: results[0].updatedAt })));
  assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(competing.find(result => result.status === 'rejected').reason.status, 409);
  await assert.rejects(templates.update(b.id, { project: b.project }), /revision is required/);
  assert.equal((await templates.read(b.id)).project.duration, 15);
  const [draftA, draftB] = [randomUUID(), randomUUID()];
  await Promise.all([draftA, draftB].map(id => drafts.update(id, { revision: 0, project: demoProject() })));
  await assert.rejects(drafts.update(draftA, { revision: 0, project: demoProject() }), error => error.status === 409);
  assert.equal((await createDraftStore(data).read(draftB)).revision, 1);
  await assert.rejects(drafts.read('../access/auth'), /Invalid draft ID/);
});

test('missing drafts stay blank and archiving them performs no writes', async t => {
  const data = await folder(t), drafts = createDraftStore(data), templates = createTemplateStore(data), db = database(data);
  const id = randomUUID(), before = db.prepare('SELECT total_changes() AS count').get().count;
  assert.deepEqual(await drafts.read(id), { project: validateProject(blankProject()), revision: 0 });
  assert.equal(await templates.archiveDraft(id), null);
  assert.deepEqual(await templates.list(), []);
  assert.equal(db.prepare('SELECT total_changes() AS count').get().count, before);
  for (const invalid of ['../draft', '00000000-0000-0000-0000-000000000000', 'not-a-uuid']) {
    await assert.rejects(templates.archiveDraft(invalid), /Invalid draft ID/);
  }
  assert.equal(db.prepare('SELECT count(*) AS count FROM meta WHERE key LIKE ?').get('draft-archive:%').count, 0);
});

test('draft archives preserve the complete persisted snapshot and revision exactly once across restarts', async t => {
  const data = await folder(t), drafts = createDraftStore(data), templates = createTemplateStore(data), db = database(data);
  const id = randomUUID(), project = demoProject();
  project.name = 'Previous working draft';
  await drafts.update(id, { revision: 0, project });
  const original = db.prepare('SELECT * FROM drafts WHERE id = ?').get(id);
  const archived = await templates.archiveDraft(id);
  assert.equal(archived.name, project.name);
  assert.deepEqual(archived.project, validateProject(project));
  assert.deepEqual(archived.tags, []);
  assert.deepEqual(db.prepare('SELECT * FROM drafts WHERE id = ?').get(id), original);
  assert.deepEqual((await templates.version(archived.id, 1)).project, validateProject(project));
  assert.equal((await templates.versions(archived.id)).length, 1);
  assert.deepEqual(await templates.archiveDraft(id), archived);
  assert.equal((await templates.list()).length, 1);
  const marker = db.prepare('SELECT value FROM meta WHERE key = ?').get(`draft-archive:${id}:1`);
  assert.deepEqual(JSON.parse(marker.value), { compositionId: archived.id });
  assert.equal(db.prepare("SELECT count(*) AS count FROM audit_log WHERE action = 'composition.created' AND target_id = ?").get(archived.id).count, 1);
  closeDatabase(data);
  const restarted = createTemplateStore(data);
  assert.deepEqual(await restarted.archiveDraft(id), archived);
  assert.equal((await restarted.list()).length, 1);
  assert.equal((await restarted.versions(archived.id)).length, 1);
  assert.deepEqual(await createDraftStore(data).read(id), { project: validateProject(project), revision: 1 });
});

test('new draft revisions archive independently without changing open compositions or resurrecting deleted archives', async t => {
  const data = await folder(t), templates = createTemplateStore(data), drafts = createDraftStore(data), id = randomUUID();
  await drafts.update(id, { revision: 0, project: demoProject() });
  const first = await templates.archiveDraft(id);
  const edited = await templates.update(first.id, { name: 'Open library composition', project: { ...first.project, duration: 15 }, updatedAt: first.updatedAt });
  const secondProject = { ...first.project, name: 'Later draft', duration: 16 };
  await drafts.update(id, { revision: 1, project: secondProject });
  const second = await templates.archiveDraft(id);
  assert.notEqual(second.id, first.id);
  assert.deepEqual(second.project, validateProject(secondProject));
  assert.deepEqual(await templates.read(first.id), edited);
  assert.deepEqual(await drafts.read(id), { project: validateProject(secondProject), revision: 2 });
  await templates.remove(second.id);
  closeDatabase(data);
  const restarted = createTemplateStore(data);
  assert.equal(await restarted.archiveDraft(id), null);
  assert.deepEqual((await restarted.list()).map(entry => entry.id), [first.id]);
  await createDraftStore(data).update(id, { revision: 2, project: secondProject });
  const third = await restarted.archiveDraft(id);
  assert.notEqual(third.id, second.id);
  assert.equal((await restarted.list()).length, 2);
});

test('draft archive validation and marker failures leave no partial composition, version or audit writes', async t => {
  const data = await folder(t), templates = createTemplateStore(data), drafts = createDraftStore(data), db = database(data), id = randomUUID();
  db.prepare('INSERT INTO drafts (id, project, revision) VALUES (?, ?, ?)').run(id, JSON.stringify(null), 1);
  await assert.rejects(templates.archiveDraft(id));
  const project = { ...demoProject(), name: '   ' };
  db.prepare('UPDATE drafts SET project = ? WHERE id = ?').run(JSON.stringify(project), id);
  db.exec("CREATE TRIGGER reject_draft_archive BEFORE INSERT ON meta WHEN NEW.key LIKE 'draft-archive:%' BEGIN SELECT RAISE(ABORT, 'Archive marker unavailable'); END");
  await assert.rejects(templates.archiveDraft(id), /Archive marker unavailable/);
  for (const table of ['templates', 'composition_versions', 'audit_log']) assert.equal(db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count, 0);
  assert.equal(db.prepare('SELECT count(*) AS count FROM meta WHERE key LIKE ?').get('draft-archive:%').count, 0);
  assert.deepEqual(await drafts.read(id), { project: validateProject(project), revision: 1 });
  db.exec('DROP TRIGGER reject_draft_archive');
  const archived = await templates.archiveDraft(id);
  assert.equal(archived.name, 'Untitled');
  assert.deepEqual(archived.project, validateProject(project));
});

test('the old global draft is preserved once without resurrecting deleted compositions', async t => {
  const data = await folder(t), templates = createTemplateStore(data), project = demoProject();
  project.name = 'Previous working draft';
  const original = JSON.stringify({ project, revision: 12, composition: null });
  await writeFile(path.join(data, 'project.json'), original);
  await templates.preserveLegacyProject(); await templates.preserveLegacyProject();
  const [entry] = await templates.list();
  assert.equal(entry.name, project.name);
  assert.deepEqual(entry.project.layers, validateProject(project).layers);
  assert.equal(await readFile(path.join(data, 'project.json'), 'utf8'), original);
  await templates.remove(entry.id);
  await createTemplateStore(data).preserveLegacyProject();
  assert.equal((await templates.list()).length, 0);
});

test('legacy projects already linked to the library do not create duplicate entries', async t => {
  const data = await folder(t), templates = createTemplateStore(data);
  const entry = await templates.create({ name: 'Existing', project: demoProject(), tags: [] });
  await writeFile(path.join(data, 'project.json'), JSON.stringify({ project: entry.project, revision: 10, composition: { id: entry.id } }));
  await templates.preserveLegacyProject();
  assert.equal((await templates.list()).length, 1);
});

test('active composition and draft selection stay separate between tabs and accounts', () => {
  const storage = () => { const values = new Map(); return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }; };
  const tabA = storage(), tabB = storage();
  const a = editorSession('first', tabA), b = editorSession('first', tabB);
  assert.notEqual(a.draftId, b.draftId);
  a.compositionId = 'composition-A'; a.remember();
  b.compositionId = 'composition-B'; b.remember();
  assert.equal(editorSession('first', tabA).compositionId, 'composition-A');
  assert.equal(editorSession('first', tabB).compositionId, 'composition-B');
  assert.equal(editorSession('second', tabA).compositionId, null);
});
