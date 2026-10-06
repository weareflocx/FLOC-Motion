import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { rendererVersion } from '../server/renderer-version.mjs';
import { checkRenderer, installRendererBrowser, trustedOrigin } from './renderer-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = key => args[args.indexOf(key) + 1];
console.log('Checking this computer…');
const runtime = await checkRenderer(args.includes('--check') ? {} : { browserPath: await installRendererBrowser() });
console.log(`Graphics ready: ${runtime.graphics}`);
if (args.includes('--check')) process.exit(0);
const origin = trustedOrigin(args.includes('--origin') ? option('--origin') : 'https://floc-motion.fly.dev').origin;
const input = createInterface({ input: process.stdin, output: process.stdout });
let code;
try { code = args.includes('--code') ? option('--code') : await input.question('Enter the connection code from FLOC Motion > Export: '); }
finally { input.close(); }
if (!/^[a-f0-9]{5}-?[a-f0-9]{5}$/i.test(code?.trim() || '')) throw new Error('Enter the complete connection code shown in Export.');
const response = await fetch(`${origin}/api/renderers/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code.trim(), version: await rendererVersion(), name: os.hostname() }), signal: AbortSignal.timeout(15000), redirect: 'error' });
const result = await response.json();
if (!response.ok) throw new Error(result.error || 'Could not connect. Get a new code in Export and try again.');
if (!/^[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(result.token || '')) throw new Error('Invalid renderer connection response.');
const config = path.join(root, '.data/render-worker/config.json');
await mkdir(path.dirname(config), { recursive: true });
await writeFile(`${config}.tmp`, JSON.stringify({ origin, token: result.token, browserPath: runtime.browserPath }), { mode: 0o600 });
await rename(`${config}.tmp`, config);
console.log('Connected. The renderer will only receive exports from this browser.');
if (!args.includes('--no-autostart')) {
  const child = spawn(process.execPath, [path.join(root, 'scripts/renderer-autostart.mjs')], { stdio: 'inherit' });
  const exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  if (exitCode !== 0) throw new Error('Could not enable automatic startup. Use Start Renderer to run it manually.');
}
