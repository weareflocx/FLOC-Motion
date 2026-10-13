import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../server/process.mjs';

test('subprocess timeouts remain explicit and nonzero exits retain diagnostics', async () => {
  await assert.rejects(run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 100 }), /timed out after 0.1s/);
  await assert.rejects(run(process.execPath, ['-e', 'console.error("Broken media");process.exit(1)']), /Broken media/);
});

test('aborted subprocesses are terminated, escalating to SIGKILL, and reject as cancelled', async () => {
  await assert.rejects(run(process.execPath, ['-e', ''], { signal: AbortSignal.abort() }), { name: 'AbortError' });
  for (const script of ['setInterval(() => {}, 1000)', 'process.on("SIGTERM", () => {});setInterval(() => {}, 1000)']) {
    const controller = new AbortController(), started = Date.now();
    const pending = run(process.execPath, ['-e', script], { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(pending, { name: 'AbortError', message: /cancelled/ });
    assert.ok(Date.now() - started < 4000);
  }
});
