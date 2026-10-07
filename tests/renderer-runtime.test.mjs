import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkRenderer, configureRenderer, installRendererBrowser } from '../scripts/renderer-runtime.mjs';

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
