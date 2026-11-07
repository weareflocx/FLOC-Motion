import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, cp, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { run } from '../server/process.mjs';
import { root } from '../server/runtime-config.mjs';

// A separate installation, so changing its sources never touches this checkout's engine.
async function checkout(t) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'floc-build-scene-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ['src', 'server', 'public/fonts']) await cp(path.join(root, name), path.join(directory, name), { recursive: true, preserveTimestamps: true });
  await symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
  const scene = path.join(directory, '.data/engine/scene.js');
  const build = async () => { await run(process.execPath, ['--input-type=module', '-e', `await (await import(${JSON.stringify(pathToFileURL(path.join(directory, 'server/build-scene.mjs')).href)})).buildScene();`], { cwd: os.tmpdir() }); return readFile(scene); };
  return { directory, scene, build };
}

test('the export scene bundle is reused until a bundled source or the bundle itself changes', async t => {
  const { directory, scene, build } = await checkout(t);
  const original = await build();
  const written = (await stat(scene)).mtimeMs;
  assert.deepEqual(await build(), original);
  assert.equal((await stat(scene)).mtimeMs, written, 'an unchanged installation reuses its bundle');
  await writeFile(scene, 'corrupt');
  assert.deepEqual(await build(), original, 'a damaged bundle is rebuilt');
  await rm(path.join(directory, '.data/engine/scene.json'));
  assert.deepEqual(await build(), original, 'a missing fingerprint rebuilds the same bundle');
  await appendFile(path.join(directory, 'src/render-entry.js'), '\nwindow.__flocBuildMarker = "changed-source";\n');
  const changed = await build();
  assert.notDeepEqual(changed, original);
  assert.match(changed.toString(), /changed-source/, 'a source change reaches the export bundle');
});
