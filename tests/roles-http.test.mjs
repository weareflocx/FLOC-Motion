import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAuthStore } from '../server/auth-store.mjs';
import { demoProject } from '../src/project.js';

test('admin-only routes reject editors with 403 and removed accounts lose their sessions', { timeout: 30000 }, async t => {
  const data = await mkdtemp(path.join(tmpdir(), 'floc-roles-http-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  const invitation = await createAuthStore(data).bootstrap('admin@example.com');
  const listener = createServer();
  listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, NODE_ENV: 'production', PORT: String(port), FLOC_DATA_DIR: data, FLOC_PUBLIC_ORIGIN: '', FLOC_RENDER_WORKER_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (server.exitCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); } });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Test server did not start.')), 15000);
    server.stdout.on('data', chunk => { if (String(chunk).includes('FLOC Motion:')) { clearTimeout(timer); resolve(); } });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Test server exited (${code}).`)); });
  });
  const call = (route, { cookie, method = 'GET', body } = {}) => fetch(origin + route, {
    method, headers: { ...(cookie && { Cookie: cookie }), ...(method !== 'GET' && { Origin: origin }), ...(body && { 'Content-Type': 'application/json' }) },
    ...(body && { body: JSON.stringify(body) })
  });
  const accept = async (details, secret) => {
    const response = await call('/api/auth/accept', { method: 'POST', body: { email: details.email, password: secret, token: details.token } });
    assert.equal(response.status, 200);
    return { cookie: response.headers.get('set-cookie').split(';')[0], user: (await response.json()).user };
  };
  const admin = await accept(invitation, 'Admin test password');
  assert.equal(admin.user.role, 'admin');
  const invite = await call('/api/auth/invitations', { cookie: admin.cookie, method: 'POST', body: { email: 'editor@example.com', role: 'editor' } });
  assert.equal(invite.status, 201);
  const sent = await invite.json();
  assert.equal(sent.role, 'editor');
  const editor = await accept({ email: sent.email, token: new URLSearchParams(new URL(sent.url).hash.slice(1)).get('invite') }, 'Editor test password');
  assert.equal((await (await call('/api/auth/session', { cookie: editor.cookie })).json()).user.role, 'editor');

  // Every admin route is enforced by the server, whatever the UI shows.
  const adminRoutes = [
    ['/api/auth/invitations', 'POST', { email: 'third@example.com', role: 'admin' }],
    ['/api/users', 'GET'],
    [`/api/users/${admin.user.id}`, 'PATCH', { role: 'editor' }],
    [`/api/users/${admin.user.id}`, 'DELETE'],
    ['/api/storage/cleanup', 'POST', { confirm: true }],
    ['/api/audit', 'GET']
  ];
  for (const [route, method, body] of adminRoutes) assert.equal((await call(route, { cookie: editor.cookie, method, body })).status, 403, `${method} ${route}`);
  // Editors keep full editing rights in the shared library.
  const created = await call('/api/templates', { cookie: editor.cookie, method: 'POST', body: { name: 'Editor work', tags: [], project: demoProject() } });
  assert.equal(created.status, 201);
  assert.equal((await call(`/api/templates/${(await created.json()).id}`, { cookie: editor.cookie, method: 'DELETE' })).status, 200);
  assert.equal((await call('/api/storage', { cookie: editor.cookie })).status, 200);

  const users = (await (await call('/api/users', { cookie: admin.cookie })).json()).users;
  assert.deepEqual(users.map(user => [user.email, user.role]), [['admin@example.com', 'admin'], ['editor@example.com', 'editor']]);
  assert(users.every(user => Date.parse(user.createdAt) && Date.parse(user.lastSeen)));
  assert.equal((await call(`/api/users/${admin.user.id}`, { cookie: admin.cookie, method: 'PATCH', body: { role: 'editor' } })).status, 409);
  assert.equal((await call(`/api/users/${admin.user.id}`, { cookie: admin.cookie, method: 'DELETE' })).status, 409);
  assert.equal((await call(`/api/users/${editor.user.id}`, { cookie: admin.cookie, method: 'PATCH', body: { role: 'owner' } })).status, 400);
  assert.equal((await call('/api/audit?limit=201', { cookie: admin.cookie })).status, 400);
  assert.equal((await call('/api/storage/cleanup', { cookie: admin.cookie, method: 'POST', body: { confirm: true } })).status, 200);
  assert.equal((await call(`/api/users/${editor.user.id}`, { cookie: admin.cookie, method: 'DELETE' })).status, 200);
  assert.equal((await call('/api/templates', { cookie: editor.cookie })).status, 401, 'removal revokes existing sessions');
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: 'editor@example.com', password: 'Editor test password' } })).status, 401);

  const page = await (await call('/api/audit?limit=200', { cookie: admin.cookie })).json();
  assert.deepEqual(page.entries.map(entry => entry.action), ['user.removed', 'storage.cleanup', 'composition.deleted', 'composition.created', 'invitation.accepted', 'invitation.created', 'invitation.accepted', 'invitation.created']);
  assert.deepEqual(page.entries[1].details, { removedFiles: 0, removedBytes: 0 });
  assert.equal(page.entries[2].actor.email, 'editor@example.com', 'removed accounts stay attributable');
});
