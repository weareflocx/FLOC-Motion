import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { root } from './runtime-config.mjs';

// Follow the render entry and worker imports instead of fingerprinting unrelated
// editor helpers. Package versions remain pinned conservatively by the lockfile.
export async function rendererVersion(directory = root) {
  directory = path.resolve(directory);
  const { metafile } = await build({
    absWorkingDir: directory,
    entryPoints: ['src/render-entry.js', 'scripts/render-worker.mjs'],
    outdir: 'renderer-version-analysis',
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    preserveSymlinks: true,
    metafile: true,
    write: false,
    logLevel: 'silent'
  });
  const files = ['package-lock.json', ...Object.keys(metafile.inputs).map(name => {
    const relative = path.relative(directory, path.resolve(directory, name));
    if (path.isAbsolute(relative) || relative.startsWith(`..${path.sep}`)) throw new Error('Renderer dependencies must stay inside the installation.');
    return relative.split(path.sep).join('/');
  })];
  const hash = createHash('sha256');
  for (const name of files.sort()) hash.update(name).update(await readFile(path.join(directory, name)));
  return hash.digest('hex');
}
