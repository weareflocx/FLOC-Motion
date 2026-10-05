import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { createPersonalRenderers, rendererCookie } from '../server/personal-renderers.mjs';
import { demoProject } from '../src/project.js';
import { run } from '../server/process.mjs';
import { trustedOrigin, browserCandidates } from '../scripts/renderer-runtime.mjs';

test('personal renderers isolate parallel jobs, credentials, progress and downloads', async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'floc-personal-'));
  let clock = 100000;
  const jobs = new Map(), version = 'current';
  const service = createPersonalRenderers({ data, jobs, version, now: () => clock });
  async function connect(name) {
    const pairing = await service.startPairing();
    const credentials = await service.finishPairing({ code: pairing.code, name, version });
    const cookie = rendererCookie(pairing.key, false);
    const browser = await service.browser(cookie), engine = await service.engine(`Bearer ${credentials.token}`);
    assert.equal(engine.id, browser.id);
    assert.equal(await service.engine(`Bearer ${pairing.key}`), null);
    assert.equal(await service.browser(rendererCookie(credentials.token, false)), null);
    await service.claim(engine, { version });
    return { cookie, browser, engine, pairing, credentials };
  }
  try {
    const a = await connect('Mac'), b = await connect('Windows');
    const project = demoProject(); project.duration = 1; for (const layer of project.layers) { layer.end = 1; layer.fadeIn = 0; layer.fadeOut = 0; }
    const [ja, jb] = await Promise.all([service.enqueue(a.browser, project, {}), service.enqueue(b.browser, project, {})]);
    assert.notEqual(ja.rendererId, jb.rendererId);
    await assert.rejects(service.enqueue(a.browser, project, {}), /already exporting/);
    await assert.rejects(service.startPairing(a.cookie), /finish/);
    assert.equal((await service.claim(a.engine, { version })).id, ja.id);
    assert.equal(await service.claim(a.engine, { version }), null);
    assert.equal((await service.claim(b.engine, { version })).id, jb.id);
    await assert.rejects(service.update(b.engine, ja.id, { progress: 50 }), /no longer assigned/);
    await assert.rejects(service.job(b.browser, ja.id), /not found/);
    await assert.rejects(service.job(null, ja.id), /not found/);
    await service.update(a.engine, ja.id, { progress: 20 });
    assert.equal(ja.progress, 20); assert.equal(jb.progress, 0);
    await assert.rejects(service.complete(a.engine, ja.id, Readable.from('not an MP4')));
    assert.equal(ja.state, 'rendering');
    const mp4 = path.join(data, 'fixture.mp4');
    await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=1080x1080:r=24:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4]);
    await service.complete(a.engine, ja.id, createReadStream(mp4));
    assert.equal((await service.job(a.browser, ja.id)).state, 'done');
    await assert.rejects(service.complete(b.engine, ja.id, createReadStream(mp4)), /no longer assigned/);
    const persisted = await readFile(path.join(data, 'renderers', `${a.browser.id}.json`), 'utf8');
    assert.ok(!persisted.includes(a.credentials.token.split('.')[1]));
    assert.ok(!persisted.includes(a.pairing.key.split('.')[1]));
    const restarted = createPersonalRenderers({ data, jobs: new Map(), version, now: () => clock });
    const restored = await restarted.browser(a.cookie);
    assert.equal(restored.id, a.browser.id);
    assert.equal((await restarted.status(restored)).online, false);
    assert.equal((await restarted.job(restored, ja.id)).state, 'done');
    assert.equal((await restarted.job(await restarted.browser(b.cookie), jb.id)).state, 'failed');
    clock += 91000;
    assert.equal((await service.job(b.browser, jb.id)).state, 'failed');
    await assert.rejects(service.complete(b.engine, jb.id, createReadStream(mp4)), /no longer assigned/);
    await assert.rejects(service.enqueue(b.browser, project, {}), /offline/);
    const reconnect = await service.startPairing(a.cookie);
    assert.equal(reconnect.key, a.pairing.key, 'reconnecting preserves access to completed exports');
    await service.finishPairing({ code: reconnect.code, name: 'New Mac', version });
    assert.equal(await service.engine(`Bearer ${a.credentials.token}`), null, 'old engine credential is revoked');
    assert.equal((await service.job(a.browser, ja.id)).state, 'done');
  } finally { await rm(data, { recursive: true, force: true }); }
});

test('pairing codes expire, are single use, and incompatible engines cannot export', async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'floc-pairing-'));
  let clock = 100000;
  const service = createPersonalRenderers({ data, jobs: new Map(), version: 'v2', now: () => clock });
  try {
    const pairing = await service.startPairing();
    await assert.rejects(service.finishPairing({ code: pairing.code, version: 'v1' }), /Update/);
    const credentials = await service.finishPairing({ code: pairing.code.toLowerCase(), version: 'v2' });
    await assert.rejects(service.finishPairing({ code: pairing.code, version: 'v2' }), /invalid/);
    const engine = await service.engine(`Bearer ${credentials.token}`);
    await assert.rejects(service.claim(engine, { version: 'v1' }), /Update/);
    assert.equal((await service.status(engine)).compatible, false);
    await assert.rejects(service.enqueue(engine, demoProject(), {}), /Update/);
    const expired = await service.startPairing(); clock += 600001;
    await assert.rejects(service.finishPairing({ code: expired.code, version: 'v2' }), /expired/);
    assert.match(rendererCookie(pairing.key, true), /HttpOnly; SameSite=Strict.*Secure/);
    assert.doesNotMatch(rendererCookie(pairing.key, false), /Secure/);
  } finally { await rm(data, { recursive: true, force: true }); }
});

test('runtime discovers Windows browsers without Mac paths and restricts editor origins', () => {
  const candidates = browserCandidates('win32', { LOCALAPPDATA: 'C:\\Users\\Jane Doe\\AppData\\Local', PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)' });
  assert.ok(candidates.includes('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'));
  assert.ok(candidates.includes('C:\\Users\\Jane Doe\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'));
  assert.equal(trustedOrigin('https://floc-motion.fly.dev').origin, 'https://floc-motion.fly.dev');
  assert.equal(trustedOrigin('http://127.0.0.1:4317').origin, 'http://127.0.0.1:4317');
  for (const origin of ['http://remote.example', 'https://example.com/path', 'https://user:pass@example.com', 'ftp://localhost']) assert.throws(() => trustedOrigin(origin));
});
