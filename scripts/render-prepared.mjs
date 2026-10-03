import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderPreparedComposition } from '../server/export.mjs';

// Run a trusted, application-prepared composition on a separate render host.
const folder = process.argv[2];
if (!folder) throw new Error('Usage: node scripts/render-prepared.mjs <composition-folder>');
const { project, settings } = JSON.parse(await readFile(path.join(folder, 'render-input.json'), 'utf8'));
try {
  const result = await renderPreparedComposition(project, path.resolve(folder), settings, update => console.log(JSON.stringify(update)));
  await writeFile(path.join(folder, 'render-result.json'), JSON.stringify({ state: 'done', ...result }));
  console.log(JSON.stringify({ state: 'done', output: path.resolve(folder, 'video.mp4'), ...result }));
} catch (error) {
  await writeFile(path.join(folder, 'render-result.json'), JSON.stringify({ state: 'failed', message: error.message }));
  throw error;
}
