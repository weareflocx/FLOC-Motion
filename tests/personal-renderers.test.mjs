import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPersonalRenderers, rendererCookie } from '../server/personal-renderers.mjs';
import { recoverInterruptedJobs } from '../server/export.mjs';
import { demoProject } from '../src/project.js';
import { trustedOrigin, browserCandidates } from '../scripts/renderer-runtime.mjs';
import { database } from '../server/database.mjs';

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
    await assert.rejects(service.startPairing(a.cookie), /finish/);
    assert.equal((await service.claim(a.engine, { version })).id, ja.id);
    assert.equal(await service.claim(a.engine, { version }), null);
    assert.equal((await service.claim(b.engine, { version })).id, jb.id);
    await assert.rejects(service.update(b.engine, ja.id, { progress: 50 }), /no longer assigned/);
    await assert.rejects(service.job(b.browser, ja.id), /not found/);
    await assert.rejects(service.job(null, ja.id), /not found/);
    await service.update(a.engine, ja.id, { progress: 20 });
    assert.equal(ja.progress, 20); assert.equal(jb.progress, 0);
    await assert.rejects(service.complete(a.engine, ja.id, {}), /Invalid export result/);
    await assert.rejects(service.complete(a.engine, ja.id, { file: 'not-a-video.txt', duration: 1 }), /Invalid export result/);
    await assert.rejects(service.complete(a.engine, ja.id, { file: 'bad\nname.mp4', duration: 1 }), /Invalid export result/);
    assert.equal(ja.state, 'rendering');
    await service.complete(a.engine, ja.id, { file: 'Movies/FLOC Motion/Test.mp4', duration: 1 });
    const completed = await service.job(a.browser, ja.id);
    assert.equal(completed.state, 'done');
    assert.equal(completed.file, 'Movies/FLOC Motion/Test.mp4');
    assert.equal(completed.duration, 1);
    assert.equal('url' in completed, false);
    await assert.rejects(access(path.join(data, 'renders', ja.id, 'video.mp4')), { code: 'ENOENT' });
    await assert.rejects(service.complete(b.engine, ja.id, { file: 'Videos/FLOC Motion/Test.mp4', duration: 1 }), /no longer assigned/);
    const persisted = JSON.stringify(database(data).prepare('SELECT * FROM renderer_devices WHERE id = ?').get(a.browser.id));
    assert.ok(persisted.includes(a.browser.id));
    assert.ok(!persisted.includes(a.credentials.token.split('.')[1]));
    assert.ok(!persisted.includes(a.pairing.key.split('.')[1]));
    await recoverInterruptedJobs(data);
    const restarted = createPersonalRenderers({ data, jobs: new Map(), version, now: () => clock });
    const restored = await restarted.browser(a.cookie);
    assert.equal(restored.id, a.browser.id);
    assert.equal((await restarted.status(restored)).online, false);
    const restoredJob = await restarted.job(restored, ja.id);
    assert.equal(restoredJob.state, 'done');
    assert.equal(restoredJob.file, 'Movies/FLOC Motion/Test.mp4');
    assert.equal(restoredJob.duration, 1);
    await assert.rejects(restarted.job(await restarted.browser(b.cookie), ja.id), /not found/);
    assert.equal((await restarted.job(await restarted.browser(b.cookie), jb.id)).state, 'failed');
    clock += 91000;
    assert.equal((await service.job(b.browser, jb.id)).state, 'failed');
    await assert.rejects(service.complete(b.engine, jb.id, { file: 'Videos/FLOC Motion/Test.mp4', duration: 1 }), /no longer assigned/);
    await assert.rejects(service.enqueue(b.browser, project, {}), /offline/);
    const reconnect = await service.startPairing(a.cookie);
    assert.equal(reconnect.key, a.pairing.key, 'reconnecting preserves access to completed exports');
    await service.finishPairing({ code: reconnect.code, name: 'New Mac', version });
    assert.equal(await service.engine(`Bearer ${a.credentials.token}`), null, 'old engine credential is revoked');
    assert.equal((await service.job(a.browser, ja.id)).state, 'done');
  } finally { await rm(data, { recursive: true, force: true }); }
});

