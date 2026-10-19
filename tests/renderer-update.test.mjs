import test from 'node:test';
import assert from 'node:assert/strict';
import { access, appendFile, cp, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { root } from '../server/runtime-config.mjs';
import { rendererVersion } from '../server/renderer-version.mjs';
import { demoProject } from '../src/project.js';
import { NODE_MISMATCH, installDependencies, npmCli, readCurrent, updateEngine } from '../scripts/renderer-update.mjs';

const linkType = process.platform === 'win32' ? 'junction' : 'dir';
const exists = target => access(target).then(() => true, () => false);
const sha256 = data => createHash('sha256').update(data).digest('hex');
const OLD = 'a'.repeat(64), STALE = 'c'.repeat(64);

// The engine package layout from the current tree, as the editor build publishes it.
async function engineTree(directory, change = '') {
  await mkdir(directory, { recursive: true });
  for (const name of ['package.json', 'package-lock.json']) await cp(path.join(root, name), path.join(directory, name));
  const editor = path.join(root, 'src/editor');
  await cp(path.join(root, 'src'), path.join(directory, 'src'), { recursive: true, filter: name => name !== editor && !name.startsWith(editor + path.sep) && !name.endsWith('.jsx') });
  await cp(path.join(root, 'server'), path.join(directory, 'server'), { recursive: true });
  await mkdir(path.join(directory, 'scripts'));
  for (const name of ['render-worker.mjs', 'renderer-runtime.mjs', 'renderer-setup.mjs', 'renderer-update.mjs', 'renderer-autostart.mjs']) await cp(path.join(root, 'scripts', name), path.join(directory, 'scripts', name));
  for (const name of ['fonts', 'brand', 'demo']) await cp(path.join(root, 'public', name), path.join(directory, 'public', name), { recursive: true });
  if (change) await appendFile(path.join(directory, 'scripts/render-worker.mjs'), `\n// ${change}\n`);
  return directory;
}

// Dependency install shared by engines with this lockfile. The fingerprint needs the real
// esbuild; HyperFrames reports the running Node as its browser so no download happens.
async function dependencies(home, { ensureMs = 0 } = {}) {
  const lockSha = sha256(await readFile(path.join(root, 'package-lock.json')));
  const modules = path.join(home, 'deps', lockSha, 'node_modules');
  await mkdir(path.join(modules, 'hyperframes/bin'), { recursive: true });
  await symlink(path.join(root, 'node_modules/esbuild'), path.join(modules, 'esbuild'), linkType);
  await writeFile(path.join(modules, 'hyperframes/bin/hyperframes.mjs'), `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(path.join(home, 'browser-commands.log'))}, process.argv.slice(2).join(' ') + '\\n');\nif (process.argv[3] === 'ensure') await new Promise(resolve => setTimeout(resolve, ${ensureMs}));\nif (process.argv[3] === 'path') console.log(process.execPath);\n`);
  return { lockSha, modules };
}

async function editor(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
function json(response, status, value) { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); }
const body = async request => { let text = ''; for await (const chunk of request) text += chunk; return text ? JSON.parse(text) : null; };

// Serves one engine package and its manifest; `tamper` adjusts what is published.
async function publish(t, zip, version, tamper = {}) {
  const bytes = zip.toBuffer();
  const manifest = { version, file: `${version}.zip`, sha256: sha256(bytes), size: bytes.length, node: process.version, ...tamper };
  const hits = { manifest: 0, zip: 0 };
  const origin = await editor(t, (request, response) => {
    if (request.url === '/renderer/engine/manifest.json') { hits.manifest++; return json(response, 200, manifest); }
    if (request.url === `/renderer/engine/${version}.zip`) { hits.zip++; response.writeHead(200, { 'Content-Type': 'application/zip' }); return response.end(bytes); }
    json(response, 404, { error: 'Not found' });
  });
  return { origin, hits };
}

async function scratch(t, prefix) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

// An installed renderer on OLD, plus a leftover engine and dependency install to prune.
async function installed(t) {
  const home = await scratch(t, 'floc-renderer-home-');
  await mkdir(path.join(home, 'engines', OLD), { recursive: true });
  await cp(path.join(root, 'package-lock.json'), path.join(home, 'engines', OLD, 'package-lock.json'));
  await mkdir(path.join(home, 'engines', STALE), { recursive: true });
  await mkdir(path.join(home, 'deps', 'f'.repeat(64), 'node_modules'), { recursive: true });
  await writeFile(path.join(home, 'current.json'), JSON.stringify({ version: OLD, previous: null }));
  await mkdir(path.join(home, '.data/render-worker'), { recursive: true });
  const configFile = path.join(home, '.data/render-worker/config.json');
  await writeFile(configFile, JSON.stringify({ origin: 'http://127.0.0.1:1/', token: 'token', browserPath: '/previous/browser' }));
  return { home, configFile };
}

let built;
async function candidate(t) {
  built ??= (async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'floc-engine-candidate-'));
    await engineTree(directory, 'Candidate engine.');
    const zip = new AdmZip(); zip.addLocalFolder(directory);
    return { directory, zip, version: await rendererVersion(directory) };
  })();
  const result = await built;
  t.after(() => rm(result.directory, { recursive: true, force: true }).then(() => { built = undefined; }));
  return result;
}

