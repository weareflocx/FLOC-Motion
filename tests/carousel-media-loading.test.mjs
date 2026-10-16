import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserCandidates } from '../scripts/renderer-runtime.mjs';
import { run } from '../server/process.mjs';
import { ensureGifVideo } from '../server/card-media.mjs';
import { blankProject, demoProject, fileLayer, validateProject } from '../src/project.js';

const executablePath = [process.env.HYPERFRAMES_BROWSER_PATH, ...browserCandidates()].find(file => file && existsSync(file));
const source = ext => `/assets/00000000-0000-4000-8000-00000000000${ext === 'svg' ? 1 : ext === 'mp4' ? 2 : ext === 'gif' || ext === 'webm' ? 3 : 4}.${ext}`;

test('early soundtrack metadata cannot leave mixed image, MP4 and GIF carousel cards empty', { skip: !executablePath && 'Chromium is required for animated media verification', timeout: 60000 }, async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'floc-carousel-loading-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const mp4 = path.join(folder, 'source.mp4'), gif = path.join(folder, 'source.gif'), webm = path.join(folder, 'source.webm'), wav = path.join(folder, 'source.wav');
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=64x64:r=12:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=64x64:r=12:d=1', '-loop', '0', gif]);
  await ensureGifVideo(gif, webm, run);
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000:duration=1', wav]);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#ff0000"/></svg>';
  const media = new Map([[source('svg'), [Buffer.from(svg), 'image/svg+xml']], [source('mp4'), [await readFile(mp4), 'video/mp4']], [source('webm'), [await readFile(webm), 'video/webm']], [source('wav'), [await readFile(wav), 'audio/wav']]]);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import { createScene, stageMarkup } from './scene.js';
    window.begin = project => {
      const root = document.querySelector('#stage'); root.innerHTML = stageMarkup(project);
      window.failures = [];
      window.preparing = createScene(root, project, { onMediaError: error => window.failures.push(error.message) });
    };
    window.finish = async () => {
      window.engine = await window.preparing;
      window.engine.setResolution(270, 270); await window.engine.seek(0);
      const output = document.querySelector('[data-floc-scene-output]');
      const center = [...output.getContext('2d').getImageData(135, 135, 1, 1).data];
      return { center, errors: window.failures };
    };
  ` }, bundle: true, format: 'iife', write: false });
  const server = http.createServer(async (req, res) => {
    if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<style>body{margin:0}#stage{position:relative;width:1080px;height:1080px;overflow:hidden}</style><div id="stage"></div><script>' + bundle.outputFiles[0].text + '</script>'); }
    if (/\.(mp4|webm)$/.test(req.url)) await gate;
    const item = media.get(req.url);
    if (!item) { res.writeHead(404); return res.end(); }
    const [bytes, type] = item, range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    res.writeHead(range ? 206 : 200, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}) });
    res.end(bytes.subarray(start, end + 1));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', `--use-angle=${process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d11' : 'gl-egl'}`] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const project = blankProject('Mixed animated cards with soundtrack');
  project.duration = 2; project.layers[0].end = 2; project.layers[0].color = '#000000';
  project.layers.push({ ...demoProject().layers.find(layer => layer.type === 'carousel'), id: 'cards', end: 2, space: 'flat', template: 'horizontal', size: 1.6, x: 50, y: 50, tilt: 0, yaw: 0, roll: 0, cardAspect: 1, speed: 0, loopDuration: 0, fadeIn: 0, fadeOut: 0, cardCount: 3,
    images: ['svg', 'mp4', 'gif'].map(ext => ({ id: ext, name: ext, src: source(ext) })) });
  project.layers.push(fileLayer({ name: 'Soundtrack', src: source('wav') }, 2, 'soundtrack'));
  await page.evaluate(project => window.begin(project), validateProject(project));
  // Force the real metadata event to arrive while animated card decoders are still loading.
  await page.waitForFunction(() => document.querySelector('audio')?.readyState >= 1);
  release();
  const result = await page.evaluate(() => window.finish());
  assert.deepEqual(result.errors, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(result.center, [255, 0, 0, 255], 'the first visible card must keep valid geometry after early audio metadata');
  await page.evaluate(() => window.engine.dispose());
});
