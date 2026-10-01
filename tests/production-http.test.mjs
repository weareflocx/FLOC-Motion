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

test('production serves frontend bundles and uploaded media without mixing namespaces', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'floc-http-'));
  let child;
  try {
    await mkdir(path.join(folder, 'server'));
    for (const name of ['index.mjs', 'runtime-config.mjs', 'export.mjs', 'build-scene.mjs', 'card-media.mjs', 'template-store.mjs']) await copyFile(path.join(root, 'server', name), path.join(folder, 'server', name));
    for (const name of ['node_modules', 'src']) await symlink(path.join(root, name), path.join(folder, name));
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

  } finally {
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    await rm(folder, { recursive: true, force: true });
  }
});
