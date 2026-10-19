import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
    assert.ok(names.includes('FLOC Motion Renderer/launcher.mjs'), 'installers place the supervisor beside the engine');
    assert.ok(names.includes('FLOC Motion Renderer/scripts/renderer-update.mjs'));
    const executable = zip.getEntry('FLOC Motion Renderer/Install-Mac.command');
    assert.ok((executable.attr >>> 16) & 0o111, 'Mac launcher retains executable permissions');
    assert.ok((zip.getEntry('FLOC Motion Renderer/Repair-Mac.command').attr >>> 16) & 0o111, 'Mac repair launcher retains executable permissions');
    zip.extractAllTo(folder);
    assert.equal(await rendererVersion(path.join(folder, 'FLOC Motion Renderer')), await rendererVersion());
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('the engine package is the editor engine, verifiable through its manifest', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'floc-engine-'));
  try {
    await run(process.execPath, [path.join(root, 'scripts/package-renderer.mjs')]);
    const directory = path.join(root, 'dist/renderer/engine');
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
    assert.deepEqual(Object.keys(manifest).sort(), ['file', 'node', 'sha256', 'size', 'version']);
    assert.match(manifest.version, /^[a-f0-9]{64}$/);
    assert.equal(manifest.file, `${manifest.version}.zip`);
    assert.deepEqual(await readdir(directory).then(names => names.sort()), [manifest.file, 'manifest.json'].sort(), 'only the current package is published');
    const node = (await readFile(path.join(root, 'installers/Install-Mac.command'), 'utf8')).match(/^NODE_VERSION="(v[\d.]+)"$/m)[1];
    assert.equal(manifest.node, node);
    assert.match(await readFile(path.join(root, 'installers/Install-Windows.cmd'), 'utf8'), new RegExp(`^set "NODE_VERSION=${node.replace(/\./g, '\\.')}"\\r?$`, 'm'));
    const bytes = await readFile(path.join(directory, manifest.file));
    assert.equal(manifest.size, bytes.length);
    assert.equal(manifest.sha256, createHash('sha256').update(bytes).digest('hex'));

    const zip = new AdmZip(bytes);
    const names = zip.getEntries().map(entry => entry.entryName);
    assert.deepEqual([...new Set(names.map(name => name.split('/')[0]))].sort(), ['package-lock.json', 'package.json', 'public', 'scripts', 'server', 'src']);
    assert.deepEqual(names.filter(name => name.startsWith('scripts/') && !name.endsWith('/')).sort(), ['render-worker.mjs', 'renderer-autostart.mjs', 'renderer-runtime.mjs', 'renderer-setup.mjs', 'renderer-update.mjs'].map(name => `scripts/${name}`));
    assert.deepEqual(names.filter(name => name.startsWith('server/') && !name.endsWith('/')).sort(), ['build-scene.mjs', 'card-frames.mjs', 'card-media.mjs', 'export.mjs', 'json-store.mjs', 'process.mjs', 'renderer-version.mjs', 'runtime-config.mjs'].map(name => `server/${name}`));
    assert.deepEqual([...new Set(names.filter(name => name.startsWith('public/')).map(name => name.split('/')[1]))].filter(Boolean).sort(), ['brand', 'demo', 'fonts']);
    assert.ok(!names.some(name => name.startsWith('src/editor/') || name.endsWith('.jsx') || /(?:^|\/)(?:node_modules|\.data|\.git)\//.test(name)));
    assert.ok(names.every(name => !name.startsWith('/') && !name.split('/').includes('..')));
    zip.extractAllTo(folder);
    assert.equal(await rendererVersion(folder), manifest.version);
    assert.equal(manifest.version, await rendererVersion());
  } finally { await rm(folder, { recursive: true, force: true }); }
});
