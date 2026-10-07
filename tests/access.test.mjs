import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAuthStore, sessionCookie } from '../server/auth-store.mjs';
import { createDraftStore } from '../server/draft-store.mjs';
import { createTemplateStore } from '../server/template-store.mjs';
import { demoProject, validateProject } from '../src/project.js';
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
  assert.deepEqual(Object.keys(accepted.user).sort(), ['email', 'id']);
  await assert.rejects(auth.accept({ token: invitation.token, email: invitation.email, password }, 'test'), /invalid or expired/);
  const persisted = await readFile(path.join(data, 'access/auth.json'), 'utf8');
  assert(!persisted.includes(password)); assert(!persisted.includes(accepted.token)); assert(!persisted.includes(invitation.token));
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
