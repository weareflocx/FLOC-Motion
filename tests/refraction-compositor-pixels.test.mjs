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

test('refraction capture retains native SVG coordinates, pick targets and transparent knockout', { skip: !executablePath && 'Chrome or Edge is required for compositor pixel verification', timeout: 60000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import { createRefractionCompositor } from './refraction-compositor.js';
    window.createRefractionCompositor = createRefractionCompositor;
  ` }, bundle: true, write: false, format: 'iife' });
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 1200 });
  await page.setContent(`<!doctype html><style>body{margin:0}</style><body>
    <div id="root" style="position:relative;width:1080px;height:1080px;transform:scale(.5);transform-origin:0 0">
      <svg width="0" height="0"><defs><filter id="offset" x="-1" y="-1" width="3" height="3" primitiveUnits="userSpaceOnUse"><feOffset dx="54" dy="0"/></filter></defs></svg>
      <div data-floc-layer="source" style="position:absolute;left:108px;top:108px;width:108px;height:108px;background:red;filter:url(#offset)"></div>
      <canvas data-floc-layer="glass" style="position:absolute;left:810px;top:810px;width:108px;height:108px;z-index:1"></canvas>
    </div>
  </body>`);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(() => {
    const root = document.getElementById('root'), source = root.querySelector('[data-floc-layer="source"]'), glass = root.querySelector('[data-floc-layer="glass"]');
    const project = { format: 'square', layers: [{ id: 'source', type: 'background' }, { id: 'glass', type: 'model', visible: true, start: 0, end: 10, modelStyle: { shader: 'refractive' } }] };
    const beauty = document.createElement('canvas'), mask = document.createElement('canvas');
    beauty.width = beauty.height = mask.width = mask.height = 32;
    mask.getContext('2d').fillRect(0, 0, 32, 32);
    const compositor = window.createRefractionCompositor(root, { width: 216, height: 216 });
    compositor.setEnabled(true);
    const calls = [];
    const render = (id, backdrop, rect) => { calls.push({ id, rect, pixel: [...backdrop.getContext('2d').getImageData(43, 32, 1, 1).data] }); return { canvas: beauty, mask }; };
    compositor.draw(project, 1, render);
    const output = root.querySelector('[data-floc-refraction-output]');
    const pixel = (x, y) => [...output.getContext('2d').getImageData(x, y, 1, 1).data];
    const shifted = pixel(43, 32), unshifted = pixel(24, 32), untouched = pixel(120, 120);
    const rect = source.getBoundingClientRect();
    const pickable = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === source;
    const stylePreserved = source.style.filter === 'url("#offset")' || source.style.filter === 'url(#offset)';
    source.style.filter = ''; source.style.left = source.style.top = '0px'; source.style.width = source.style.height = '1080px';
    glass.style.left = glass.style.top = '108px'; glass.style.opacity = '.5';
    compositor.draw(project, 1, render);
    const halfKnockout = pixel(32, 32), outsideKnockout = pixel(70, 70);
    const covered = beauty.getContext('2d'); covered.fillStyle = 'blue'; covered.fillRect(0, 0, 32, 32);
    compositor.draw(project, 1, render);
    const halfReplacement = pixel(32, 32);
    compositor.setResolution(432, 432);
    const preserved = { width: output.width, pixel: pixel(32, 32) };
    compositor.draw(project, 1, render);
    const resized = { width: output.width, height: output.height, pixel: pixel(64, 64) };
    compositor.setEnabled(false);
    const restored = !source.hasAttribute('data-floc-refraction-hidden') && output.style.display === 'none' && glass.style.opacity === '0.5';
    compositor.dispose();
    return { shifted, unshifted, untouched, pickable, stylePreserved, calls, halfKnockout, outsideKnockout, halfReplacement, preserved, resized, restored, remaining: root.querySelectorAll('[data-floc-refraction-output]').length };
  });
  assert.deepEqual(result.shifted, [255, 0, 0, 255], 'native SVG displacement scales in output pixels and retains its local origin');
  assert.deepEqual(result.unshifted, [0, 0, 0, 0]);
  assert.deepEqual(result.untouched, [0, 0, 0, 0], 'an SVG filter does not flood the backing canvas outside its element');
  assert.equal(result.pickable, true, 'paint-suppressed sources retain HTML hit targets');
  assert.equal(result.stylePreserved, true);
  assert.deepEqual(result.calls[0].rect, { x: .75, y: .75, width: .1, height: .1 }, 'preview CSS zoom does not change model placement');
  assert.deepEqual(result.calls[0].pixel, [255, 0, 0, 255]);
  assert.equal(result.halfKnockout[0], 255);
  assert.ok(Math.abs(result.halfKnockout[3] - 128) <= 1, 'transparent beauty still removes coverage at layer opacity');
  assert.deepEqual(result.outsideKnockout, [255, 0, 0, 255]);
  assert.ok(Math.abs(result.halfReplacement[0] - 128) <= 1 && Math.abs(result.halfReplacement[2] - 128) <= 1);
  assert.equal(result.halfReplacement[3], 255, 'lighter replacement preserves the destination alpha instead of double source-over');
  assert.equal(result.preserved.width, 216);
  assert.deepEqual(result.preserved.pixel, result.halfReplacement, 'resizing does not clear the last visible composite before its seek');
  assert.equal(result.resized.width, 432); assert.equal(result.resized.height, 432);
  assert.deepEqual(result.resized.pixel, result.halfReplacement);
  assert.equal(result.restored, true); assert.equal(result.remaining, 0);
});

test('native text edges and SVG effect grids survive fractional layer placement', { skip: !executablePath && 'Chrome or Edge is required for text pixel verification', timeout: 60000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import { createRefractionCompositor } from './refraction-compositor.js';
    import { createEffects, newEffect, EFFECTS } from './effects.js';
    Object.assign(window, { createRefractionCompositor, createEffects, newEffect, effectTypes: EFFECTS.map(effect => effect.id) });
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
      const compositor = window.createRefractionCompositor(root, { width: size, height: size });
      compositor.setEnabled(true);
      compositor.draw(window.fixtureProject, .7, () => { throw new Error('No model should be requested by this text-only capture'); });
      const output = root.querySelector('[data-floc-refraction-output]');
      const actual = document.createElement('canvas'); actual.width = actual.height = width;
      const paint = actual.getContext('2d'); paint.imageSmoothingQuality = 'high'; paint.drawImage(output, 0, 0, width, width);
      const after = paint.getImageData(0, 0, width, width).data;
      let changed = 0, maximum = 0;
      for (let index = 0; index < before.length; index += 4) {
        const delta = Math.max(...[0, 1, 2, 3].map(offset => Math.abs(before[index + offset] - after[index + offset])));
        if (delta > channel) changed++;
        maximum = Math.max(maximum, delta);
      }
      compositor.dispose(); window.fixtureEffects.dispose();
      return { ratio: changed / (width * width), maximum };
    }, { native, size, width: CAPTURE_WIDTH, channel: BASELINE_TOLERANCE.channel });
    assert.ok(difference.ratio <= BASELINE_TOLERANCE.ratio, `${type ?? 'plain'} retains native glyphs and effect grids within the golden-frame tolerance: ${JSON.stringify(difference)}`);
  }
});
