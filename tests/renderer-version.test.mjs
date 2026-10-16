import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, copyFile, cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { rendererVersion } from '../server/renderer-version.mjs';
import { root } from '../server/runtime-config.mjs';

async function checkout(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'floc-renderer-version-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ['src', 'server', 'scripts']) await cp(path.join(root, name), path.join(directory, name), { recursive: true });
  await copyFile(path.join(root, 'package-lock.json'), path.join(directory, 'package-lock.json'));
  return directory;
}

test('editor-only changes do not invalidate an otherwise identical installed renderer', async t => {
  const directory = await checkout(t);
  const original = await rendererVersion(directory);
  for (const name of ['src/editor-controls.js', 'src/batch-variants.js', 'src/visual-alternatives.js']) {
    await appendFile(path.join(directory, name), '\n// Editor interaction changed.\n');
    assert.equal(await rendererVersion(directory), original, name);
  }
  await writeFile(path.join(directory, 'src/editor-only-feature.js'), 'export const label = "New editor feature";\n');
  await writeFile(path.join(directory, 'src/editor/unused-view.jsx'), '<unparsed editor syntax');
  assert.equal(await rendererVersion(directory), original, 'new unrelated source files must not force reinstallation');
});

test('scene, validation, export and worker changes still invalidate renderer compatibility', async t => {
  const directory = await checkout(t);
  const original = await rendererVersion(directory);
  for (const name of ['src/scene.js', 'src/effects.js', 'src/project.js', 'src/project-migrations.js', 'server/export.mjs', 'server/card-frames.mjs', 'scripts/render-worker.mjs', 'scripts/renderer-runtime.mjs', 'server/renderer-version.mjs', 'server/runtime-config.mjs', 'package-lock.json']) {
    const filename = path.join(directory, name), content = await readFile(filename, 'utf8');
    await writeFile(filename, content + (name.endsWith('.json') ? '\n ' : '\n// Runtime source changed.\n'));
    assert.notEqual(await rendererVersion(directory), original, name);
    await writeFile(filename, content);
  }
});

test('new transitive JavaScript and JSON dependencies are discovered without a filename allowlist', async t => {
  const directory = await checkout(t);
  const original = await rendererVersion(directory);
  await writeFile(path.join(directory, 'src/runtime-extension.json'), '{"strength":1}\n');
  await writeFile(path.join(directory, 'src/runtime-extension.js'), 'import settings from "./runtime-extension.json"; export const strength = settings.strength;\n');
  assert.equal(await rendererVersion(directory), original, 'unreferenced extensions do not participate');
  const scene = path.join(directory, 'src/scene.js');
  await writeFile(scene, 'import "./runtime-extension.js";\n' + await readFile(scene, 'utf8'));
  const imported = await rendererVersion(directory);
  assert.notEqual(imported, original);
  await writeFile(path.join(directory, 'src/runtime-extension.json'), '{"strength":2}\n');
  const changedJSON = await rendererVersion(directory);
  assert.notEqual(changedJSON, imported);
  await appendFile(path.join(directory, 'src/runtime-extension.js'), '\nexport const mode = "refractive";\n');
  assert.notEqual(await rendererVersion(directory), changedJSON);
});

test('missing runtime imports fail closed instead of reporting compatibility', async t => {
  const directory = await checkout(t);
  await appendFile(path.join(directory, 'src/scene.js'), '\nimport "./missing-renderer-dependency.js";\n');
  await assert.rejects(rendererVersion(directory), /missing-renderer-dependency/);
});

test('renderer compatibility is independent of install path and production symlinks', async t => {
  const directory = await checkout(t);
  const linked = await mkdtemp(path.join(os.tmpdir(), 'floc-renderer-linked-'));
  t.after(() => rm(linked, { recursive: true, force: true }));
  await cp(path.join(directory, 'server'), path.join(linked, 'server'), { recursive: true });
  await copyFile(path.join(directory, 'package-lock.json'), path.join(linked, 'package-lock.json'));
  for (const name of ['src', 'scripts']) await symlink(path.join(directory, name), path.join(linked, name), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(await rendererVersion(linked), await rendererVersion(directory));
});
