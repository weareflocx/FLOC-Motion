import { access } from 'node:fs/promises';
import path from 'node:path';
import { run } from '../server/process.mjs';
import { root } from '../server/runtime-config.mjs';

export async function installRendererBrowser() {
  if (process.env.HYPERFRAMES_BROWSER_PATH) return process.env.HYPERFRAMES_BROWSER_PATH;
  const bin = path.join(root, 'node_modules/hyperframes/bin/hyperframes.mjs');
  // Use a dedicated rendering browser rather than the user's everyday Chrome.
  const options = { env: { PRODUCER_HEADLESS_SHELL_PATH: '' } };
  await run(process.execPath, [bin, 'browser', 'ensure'], options, text => process.stdout.write(text));
  return (await run(process.execPath, [bin, 'browser', 'path'], options)).trim();
}

export function trustedOrigin(value) {
  const url = new URL(value);
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password || !(url.protocol === 'https:' || (url.protocol === 'http:' && local))) throw new Error('Use the editor HTTPS address, or a loopback HTTP address for local testing.');
  return url;
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