test('an idle renderer downloads, verifies and switches to the published engine', async t => {
  const { zip, version } = await candidate(t);
  const { home, configFile } = await installed(t);
  const { lockSha, modules } = await dependencies(home);
  const { origin, hits } = await publish(t, zip, version);
  // A missing npm proves the existing dependency install is reused.
  const result = await updateEngine({ home, origin, target: version, configFile, npm: path.join(home, 'missing-npm-cli.js') });
  assert.deepEqual(result, { version, previous: OLD });
  assert.deepEqual(JSON.parse(await readFile(path.join(home, 'current.json'), 'utf8')), { version, previous: OLD });
  const engine = path.join(home, 'engines', version);
  assert.equal(await realpath(path.join(engine, 'node_modules')), await realpath(modules));
  assert.equal(await rendererVersion(engine), version, 'installed engine keeps the published fingerprint');
  assert.equal(JSON.parse(await readFile(configFile, 'utf8')).browserPath, process.execPath);
  assert.equal(JSON.parse(await readFile(configFile, 'utf8')).token, 'token', 'the connection is kept');
  assert.match(await readFile(path.join(home, 'browser-commands.log'), 'utf8'), /^browser ensure\nbrowser path\n$/);
  assert.deepEqual((await readdir(path.join(home, 'engines'))).sort(), [OLD, version].sort(), 'staging and unreferenced engines are removed');
  assert.deepEqual(await readdir(path.join(home, 'deps')), [lockSha]);
  assert.deepEqual(hits, { manifest: 1, zip: 1 });
  assert.deepEqual(await updateEngine({ home, origin, target: version, configFile }), { version, previous: OLD, unchanged: true });
  assert.equal(hits.zip, 1, 'an installed engine is not downloaded again');
});

test('tampered, unsafe or incompatible engine packages leave the current engine untouched', async t => {
  const { zip, version } = await candidate(t);
  const cases = [
    ['checksum mismatch', zip, { sha256: 'e'.repeat(64) }, /failed verification/],
    ['size mismatch', zip, { size: zip.toBuffer().length + 1 }, /incomplete/],
    ['newer Node runtime', zip, { node: 'v99.0.0' }, new RegExp(NODE_MISMATCH.replace('.', '\\.'))],
    ['different engine version', zip, { version: 'd'.repeat(64), file: `${'d'.repeat(64)}.zip` }, /different engine/]
  ];
  const traversal = new AdmZip(zip.toBuffer());
  traversal.addFile('src/escape.txt', Buffer.from('outside'));
  traversal.getEntry('src/escape.txt').entryName = '../escape.txt';
  cases.push(['path traversal', traversal, {}, /Unsafe engine package entry: \.\.\/escape\.txt/]);
  const absolute = new AdmZip(zip.toBuffer());
  absolute.addFile('src/absolute.txt', Buffer.from('outside'));
  absolute.getEntry('src/absolute.txt').entryName = '/tmp/floc-absolute.txt';
  cases.push(['absolute path', absolute, {}, /Unsafe engine package entry/]);
  const link = new AdmZip(zip.toBuffer());
  link.addFile('src/link.js', Buffer.from('/etc/passwd'));
  link.getEntry('src/link.js').attr = (0o120777 << 16) >>> 0;
  cases.push(['symlink entry', link, {}, /Unsafe engine package entry: src\/link\.js/]);
  const extra = new AdmZip(zip.toBuffer());
  extra.addFile('node_modules/hyperframes/index.js', Buffer.from('export {}'));
  cases.push(['entry outside the engine layout', extra, {}, /Unexpected engine package entry/]);
  for (const [name, archive, tamper, error] of cases) {
    const { home, configFile } = await installed(t);
    await dependencies(home);
    const { origin, hits } = await publish(t, archive, version, tamper);
    const config = await readFile(configFile, 'utf8');
    await assert.rejects(updateEngine({ home, origin, target: version, configFile }), error, name);
    assert.deepEqual(await readCurrent(home), { version: OLD, previous: null }, name);
    assert.equal(await readFile(configFile, 'utf8'), config, name);
    assert.deepEqual((await readdir(path.join(home, 'engines'))).sort(), [OLD, STALE].sort(), `${name}: no staging is left behind`);
    assert.equal(await exists(path.join(home, 'escape.txt')), false, name);
    assert.equal(await exists(path.join(home, 'engines', 'escape.txt')), false, name);
    if (name === 'newer Node runtime') assert.equal(hits.zip, 0, 'an incompatible engine is never downloaded');
  }
});

