import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAuthStore } from '../server/auth-store.mjs';
import { run } from '../server/process.mjs';

test('uploaded audio waveform API requires a browser session and returns real cached peaks or HTTP errors', { timeout: 30000 }, async t => {
  const data = await mkdtemp(path.join(tmpdir(), 'floc-waveform-http-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  const invitation = await createAuthStore(data).bootstrap('waveform@example.com');
  const listener = createServer();
  listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const origin = `http://127.0.0.1:${port}`, workerToken = 'waveform-test-renderer-token';
  const server = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, NODE_ENV: 'production', PORT: String(port), FLOC_DATA_DIR: data, FLOC_PUBLIC_ORIGIN: '', FLOC_RENDER_WORKER_TOKEN: workerToken }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (server.exitCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); } });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Waveform test server did not start.')), 15000);
    server.stdout.on('data', chunk => { if (String(chunk).includes('FLOC Motion:')) { clearTimeout(timer); resolve(); } });
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Waveform test server exited (${code}).`)); });
  });
  const route = `/api/assets/${randomUUID()}.wav/waveform`;
  assert.equal((await fetch(origin + route)).status, 401);
  assert.equal((await fetch(origin + route, { headers: { Authorization: `Bearer ${workerToken}` } })).status, 401);
  const accepted = await fetch(origin + '/api/auth/accept', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: invitation.email, token: invitation.token, password: 'Waveform test password' }) });
  assert.equal(accepted.status, 200);
  const cookie = accepted.headers.get('set-cookie').split(';')[0];
  const headers = { Cookie: cookie, Origin: origin };
  assert.equal((await fetch(origin + route, { headers })).status, 404);

  const fixture = path.join(data, 'fixture.wav');
  await run('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000:duration=0.5', fixture]);
  const source = await readFile(fixture);
  const uploaded = await fetch(origin + '/api/assets?name=sound.wav', { method: 'POST', headers, body: source });
  assert.equal(uploaded.status, 200);
  const asset = await uploaded.json(), waveformRoute = `/api${asset.src}/waveform`;
  const response = await fetch(origin + waveformRoute, { headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const waveform = await response.json();
  assert.equal(waveform.duration, .5);
  assert.equal(waveform.peaks.length, 2048);
  assert(waveform.peaks.some(peak => peak > .1));
  assert.deepEqual(await (await fetch(origin + waveformRoute, { headers })).json(), waveform);
  assert.equal((await readdir(path.join(data, 'cache', 'audio-waveforms'))).length, 1);
  assert.deepEqual(await readFile(path.join(data, 'assets', `${asset.id}.wav`)), source);
  assert.deepEqual(await readdir(path.join(data, 'renders')), []);

  for (const invalid of [`/api/assets/${asset.id}.png/waveform`, '/api/assets/%2e%2e%2ffixture.wav/waveform', '/api/assets/not-a-uuid.wav/waveform']) {
    assert.equal((await fetch(origin + invalid, { headers })).status, 404);
  }
  assert.equal((await fetch(origin + waveformRoute, { method: 'POST', headers })).status, 404);
  const corrupt = `${randomUUID()}.wav`;
  await writeFile(path.join(data, 'assets', corrupt), 'invalid media');
  const failure = await fetch(origin + `/api/assets/${corrupt}/waveform`, { headers });
  assert.equal(failure.status, 422);
  assert.match((await failure.json()).error, /Audio waveform could not be generated/);
});
