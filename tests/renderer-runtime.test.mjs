import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkRenderer, configureRenderer, exportDirectory, installRendererBrowser, saveRenderedVideo } from '../scripts/renderer-runtime.mjs';

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
