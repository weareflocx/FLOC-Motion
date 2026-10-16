import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserCandidates } from '../scripts/renderer-runtime.mjs';
import { sceneUpdatePlan } from '../src/scene-update.js';
import { createResourceCache, watchContextLoss } from '../src/scene-resources.js';
import { demoProject, fileLayer, patchLayer, switchFormat, validateProject } from '../src/project.js';
import { effectLayer } from '../src/effects.js';
import { fontFaceCss } from '../src/fonts.js';

const executablePath = [process.env.HYPERFRAMES_BROWSER_PATH, ...browserCandidates()].find(file => file && existsSync(file));

const project = () => {
  const input = demoProject();
  input.layers.push(fileLayer({ name: 'clip', src: '/assets/00000000-0000-4000-8000-000000000002.mp4' }, input.duration, 'clip'));
  input.layers.push(fileLayer({ name: 'model', src: '/assets/00000000-0000-4000-8000-000000000001.glb' }, input.duration, 'model'));
  input.layers.push(effectLayer('grain', input.duration));
  return validateProject(input);
};
const idOf = (p, type) => p.layers.find(layer => layer.type === type).id;

test('parameter edits apply to the live scene', () => {
  const base = project();
  const carousel = idOf(base, 'carousel'), text = idOf(base, 'text'), background = idOf(base, 'background');
  const edits = [
    [carousel, { stretch: 0.2 }], [carousel, { size: 1.4, gap: 0.3, cardAspect: 1.2, curve: 0.5, radius: 3 }],
    [carousel, { speed: 12, perspective: 60, cornerRadius: 30, cardShape: 'squircle', backface: 'hide' }], [carousel, { cardFit: 'height' }], [carousel, { cardFit: 'width', template: 'circular' }],
    [text, { text: 'New title', color: '#ff00ff', size: 70, width: 40 }], [text, { visible: false, start: 1, fadeIn: 0.5 }],
    [background, { color: '#123456' }], [idOf(base, 'media'), { x: 40, size: 20, offset: 1, loop: true }], [idOf(base, 'model'), { yaw: 30, offset: 0.5 }]
  ];
  for (const [id, patch] of edits) assert.deepEqual(sceneUpdatePlan(base, patchLayer(base, id, patch)), { effects: false }, JSON.stringify(patch));
  assert.deepEqual(sceneUpdatePlan(base, { ...base, layout: { ...base.layout, enabled: !base.layout.enabled } }), { effects: false });
  assert.deepEqual(sceneUpdatePlan(base, patchLayer(base, text, { effects: [{ type: 'blur', enabled: true, amount: 4, mode: 'uniform', direction: 'bottom' }] })), { effects: true });
  assert.deepEqual(sceneUpdatePlan(base, patchLayer(base, 'grain', { effects: [{ ...base.layers.at(-1).effects[0], opacity: 0.6 }] })), { effects: true });
});

test('structural edits rebuild the scene', () => {
  const base = project();
  const carousel = idOf(base, 'carousel');
  const images = base.images.slice(0, 2);
  const changes = {
    reorder: { ...base, layers: [base.layers[1], base.layers[0], ...base.layers.slice(2)] },
    removal: { ...base, layers: base.layers.slice(0, -1) },
    type: { ...base, layers: base.layers.map(layer => layer.id === 'grain' ? { ...layer, type: 'text' } : layer) },
    format: switchFormat(base, 'portrait'),
    template: patchLayer(base, carousel, { template: 'stack' }),
    cardCount: patchLayer(base, carousel, { cardCount: 9 }),
    projectImages: { ...base, images },
    carouselImages: patchLayer(base, carousel, { images: [...base.images].reverse() }),
    media: patchLayer(base, idOf(base, 'media'), { src: '/assets/00000000-0000-4000-8000-000000000003.mp4' }),
    model: patchLayer(base, idOf(base, 'model'), { src: '/assets/00000000-0000-4000-8000-000000000004.glb' }),
    backgroundMode: patchLayer(base, idOf(base, 'background'), { mode: 'procedural' }),
    effectScope: patchLayer(base, 'grain', { effectScope: 'overlay' })
  };
  for (const [name, next] of Object.entries(changes)) assert.equal(sceneUpdatePlan(base, next), null, name);
});

test('refractive carousel capture rebuilds only when immutable framebuffer retention changes', () => {
  const base = project(), id = idOf(base, 'model'), style = base.layers.find(layer => layer.id === id).modelStyle;
  const refractive = patchLayer(base, id, { modelStyle: { ...style, shader: 'refractive' } });
  assert.equal(sceneUpdatePlan(base, refractive), null);
  assert.equal(sceneUpdatePlan(refractive, base), null);
  assert.deepEqual(sceneUpdatePlan(refractive, patchLayer(refractive, id, { visible: false })), { effects: false }, 'visibility and the playhead cannot change context attributes');
  assert.deepEqual(sceneUpdatePlan(refractive, patchLayer(refractive, id, { modelStyle: { ...style, shader: 'refractive', roughness: .45 } })), { effects: false });
  const two = validateProject({ ...refractive, layers: [...refractive.layers, { ...refractive.layers.find(layer => layer.id === id), id: 'second-model' }] });
  assert.deepEqual(sceneUpdatePlan(two, patchLayer(two, id, { modelStyle: style })), { effects: false }, 'another refractive model still needs the retained carousel frames');
  const withoutCarousel = validateProject({ ...base, layers: base.layers.filter(layer => layer.type !== 'carousel') });
  assert.deepEqual(sceneUpdatePlan(withoutCarousel, patchLayer(withoutCarousel, id, { modelStyle: { ...style, shader: 'refractive' } })), { effects: false }, 'model-only scenes do not need retained carousel buffers');
});

