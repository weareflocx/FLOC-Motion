import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { root } from '../server/runtime-config.mjs';
import { createAuthStore } from '../server/auth-store.mjs';
import { createPersonalRenderers, rendererCookie } from '../server/personal-renderers.mjs';
import { rendererVersion } from '../server/renderer-version.mjs';
import { recoverInterruptedJobs, listJobs, startExport, cancelExport, jobs, EXPORT_QUEUE_LIMIT } from '../server/export.mjs';
import { RESTART_MESSAGE } from '../src/export-jobs.js';
import { demoProject } from '../src/project.js';

const stored = (data, id) => readFile(path.join(data, 'renders', id, 'job.json'), 'utf8').then(JSON.parse);
async function store(data, job) {
  await mkdir(path.join(data, 'renders', job.id), { recursive: true });
  await writeFile(path.join(data, 'renders', job.id, 'job.json'), JSON.stringify(job));
}
const record = (fields = {}) => ({ id: randomUUID(), state: 'done', progress: 100, message: 'MP4 ready', name: 'Clip', quality: 'high', resolution: '1080p', width: 1080, height: 1920, fps: 30, createdAt: new Date(Date.UTC(2026, 9, 1)).toISOString(), ...fields });

test('a restarted editor fails exports it left in flight and keeps every job history', async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'floc-recovery-'));
  let child;
  try {
    const auth = createAuthStore(data);
    const account = await auth.accept({ ...await auth.bootstrap('exports@example.com'), password: 'Export recovery password' }, 'test');
    const version = await rendererVersion();
    const renderers = createPersonalRenderers({ data, jobs: new Map(), version });
    async function pair(name) {
      const pairing = await renderers.startPairing();
      await renderers.finishPairing({ code: pairing.code, name, version });
      return { cookie: rendererCookie(pairing.key, false), id: pairing.key.split('.')[0] };
    }
    const mac = await pair('Mac'), windows = await pair('Windows');
    const at = minutes => new Date(Date.UTC(2026, 9, 1, 10, minutes)).toISOString();
    const local = record({ state: 'rendering', progress: 40, message: 'Rendering frames', createdAt: at(5) });
    const queued = record({ state: 'queued', progress: 0, message: 'Waiting for the Mac', createdAt: at(4) });
    const personal = record({ rendererId: mac.id, state: 'rendering', createdAt: at(3) });
    const other = record({ rendererId: windows.id, state: 'done', file: 'Videos/FLOC Motion/Other.mp4', createdAt: at(2) });
    const legacy = record({ url: '/exports/legacy/video.mp4', createdAt: at(1) });
    for (const job of [local, queued, personal, other, legacy]) await store(data, job);
    await writeFile(path.join(data, 'renders', 'notes.txt'), 'not a job');

    const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
    const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    child = spawn(process.execPath, [path.join(root, 'server/index.mjs')], { env: { ...process.env, NODE_ENV: 'production', PORT: String(port), FLOC_DATA_DIR: data, FLOC_PUBLIC_ORIGIN: '', FLOC_RENDER_WORKER_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const base = `http://127.0.0.1:${port}`;
    const request = (route, { cookie = '', ...options } = {}) => fetch(base + route, { ...options, headers: { Origin: base, Cookie: `floc_session=${account.token}${cookie ? `; ${cookie}` : ''}` } });
    let ready = false;
    for (let i = 0; i < 200 && !ready; i++) { try { ready = (await fetch(`${base}/api/health`)).ok; } catch { await new Promise(resolve => setTimeout(resolve, 50)); } }
    assert.equal(ready, true, 'editor starts');

    const polled = await (await request(`/api/exports/${local.id}`)).json();
    assert.equal(polled.state, 'failed', 'a local export does not poll forever after a restart');
    assert.equal(polled.message, RESTART_MESSAGE);
    assert.equal((await stored(data, queued.id)).state, 'failed');
    assert.equal((await (await request(`/api/exports/${personal.id}`, { cookie: mac.cookie })).json()).state, 'failed');
    assert.equal((await stored(data, other.id)).file, 'Videos/FLOC Motion/Other.mp4', 'finished jobs are untouched');
    assert.equal((await stored(data, legacy.id)).url, legacy.url);

    const listed = (await (await request('/api/exports', { cookie: mac.cookie })).json()).jobs;
    assert.deepEqual(listed.map(job => job.id), [local.id, queued.id, personal.id, legacy.id], 'newest first, without another computer’s exports');
    assert.equal(listed.find(job => job.id === legacy.id).url, legacy.url);
    assert.deepEqual((await (await request('/api/exports')).json()).jobs.map(job => job.id), [local.id, queued.id, legacy.id]);

    const ended = await request(`/api/exports/${local.id}/cancel`, { method: 'POST' });
    assert.equal(ended.status, 409);
    assert.match((await ended.json()).error, /already ended/);
    assert.equal((await request(`/api/exports/${personal.id}/cancel`, { method: 'POST', cookie: windows.cookie })).status, 404, 'another computer cannot cancel');
    assert.equal((await stored(data, local.id)).state, 'failed');
  } finally {
    child?.kill();
    if (child && child.exitCode === null) await once(child, 'exit');
    await rm(data, { recursive: true, force: true });
  }
});

test('recovery only rewrites unfinished jobs and survives unreadable entries', async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'floc-recover-'));
  try {
    assert.equal(await recoverInterruptedJobs(data), 0, 'no renders folder yet');
    const cancelled = record({ state: 'cancelled', message: 'Export cancelled.' }), running = record({ state: 'rendering' });
    for (const job of [cancelled, running]) await store(data, job);
    await mkdir(path.join(data, 'renders', randomUUID()));
    const corrupt = randomUUID(); await mkdir(path.join(data, 'renders', corrupt)); await writeFile(path.join(data, 'renders', corrupt, 'job.json'), '{');
    assert.equal(await recoverInterruptedJobs(data), 1);
    assert.equal((await stored(data, cancelled.id)).state, 'cancelled');
    assert.deepEqual(await stored(data, running.id), { ...running, state: 'failed', message: RESTART_MESSAGE });
  } finally { await rm(data, { recursive: true, force: true }); }
});

