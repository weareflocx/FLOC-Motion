import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { root } from './runtime-config.mjs';
import { FONT_FILES } from '../src/fonts.js';
export { root } from './runtime-config.mjs';
export async function buildScene() {
  await mkdir(path.join(root, '.data', 'engine'), { recursive: true });
  await build({ entryPoints: [path.join(root, 'src/render-entry.js')], bundle: true, format: 'iife', platform: 'browser', outfile: path.join(root, '.data/engine/scene.js'), minify: true });
  for (const font of FONT_FILES) await copyFile(path.join(root, 'public/fonts', font.file), path.join(root, '.data/engine', font.file));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await buildScene();
