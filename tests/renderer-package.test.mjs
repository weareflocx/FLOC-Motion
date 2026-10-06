import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import AdmZip from 'adm-zip';
import { rendererVersion } from '../server/renderer-version.mjs';
import { root } from '../server/runtime-config.mjs';
import { run } from '../server/process.mjs';

test('distributed renderer matches the editor engine and contains no private data', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'floc-package-'));
  try {
    await run(process.execPath, [path.join(root, 'scripts/package-renderer.mjs')]);
    const zip = new AdmZip(path.join(root, 'dist/renderer/FLOC-Motion-Renderer.zip'));
    const names = zip.getEntries().map(entry => entry.entryName);
    assert.ok(names.includes('FLOC Motion Renderer/Install-Windows.cmd'));
    assert.ok(names.includes('FLOC Motion Renderer/Install-Mac.command'));
    assert.ok(names.includes('FLOC Motion Renderer/Repair-Mac.command'));
    assert.ok(!names.some(name => /(?:\.data|\.git|node_modules|assets|editor)\//.test(name)));
    const executable = zip.getEntry('FLOC Motion Renderer/Install-Mac.command');
    assert.ok((executable.attr >>> 16) & 0o111, 'Mac launcher retains executable permissions');
    assert.ok((zip.getEntry('FLOC Motion Renderer/Repair-Mac.command').attr >>> 16) & 0o111, 'Mac repair launcher retains executable permissions');
    zip.extractAllTo(folder);
    assert.equal(await rendererVersion(path.join(folder, 'FLOC Motion Renderer')), await rendererVersion());
  } finally { await rm(folder, { recursive: true, force: true }); }
});
