import { build, version } from 'esbuild';
import { mkdir, copyFile, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { root } from './runtime-config.mjs';
import { readJson, writeJsonAtomic } from './json-store.mjs';
import { FONT_FILES } from '../src/fonts.js';
export { root } from './runtime-config.mjs';
const engine = path.join(root, '.data', 'engine'), scene = path.join(engine, 'scene.js'), stampFile = path.join(engine, 'scene.json');
const OPTIONS = { absWorkingDir: root, entryPoints: [path.join(root, 'src/render-entry.js')], bundle: true, format: 'iife', platform: 'browser', outfile: scene, minify: true };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function inputsDigest(inputs) {
  const hash = createHash('sha256').update(`${version}\0${JSON.stringify(OPTIONS)}\0`);
  for (const name of inputs) hash.update(`${name}\0`).update(await readFile(path.resolve(root, name)));
  return hash.digest('hex');
}
async function current() {
  try {
    const stamp = await readJson(stampFile);
    return Array.isArray(stamp.inputs) && stamp.digest === await inputsDigest(stamp.inputs) && stamp.output === sha256(await readFile(scene));
  } catch { return false; }
}
// esbuild-wasm takes ~0.5 s (over 1 s when cold) per bundle; reuse it while every bundled input is
// byte-identical. Readers copy scene.js concurrently, so it is replaced atomically.
async function rebuild() {
  await mkdir(engine, { recursive: true });
  if (!await current()) {
    const started = Date.now();
    const { outputFiles, metafile } = await build({ ...OPTIONS, write: false, metafile: true });
    const inputs = Object.keys(metafile.inputs).sort(), code = outputFiles[0].contents;
    const temporary = `${scene}.tmp-${process.pid}-${randomUUID()}`;
    try { await writeFile(temporary, code); await rename(temporary, scene); }
    finally { await rm(temporary, { force: true }); }
    // An input edited during the build may not be in this bundle; leave it unstamped.
    const edited = (await Promise.all(inputs.map(name => stat(path.resolve(root, name))))).some(info => info.mtimeMs >= started - 2000);
    if (edited) await rm(stampFile, { force: true });
    else await writeJsonAtomic(stampFile, { digest: await inputsDigest(inputs), output: sha256(code), inputs });
  }
  for (const font of FONT_FILES) await copyFile(path.join(root, 'public/fonts', font.file), path.join(engine, font.file));
}
let building = null;
export function buildScene() { return building ??= rebuild().finally(() => { building = null; }); }
if (process.argv[1] === fileURLToPath(import.meta.url)) await buildScene();
