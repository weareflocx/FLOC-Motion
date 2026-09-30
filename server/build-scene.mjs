import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function buildScene() {
  await mkdir(path.join(root, '.data', 'engine'), { recursive: true });
  await build({ entryPoints: [path.join(root, 'src/render-entry.js')], bundle: true, format: 'iife', platform: 'browser', outfile: path.join(root, '.data/engine/scene.js'), minify: true });
  for (const weight of [400, 600, 800]) await copyFile(path.join(root, `node_modules/@fontsource/geist/files/geist-latin-${weight}-normal.woff2`), path.join(root, `.data/engine/geist-${weight}.woff2`));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await buildScene();