test('recent exports list unfinished jobs in queue order, then twenty finished ones newest first, hiding other renderers', async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'floc-list-'));
  try {
    const mine = randomUUID(), theirs = randomUUID();
    const jobs = Array.from({ length: 24 }, (_, index) => record({ createdAt: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString() }));
    for (const job of jobs) await store(data, job);
    const live = new Map([[jobs[23].id, { ...jobs[23], state: 'rendering', progress: 50 }]]);
    const own = record({ rendererId: mine, createdAt: new Date(Date.UTC(2026, 9, 2)).toISOString(), file: 'Movies/FLOC Motion/Mine.mov', format: 'mov', transparent: true });
    const foreign = record({ rendererId: theirs, createdAt: new Date(Date.UTC(2026, 9, 3)).toISOString() });
    live.set(own.id, own); live.set(foreign.id, foreign);
    // Queued in this order within one millisecond: the list keeps their creation order, not timestamp ties.
    const at = new Date(Date.UTC(2026, 9, 4)).toISOString();
    const waiting = ['First', 'Second', 'Third'].map(name => record({ name, state: 'queued', progress: 0, createdAt: at }));
    const ownWaiting = record({ name: 'Mine queued', rendererId: mine, state: 'queued', progress: 0, createdAt: at });
    for (const job of [waiting[0], ownWaiting, waiting[1], waiting[2]]) live.set(job.id, job);
    const listed = await listJobs(data, live, mine);
    assert.equal(listed.length, 25);
    assert.deepEqual(listed.slice(0, 5).map(job => [job.name, job.state, job.position]), [['Clip', 'rendering', undefined], ['First', 'queued', 1], ['Mine queued', 'queued', 1], ['Second', 'queued', 2], ['Third', 'queued', 3]], 'each queue numbers its own waiting exports');
    assert.equal(listed[0].progress, 50, 'live progress wins over the persisted record');
    assert.equal(listed[5].id, own.id); assert.equal(listed[5].file, own.file);
    assert.equal(listed[5].format, 'mov'); assert.equal(listed[5].transparent, true, 'recent exports report their format');
    assert.equal(listed[6].id, jobs[22].id, 'finished jobs follow, newest first');
    assert.ok(!listed.some(job => job.id === foreign.id));
    assert.ok(listed.every(job => !('rendererId' in job) && !('project' in job)));
    assert.ok(!(await listJobs(data, live)).some(job => [own.id, ownWaiting.id].includes(job.id)), 'browsers without a renderer see shared exports only');
  } finally { await rm(data, { recursive: true, force: true }); }
});