test('cached resources survive a rebuild and are disposed after the last scene releases them', async () => {
  const cache = createResourceCache();
  let loads = 0;
  const disposed = [];
  const acquire = () => cache.acquire('video\ncarousel\n/a.mp4', () => ({ id: ++loads }), value => disposed.push(value.id));
  const active = acquire();
  const rebuilt = acquire();
  assert.equal(await active.value, await rebuilt.value);
  active.release(); active.release();
  await Promise.resolve();
  assert.deepEqual(disposed, []);
  assert.equal(loads, 1);
  rebuilt.release();
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(disposed, [1]);
  assert.equal(cache.size, 0);
  const fresh = acquire();
  assert.equal((await fresh.value).id, 2);
  fresh.release();
});

test('failed loads are retried instead of cached', async () => {
  const cache = createResourceCache();
  let attempts = 0;
  const load = () => { if (++attempts === 1) throw new Error('decode failed'); return 'ok'; };
  const first = cache.acquire('image\n/a.png', load);
  await assert.rejects(first.value, /decode failed/);
  first.release();
  const second = cache.acquire('image\n/a.png', load);
  assert.equal(await second.value, 'ok');
  second.release();
});

test('lost WebGL contexts allow restoration, redraw and report a context that stays lost', async () => {
  const canvas = new EventTarget();
  let restored = 0, failed = 0;
  const watcher = watchContextLoss(canvas, { restored: () => restored++, failed: () => failed++, timeout: 5 });
  const lost = new Event('webglcontextlost', { cancelable: true });
  canvas.dispatchEvent(lost);
  assert.equal(lost.defaultPrevented, true);
  assert.equal(watcher.lost, true);
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  assert.equal(watcher.lost, false);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.deepEqual([restored, failed], [1, 0]);
  canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.deepEqual([restored, failed], [1, 1]);
  watcher.dispose();
});

test('in-place updates draw exactly what a rebuilt scene draws', { skip: !executablePath && 'Chrome or Edge is required for WebGL verification', timeout: 120000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import { createScene, stageMarkup } from './scene.js';
    let scene;
    window.build = async project => {
      const stage = document.querySelector('.stage'), node = document.createElement('div');
      node.innerHTML = stageMarkup(project);
      const next = await createScene(node, project);
      scene?.dispose(); scene = next; stage.replaceChildren(node);
      await scene.seek(1.3);
    };
    window.update = async project => { const updated = scene.update(project); if (updated) await scene.seek(1.3); return updated; };
    const pixels = async png => {
      const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    window.differing = async (a, b) => { const [x, y] = await Promise.all([pixels(a), pixels(b)]); return x.filter((value, i) => value !== y[i]).length; };
  ` }, bundle: true, write: false, format: 'iife' });
  const server = http.createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(`<!doctype html><style>${fontFaceCss('/fonts/')}body{margin:0}.stage{position:absolute;inset:0 auto auto 0;width:1080px;height:1080px;overflow:hidden}</style><div class="stage"></div><script>${bundle.outputFiles[0].text}</script>`); }
    try { const body = await readFile(path.join('public', path.normalize(pathname))); res.writeHead(200, { 'Content-Type': pathname.endsWith('.svg') ? 'image/svg+xml' : 'font/woff2' }); res.end(body); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing', '--force-color-profile=srgb', '--font-render-hinting=none', '--hide-scrollbars'] });
  t.after(() => browser.close());
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1080, height: 1080 });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const capture = async () => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return (await page.$('.stage')).screenshot({ encoding: 'base64' });
  };
  let project = validateProject(demoProject());
  await page.evaluate(project => window.build(project), project);
  const edits = [
    { carousel: { stretch: 0.9, size: 1.3, cardAspect: 1.4, cornerRadius: 30, cardShape: 'squircle', backface: 'hide', perspective: 60, effects: [{ type: 'dithering', amount: 0.7 }] },
      headline: { text: 'Updated <title>', color: '#ff00aa', size: 90, effects: [{ type: 'blur', enabled: true, amount: 6, mode: 'uniform', direction: 'bottom' }] }, background: { color: '#203040' } },
    { carousel: { stretch: 0, effects: [{ type: 'duotone', highlight: '#00ffaa' }] }, headline: { effects: [] }, signature: { visible: false } },
    // Per-image cards resize and re-crop in place; the demo posters are 4:5.
    { carousel: { cardFit: 'height', size: 1.2, cornerRadius: 12 } },
    { carousel: { cardFit: 'width', motionVariant: 'billboard' } },
    { carousel: { cardFit: 'fixed', cardAspect: 16 / 9 } }
  ];
  for (const edit of edits) {
    for (const [id, patch] of Object.entries(edit)) project = patchLayer(project, id, patch);
    assert.equal(await page.evaluate(project => window.update(project), project), true);
    const live = await capture();
    await page.evaluate(project => window.build(project), project);
    const rebuilt = await capture();
    assert.equal(await page.evaluate((a, b) => window.differing(a, b), live, rebuilt), 0, JSON.stringify(edit));
  }
  assert.equal(await page.evaluate(project => window.update(project), patchLayer(project, 'carousel', { template: 'stack' })), false);
  assert.deepEqual(errors, []);
});
