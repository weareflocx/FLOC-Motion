import { spawn } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';
const children = new Set();
export function terminateProcesses() { for (const child of children) child.kill('SIGTERM'); }

export function run(command, args, options = {}, onData = () => {}) {
  const { timeoutMs = 20 * 60 * 1000, signal, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(command));
    const child = spawn(command, args, { ...spawnOptions, env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1', HYPERFRAMES_SKIP_SKILLS: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1', HYPERFRAMES_NO_AUTO_INSTALL: '1', ...options.env } });
    children.add(child);
    let output = '', timedOut = false, aborted = false, killTimer;
    for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => {
      const text = stripVTControlCharacters(chunk.toString());
      output = (output + text).slice(-12000); onData(text);
    });
    const stop = () => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2000); killTimer.unref();
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const abort = () => { aborted = true; clearTimeout(timer); stop(); };
    signal?.addEventListener('abort', abort, { once: true });
    const cleanup = () => { children.delete(child); clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort); };
    child.on('error', error => { cleanup(); reject(aborted ? abortError(command) : error); });
    child.on('close', code => {
      cleanup();
      if (aborted) reject(abortError(command));
      else if (timedOut) reject(new Error(`${command} timed out after ${timeoutMs / 1000}s. ${output}`));
      else code === 0 ? resolve(output) : reject(new Error(output || `${command} failed (${code}).`));
    });
  });
}
function abortError(command) { return Object.assign(new Error(`${command} was cancelled.`), { name: 'AbortError', code: 'ABORT_ERR' }); }
