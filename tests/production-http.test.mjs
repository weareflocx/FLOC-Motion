import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { demoProject, patchLayer } from '../src/project.js';
import { root } from '../server/runtime-config.mjs';
import { createAuthStore } from '../server/auth-store.mjs';
import { randomUUID } from 'node:crypto';
import { rendererVersion } from '../server/renderer-version.mjs';

test('production serves frontend bundles and uploaded media without mixing namespaces', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'floc-http-'));
  let child;
  try {
    await mkdir(path.join(folder, 'server'));
    for (const name of ['index.mjs', 'auth-store.mjs', 'draft-store.mjs', 'runtime-config.mjs', 'export.mjs', 'process.mjs', 'build-scene.mjs', 'card-media.mjs', 'card-frames.mjs', 'render-worker.mjs', 'template-store.mjs', 'asset-validation.mjs', 'asset-upload.mjs', 'personal-renderers.mjs', 'renderer-version.mjs']) await copyFile(path.join(root, 'server', name), path.join(folder, 'server', name));
    await copyFile(path.join(root, 'package-lock.json'), path.join(folder, 'package-lock.json'));
    for (const name of ['node_modules', 'src', 'scripts']) await symlink(path.join(root, name), path.join(folder, name));
    await mkdir(path.join(folder, 'dist/assets'), { recursive: true });
    await writeFile(path.join(folder, 'dist/index.html'), '<script src="/assets/index-test.js"></script>');
    await writeFile(path.join(folder, 'dist/assets/index-test.js'), 'window.testBundle = true;');
    await writeFile(path.join(folder, 'dist/assets/index-test.css'), 'body{color:white}');
    await mkdir(path.join(folder, '.data/assets'), { recursive: true });
    const auth = createAuthStore(path.join(folder, '.data'));
    const invitation = await auth.bootstrap('production-test@example.com');
    const account = await auth.accept({ ...invitation, password: 'Production test password' }, 'test');
    const authCookie = `floc_session=${account.token}`;
    const request = (url, options = {}) => fetch(url, { ...options, headers: { ...options.headers, Origin: options.headers?.Origin || new URL(url).origin, Cookie: authCookie + (options.headers?.Cookie ? '; ' + options.headers.Cookie : '') } });
    const draftId = randomUUID();
    const media = '12345678-1234-1234-1234-123456789012.png';
    await writeFile(path.join(folder, '.data/assets', media), 'uploaded-media');
    const socket = createServer();
    socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
    const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    child = spawn(process.execPath, [path.join(folder, 'server/index.mjs')], { env: { ...process.env, NODE_ENV: 'production', PORT: String(port), FLOC_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`, FLOC_DATA_DIR: path.join(folder, '.data') }, stdio: ['ignore', 'pipe', 'pipe'] });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await request(`http://127.0.0.1:${port}/api/health`)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(ready, true, 'production server starts');
    for (const [url, type, body] of [['/assets/index-test.js', 'text/javascript', 'window.testBundle = true;'], ['/assets/index-test.css', 'text/css', 'body{color:white}'], [`/assets/${media}`, 'image/png', 'uploaded-media']]) {
      const res = await request(`http://127.0.0.1:${port}${url}`);
      assert.equal(res.status, 200); assert.equal(res.headers.get('content-type'), type); assert.equal(await res.text(), body);
    }
    assert.equal((await request(`http://127.0.0.1:${port}/assets/missing.js`)).status, 404);
    const base = `http://127.0.0.1:${port}`;
    const original = await (await request(`${base}/api/drafts/${draftId}`)).json();
    const created = await request(`${base}/api/templates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Studio loop', tags: ['Brand'], project: demoProject() }) });
    assert.equal(created.status, 201);
    const entry = await created.json();
    assert.equal((await (await request(`${base}/api/templates`)).json()).templates[0].id, entry.id);
    assert.equal((await request(`${base}/api/templates/${entry.id}`, { method: 'PUT', headers: { Origin: 'https://untrusted.example' }, body: JSON.stringify({ name: 'Forbidden', tags: [] }) })).status, 403);
    const updated = await request(`${base}/api/templates/${entry.id}`, { method: 'PUT', body: JSON.stringify({ name: 'Renamed', tags: [] }) });
    assert.equal((await updated.json()).name, 'Renamed');
    assert.equal((await request(`${base}/api/templates/${entry.id}`, { method: 'DELETE' })).status, 200);
    assert.deepEqual(await (await request(`${base}/api/drafts/${draftId}`)).json(), original);
    assert.equal((await request(`${base}/assets/${media}`)).status, 200);
    const composition = await (await request(`${base}/api/templates`, { method: 'POST', body: JSON.stringify({ name: 'Working composition', tags: [], project: demoProject() }) })).json();
    const edited = patchLayer({ ...composition.project, name: 'Updated composition', duration: 15 }, 'carousel', { template: 'zoom-through', zoomRotation: 45 });
    const saved = await request(`${base}/api/templates/${composition.id}`, { method: 'PUT', body: JSON.stringify({ name: edited.name, project: edited, updatedAt: composition.updatedAt }) });
    assert.equal(saved.status, 200);
    const receipt = await saved.json();
    assert.equal(receipt.id, composition.id);
    const current = await (await request(`${base}/api/templates/${composition.id}`)).json();
    assert.equal(current.id, composition.id);
    assert.equal(current.project.duration, 15);
    assert.equal(current.project.layers.find(layer => layer.id === 'carousel').template, 'zoom-through');
    assert.equal(current.project.layers.find(layer => layer.id === 'carousel').zoomRotation, 45);
    assert.equal((await (await request(`${base}/api/templates`)).json()).templates[0].project.duration, 15);

    assert.equal((await request(`${base}/api/exports`, { method: 'POST', body: JSON.stringify({ project: demoProject() }) })).status, 503, 'public exports cannot fall back to somebody else’s Mac');
    const pairingResponse = await request(`${base}/api/renderers/pair`, { method: 'POST' });
    const cookie = pairingResponse.headers.get('set-cookie').split(';')[0];
    assert.match(pairingResponse.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    const pairing = await pairingResponse.json();
    const version = await rendererVersion(folder);
    const connected = await (await request(`${base}/api/renderers/connect`, { method: 'POST', body: JSON.stringify({ code: pairing.code, version, name: 'Test computer' }) })).json();
    const engineHeaders = { Authorization: `Bearer ${connected.token}` };
    assert.equal((await request(`${base}/api/render-worker/claim`, { method: 'POST', headers: engineHeaders, body: JSON.stringify({ version }) })).status, 200);
    const renderer = await (await request(`${base}/api/renderers/status`, { headers: { Cookie: cookie } })).json();
    assert.equal(renderer.online, true); assert.equal(renderer.compatible, true);
    const personalJob = await (await request(`${base}/api/exports`, { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify({ project: demoProject() }) })).json();
    assert.equal((await request(`${base}/api/exports/${personalJob.id}`)).status, 404);
    assert.equal((await request(`${base}/exports/${personalJob.id}/video.mp4`)).status, 404);
    assert.equal((await request(`${base}/api/exports/${personalJob.id}`, { headers: { Cookie: cookie } })).status, 200);
    const claimed = await (await request(`${base}/api/render-worker/claim`, { method: 'POST', headers: engineHeaders, body: JSON.stringify({ version }) })).json();
    assert.equal(claimed.id, personalJob.id);
    const result = await request(`${base}/api/render-worker/${personalJob.id}/result`, { method: 'POST', headers: engineHeaders, body: JSON.stringify({ file: 'Movies/FLOC Motion/Test.mp4', duration: 1 }) });
    assert.equal(result.status, 200);
    const finished = await (await request(`${base}/api/exports/${personalJob.id}`, { headers: { Cookie: cookie } })).json();
    assert.equal(finished.state, 'done');
    assert.equal(finished.file, 'Movies/FLOC Motion/Test.mp4');
    assert.equal('url' in finished, false);
    assert.equal((await fetch(`${base}/api/exports/${personalJob.id}`, { headers: engineHeaders })).status, 200, 'engine can check whether a retried result already completed');
    assert.equal((await request(`${base}/exports/${personalJob.id}/video.mp4`, { headers: { Cookie: cookie } })).status, 404);
    assert.equal((await request(`${base}/exports/${personalJob.id}/video.mp4`)).status, 404);
    assert.equal((await request(`${base}/api/renderers/pair`, { method: 'POST', headers: { Origin: 'https://untrusted.example' } })).status, 403);
    const stale = await request(`${base}/api/templates/${composition.id}`, { method: 'PUT', body: JSON.stringify({ project: demoProject(), updatedAt: composition.updatedAt }) });
    assert.equal(stale.status, 409);
    const draft = await request(`${base}/api/drafts/${draftId}`, { method: 'PUT', body: JSON.stringify({ project: patchLayer(demoProject(), 'carousel', { template: 'stack-shuffle' }), revision: original.revision }) });
    assert.equal(draft.status, 200);
    const currentDraft = await (await request(`${base}/api/drafts/${draftId}`)).json();
    assert.equal('composition' in currentDraft, false);
    assert.equal(currentDraft.project.layers.find(layer => layer.id === 'carousel').shuffleGap, 36);
    assert.equal(currentDraft.project.layers.find(layer => layer.id === 'carousel').template, 'stack-shuffle');
    const sweepDraft = await request(`${base}/api/drafts/${draftId}`, { method: 'PUT', body: JSON.stringify({ project: patchLayer(currentDraft.project, 'carousel', { template: 'sweep-reveal' }), revision: currentDraft.revision, composition: null }) });
    assert.equal(sweepDraft.status, 200);
    const savedSweep = (await (await request(`${base}/api/drafts/${draftId}`)).json()).project.layers.find(layer => layer.id === 'carousel');
    assert.equal(savedSweep.template, 'sweep-reveal');
    assert.equal(savedSweep.loopDuration, 10.2);
    assert.equal(savedSweep.motion.curve, 'glide');
    const sweepReceipt = await sweepDraft.json();
    const windowDraft = await request(`${base}/api/drafts/${draftId}`, { method: 'PUT', body: JSON.stringify({ project: patchLayer(currentDraft.project, 'carousel', { template: 'window-push' }), revision: sweepReceipt.revision, composition: null }) });
    assert.equal(windowDraft.status, 200);
    const savedWindow = (await (await request(`${base}/api/drafts/${draftId}`)).json()).project.layers.find(layer => layer.id === 'carousel');
    assert.equal(savedWindow.template, 'window-push');
    assert.equal(savedWindow.loopDuration, 7.2);
    assert.equal(savedWindow.windowZoom, .5);
    assert.equal(savedWindow.windowSpacing, 0);
    assert.equal((await (await request(`${base}/api/templates`)).json()).templates[0].project.duration, 15);

  } finally {
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    await rm(folder, { recursive: true, force: true });
  }
});