test('the installer step installs the bundled engine and retires the single-folder layout', async t => {
  const { home } = await installed(t);
  await rm(path.join(home, 'current.json'));
  await rm(path.join(home, 'engines'), { recursive: true });
  for (const name of ['src', 'server', 'scripts', 'public', 'node_modules/hyperframes']) await mkdir(path.join(home, name), { recursive: true });
  for (const name of ['package.json', 'package-lock.json']) await cp(path.join(root, name), path.join(home, name));
  await writeFile(path.join(home, 'src/scene.js'), '// Legacy engine.\n');
  await writeFile(path.join(home, '.data/render-worker/worker.log'), 'diagnostics');
  const source = await engineTree(path.join(await scratch(t, 'floc-installer-'), 'FLOC Motion Renderer'));
  await cp(path.join(root, 'scripts/renderer-launcher.mjs'), path.join(source, 'launcher.mjs'));
  const { modules } = await dependencies(home);
  const version = await rendererVersion(source);
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(source, 'scripts/renderer-update.mjs'), '--install-local', source, '--home', home], { stdio: ['ignore', 'pipe', 'pipe'] });
    let text = ''; child.stdout.on('data', chunk => { text += chunk; }); child.stderr.on('data', chunk => { text += chunk; });
    child.on('exit', code => code === 0 ? resolve(text) : reject(new Error(text)));
  });
  assert.match(output, new RegExp(`Engine installed: ${version.slice(0, 12)}`));
  assert.deepEqual(JSON.parse(await readFile(path.join(home, 'current.json'), 'utf8')), { version, previous: null });
  assert.equal(await realpath(path.join(home, 'engines', version, 'node_modules')), await realpath(modules));
  assert.equal(await readFile(path.join(home, 'launcher.mjs'), 'utf8'), await readFile(path.join(root, 'scripts/renderer-launcher.mjs'), 'utf8'));
  for (const name of ['src', 'server', 'scripts', 'public', 'package.json', 'package-lock.json', 'node_modules']) assert.equal(await exists(path.join(home, name)), false, `legacy ${name} removed`);
  assert.equal(await readFile(path.join(home, '.data/render-worker/worker.log'), 'utf8'), 'diagnostics', '.data is preserved');
  assert.ok(await exists(path.join(home, '.data/render-worker/config.json')));
  assert.ok(await exists(path.join(source, 'src/scene.js')), 'the extracted package is left intact');
});

function startWorker(script, config, env) {
  const child = spawn(process.execPath, [script, config], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; });
  const exit = new Promise(resolve => child.on('exit', code => resolve(code)));
  return { child, exit, output: () => output };
}
// A copy of the current engine with the repository's dependencies, as engines/<version>.
async function runnableEngine(directory) {
  await engineTree(directory);
  await symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), linkType);
  return directory;
}

