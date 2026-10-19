import test from 'node:test';
import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { root } from '../server/runtime-config.mjs';

const A = 'a'.repeat(64), B = 'b'.repeat(64);
const exists = target => access(target).then(() => true, () => false);

// Engines that report each run. A switches to B once (as the updater does, then exit 75);
// B never starts successfully.
const engineA = `import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
const home = process.env.FLOC_RENDERER_HOME;
appendFileSync(home + '/runs.log', 'A ' + process.argv[2] + '\\n');
if (!existsSync(home + '/switched')) {
  writeFileSync(home + '/switched', '');
  writeFileSync(home + '/current.json', JSON.stringify({ version: '${B}', previous: '${A}' }));
  process.exit(75);
}
process.on('SIGTERM', () => { appendFileSync(home + '/runs.log', 'A stopped\\n'); process.exit(0); });
setInterval(() => {}, 1000);
`;
const engineB = `import { appendFileSync } from 'node:fs';
appendFileSync(process.env.FLOC_RENDERER_HOME + '/runs.log', 'B\\n');
process.exit(1);
`;

function launch(home, args = []) {
  const child = spawn(process.execPath, [path.join(home, 'launcher.mjs'), ...args], { cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; });
  const exit = new Promise(resolve => child.on('exit', code => resolve(code)));
  return { child, exit, output: () => output };
}
async function until(check, ms = 20000) {
  const deadline = Date.now() + ms;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the launcher.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

test('launcher switches engines on exit 75 and restores the previous one after a crash loop', { timeout: 60000 }, async t => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'floc-launcher-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  await cp(path.join(root, 'scripts/renderer-launcher.mjs'), path.join(home, 'launcher.mjs'));
  for (const [version, source] of [[A, engineA], [B, engineB]]) {
    await mkdir(path.join(home, 'engines', version, 'scripts'), { recursive: true });
    await writeFile(path.join(home, 'engines', version, 'scripts/render-worker.mjs'), source);
  }
  await writeFile(path.join(home, 'current.json'), JSON.stringify({ version: A, previous: null }));
  const runs = () => readFile(path.join(home, 'runs.log'), 'utf8').catch(() => '');
  const launcher = launch(home);
  t.after(() => launcher.child.kill('SIGKILL'));
  await until(async () => (await runs()).split('\n').filter(line => line.startsWith('A ')).length === 2);
  const config = path.join(home, '.data/render-worker/config.json');
  assert.equal(await runs(), `A ${config}\nB\nB\nB\nA ${config}\n`, 'restarts immediately on 75, rolls back after three failures');
  assert.deepEqual(JSON.parse(await readFile(path.join(home, 'current.json'), 'utf8')), { version: A, previous: null, failed: B });
  assert.match(await readFile(path.join(home, '.data/render-worker/launcher.log'), 'utf8'), /Restored engine a{12} after repeated failures/);
  assert.equal(await readFile(path.join(home, '.data/render-worker/launcher.pid'), 'utf8'), String(launcher.child.pid));

  const second = launch(home);
  assert.equal(await second.exit, 0);
  assert.match(second.output(), /already running/);

  if (process.platform !== 'win32') {
    launcher.child.kill('SIGTERM');
    assert.equal(await launcher.exit, 0, launcher.output());
    assert.match(await runs(), /A stopped\n$/, 'the stop signal reaches the engine');
    assert.equal(await exists(path.join(home, '.data/render-worker/launcher.pid')), false);
  }
});

test('a stale launcher.pid naming another user\'s process does not block startup', { skip: process.platform === 'win32' || process.getuid?.() === 0, timeout: 30000 }, async t => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'floc-launcher-stale-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  await cp(path.join(root, 'scripts/renderer-launcher.mjs'), path.join(home, 'launcher.mjs'));
  await mkdir(path.join(home, 'engines', A, 'scripts'), { recursive: true });
  await writeFile(path.join(home, 'engines', A, 'scripts/render-worker.mjs'), `import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.FLOC_RENDERER_HOME + '/started', '');\nsetInterval(() => {}, 1000);\n`);
  await writeFile(path.join(home, 'current.json'), JSON.stringify({ version: A, previous: null }));
  await mkdir(path.join(home, '.data/render-worker'), { recursive: true });
  // pid 1 belongs to root: signalling it fails with EPERM, as for a recycled system pid.
  await writeFile(path.join(home, '.data/render-worker/launcher.pid'), '1');
  const launcher = launch(home);
  t.after(() => launcher.child.kill('SIGKILL'));
  await until(() => exists(path.join(home, 'started')));
  assert.equal(await readFile(path.join(home, '.data/render-worker/launcher.pid'), 'utf8'), String(launcher.child.pid));
  launcher.child.kill('SIGTERM');
  await launcher.exit;
});

test('launcher tools run from the current engine with the installation home', async t => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'floc-launcher-tools-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  await cp(path.join(root, 'scripts/renderer-launcher.mjs'), path.join(home, 'launcher.mjs'));
  await mkdir(path.join(home, 'engines', A, 'scripts'), { recursive: true });
  await writeFile(path.join(home, 'engines', A, 'scripts/renderer-autostart.mjs'), 'console.log(JSON.stringify({ home: process.env.FLOC_RENDERER_HOME, args: process.argv.slice(2) })); process.exit(3);\n');
  await writeFile(path.join(home, 'current.json'), JSON.stringify({ version: A, previous: null }));
  const stop = launch(home, ['stop']);
  assert.equal(await stop.exit, 3, 'the tool exit code is preserved');
  assert.deepEqual(JSON.parse(stop.output()), { home, args: ['--stop'] });
  const unknown = launch(home, ['bogus']);
  assert.equal(await unknown.exit, 2);
});
