import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserCandidates } from '../scripts/renderer-runtime.mjs';
import { BASELINE_TOLERANCE, CAPTURE_WIDTH } from '../scripts/golden-frames.mjs';

const executablePath = [process.env.HYPERFRAMES_BROWSER_PATH, ...browserCandidates()].find(file => file && existsSync(file));

test('scene sources separate local geometry, Flat placement and projected source overrides', { skip: !executablePath && 'Chrome or Edge is required for capture pixels', timeout: 60000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import { createSceneCapture } from './scene-capture.js';
    import { createEffects, newEffect } from './effects.js';
    Object.assign(window, { createSceneCapture, createEffects, newEffect });
  ` }, bundle: true, write: false, format: 'iife' });
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`<div id="root" style="position:relative;width:200px;height:200px;transform:scale(.5);transform-origin:0 0">
    <div data-floc-layer="graphic" style="position:absolute;left:40px;top:20px;width:40px;height:20px;background:red;opacity:.5;transform:rotate(90deg);transform-origin:0 0;clip-path:inset(0 0 0 50%)"></div>
  </div>`);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const root = document.getElementById('root');
    const capture = window.createSceneCapture(root, { width: 100, height: 100 });
    const pixel = (value, x, y) => [...value.canvas.getContext('2d').getImageData(Math.floor((x - value.x) / value.width * value.canvas.width), Math.floor((y - value.y) / value.height * value.canvas.height), 1, 1).data];
    const local = capture.captureLayer('graphic', { local: true });
    const localResult = { bounds: [local.x, local.y, local.width, local.height], clear: pixel(local, 5, 10), painted: pixel(local, 30, 10) };
    const opaque = pixel(capture.captureLayer('graphic', { local: true, opacity: false }), 30, 10);
    const flat = capture.captureLayer('graphic');
    const flatResult = { pixel: pixel(flat, 25, 50), x: flat.x, y: flat.y };
    const source = document.createElement('canvas'); source.width = source.height = 100;
    const context = source.getContext('2d'); context.fillStyle = 'rgba(0,0,255,.5)'; context.fillRect(0, 0, 100, 100);
    const override = capture.captureLayer('graphic', { source, bounds: { x: 0, y: 0, width: 200, height: 200 }, opacity: false });
    const overrideResult = { bounds: [override.x, override.y, override.width, override.height], pixel: pixel(override, 2, 2) };
    capture.setResolution(200, 200);
    const resized = capture.captureLayer('graphic', { local: true, opacity: false });
    const resizedResult = { width: resized.canvas.width, bounds: resized.width, pixel: pixel(resized, 30, 10) };
    const image = new Image(), texture = document.createElement('canvas'); texture.width = 40; texture.height = 20;
    const paint = texture.getContext('2d'); paint.fillStyle = 'red'; paint.fillRect(0, 0, 20, 20); paint.fillStyle = 'blue'; paint.fillRect(20, 0, 20, 20);
    image.src = texture.toDataURL(); await image.decode();
    const media = document.createElement('div'); media.dataset.flocLayer = 'media';
    media.style.cssText = 'position:absolute;left:100px;top:100px;width:20px;height:20px;opacity:.5';
    image.style.cssText = 'position:absolute;width:20px;height:20px;object-fit:cover;object-position:100% 50%;opacity:.5';
    media.append(image); root.append(media);
    const mediaPixel = pixel(capture.captureLayer('media', { local: true, opacity: false }), 10, 10);
    const effect = window.newEffect('monochrome');
    const effects = window.createEffects(root, { format: 'square', layers: [{ id: 'graphic', type: 'media', effects: [] }, { id: 'grade', type: 'effect', effectScope: 'below', effects: [effect] }] }, { square: [200, 200] }, () => 1);
    await effects.seek(0);
    const adjusted = capture.captureAdjustment('grade', source);
    const adjustedResult = { width: adjusted.width, pixel: [...adjusted.getContext('2d').getImageData(100, 100, 1, 1).data] };
    effects.dispose(); capture.dispose();
    return { localResult, opaque, flatResult, overrideResult, resizedResult, adjustedResult, mediaPixel, remaining: root.querySelectorAll('svg').length, afterDispose: capture.captureLayer('graphic') };
  });
  assert.deepEqual(result.localResult.bounds, [0, 0, 40, 20]);
  assert.deepEqual(result.localResult.clear, [0, 0, 0, 0]);
  assert.deepEqual(result.localResult.painted, [255, 0, 0, 128]);
  assert.deepEqual(result.opaque, [255, 0, 0, 255]);
  assert.deepEqual(result.flatResult.pixel, [255, 0, 0, 128], 'Flat source applies its authored rotation and opacity once');
  assert.deepEqual(result.overrideResult.bounds, [0, 0, 200, 200]);
  assert.deepEqual(result.overrideResult.pixel, [0, 0, 255, 128], 'projected override is neither placed nor clipped nor faded a second time');
  assert.equal(result.resizedResult.width, 40); assert.equal(result.resizedResult.bounds, 40);
  assert.deepEqual(result.resizedResult.pixel, [255, 0, 0, 255]);
  assert.equal(result.adjustedResult.width, 200);
  const [r, g, b, a] = result.adjustedResult.pixel;
  assert.ok(Math.abs(r - g) <= 1 && Math.abs(g - b) <= 1 && r > 0);
  assert.equal(a, 128, 'Below adjustment reuses its current graph without changing premultiplied coverage');
  assert.deepEqual(result.mediaPixel, [0, 0, 255, 128], 'local source keeps media cover/object-position and child opacity without the root fade');
  assert.equal(result.remaining, 0); assert.equal(result.afterDispose, null);
});

test('native text edges and SVG effect grids survive fractional layer placement', { skip: !executablePath && 'Chrome or Edge is required for text pixel verification', timeout: 60000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import { createSceneCapture } from './scene-capture.js';
    import { createEffects, newEffect, EFFECTS } from './effects.js';
    Object.assign(window, { createSceneCapture, createEffects, newEffect, effectTypes: EFFECTS.map(effect => effect.id) });
  ` }, bundle: true, write: false, format: 'iife' });
  const font = (await readFile('public/fonts/druk-wide-heavy.woff2')).toString('base64');
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing', '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const types = await page.evaluate(() => window.effectTypes);
  for (const type of [null, ...types]) {
    const size = type ? 1080 : 360;
    await page.setViewport({ width: size + 40, height: size + 40, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><style>
      @font-face{font-family:Druk;src:url(data:font/woff2;base64,${font});font-weight:900}
      body{margin:0}
      #root{position:relative;width:1080px;height:1080px;transform:scale(${size / 1080});transform-origin:0 0}
    </style><div id="root">
      <div data-floc-layer="background" style="position:absolute;inset:0;background:#e0e0e0"></div>
      <div data-floc-layer="headline" style="position:absolute;left:64.8px;top:302.4px;width:972px;font:900 176px/.98 Druk;letter-spacing:-.035em;white-space:pre-wrap;overflow-wrap:anywhere;color:#163987;z-index:1">FLOC\nMOTION</div>
    </div>`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(async type => {
      await document.fonts.ready;
      window.fixtureProject = { format: 'square', layers: [{ id: 'background', type: 'background' }, { id: 'headline', type: 'text', effects: type ? [window.newEffect(type)] : [] }] };
      window.fixtureEffects = window.createEffects(document.getElementById('root'), window.fixtureProject, { square: [1080, 1080] }, () => 1);
      await window.fixtureEffects.seek(.7);
    }, type);
    const native = await page.screenshot({ encoding: 'base64', clip: { x: 0, y: 0, width: size, height: size } });
    const difference = await page.evaluate(async ({ native, size, width, channel }) => {
      const image = new Image(); image.src = 'data:image/png;base64,' + native; await image.decode();
      const expected = document.createElement('canvas'); expected.width = expected.height = width;
      const context = expected.getContext('2d'); context.imageSmoothingQuality = 'high'; context.drawImage(image, 0, 0, width, width);
      const before = context.getImageData(0, 0, width, width).data;
      const root = document.getElementById('root');
      const capture = window.createSceneCapture(root, { width: size, height: size });
      const output = document.createElement('canvas'); output.width = output.height = size;
      const target = output.getContext('2d'); target.setTransform(size / 1080, 0, 0, size / 1080, 0, 0);
      for (const layer of window.fixtureProject.layers) {
        const value = capture.captureLayer(layer.id);
        target.drawImage(value.canvas, value.x, value.y, value.width, value.height);
      }
      const actual = document.createElement('canvas'); actual.width = actual.height = width;
      const paint = actual.getContext('2d'); paint.imageSmoothingQuality = 'high'; paint.drawImage(output, 0, 0, width, width);
      const after = paint.getImageData(0, 0, width, width).data;
      let changed = 0, maximum = 0;
      for (let index = 0; index < before.length; index += 4) {
        const delta = Math.max(...[0, 1, 2, 3].map(offset => Math.abs(before[index + offset] - after[index + offset])));
        if (delta > channel) changed++;
        maximum = Math.max(maximum, delta);
      }
      capture.dispose(); window.fixtureEffects.dispose();
      return { ratio: changed / (width * width), maximum };
    }, { native, size, width: CAPTURE_WIDTH, channel: BASELINE_TOLERANCE.channel });
    assert.ok(difference.ratio <= BASELINE_TOLERANCE.ratio, `${type ?? 'plain'} retains native glyphs and effect grids within the golden-frame tolerance: ${JSON.stringify(difference)}`);
  }
});
