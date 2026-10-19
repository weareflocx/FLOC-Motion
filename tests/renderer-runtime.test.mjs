import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { checkRenderer, configureRenderer, connectRenderer, exportDirectory, installRendererBrowser, rendererDataDirectory, saveRenderedVideo } from '../scripts/renderer-runtime.mjs';

test('renderer saves collision-safe videos in the platform media directory', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'floc-exports-'));
  const source = path.join(folder, 'source.mp4'), destination = path.join(folder, 'saved');
  try {
    assert.equal(exportDirectory('darwin', '/Users/test'), path.join('/Users/test', 'Movies', 'FLOC Motion'));
    assert.equal(exportDirectory('win32', '/Users/test'), path.join('/Users/test', 'Videos', 'FLOC Motion'));
    const date = new Date(2026, 8, 30, 12, 34, 56);
    await writeFile(source, 'first');
    const first = await saveRenderedVideo(source, 'Test project', destination, date);
    await writeFile(source, 'second');
    const second = await saveRenderedVideo(source, 'Test project', destination, date);
    assert.equal(path.basename(first), 'Test project 2026-09-30 12.34.56.mp4');
    assert.equal(path.basename(second), 'Test project 2026-09-30 12.34.56 (2).mp4');
    assert.equal(await readFile(first, 'utf8'), 'first');
    assert.equal(await readFile(second, 'utf8'), 'second');
    const sanitized = await saveRenderedVideo(source, '/\\:*?"<>|\u0001', destination, date);
    assert.doesNotMatch(path.basename(sanitized), /[\/:*?"<>|\u0000-\u001f]/);
    const fallback = await saveRenderedVideo(source, ' . \u0001 ', destination, date);
    assert.match(path.basename(fallback), /^FLOC Motion export /);
    for (const reserved of ['CON', 'nul.txt', 'COM1', 'LPT9']) {
      const saved = await saveRenderedVideo(source, reserved, destination, date);
      assert.ok(path.basename(saved).startsWith(`_${reserved} `));
    }
    const unicode = await saveRenderedVideo(source, `${'a'.repeat(79)}😀tail`, destination, date);
    const unicodeBase = path.basename(unicode).split(' 2026-')[0];
    assert.equal(Array.from(unicodeBase).length, 80);
    assert.match(path.basename(unicode), /😀 2026-09-30/);
    assert.doesNotMatch(path.basename(unicode), /�/);
    // MOV and PNG-sequence exports keep their own extension and the same collision-safe naming.
    for (const extension of ['mov', 'zip']) {
      const rendered = path.join(folder, `rendered.${extension}`);
      await writeFile(rendered, extension);
      assert.equal(path.basename(await saveRenderedVideo(rendered, 'Test project', destination, date)), `Test project 2026-09-30 12.34.56.${extension}`);
      assert.equal(path.basename(await saveRenderedVideo(rendered, 'Test project', destination, date)), `Test project 2026-09-30 12.34.56 (2).${extension}`);
    }
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('renderer preserves an explicit browser override and validates it before use', async () => {
  const env = { ...process.env };
  try {
    process.env.HYPERFRAMES_BROWSER_PATH = process.execPath;
    assert.equal(await installRendererBrowser(), process.execPath);
    assert.equal(await configureRenderer(), process.execPath);
    assert.equal(process.env.PRODUCER_BROWSER_GPU_MODE, 'hardware');
    await assert.rejects(configureRenderer({ browserPath: path.join(os.tmpdir(), 'missing-floc-browser') }), /ENOENT/);
    assert.equal(process.env.HYPERFRAMES_BROWSER_PATH, process.execPath);
  } finally { process.env = env; }
});

test('installer rejects a browser that hangs during the render version check', { skip: process.platform === 'win32' }, async () => {
  const env = { ...process.env };
  const folder = await mkdtemp(path.join(os.tmpdir(), 'floc-browser-'));
  const browser = path.join(folder, 'chrome');
  try {
    await writeFile(browser, '#!/usr/bin/env node\nif (process.argv[2] === "--version") setInterval(() => {}, 1000); else process.exit(0);\n', { mode: 0o755 });
    process.env.HYPERFRAMES_BROWSER_PATH = process.execPath;
    await assert.rejects(checkRenderer({ browserPath: browser }), /Run the latest installer again.*timed out after 5s/);
    assert.equal(process.env.HYPERFRAMES_BROWSER_PATH, process.execPath, 'failed browser is not selected');
  } finally { process.env = env; await rm(folder, { recursive: true, force: true }); }
});

test('installed renderers keep their data beside the launcher; direct runs keep it in the engine', () => {
  assert.equal(rendererDataDirectory('/engine', {}), path.join('/engine', '.data', 'render-worker'));
  assert.equal(rendererDataDirectory('/engine', { FLOC_RENDERER_HOME: '/renderer' }), path.join(path.resolve('/renderer'), '.data', 'render-worker'));
});

test('setup reuses a connection the editor still recognises and pairs otherwise', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'floc-setup-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const token = `${'1'.repeat(8)}-1111-1111-1111-${'1'.repeat(12)}.${'a'.repeat(64)}`, paired = `${'2'.repeat(8)}-2222-2222-2222-${'2'.repeat(12)}.${'b'.repeat(64)}`;
  let identity = 200;
  const requests = [];
  const server = createServer(async (request, response) => {
    let text = ''; for await (const chunk of request) text += chunk;
    requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization, body: text && JSON.parse(text) });
    response.writeHead(request.url === '/api/render-worker/identity' ? identity : 200, { 'Content-Type': 'application/json' });
    if (request.url === '/api/render-worker/identity') response.end(JSON.stringify(identity === 200 ? { id: 'device', name: 'Studio Mac' } : { error: 'Unauthorized' }));
    else response.end(JSON.stringify({ token: paired }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const configFile = path.join(folder, 'config.json');
  const save = () => writeFile(configFile, JSON.stringify({ origin, token, browserPath: '/old/browser' }));
  const config = async () => JSON.parse(await readFile(configFile, 'utf8'));
  let asked = 0;
  const options = { configFile, askCode: async () => { asked++; return 'abcde-12345'; }, browserPath: '/new/browser', version: async () => 'v'.repeat(64), name: 'Studio Mac' };

  await save();
  assert.deepEqual(await connectRenderer({ ...options, origin: null }), { reused: true, name: 'Studio Mac' });
  assert.deepEqual(await config(), { origin, token, browserPath: '/new/browser' }, 'only the browser is refreshed');
  assert.deepEqual(requests.map(request => [request.method, request.url, request.authorization]), [['GET', '/api/render-worker/identity', `Bearer ${token}`]]);
  assert.equal(asked, 0, 'no connection code is requested');

  identity = 401; requests.length = 0; await save();
  assert.deepEqual(await connectRenderer({ ...options, origin }), { reused: false });
  assert.equal(asked, 1);
  assert.deepEqual(requests.map(request => request.url), ['/api/render-worker/identity', '/api/renderers/connect']);
  assert.deepEqual(requests[1].body, { code: 'abcde-12345', version: 'v'.repeat(64), name: 'Studio Mac' });
  assert.deepEqual(await config(), { origin, token: paired, browserPath: '/new/browser' });

  identity = 200; requests.length = 0; await save();
  assert.deepEqual(await connectRenderer({ ...options, origin, code: '12345-abcde' }), { reused: false }, 'a code always pairs');
  assert.deepEqual(requests.map(request => request.url), ['/api/renderers/connect']);

  identity = 503; requests.length = 0; await save();
  await assert.rejects(connectRenderer({ ...options, origin }), /could not check the existing connection \(503\)/);
  assert.deepEqual(await config(), { origin, token, browserPath: '/old/browser' }, 'an unavailable editor never replaces the connection');
  assert.equal(asked, 1);
});
