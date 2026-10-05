import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { demoProject } from '../src/project.js';
import { root } from '../server/runtime-config.mjs';
import { rendererVersion } from '../server/renderer-version.mjs';

test('production serves frontend bundles and uploaded media without mixing namespaces', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'floc-http-'));
  let child;
  try {
    await mkdir(path.join(folder, 'server'));
    for (const name of ['index.mjs', 'runtime-config.mjs', 'export.mjs', 'process.mjs', 'build-scene.mjs', 'card-media.mjs', 'card-frames.mjs', 'render-worker.mjs', 'template-store.mjs', 'asset-validation.mjs', 'personal-renderers.mjs', 'renderer-version.mjs']) await copyFile(path.join(root, 'server', name), path.join(folder, 'server', name));
    await copyFile(path.join(root, 'package-lock.json'), path.join(folder, 'package-lock.json'));
    for (const name of ['node_modules', 'src', 'scripts']) await symlink(path.join(root, name), path.join(folder, name));
    await mkdir(path.join(folder, 'dist/assets'), { recursive: true });
    await writeFile(path.join(folder, 'dist/index.html'), '<script src="/assets/index-test.js"></script>');
    await writeFile(path.join(folder, 'dist/assets/index-test.js'), 'window.testBundle = true;');
    await writeFile(path.join(folder, 'dist/assets/index-test.css'), 'body{color:white}');
    await mkdir(path.join(folder, '.data/assets'), { recursive: true });
    const media = '12345678-1234-1234-1234-123456789012.png';
    await writeFile(path.join(folder, '.data/assets', media), 'uploaded-media');
    const socket = createServer();
    socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
    const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    child = spawn(process.execPath, [path.join(folder, 'server/index.mjs')], { env: { ...process.env, NODE_ENV: 'production', PORT: String(port), FLOC_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`, FLOC_DATA_DIR: path.join(folder, '.data') }, stdio: ['ignore', 'pipe', 'pipe'] });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(ready, true, 'production server starts');
    for (const [url, type, body] of [['/assets/index-test.js', 'text/javascript', 'window.testBundle = true;'], ['/assets/index-test.css', 'text/css', 'body{color:white}'], [`/assets/${media}`, 'image/png', 'uploaded-media']]) {
      const res = await fetch(`http://127.0.0.1:${port}${url}`);
      assert.equal(res.status, 200); assert.equal(res.headers.get('content-type'), type); assert.equal(await res.text(), body);
    }
    assert.equal((await fetch(`http://127.0.0.1:${port}/assets/missing.js`)).status, 404);
    const base = `http://127.0.0.1:${port}`;
    const original = await (await fetch(`${base}/api/project`)).json();
    const created = await fetch(`${base}/api/templates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Studio loop', tags: ['Brand'], project: demoProject() }) });
    assert.equal(created.status, 201);
    const entry = await created.json();
    assert.equal((await (await fetch(`${base}/api/templates`)).json()).templates[0].id, entry.id);
    assert.equal((await fetch(`${base}/api/templates/${entry.id}`, { method: 'PUT', headers: { Origin: 'https://untrusted.example' }, body: JSON.stringify({ name: 'Forbidden', tags: [] }) })).status, 403);
    const updated = await fetch(`${base}/api/templates/${entry.id}`, { method: 'PUT', body: JSON.stringify({ name: 'Renamed', tags: [] }) });
    assert.equal((await updated.json()).name, 'Renamed');
    assert.equal((await fetch(`${base}/api/templates/${entry.id}`, { method: 'DELETE' })).status, 200);
    assert.deepEqual(await (await fetch(`${base}/api/project`)).json(), original);
    assert.equal((await fetch(`${base}/assets/${media}`)).status, 200);
    const composition = await (await fetch(`${base}/api/templates`, { method: 'POST', body: JSON.stringify({ name: 'Working composition', tags: [], project: demoProject() }) })).json();
    const edited = { ...composition.project, name: 'Updated composition', duration: 15 };
    const saved = await fetch(`${base}/api/project`, { method: 'PUT', body: JSON.stringify({ project: edited, revision: original.revision, composition: { id: composition.id, updatedAt: composition.updatedAt } }) });
    assert.equal(saved.status, 200);
    const receipt = await saved.json();
    assert.equal(receipt.composition.id, composition.id);
    const current = await (await fetch(`${base}/api/project`)).json();
    assert.equal(current.composition.id, composition.id);
    assert.equal(current.project.duration, 15);
    assert.equal((await (await fetch(`${base}/api/templates`)).json()).templates[0].project.duration, 15);

    assert.equal((await fetch(`${base}/api/exports`, { method: 'POST', body: JSON.stringify({ project: demoProject() }) })).status, 503, 'public exports cannot fall back to somebody else’s Mac');
    const pairingResponse = await fetch(`${base}/api/renderers/pair`, { method: 'POST' });
    const cookie = pairingResponse.headers.get('set-cookie').split(';')[0];
    assert.match(pairingResponse.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    const pairing = await pairingResponse.json();
    const version = await rendererVersion(folder);
    const connected = await (await fetch(`${base}/api/renderers/connect`, { method: 'POST', body: JSON.stringify({ code: pairing.code, version, name: 'Test computer' }) })).json();
    const engineHeaders = { Authorization: `Bearer ${connected.token}` };
    assert.equal((await fetch(`${base}/api/render-worker/claim`, { method: 'POST', headers: engineHeaders, body: JSON.stringify({ version }) })).status, 200);
    const renderer = await (await fetch(`${base}/api/renderers/status`, { headers: { Cookie: cookie } })).json();
    assert.equal(renderer.online, true); assert.equal(renderer.compatible, true);
    const personalJob = await (await fetch(`${base}/api/exports`, { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify({ project: demoProject() }) })).json();
    assert.equal((await fetch(`${base}/api/exports/${personalJob.id}`)).status, 404);
    assert.equal((await fetch(`${base}/exports/${personalJob.id}/video.mp4`)).status, 404);
    assert.equal((await fetch(`${base}/api/exports/${personalJob.id}`, { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(`${base}/api/exports/${personalJob.id}`, { headers: engineHeaders })).status, 200, 'engine can check whether a retried upload already completed');
    assert.equal((await fetch(`${base}/api/renderers/pair`, { method: 'POST', headers: { Origin: 'https://untrusted.example' } })).status, 403);
    const stale = await fetch(`${base}/api/project`, { method: 'PUT', body: JSON.stringify({ project: demoProject(), revision: original.revision, composition: receipt.composition }) });
    assert.equal(stale.status, 409);
    const draft = await fetch(`${base}/api/project`, { method: 'PUT', body: JSON.stringify({ project: demoProject(), revision: receipt.revision, composition: null }) });
    assert.equal(draft.status, 200);
    assert.equal((await (await fetch(`${base}/api/project`)).json()).composition, null);
    assert.equal((await (await fetch(`${base}/api/templates`)).json()).templates[0].project.duration, 15);

  } finally {
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    await rm(folder, { recursive: true, force: true });
  }
});
