import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { root } from './runtime-config.mjs';

// Bind the renderer to the shared validator and scene, not just package.version.
export async function rendererVersion(directory = root) {
  const files = ['package-lock.json', 'server/export.mjs', 'server/card-frames.mjs', 'server/card-media.mjs', 'server/build-scene.mjs', 'server/process.mjs', 'server/json-store.mjs', 'server/renderer-version.mjs', 'scripts/render-worker.mjs', 'scripts/renderer-runtime.mjs'];
  async function walk(relative) {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      if (entry.name === 'editor') continue;
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(name);
      else if (/\.(js|json)$/.test(entry.name)) files.push(name);
    }
  }
  await walk('src');
  const hash = createHash('sha256');
  for (const name of files.sort()) hash.update(name).update(await readFile(path.join(directory, name)));
  return hash.digest('hex');
}