test('an installed worker finishes its job before updating, then exits for the launcher', { timeout: 120000 }, async t => {
  const { zip, version } = await candidate(t);
  const home = await scratch(t, 'floc-worker-home-');
  const old = await rendererVersion(await runnableEngine(path.join(home, 'engines', 'staging-copy')));
  await rename(path.join(home, 'engines', 'staging-copy'), path.join(home, 'engines', old));
  await writeFile(path.join(home, 'current.json'), JSON.stringify({ version: old, previous: null }));
  // Browser preparation outlasts the claim interval, so claims report the update.
  await dependencies(home, { ensureMs: 7000 });
  const bytes = zip.toBuffer();
  const events = [], claims = [];
  const jobId = randomUUID();
  const face = { id: randomUUID(), family: 'Test Sans', weight: 400, style: 'normal', ext: 'woff2' };
  const origin = await editor(t, async (request, response) => {
    const url = request.url;
    if (url === '/api/render-worker/claim') {
      const claim = await body(request); claims.push(claim); events.push('claim');
      if (claims.length === 1) return json(response, 200, { id: jobId, project: demoProject(), settings: {}, fonts: [face] });
      return json(response, 200, { update: { version, manifest: '/renderer/engine/manifest.json', requested: false } });
    }
    if (url.startsWith('/fonts/workspace/')) {
      events.push('font started');
      // The job stays active while its font downloads.
      await new Promise(resolve => setTimeout(resolve, 1500));
      events.push('font failed');
      return json(response, 500, { error: 'Unavailable' });
    }
    if (url === `/api/render-worker/${jobId}/progress`) {
      const update = await body(request);
      if (update.state === 'failed') events.push('job failed');
      return json(response, 200, {});
    }
    if (url === '/renderer/engine/manifest.json') { events.push('manifest'); return json(response, 200, { version, file: `${version}.zip`, sha256: sha256(bytes), size: bytes.length, node: process.version }); }
    if (url === `/renderer/engine/${version}.zip`) { response.writeHead(200); return response.end(bytes); }
    json(response, 404, { error: 'Not found' });
  });
  const config = path.join(home, '.data/render-worker/config.json');
  await mkdir(path.dirname(config), { recursive: true });
  await writeFile(config, JSON.stringify({ origin: `${origin}/`, token: `${randomUUID()}.${'b'.repeat(64)}`, browserPath: process.execPath }));
  const worker = startWorker(path.join(home, 'engines', old, 'scripts/render-worker.mjs'), config, { FLOC_RENDERER_HOME: home });
  t.after(() => worker.child.kill('SIGKILL'));
  const code = await Promise.race([worker.exit, new Promise(resolve => setTimeout(() => resolve('timeout'), 100000).unref())]);
  assert.equal(code, 75, worker.output());
  assert.deepEqual(claims[0], { version: old, updater: 1, engine: { state: 'ready' } });
  assert.deepEqual(events.slice(0, 5), ['claim', 'font started', 'font failed', 'job failed', 'claim'], 'no update starts while the job is active');
  assert.equal(events[5], 'manifest');
  assert.ok(claims.some(claim => claim.engine.state === 'updating' && claim.engine.target === version), 'claims continue while updating');
  assert.deepEqual(JSON.parse(await readFile(path.join(home, 'current.json'), 'utf8')), { version, previous: old });
  assert.match(await readFile(path.join(home, '.data/render-worker/worker.log'), 'utf8'), /Engine update installed; restarting\./);
  assert.equal(await exists(path.join(home, '.data/render-worker/worker.pid')), false);
  assert.equal(await exists(path.join(home, 'engines', old, '.data/render-worker')), false, 'renderer data stays outside the engine');
});

test('a worker started directly keeps the legacy claim and never updates itself', { timeout: 60000 }, async t => {
  const engine = await runnableEngine(path.join(await scratch(t, 'floc-direct-worker-'), 'engine'));
  const claims = [];
  let manifest = 0;
  const origin = await editor(t, async (request, response) => {
    if (request.url === '/api/render-worker/claim') { claims.push(await body(request)); return json(response, 200, { update: { version: 'e'.repeat(64), manifest: '/renderer/engine/manifest.json', requested: true } }); }
    if (request.url === '/renderer/engine/manifest.json') manifest++;
    json(response, 404, { error: 'Not found' });
  });
  const config = path.join(engine, '.data/render-worker/config.json');
  await mkdir(path.dirname(config), { recursive: true });
  await writeFile(config, JSON.stringify({ origin: `${origin}/`, token: `${randomUUID()}.${'b'.repeat(64)}`, browserPath: process.execPath }));
  const env = { ...process.env }; delete env.FLOC_RENDERER_HOME;
  const worker = spawn(process.execPath, [path.join(engine, 'scripts/render-worker.mjs'), config], { env, stdio: 'ignore' });
  const exit = new Promise(resolve => worker.on('exit', code => resolve(code)));
  t.after(() => worker.kill('SIGKILL'));
  while (claims.length < 2) await new Promise(resolve => setTimeout(resolve, 200));
  worker.kill('SIGTERM');
  assert.equal(await exit, 0);
  assert.deepEqual(claims[0], { version: await rendererVersion(engine) });
  assert.ok(claims.every(claim => Object.keys(claim).join() === 'version'));
  assert.equal(manifest, 0);
  assert.ok(await exists(path.join(engine, '.data/render-worker/worker.log')), 'direct runs keep their data in the checkout');
});

