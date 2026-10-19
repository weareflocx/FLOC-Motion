import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { rendererVersion } from '../server/renderer-version.mjs';
import { checkRenderer, connectRenderer, installRendererBrowser, rendererDataDirectory, trustedOrigin } from './renderer-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = key => args[args.indexOf(key) + 1];
console.log('Checking this computer…');
const runtime = await checkRenderer(args.includes('--check') ? {} : { browserPath: await installRendererBrowser() });
console.log(`Graphics ready: ${runtime.graphics}`);
if (args.includes('--check')) process.exit(0);
const askCode = async () => {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try { return await input.question('Enter the connection code from FLOC Motion > Export: '); }
  finally { input.close(); }
};
const connection = await connectRenderer({
  configFile: path.join(rendererDataDirectory(root), 'config.json'),
  origin: args.includes('--origin') ? trustedOrigin(option('--origin')).origin : null,
  code: args.includes('--code') ? option('--code') ?? '' : undefined,
  askCode,
  browserPath: runtime.browserPath,
  version: () => rendererVersion()
});
console.log(connection.reused ? `Using the existing connection: ${connection.name}` : 'Connected. The renderer will only receive exports from this browser.');
if (!args.includes('--no-autostart')) {
  const child = spawn(process.execPath, [path.join(root, 'scripts/renderer-autostart.mjs')], { stdio: 'inherit' });
  const exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  if (exitCode !== 0) throw new Error('Could not enable automatic startup. Use Start Renderer to run it manually.');
}
