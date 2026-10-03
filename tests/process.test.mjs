import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../server/process.mjs';

test('subprocess timeouts remain explicit and nonzero exits retain diagnostics', async () => {
  await assert.rejects(run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 100 }), /timed out after 0.1s/);
  await assert.rejects(run(process.execPath, ['-e', 'console.error("Broken media");process.exit(1)']), /Broken media/);
});
