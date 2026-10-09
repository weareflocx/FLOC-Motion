import { cp, mkdtemp, mkdir, rm, chmod, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import AdmZip from 'adm-zip';
import { root } from '../server/runtime-config.mjs';

const scratch = await mkdtemp(path.join(os.tmpdir(), 'floc-renderer-package-'));
try {
  const target = path.join(scratch, 'FLOC Motion Renderer');
  await mkdir(target);
  for (const name of ['package.json', 'package-lock.json']) await cp(path.join(root, name), path.join(target, name));
  const editorDirectory = path.join(root, 'src/editor');
  await cp(path.join(root, 'src'), path.join(target, 'src'), { recursive: true, filter: name => name !== editorDirectory && !name.startsWith(editorDirectory + path.sep) && !name.endsWith('.jsx') });
  for (const name of ['export.mjs', 'card-frames.mjs', 'card-media.mjs', 'process.mjs', 'json-store.mjs', 'build-scene.mjs', 'runtime-config.mjs', 'renderer-version.mjs']) {
    await mkdir(path.join(target, 'server'), { recursive: true });
    await cp(path.join(root, 'server', name), path.join(target, 'server', name));
  }
  for (const name of ['render-worker.mjs', 'renderer-runtime.mjs', 'renderer-setup.mjs', 'renderer-autostart.mjs']) {
    await mkdir(path.join(target, 'scripts'), { recursive: true });
    await cp(path.join(root, 'scripts', name), path.join(target, 'scripts', name));
  }
  for (const name of ['fonts', 'brand', 'demo', 'licenses']) await cp(path.join(root, 'public', name), path.join(target, 'public', name), { recursive: true });
  for (const name of await readdir(path.join(root, 'installers'))) {
    await cp(path.join(root, 'installers', name), path.join(target, name));
    if (name.endsWith('.cmd')) await writeFile(path.join(target, name), (await readFile(path.join(target, name), 'utf8')).replace(/\r?\n/g, '\r\n'));
    if (name.endsWith('.command')) await chmod(path.join(target, name), 0o755);
  }
  const zip = new AdmZip(); zip.addLocalFolder(target, 'FLOC Motion Renderer');
  await mkdir(path.join(root, 'dist/renderer'), { recursive: true });
  zip.writeZip(path.join(root, 'dist/renderer/FLOC-Motion-Renderer.zip'));
  console.log('Renderer installer: dist/renderer/FLOC-Motion-Renderer.zip');
} finally { await rm(scratch, { recursive: true, force: true }); }