test('a renderer takes queued exports in order, one at a time; queued ones cancel and expire', async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'floc-personal-queue-'));
  let clock = 100000;
  const version = 'current', service = createPersonalRenderers({ data, jobs: new Map(), version, now: () => clock });
  try {
    const pairing = await service.startPairing();
    const credentials = await service.finishPairing({ code: pairing.code, name: 'Mac', version });
    const browser = await service.browser(rendererCookie(pairing.key, false)), engine = await service.engine(`Bearer ${credentials.token}`);
    await service.claim(engine, { version });
    const project = demoProject(); project.duration = 1; for (const layer of project.layers) { layer.end = 1; layer.fadeIn = 0; layer.fadeOut = 0; }
    const queued = [];
    for (const name of ['A', 'B', 'C', 'D']) queued.push(await service.enqueue(browser, { ...project, name }, {}));
    assert.deepEqual(queued.map(job => job.state), ['queued', 'queued', 'queued', 'queued']);
    assert.deepEqual(await service.status(browser).then(status => [status.busy, status.queued]), [true, 4]);
    const stored = id => readFile(path.join(data, 'renders', id, 'job.json'), 'utf8').then(JSON.parse);
    assert.equal((await stored(queued[3].id)).state, 'queued', 'waiting exports are on disk for restart recovery');

    const first = await service.claim(engine, { version });
    assert.equal(first.id, queued[0].id); assert.equal(first.project.name, 'A');
    assert.equal(await service.claim(engine, { version }), null, 'one export at a time');
    const cancelled = await service.cancel(browser, queued[1].id);
    assert.equal(cancelled.state, 'cancelled');
    assert.equal((await stored(queued[1].id)).state, 'cancelled');
    await service.complete(engine, first.id, { file: 'Movies/FLOC Motion/A.mp4', duration: 1 });
    assert.equal((await service.claim(engine, { version })).id, queued[2].id, 'the cancelled export is skipped');
    await service.update(engine, queued[2].id, { state: 'failed', message: 'GPU lost' });
    assert.equal((await service.claim(engine, { version })).id, queued[3].id, 'a failure moves on to the next export');
    await service.complete(engine, queued[3].id, { file: 'Movies/FLOC Motion/D.mp4', duration: 1 });
    assert.equal(await service.claim(engine, { version }), null);
    assert.equal((await service.status(browser)).busy, false);

    // The queue holds 50 waiting exports; a disconnected renderer fails its current and waiting exports.
    const waiting = [];
    for (let i = 0; i < 50; i++) waiting.push(await service.enqueue(browser, project, {}));
    await assert.rejects(service.enqueue(browser, project, {}), error => error.status === 429 && /Up to 50 exports/.test(error.message));
    await service.claim(engine, { version });
    await service.enqueue(browser, project, {});
    clock += 91000;
    assert.deepEqual(await service.status(browser).then(status => [status.busy, status.queued]), [false, 0]);
    assert.ok(waiting.every(job => job.state === 'failed' && /disconnected/.test(job.message)));
    assert.equal((await stored(waiting[49].id)).state, 'failed');
  } finally { await rm(data, { recursive: true, force: true }); }
});

test('only the owning browser cancels a renderer export, and its stale result is rejected', async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'floc-personal-cancel-'));
  const jobs = new Map(), version = 'current';
  const service = createPersonalRenderers({ data, jobs, version, now: () => 100000 });
  async function connect(name) {
    const pairing = await service.startPairing();
    const credentials = await service.finishPairing({ code: pairing.code, name, version });
    const engine = await service.engine(`Bearer ${credentials.token}`);
    await service.claim(engine, { version });
    return { browser: await service.browser(rendererCookie(pairing.key, false)), engine };
  }
  try {
    const a = await connect('Mac'), b = await connect('Windows');
    const project = demoProject(); project.duration = 1; for (const layer of project.layers) { layer.end = 1; layer.fadeIn = 0; layer.fadeOut = 0; }
    const job = await service.enqueue(a.browser, project, {});
    await service.claim(a.engine, { version });
    await assert.rejects(service.cancel(b.browser, job.id), /not found/);
    await assert.rejects(service.cancel(null, job.id), /not found/);
    const cancelled = await service.cancel(a.browser, job.id);
    assert.equal(cancelled.state, 'cancelled'); assert.equal(cancelled.message, 'Export cancelled.');
    assert.equal((await service.status(a.browser)).busy, false);
    assert.equal(JSON.parse(await readFile(path.join(data, 'renders', job.id, 'job.json'), 'utf8')).state, 'cancelled');
    await assert.rejects(service.update(a.engine, job.id, { progress: 60 }), error => error.status === 409 && /no longer assigned/.test(error.message));
    await assert.rejects(service.complete(a.engine, job.id, { file: 'Movies/FLOC Motion/Late.mp4', duration: 1 }), /no longer assigned/);
    assert.equal(job.state, 'cancelled'); assert.equal('file' in job, false);
    await assert.rejects(service.cancel(a.browser, job.id), error => error.status === 409);
    const next = await service.enqueue(a.browser, project, {});
    assert.equal((await service.claim(a.engine, { version })).id, next.id, 'the renderer can take the next export');
  } finally { await rm(data, { recursive: true, force: true }); }
});

