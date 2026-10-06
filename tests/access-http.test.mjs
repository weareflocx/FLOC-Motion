import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAuthStore } from '../server/auth-store.mjs';
import { demoProject } from '../src/project.js';
import { root } from '../server/runtime-config.mjs';

test('HTTP access requires invited accounts; shared compositions and renderer reads remain usable', { timeout: 30000 }, async t => {
  const data = await mkdtemp(path.join(tmpdir(), 'floc-access-http-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  const invitation = await createAuthStore(data).bootstrap('first@example.com');
  const listener = createServer();
  listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const origin = `http://127.0.0.1:${port}`, workerToken = 'test-only-shared-renderer-credential';
  const server = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, NODE_ENV: 'production', PORT: String(port), FLOC_DATA_DIR: data, FLOC_PUBLIC_ORIGIN: '', FLOC_RENDER_WORKER_TOKEN: workerToken }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (server.exitCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); } });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Test server did not start.')), 15000);
    server.stdout.on('data', chunk => { if (String(chunk).includes('FLOC Motion:')) { clearTimeout(timer); resolve(); } });
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Test server exited (${code}).`)); });
  });
  const call = (route, { cookie, method = 'GET', body, authorization, requestOrigin = origin } = {}) => fetch(origin + route, {
    method, headers: { ...(cookie && { Cookie: cookie }), ...(authorization && { Authorization: authorization }), ...(method !== 'GET' && requestOrigin && { Origin: requestOrigin }), ...(body && { 'Content-Type': 'application/json' }) },
    ...(body && { body: typeof body === 'string' ? body : JSON.stringify(body) })
  });
  for (const route of ['/api/templates', '/api/project', '/api/drafts/' + randomUUID(), '/api/renderers/status']) assert.equal((await call(route)).status, 401);
  assert.equal((await call('/api/health')).status, 200);
  assert.equal((await call('/api/auth/session')).status, 200);
  assert.equal((await call('/api/auth/register', { method: 'POST', body: {} })).status, 401);
  const credentials = { email: invitation.email, password: 'Test invitation password', token: invitation.token };
  assert.equal((await call('/api/auth/accept', { method: 'POST', body: credentials, requestOrigin: 'https://outside.example' })).status, 403);
  const accept = await call('/api/auth/accept', { method: 'POST', body: credentials });
  assert.equal(accept.status, 200);
  const cookie = accept.headers.get('set-cookie').split(';')[0];
  assert(accept.headers.get('set-cookie').includes('HttpOnly'));
  assert.equal((await call('/api/auth/accept', { method: 'POST', body: credentials })).status, 400);
  assert.equal((await call('/api/templates', { cookie })).status, 200);
  assert.equal((await call('/api/templates', { cookie, method: 'POST', body: {}, requestOrigin: null })).status, 403);
  const invite = await call('/api/auth/invitations', { cookie, method: 'POST', body: { email: 'second@example.com' } });
  assert.equal(invite.status, 201);
  const second = await invite.json(), token = new URLSearchParams(new URL(second.url).hash.slice(1)).get('invite');
  const secondAccept = await call('/api/auth/accept', { method: 'POST', body: { email: second.email, password: 'Another test password', token } });
  assert.equal(secondAccept.status, 200);
  const secondCookie = secondAccept.headers.get('set-cookie').split(';')[0];
  const entries = await Promise.all([cookie, secondCookie].map(async (session, index) => {
    const response = await call('/api/templates', { cookie: session, method: 'POST', body: { name: `Composition ${index}`, tags: [], project: demoProject() } });
    assert.equal(response.status, 201); return response.json();
  }));
  const writes = await Promise.all(entries.map((entry, index) => call(`/api/templates/${entry.id}`, { cookie: index ? cookie : secondCookie, method: 'PUT', body: { name: entry.name, project: { ...entry.project, duration: 15 }, updatedAt: entry.updatedAt } })));
  assert(writes.every(response => response.status === 200));
  assert.equal((await call(`/api/templates/${entries[0].id}`, { cookie, method: 'PUT', body: { project: entries[0].project, updatedAt: entries[0].updatedAt } })).status, 409);
  assert.equal((await call('/api/project', { cookie })).status, 404);
  const asset = `${randomUUID()}.png`, exportId = randomUUID();
  await mkdir(path.join(data, 'assets'), { recursive: true });
  await writeFile(path.join(data, 'assets', asset), 'Private media');
  await mkdir(path.join(data, 'renders', exportId), { recursive: true });
  await writeFile(path.join(data, 'renders', exportId, 'video.mp4'), 'Private export');
  assert.equal((await call(`/assets/${asset}`)).status, 401);
  assert.equal((await call(`/exports/${exportId}/video.mp4`)).status, 401);
  assert.equal((await call(`/assets/${asset}`, { cookie })).status, 200);
  assert.equal((await call(`/assets/${asset}`, { authorization: `Bearer ${workerToken}` })).status, 200);
  assert.equal((await call('/api/templates', { authorization: `Bearer ${workerToken}` })).status, 401);
  assert.equal((await call(`/assets/${asset}`, { authorization: 'Bearer wrong-token' })).status, 401);
  assert.equal((await call('/api/render-worker/claim', { method: 'POST', authorization: `Bearer ${workerToken}`, body: {} })).status, 200);
  assert.equal((await call('/api/auth/logout', { cookie, method: 'POST' })).status, 200);
  assert.equal((await call('/api/templates', { cookie })).status, 401);
  assert.equal((await call('/api/templates', { cookie: secondCookie })).status, 200);
});

test('development file serving cannot expose credentials or uploaded data through Vite paths', { timeout: 30000 }, async t => {
  await mkdir(path.join(root, '.data'), { recursive: true });
  const data = await mkdtemp(path.join(root, '.data/access-http-test-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  await mkdir(path.join(data, 'access'));
  const marker = 'private-file-content-must-not-be-served';
  await writeFile(path.join(data, 'access/auth.json'), JSON.stringify({ marker, users: [], sessions: [], invitations: [] }));
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, NODE_ENV: 'development', PORT: String(port), FLOC_DATA_DIR: data, FLOC_PUBLIC_ORIGIN: '', FLOC_RENDER_WORKER_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (server.exitCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); } });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Development test server did not start.')), 15000);
    server.stdout.on('data', chunk => { if (String(chunk).includes('FLOC Motion:')) { clearTimeout(timer); resolve(); } });
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Development test server exited (${code}).`)); });
  });
  for (const route of [`/@fs${data}/access/auth.json`, `/${path.relative(root, data)}/access/auth.json`, `/${path.relative(root, data)}/access/auth.json?raw`]) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 403);
    assert(!(await response.text()).includes(marker));
  }
});