test('a new lockfile is installed once with the runtime npm and shared by later engines', async t => {
  const npm = await npmCli().catch(() => null);
  if (!npm) return t.skip('This Node installation has no bundled npm.');
  const home = await scratch(t, 'floc-deps-');
  const lock = { name: 'engine', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'engine', version: '1.0.0' } } };
  const engines = [];
  for (const name of ['first', 'second']) {
    const engine = path.join(home, 'engines', name);
    await mkdir(engine, { recursive: true });
    await writeFile(path.join(engine, 'package.json'), JSON.stringify({ name: 'engine', version: '1.0.0', private: true }));
    await writeFile(path.join(engine, 'package-lock.json'), JSON.stringify(lock));
    engines.push(engine);
  }
  const first = await installDependencies(home, engines[0]);
  assert.equal(first.reused, false);
  const second = await installDependencies(home, engines[1], { npm: path.join(home, 'missing-npm-cli.js') });
  assert.deepEqual(second, { lockSha: first.lockSha, reused: true });
  assert.deepEqual(await readdir(path.join(home, 'deps')), [first.lockSha], 'no partial install remains');
  for (const engine of engines) assert.equal(await realpath(path.join(engine, 'node_modules')), await realpath(path.join(home, 'deps', first.lockSha, 'node_modules')));
});

test('an installed worker reports a failed update, keeps its engine and retries on Update now', { timeout: 90000 }, async t => {
  const { zip, version } = await candidate(t);
  const home = await scratch(t, 'floc-worker-failed-');
  const old = await rendererVersion(await runnableEngine(path.join(home, 'engines', 'staging-copy')));
  await rename(path.join(home, 'engines', 'staging-copy'), path.join(home, 'engines', old));
  await writeFile(path.join(home, 'current.json'), JSON.stringify({ version: old, previous: null }));
  const bytes = zip.toBuffer();
  const claims = [];
  let manifests = 0;
  const origin = await editor(t, async (request, response) => {
    if (request.url === '/api/render-worker/claim') {
      claims.push(await body(request));
      return json(response, 200, { update: { version, manifest: '/renderer/engine/manifest.json', requested: claims.length === 3 } });
    }
    if (request.url === '/renderer/engine/manifest.json') { manifests++; return json(response, 200, { version, file: `${version}.zip`, sha256: 'e'.repeat(64), size: bytes.length, node: process.version }); }
    if (request.url === `/renderer/engine/${version}.zip`) { response.writeHead(200); return response.end(bytes); }
    json(response, 404, { error: 'Not found' });
  });
  const config = path.join(home, '.data/render-worker/config.json');
  await mkdir(path.dirname(config), { recursive: true });
  await writeFile(config, JSON.stringify({ origin: `${origin}/`, token: `${randomUUID()}.${'b'.repeat(64)}`, browserPath: process.execPath }));
  const worker = startWorker(path.join(home, 'engines', old, 'scripts/render-worker.mjs'), config, { FLOC_RENDERER_HOME: home });
  t.after(() => worker.child.kill('SIGKILL'));
  while (claims.length < 4) {
    assert.equal(worker.child.exitCode, null, worker.output());
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  worker.child.kill('SIGTERM');
  assert.equal(await worker.exit, 0, 'the current engine keeps running');
  const failed = { state: 'failed', message: 'The engine download failed verification.', target: version };
  assert.deepEqual(claims.slice(0, 4).map(claim => claim.engine), [{ state: 'ready' }, failed, failed, failed]);
  assert.equal(manifests, 2, 'a routine check-in does not retry; Update now does');
  assert.deepEqual(JSON.parse(await readFile(path.join(home, 'current.json'), 'utf8')), { version: old, previous: null });
});
