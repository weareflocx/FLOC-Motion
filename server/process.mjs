import { spawn } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';

export function run(command, args, options = {}, onData = () => {}) {
  const { timeoutMs = 20 * 60 * 1000, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...spawnOptions, env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1', HYPERFRAMES_SKIP_SKILLS: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1', HYPERFRAMES_NO_AUTO_INSTALL: '1', ...options.env } });
    let output = '', timedOut = false, killTimer;
    for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => {
      const text = stripVTControlCharacters(chunk.toString());
      output = (output + text).slice(-12000); onData(text);
    });
    const timer = setTimeout(() => {
      timedOut = true; child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2000); killTimer.unref();
    }, timeoutMs);
    const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); };
    child.on('error', error => { cleanup(); reject(error); });
    child.on('close', code => {
      cleanup();
      if (timedOut) reject(new Error(`${command} timed out after ${timeoutMs / 1000}s. ${output}`));
      else code === 0 ? resolve(output) : reject(new Error(output || `${command} failed (${code}).`));
    });
  });
}
