import { access, copyFile, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../server/process.mjs';
import { root } from '../server/runtime-config.mjs';
import { readJson, writeJsonAtomic } from '../server/json-store.mjs';

export const DEFAULT_EDITOR_ORIGIN = 'https://floc-motion.fly.dev';

// Installed renderers keep connection, logs and job data beside the launcher so engine
// updates replace code only. Direct runs keep them inside the checkout, as before.
export function rendererDataDirectory(engineRoot = root, env = process.env) {
  return path.join(env.FLOC_RENDERER_HOME ? path.resolve(env.FLOC_RENDERER_HOME) : engineRoot, '.data', 'render-worker');
}

export async function installRendererBrowser() {
  if (process.env.HYPERFRAMES_BROWSER_PATH) return process.env.HYPERFRAMES_BROWSER_PATH;
  const bin = path.join(root, 'node_modules/hyperframes/bin/hyperframes.mjs');
  // Use a dedicated rendering browser rather than the user's everyday Chrome.
  const options = { env: { PRODUCER_HEADLESS_SHELL_PATH: '' } };
  await run(process.execPath, [bin, 'browser', 'ensure'], options, text => process.stdout.write(text));
  return (await run(process.execPath, [bin, 'browser', 'path'], options)).trim();
}

export function exportDirectory(platform = process.platform, home = os.homedir()) {
  return path.join(home, platform === 'darwin' ? 'Movies' : 'Videos', 'FLOC Motion');
}
// Never overwrite an earlier export: a name collision gets a numbered copy. The rendered
// file's extension (.mp4, .mov or .zip) is kept.
export async function saveRenderedVideo(source, name, directory = exportDirectory(), date = new Date()) {
  await mkdir(directory, { recursive: true });
  const sanitized = String(name || '').replace(/[\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').replace(/^[. -]+|[. -]+$/g, '');
  let base = Array.from(sanitized).slice(0, 80).join('').replace(/[. ]+$/g, '') || 'FLOC Motion export';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)) base = `_${base}`;
  const pad = value => String(value).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
  for (let copy = 1; ; copy++) {
    const filename = path.join(directory, `${base} ${stamp}${copy > 1 ? ` (${copy})` : ''}${path.extname(source).toLowerCase()}`);
    try { await copyFile(source, filename, constants.COPYFILE_EXCL); return filename; }
    catch (cause) { if (cause.code !== 'EEXIST') throw cause; }
  }
}

export function trustedOrigin(value) {
  const url = new URL(value);
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password || !(url.protocol === 'https:' || (url.protocol === 'http:' && local))) throw new Error('Use the editor HTTPS address, or a loopback HTTP address for local testing.');
  return url;
}

// Reuses a saved connection the editor still recognises, so reinstalling never needs a
// new code; otherwise pairs with a connection code. `code` forces pairing. A brief network
// or editor outage (for example a stopped machine starting) is retried before giving up.
export async function connectRenderer({ configFile, origin, code, askCode, browserPath, version, name = os.hostname(), attempts = 3, retryDelayMs = 5000 }) {
  const existing = code === undefined ? await readJson(configFile, { missing: null }).catch(() => null) : null;
  let saved = null;
  try { if (typeof existing?.token === 'string' && existing.token.length >= 32) saved = trustedOrigin(existing.origin).origin; } catch {}
  if (saved && (!origin || origin === saved)) {
    let response, failure;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      try { response = await fetch(`${saved}/api/render-worker/identity`, { headers: { Authorization: `Bearer ${existing.token}` }, signal: AbortSignal.timeout(15000), redirect: 'error' }); failure = null; }
      catch (cause) { response = null; failure = cause; continue; }
      if (response.status < 500) break;
    }
    if (failure) throw new Error(`Could not reach ${saved} to check the existing connection. Check your internet connection and try again.`, { cause: failure });
    if (response.ok) {
      const identity = await response.json();
      await writeJsonAtomic(configFile, { ...existing, origin: saved, browserPath }, { mode: 0o600 });
      return { reused: true, name: String(identity?.name || identity?.id || 'this computer') };
    }
    // Only a rejected token warrants a new code; a failing editor must not orphan the device.
    if (![401, 403, 404].includes(response.status)) throw new Error(`The editor could not check the existing connection (${response.status}). Try again in a moment.`);
  }
  code ??= await askCode();
  if (!/^[a-f0-9]{5}-?[a-f0-9]{5}$/i.test(code?.trim() || '')) throw new Error('Enter the complete connection code shown in Export.');
  const target = origin || DEFAULT_EDITOR_ORIGIN;
  const response = await fetch(`${target}/api/renderers/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code.trim(), version: await version(), name }), signal: AbortSignal.timeout(15000), redirect: 'error' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not connect. Get a new code in Export and try again.');
  if (!/^[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(result.token || '')) throw new Error('Invalid renderer connection response.');
  await writeJsonAtomic(configFile, { origin: target, token: result.token, browserPath }, { mode: 0o600 });
  return { reused: false };
}
export function browserCandidates(platform = process.platform, env = process.env) {
  if (platform === 'darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', path.join(env.HOME || '', 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')];
  if (platform === 'win32') {
    const locations = [env.LOCALAPPDATA, env.PROGRAMFILES, env['PROGRAMFILES(X86)']].filter(Boolean);
    return locations.flatMap(folder => ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'].map(file => path.win32.join(folder, file)));
  }
  return ['/usr/bin/chromium', '/usr/bin/google-chrome'];
}
export async function configureRenderer(config = {}) {
  const directories = process.platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin'] : process.platform === 'win32' ? [path.join(process.env.LOCALAPPDATA || '', 'Microsoft/WinGet/Links')] : [];
  process.env.PATH = [...directories, process.env.PATH || ''].join(path.delimiter);
  let browser = config.browserPath || process.env.HYPERFRAMES_BROWSER_PATH;
  if (!browser) for (const candidate of browserCandidates()) {
    try { await access(candidate); browser = candidate; break; } catch {}
  }
  if (!browser) throw new Error('Chrome or Microsoft Edge is required. Install it, then open the renderer again.');
  await access(browser);
  // Match HyperFrames' preflight, which is separate from the GPU launch check.
  try { await run(browser, ['--version'], { timeoutMs: 5000 }); }
  catch (cause) { throw new Error(`The renderer browser cannot start: ${browser}. Run the latest installer again to configure the dedicated rendering browser. ${cause.message}`, { cause }); }
  process.env.HYPERFRAMES_BROWSER_PATH = browser;
  process.env.PRODUCER_BROWSER_GPU_MODE = 'hardware';
  return browser;
}
export async function checkRenderer(config = {}) {
  const browser = await configureRenderer(config);
  for (const tool of ['ffmpeg', 'ffprobe']) {
    try { await run(tool, ['-version'], { timeoutMs: 10000 }); }
    catch { throw new Error('FFmpeg and FFprobe are required. Run the installer again.'); }
  }
  const { default: puppeteer } = await import('puppeteer-core');
  const angle = process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d11' : 'gl-egl';
  const instance = await puppeteer.launch({ executablePath: browser, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', `--use-angle=${angle}`] });
  try {
    const page = await instance.newPage();
    const renderer = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
      const extension = gl?.getExtension('WEBGL_debug_renderer_info');
      return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : '';
    });
    if (!renderer || /swiftshader|llvmpipe|lavapipe|softpipe|software|microsoft basic render/i.test(renderer)) throw new Error('Hardware graphics are unavailable. Enable hardware acceleration in Chrome or Edge, update your graphics driver, then run the installer again.');
    return { browserPath: browser, graphics: renderer };
  } finally { await instance.close(); }
}