test('local exports wait in a FIFO queue; a waiting export cancels without running and the queue is capped', async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'floc-queue-'));
  const previous = process.env.FLOC_DATA_DIR;
  process.env.FLOC_DATA_DIR = data;
  try {
    // Missing assets fail each export quickly once it starts, without rendering.
    const project = name => ({ ...demoProject(), name, images: [{ id: 'missing', name: 'Missing', src: '/assets/12345678-1234-1234-1234-123456789abc.mp4' }] });
    const [first, second, third] = [await startExport(project('First')), await startExport(project('Second')), await startExport(project('Third'))];
    assert.deepEqual([second.state, third.state], ['queued', 'queued']);
    assert.match(third.message, /Waiting/);
    assert.equal((await stored(data, third.id)).state, 'queued', 'a waiting export is on disk for restart recovery');
    assert.deepEqual((await listJobs(data, jobs)).slice(0, 3).map(job => [job.name, job.position]), [['First', undefined], ['Second', 1], ['Third', 2]]);
    assert.equal((await cancelExport(second.id)).state, 'cancelled');
    assert.equal((await stored(data, second.id)).state, 'cancelled');
    assert.equal((await listJobs(data, jobs)).find(job => job.id === third.id).position, 1);
    for (let i = 0; i < 2400 && !['failed', 'done'].includes(third.state); i++) await new Promise(resolve => setTimeout(resolve, 25));
    assert.deepEqual([first.state, second.state, third.state], ['failed', 'cancelled', 'failed'], 'the cancelled export never ran');
    assert.match(third.message, /not found|ENOENT|no such file/i);
    await assert.rejects(access(path.join(data, 'renders', second.id, 'render.log')), { code: 'ENOENT' });

    // A running export (a real render, which takes seconds) plus EXPORT_QUEUE_LIMIT waiting ones fill the queue.
    const filled = [await startExport({ ...demoProject(), name: 'Running' })];
    for (let i = 0; i < EXPORT_QUEUE_LIMIT; i++) filled.push(await startExport(project(`Fill ${i}`)));
    assert.ok(filled.slice(1).every(job => job.state === 'queued'));
    await assert.rejects(startExport(project('Overflow')), error => error.status === 429 && /Up to 50 exports/.test(error.message));
    for (const job of filled.reverse()) await cancelExport(job.id);
    assert.ok(filled.every(job => job.state === 'cancelled'));
  } finally {
    if (previous === undefined) delete process.env.FLOC_DATA_DIR; else process.env.FLOC_DATA_DIR = previous;
    // The cancelled render may still be removing its intermediates.
    await rm(data, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test('cancelling a local export frees the queue and a later failure never overwrites it', async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'floc-cancel-'));
  const previous = process.env.FLOC_DATA_DIR;
  process.env.FLOC_DATA_DIR = data;
  try {
    // A missing asset makes the background work fail after cancellation; the job must stay cancelled.
    const project = demoProject();
    project.images = [{ id: 'missing', name: 'Missing', src: '/assets/12345678-1234-1234-1234-123456789abc.mp4' }];
    const job = await startExport(project);
    assert.equal((await cancelExport(job.id)).state, 'cancelled');
    assert.equal((await stored(data, job.id)).state, 'cancelled');
    await assert.rejects(cancelExport(job.id), error => error.status === 409);
    const control = await startExport(project);
    // The control export builds the scene bundle first, which is slow while the full suite runs in parallel.
    for (let i = 0; i < 2400 && control.state !== 'failed'; i++) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(control.state, 'failed');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(job.state, 'cancelled'); assert.equal(job.message, 'Export cancelled.');
    assert.equal((await stored(data, job.id)).state, 'cancelled');
    assert.doesNotMatch(await readFile(path.join(data, 'renders', job.id, 'render.log'), 'utf8').catch(() => ''), /Export failed/);
  } finally {
    if (previous === undefined) delete process.env.FLOC_DATA_DIR; else process.env.FLOC_DATA_DIR = previous;
    await rm(data, { recursive: true, force: true });
  }
});

test('a running local export leaves a record that recovery fails after a crash', async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'floc-crash-')), crashed = await mkdtemp(path.join(tmpdir(), 'floc-crashed-'));
  const previous = process.env.FLOC_DATA_DIR;
  process.env.FLOC_DATA_DIR = data;
  try {
    const job = await startExport(demoProject());
    let persisted;
    for (let i = 0; i < 400 && !persisted; i++) { persisted = await stored(data, job.id).catch(() => null); if (!persisted) await new Promise(resolve => setTimeout(resolve, 25)); }
    await cancelExport(job.id);
    assert.ok(persisted && ['queued', 'rendering'].includes(persisted.state), 'the job is on disk before rendering finishes');
    // The disk as a crashed process would leave it: only the in-flight record survives.
    await store(crashed, persisted);
    assert.equal(await recoverInterruptedJobs(crashed), 1);
    const recovered = await stored(crashed, job.id);
    assert.deepEqual([recovered.state, recovered.message], ['failed', RESTART_MESSAGE]);
  } finally {
    if (previous === undefined) delete process.env.FLOC_DATA_DIR; else process.env.FLOC_DATA_DIR = previous;
    await Promise.all([data, crashed].map(folder => rm(folder, { recursive: true, force: true })));
  }
});
