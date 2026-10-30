import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserCandidates } from '../scripts/renderer-runtime.mjs';

const executablePath = [process.env.HYPERFRAMES_BROWSER_PATH, ...browserCandidates()].find(file => file && existsSync(file));

test('prepared visual videos preserve source clocks, decoded dimensions, alpha, fit and visible bounds', { skip: !executablePath && 'Chrome or Edge is required for prepared video rendering', timeout: 120000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import { createScene, stageMarkup } from './scene.js';
    import { blankProject, fileLayer, validateProject } from './project.js';
    import { createResourceCache } from './scene-resources.js';
    const root = document.getElementById('stage');
    const src = '/assets/5c6e62a1-59b0-4b79-a752-a943d49cd13d.mp4';
    const frames = { directory: '/video-frames/0', extension: 'png', duration: 3, fps: 24, firstFrame: 24, count: 48, width: 8, height: 16 };
    let engine, project;
    const resources = createResourceCache();
    function background() {
      const p = blankProject();
      p.layers = [{ ...p.layers[0], mode: 'video', src, color: '#ffff00', fit: 'contain', offset: 1, start: 1, end: 9, loop: true }];
      return validateProject(p);
    }
    function pixels(x = 54, y = 54) {
      return [...root.querySelector('[data-floc-scene-output]').getContext('2d').getImageData(x, y, 1, 1).data];
    }
    async function mount(p, videoFrames = { [src]: frames }) {
      engine?.dispose(); project = p;
      root.innerHTML = stageMarkup(project, undefined, { videoFrames });
      engine = await createScene(root, project, { renderMode: true, videoFrames, resources });
      engine.setResolution(108, 108);
    }
    async function seek(time, x, y) { await engine.seek(time); return pixels(x, y); }
    async function patch(values) {
      const next = validateProject({ ...project, layers: project.layers.map(l => ({ ...l, ...values })) });
      if (!engine.update(next)) throw new Error('A prepared video setting unexpectedly rebuilt its scene');
      project = next;
    }
    window.exerciseVideoFrames = async () => {
      const result = {}, p = background();
      const preview = document.createElement('template'); preview.innerHTML = stageMarkup(p);
      result.previewVideo = preview.content.querySelector('video')?.getAttribute('src');
      try { await mount(p, {}); } catch (error) { result.missing = error.message; }
      await mount(p);
      result.nativeVideos = root.querySelectorAll('video').length;
      const source = root.querySelector('#media-background');
      result.dimensions = [source.width, source.height];
      result.before = await seek(.5);
      result.offset = await seek(1);
      result.containMargin = await seek(1, 54, 5);
      result.next = await seek(1.5);
      result.blue = await seek(2);
      result.alpha = await seek(2.5);
      result.loop = await seek(3);
      result.backwards = await seek(1.5);
      result.end = await seek(9);
      await patch({ loop: false });
      result.hold = await seek(7);
      await patch({ fit: 'cover' });
      result.cover = await seek(1, 5, 5);
      await patch({ visible: false });
      result.hidden = await seek(1);
      await patch({ visible: true, offset: 1.5 });
      result.changedOffset = await seek(1);
      await patch({ offset: 1 });
      await seek(1);
      const older = engine.seek(1.5), newer = engine.seek(2);
      await Promise.all([older, newer]); result.latestSeek = pixels();
      const pending = engine.seek(1.5); engine.dispose(); await pending;
      result.disposedDimensions = [source.width, source.height];
      result.cachedFrames = resources.size;
      const media = fileLayer({ src, name: 'Clip' }, 8, 'clip');
      const standalone = blankProject();
      standalone.layers = [{ ...media, space: 'flat', x: 25, y: 25, size: 50, offset: 1, start: 1, end: 8, loop: false }];
      await mount(validateProject(standalone));
      result.media = await seek(1, 40, 35);
      result.mediaOutside = await seek(1, 10, 10);
      result.mediaBelow = await seek(1, 40, 70);
      await patch({ opacity: .5 });
      result.mediaOpacity = await seek(1, 40, 35);
      await patch({ visible: false });
      result.mediaHidden = await seek(1, 40, 35);
      engine.dispose();
      return result;
    };
  ` }, bundle: true, write: false, format: 'iife' });
  const angle = process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d11' : 'gl-egl';
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', `--use-angle=${angle}`, '--force-color-profile=srgb'] });
  t.after(() => browser.close());
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const encoded = await page.evaluate(() => ['#ff0000', '#00ff00', '#0000ff', null].map(color => {
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 8;
    if (color) { const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 16, 8); }
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  const images = encoded.map(image => Buffer.from(image, 'base64'));
  const server = http.createServer(async (req, res) => {
    const frame = /^\/video-frames\/0\/(\d{6})\.png$/.exec(req.url);
    if (frame) {
      const index = Number(frame[1]);
      // Resolve an older seek after a newer one to exercise stale-image protection.
      if (index >= 12 && index < 24) await new Promise(resolve => setTimeout(resolve, 40));
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }); res.end(images[Math.floor(index / 12)]);
    } else if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<style>body{margin:0}#stage{position:relative;width:1080px;height:1080px;overflow:hidden}canvas{display:block}</style><div id="stage"></div>');
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(() => window.exerciseVideoFrames());
  assert.deepEqual(errors, []);
  assert.equal(result.previewVideo, '/assets/5c6e62a1-59b0-4b79-a752-a943d49cd13d.mp4');
  assert.match(result.missing, /Prepared video frames are missing/);
  assert.equal(result.nativeVideos, 0);
  assert.deepEqual(result.dimensions, [16, 8], 'decoded dimensions replace pre-rotation stream metadata');
  for (const key of ['offset', 'loop', 'cover', 'media']) assert.deepEqual(result[key], [255, 0, 0, 255], key);
  for (const key of ['next', 'backwards', 'changedOffset']) assert.deepEqual(result[key], [0, 255, 0, 255], key);
  for (const key of ['blue', 'latestSeek']) assert.deepEqual(result[key], [0, 0, 255, 255], key);
  for (const key of ['alpha', 'hold', 'containMargin']) assert.deepEqual(result[key], [255, 255, 0, 255], key);
  for (const key of ['before', 'end', 'hidden', 'mediaOutside', 'mediaBelow', 'mediaHidden']) assert.equal(result[key][3], 0, key);
  assert.deepEqual(result.mediaOpacity.slice(0, 3), [255, 0, 0]);
  assert.ok(Math.abs(result.mediaOpacity[3] - 128) <= 1, 'standalone alpha is not applied twice');
  assert.deepEqual(result.disposedDimensions, [0, 0]);
  assert.equal(result.cachedFrames, 0, 'old prepared images do not accumulate in the shared cache');
});
