// Stable supervisor installed as RENDERER_HOME/launcher.mjs. It is never auto-updated,
// so it imports Node built-ins only and keeps no engine logic: it runs the engine named
// by current.json, restarts it, and restores the previous engine when a freshly
// switched one keeps crashing.
//   node launcher.mjs                 run the renderer (automatic startup uses this)
//   node launcher.mjs start|stop|uninstall|setup [...]   run the current engine's tools
import { spawn, execFileSync } from 'node:child_process';
import { appendFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RESTART_NOW = 75, TRIAL_FAILURES = 3, HEALTHY_MS = 60000, MAX_BACKOFF_MS = 60000;
const launcher = fileURLToPath(import.meta.url);
const home = path.dirname(launcher);
const data = path.join(home, '.data', 'render-worker');
const currentFile = path.join(home, 'current.json');
const pidFile = path.join(data, 'launcher.pid');
const env = { ...process.env, FLOC_RENDERER_HOME: home };

async function log(message) {
  console.log(message);
  const filename = path.join(data, 'launcher.log');
  try {
    if ((await stat(filename).catch(() => ({ size: 0 }))).size > 1e6) await rename(filename, `${filename}.previous`);
    await appendFile(filename, `${new Date().toISOString()} ${message}\n`);
  } catch {}
}
async function readCurrent() {
  const current = JSON.parse(await readFile(currentFile, 'utf8'));
  if (!/^[a-f0-9]{64}$/.test(current?.version || '')) throw new Error('current.json does not name an installed engine. Run the installer again.');
  return current;
}
async function writeCurrent(value) {
  const temporary = `${currentFile}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify(value));
  await rename(temporary, currentFile);
}
const engineScript = (version, name) => path.join(home, 'engines', version, 'scripts', name);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const command = process.argv[2] || 'run';
const tools = { start: ['renderer-autostart.mjs'], stop: ['renderer-autostart.mjs', '--stop'], uninstall: ['renderer-autostart.mjs', '--uninstall'], setup: ['renderer-setup.mjs'] };
if (command !== 'run') {
  if (!tools[command]) { console.error('Usage: launcher.mjs [run|start|stop|uninstall|setup]'); process.exit(2); }
  const [script, ...flags] = tools[command];
  const current = await readCurrent();
  const child = spawn(process.execPath, [engineScript(current.version, script), ...flags, ...process.argv.slice(3)], { cwd: home, env, stdio: 'inherit', windowsHide: true });
  child.on('error', error => { console.error(error.message); process.exit(1); });
  child.on('exit', code => process.exit(code ?? 1));
} else await supervise();

// A stale pid file may name an unrelated process after a restart, so the command line
// must also be the launcher. EPERM only means the pid exists under another user (for
// example a system service that reused it), so it still needs the command-line check.
function isLauncher(pid) {
  try { process.kill(pid, 0); } catch (cause) { if (cause.code !== 'EPERM') return false; }
  try {
    const commandLine = process.platform === 'win32'
      ? execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
      : execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 5000 });
    return commandLine.includes('launcher.mjs');
  } catch { return false; }
}
async function acquireLock() {
  await mkdir(data, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const handle = await open(pidFile, 'wx'); await handle.writeFile(String(process.pid)); await handle.close(); return true; }
    catch (cause) { if (cause.code !== 'EEXIST') throw cause; }
    const pid = Number(await readFile(pidFile, 'utf8').catch(() => ''));
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && isLauncher(pid)) return false;
    await rm(pidFile, { force: true });
  }
  return false;
}

async function supervise() {
  if (!await acquireLock()) { console.log('The renderer is already running.'); return; }
  let child = null, stopping = false;
  const release = async () => {
    const owner = await readFile(pidFile, 'utf8').catch(() => '');
    if (owner === String(process.pid)) await rm(pidFile, { force: true });
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    stopping = true;
    if (child) child.kill(signal); else release().then(() => process.exit(0));
  });
  // trial: the engine switched to by an update, until it stays up HEALTHY_MS.
  let trial = null, backoff = 1000;
  while (!stopping) {
    let current;
    try { current = await readCurrent(); }
    catch (error) { await log(`Cannot start the renderer: ${error.message}`); await release(); process.exit(1); }
    const started = Date.now();
    child = spawn(process.execPath, [engineScript(current.version, 'render-worker.mjs'), path.join(data, 'config.json')], { cwd: home, env, stdio: 'inherit', windowsHide: true });
    const code = await new Promise(resolve => { child.on('error', error => { log(`Cannot start the engine: ${error.message}`); resolve(1); }); child.on('exit', (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0))); });
    child = null;
    if (stopping) break;
    const ranMs = Date.now() - started;
    if (ranMs >= HEALTHY_MS) { trial = null; backoff = 1000; }
    if (code === RESTART_NOW) {
      const next = await readCurrent().catch(() => null);
      if (next && next.version !== current.version) { trial = { version: next.version, failures: 0 }; await log(`Engine switched to ${next.version.slice(0, 12)}.`); }
      continue;
    }
    if (trial?.version === current.version && code !== 0) {
      trial.failures++;
      await log(`Updated engine exited with code ${code} (${trial.failures}/${TRIAL_FAILURES}).`);
      if (trial.failures < TRIAL_FAILURES) { await sleep(1000); continue; }
      trial = null;
      if (current.previous) {
        await writeCurrent({ version: current.previous, previous: null, failed: current.version });
        await log(`Restored engine ${current.previous.slice(0, 12)} after repeated failures.`);
        backoff = 1000;
        continue;
      }
    }
    await log(`Renderer exited with code ${code}; restarting in ${backoff / 1000}s.`);
    await sleep(backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }
  await release();
  process.exit(0);
}