test('a renderer result must carry the extension of the format the job asked for', async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'floc-personal-format-'));
  const jobs = new Map(), version = 'current';
  const service = createPersonalRenderers({ data, jobs, version, now: () => 100000 });
  try {
    const pairing = await service.startPairing();
    const credentials = await service.finishPairing({ code: pairing.code, name: 'Mac', version });
    const engine = await service.engine(`Bearer ${credentials.token}`), browser = await service.browser(rendererCookie(pairing.key, false));
    await service.claim(engine, { version });
    const project = demoProject(); project.duration = 1; for (const layer of project.layers) { layer.end = 1; layer.fadeIn = 0; layer.fadeOut = 0; }
    await assert.rejects(service.enqueue(browser, project, { format: 'mp4', transparent: true }), /require MOV or PNG/);
    for (const [format, wrong, right] of [['mov', 'Movies/FLOC Motion/Clip.mp4', 'Movies/FLOC Motion/Clip.mov'], ['png', 'Movies/FLOC Motion/Clip.mov', 'Movies/FLOC Motion/Clip.zip'], ['mp4', 'Movies/FLOC Motion/Clip.zip', 'Movies/FLOC Motion/Clip.MP4']]) {
      const job = await service.enqueue(browser, project, { format, transparent: format !== 'mp4' });
      assert.equal(job.format, format);
      assert.equal((await service.claim(engine, { version })).settings.format, format);
      await assert.rejects(service.complete(engine, job.id, { file: wrong, duration: 1 }), error => error.status === 400);
      assert.equal(job.state, 'rendering');
      await service.complete(engine, job.id, { file: right, duration: 1 });
      assert.equal(job.state, 'done'); assert.equal(job.file, right);
    }
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

test('updater renderers update their engine when outdated or asked, and old renderers keep the original contract', async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'floc-personal-update-'));
  let clock = 100000;
  const jobs = new Map(), version = 'b'.repeat(64), old = 'a'.repeat(64);
  const service = createPersonalRenderers({ data, jobs, version, now: () => clock });
  const update = requested => ({ update: { version, manifest: '/renderer/engine/manifest.json', requested } });
  const ready = { state: 'ready' }, stored = id => readFile(path.join(data, 'renders', id, 'job.json'), 'utf8').then(JSON.parse);
  async function connect(name) {
    const pairing = await service.startPairing();
    const credentials = await service.finishPairing({ code: pairing.code, name, version });
    return { browser: await service.browser(rendererCookie(pairing.key, false)), engine: await service.engine(`Bearer ${credentials.token}`) };
  }
  try {
    const project = demoProject(); project.duration = 1; for (const layer of project.layers) { layer.end = 1; layer.fadeIn = 0; layer.fadeOut = 0; }
    const mac = await connect('Mac');
    assert.deepEqual(service.identity(mac.engine), { id: mac.engine.id, name: 'Mac' });
    assert.equal((await service.status(mac.browser)).online, false, 'identity does not check the renderer in');
    await assert.rejects(service.requestUpdate(null), error => error.status === 404);

    // An outdated updater renderer stays online, is told to update and never gets an export meanwhile.
    assert.deepEqual(await service.claim(mac.engine, { version: old, updater: 1, engine: ready }), update(false));
    let status = await service.status(mac.browser);
    assert.deepEqual([status.online, status.compatible, status.updater, status.engine, status.updateRequested], [true, false, true, { state: 'ready', message: '', target: '' }, false]);
    const waiting = await service.enqueue(mac.browser, project, {});
    assert.deepEqual([waiting.state, waiting.message], ['queued', 'Waiting for your renderer to update']);
    assert.deepEqual(await service.claim(mac.engine, { version: old, updater: 1, engine: { state: 'updating', target: version } }), update(false));
    assert.equal((await service.status(mac.browser)).engine.state, 'updating');
    assert.equal(waiting.state, 'queued');
    await assert.rejects(service.claim(mac.engine, { version: old, updater: 1, engine: { state: 'bogus' } }), error => error.status === 400);
    assert.equal((await service.claim(mac.engine, { version, updater: 1, engine: ready })).id, waiting.id, 'the updated engine takes the waiting export');
    await service.complete(mac.engine, waiting.id, { file: 'Movies/FLOC Motion/Waiting.mp4', duration: 1 });

    // Update now: the next check-in carries the request once, even when the engine is current.
    const requested = await service.requestUpdate(mac.browser);
    assert.equal(requested.updateRequested, true);
    const next = await service.enqueue(mac.browser, project, {});
    assert.deepEqual(await service.claim(mac.engine, { version, updater: 1, engine: ready }), update(true));
    assert.equal((await service.status(mac.browser)).updateRequested, false);
    assert.equal(await service.claim(mac.engine, { version, updater: 1, engine: { state: 'updating', target: version } }), null, 'no export starts while the engine updates');
    assert.equal((await service.claim(mac.engine, { version, updater: 1, engine: ready })).id, next.id);
    await service.complete(mac.engine, next.id, { file: 'Movies/FLOC Motion/Next.mp4', duration: 1 });

    // A failed update fails the exports that waited for it and blocks new ones until it recovers.
    await service.claim(mac.engine, { version: old, updater: 1, engine: ready });
    const [first, second] = [await service.enqueue(mac.browser, project, {}), await service.enqueue(mac.browser, project, {})];
    const failure = { state: 'failed', message: 'Reinstall the renderer to update its Node runtime.', target: version };
    assert.deepEqual(await service.claim(mac.engine, { version: old, updater: 1, engine: failure }), update(false));
    const expected = 'Your renderer could not update: Reinstall the renderer to update its Node runtime. Use Update now or reinstall.';
    for (const job of [first, second]) {
      assert.deepEqual([job.state, job.message], ['failed', expected]);
      assert.deepEqual([(await stored(job.id)).state, (await stored(job.id)).message], ['failed', expected]);
    }
    assert.equal((await service.status(mac.browser)).busy, false);
    await service.claim(mac.engine, { version: old, updater: 1, engine: { ...failure, message: failure.message + 'x'.repeat(600) } });
    assert.equal((await service.status(mac.browser)).engine.message.length, 500);
    await service.claim(mac.engine, { version: old, updater: 1, engine: failure });
    await assert.rejects(service.enqueue(mac.browser, project, {}), error => error.status === 409 && error.message === expected);
    assert.equal((await service.requestUpdate(mac.browser)).updateRequested, true);
    assert.deepEqual(await service.claim(mac.engine, { version: old, updater: 1, engine: failure }), update(true));
    assert.equal((await service.enqueue(mac.browser, project, {}).catch(error => error)).status, 409);
    assert.deepEqual(await service.claim(mac.engine, { version: old, updater: 1, engine: { state: 'updating', target: version } }), update(false));
    assert.equal((await service.enqueue(mac.browser, project, {})).message, 'Waiting for your renderer to update');

    // Renderers installed before the updater: unchanged errors and no update instructions.
    const windows = await connect('Windows');
    await assert.rejects(service.claim(windows.engine, { version: old }), error => error.status === 409 && error.message === 'Update your renderer to match the editor.');
    status = await service.status(windows.browser);
    assert.deepEqual([status.online, status.compatible, status.updater, status.engine], [true, false, false, null]);
    await assert.rejects(service.enqueue(windows.browser, project, {}), error => error.status === 409 && error.message === 'Update your renderer before exporting.');
    await assert.rejects(service.requestUpdate(windows.browser), error => error.status === 409);
    assert.equal(await service.claim(windows.engine, { version }), null);
    const legacy = await service.enqueue(windows.browser, project, {});
    assert.equal(legacy.message, 'Waiting for your renderer');
    assert.equal((await service.claim(windows.engine, { version })).id, legacy.id);
    const reconnecting = await service.startPairing();
    await assert.rejects(service.requestUpdate(await service.browser(rendererCookie(reconnecting.key, false))), error => error.status === 409);
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
