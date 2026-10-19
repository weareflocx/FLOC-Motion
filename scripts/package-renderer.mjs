import { cp, mkdtemp, mkdir, rm, chmod, readdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import AdmZip from 'adm-zip';
import { root } from '../server/runtime-config.mjs';
import { rendererVersion } from '../server/renderer-version.mjs';

const SERVER_FILES = ['export.mjs', 'card-frames.mjs', 'card-media.mjs', 'process.mjs', 'json-store.mjs', 'build-scene.mjs', 'runtime-config.mjs', 'renderer-version.mjs'];
const SCRIPT_FILES = ['render-worker.mjs', 'renderer-runtime.mjs', 'renderer-setup.mjs', 'renderer-update.mjs', 'renderer-autostart.mjs'];

// The engine is what installers place in engines/<version> and what installed renderers download to update.
async function copyEngine(target) {
  for (const name of ['package.json', 'package-lock.json']) await cp(path.join(root, name), path.join(target, name));
  const editorDirectory = path.join(root, 'src/editor');
  await cp(path.join(root, 'src'), path.join(target, 'src'), { recursive: true, filter: name => name !== editorDirectory && !name.startsWith(editorDirectory + path.sep) && !name.endsWith('.jsx') });
  await mkdir(path.join(target, 'server'), { recursive: true });
  for (const name of SERVER_FILES) await cp(path.join(root, 'server', name), path.join(target, 'server', name));
  await mkdir(path.join(target, 'scripts'), { recursive: true });
  for (const name of SCRIPT_FILES) await cp(path.join(root, 'scripts', name), path.join(target, 'scripts', name));
  for (const name of ['fonts', 'brand', 'demo']) await cp(path.join(root, 'public', name), path.join(target, 'public', name), { recursive: true });
}

// Engine updates run on the private Node the installers download, so both installers must pin the same one.
async function installerNodeVersion() {
  const pin = async (name, pattern) => (await readFile(path.join(root, 'installers', name), 'utf8')).match(pattern)?.[1];
  const mac = await pin('Install-Mac.command', /^NODE_VERSION="(v\d+\.\d+\.\d+)"\r?$/m);
  const windows = await pin('Install-Windows.cmd', /^set "NODE_VERSION=(v\d+\.\d+\.\d+)"\r?$/m);
  if (!mac || mac !== windows) throw new Error('Install-Mac.command and Install-Windows.cmd must pin the same NODE_VERSION.');
  return mac;
}

const scratch = await mkdtemp(path.join(os.tmpdir(), 'floc-renderer-package-'));
try {
  const node = await installerNodeVersion();
  const output = path.join(root, 'dist/renderer');
  await mkdir(output, { recursive: true });

  const engine = path.join(scratch, 'engine');
  await mkdir(engine);
  await copyEngine(engine);
  const version = await rendererVersion(engine);
  // A package the editor would not accept would make every renderer update again on each check-in.
  if (version !== await rendererVersion(root)) throw new Error('The packaged engine does not match the editor’s renderer version.');
  const engineZip = new AdmZip(); engineZip.addLocalFolder(engine);
  const bytes = engineZip.toBuffer();
  const engines = path.join(output, 'engine');
  await mkdir(engines, { recursive: true });
  const file = `${version}.zip`;
  await writeFile(path.join(engines, `${file}.tmp`), bytes);
  await rename(path.join(engines, `${file}.tmp`), path.join(engines, file));
  // The manifest switches last, so renderers never see a version whose package is not in place yet.
  const manifest = { version, file, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, node };
  await writeFile(path.join(engines, 'manifest.json.tmp'), `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(path.join(engines, 'manifest.json.tmp'), path.join(engines, 'manifest.json'));
  for (const name of await readdir(engines)) if (name !== file && name !== 'manifest.json') await rm(path.join(engines, name), { recursive: true, force: true });
  console.log(`Renderer engine: dist/renderer/engine/${file}`);

  const target = path.join(scratch, 'FLOC Motion Renderer');
  await mkdir(target);
  await copyEngine(target);
  await cp(path.join(root, 'scripts/renderer-launcher.mjs'), path.join(target, 'launcher.mjs'));
  for (const name of await readdir(path.join(root, 'installers'))) {
    await cp(path.join(root, 'installers', name), path.join(target, name));
    if (name.endsWith('.cmd')) await writeFile(path.join(target, name), (await readFile(path.join(target, name), 'utf8')).replace(/\r?\n/g, '\r\n'));
    if (name.endsWith('.command')) await chmod(path.join(target, name), 0o755);
  }
  const zip = new AdmZip(); zip.addLocalFolder(target, 'FLOC Motion Renderer');
  zip.writeZip(path.join(output, 'FLOC-Motion-Renderer.zip'));
  console.log('Renderer installer: dist/renderer/FLOC-Motion-Renderer.zip');
} finally { await rm(scratch, { recursive: true, force: true }); }
