import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { executablePath } from '../scripts/golden-frames.mjs';

test('color treatments preserve translucent colors and continuous dither tones', { skip: !executablePath && 'Chrome or Edge is required for effect quality verification', timeout: 60000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import { createEffects, newEffect } from './effects.js';
    import { createSceneCapture } from './scene-capture.js';
    window.treat = async (type, patch = {}, tone = 128, alpha = 1) => {
      const root = document.createElement('div');
      root.style.cssText = 'position:relative;width:128px;height:128px';
      const source = document.createElement('canvas'); source.width = source.height = 128;
      source.dataset.flocLayer = 'source'; source.style.cssText = 'position:absolute;inset:0;width:128px;height:128px';
      const context = source.getContext('2d'); context.fillStyle = 'rgba(' + tone + ',' + tone + ',' + tone + ',' + alpha + ')'; context.fillRect(0, 0, 128, 128);
      root.append(source); document.body.append(root);
      const project = { format: 'fixture', layers: [{ id: 'source', type: 'media', effects: [{ ...newEffect(type), ...patch }], start: 0 }] };
      const effects = createEffects(root, project, { fixture: [1080, 1080] }, () => 1);
      await effects.seek(.5);
      const capture = createSceneCapture(root, { width: 128, height: 128 });
      const value = capture.captureLayer('source', { local: true });
      const pixels = [...value.canvas.getContext('2d').getImageData(16 - value.x, 16 - value.y, 96, 96).data];
      capture.dispose(); effects.dispose(); root.remove(); return pixels;
    };
  ` }, bundle: true, write: false, format: 'iife' });
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  await t.test('chromatic split does not make translucent interiors opaque or darker', async () => {
    const pixels = await page.evaluate(() => window.treat('chromatic', { amount: 1 }, 128, .5));
    for (let i = 0; i < pixels.length; i += 4) {
      assert.equal(pixels[i + 3], 128, 'channel recombination preserves source coverage');
      assert.ok(pixels.slice(i, i + 3).every(value => Math.abs(value - 128) <= 2), 'unshifted interior keeps its original color');
    }
  });

  for (const [type, patch] of [['halftone', { size: .3 }], ['dithering', { size: .2, steps: 7 }], ['fluted-glass', { distortion: 0 }]]) {
    await t.test(`${type} separates color treatment from source opacity`, async () => {
      const opaque = await page.evaluate((type, patch) => window.treat(type, patch, 160, 1), type, patch);
      const translucent = await page.evaluate((type, patch) => window.treat(type, patch, 160, .5), type, patch);
      let maximum = 0;
      for (let i = 0; i < opaque.length; i += 4) {
        assert.equal(translucent[i + 3], 128, 'the treatment applies coverage once');
        for (let c = 0; c < 3; c++) maximum = Math.max(maximum, Math.abs(opaque[i + c] - translucent[i + c]));
      }
      // Half-alpha premultiplication can round the input by one RGB level;
      // a softened dither threshold may amplify that slightly, not by a full step.
      assert.ok(maximum <= 8, `opacity changed the treated RGB by ${maximum}/255`);
    });
  }

  await t.test('fine dithering preserves intermediate tone averages instead of pre-posterizing', async () => {
    for (const tone of [40, 70, 100, 130, 160, 190, 220]) {
      const pixels = await page.evaluate(tone => window.treat('dithering', { size: 0, steps: 7 }, tone), tone);
      let total = 0;
      for (let i = 0; i < pixels.length; i += 4) total += pixels[i];
      const mean = total / (pixels.length / 4);
      assert.ok(Math.abs(mean - tone) <= 3, `input ${tone} became mean ${mean.toFixed(2)}`);
    }
  });

  await t.test('one-level video fluctuations do not flash whole dither color steps', async () => {
    for (const tone of [31, 63, 95, 127, 159, 191, 223]) {
      const before = await page.evaluate(tone => window.treat('dithering', { size: 0, steps: 4 }, tone), tone);
      const after = await page.evaluate(tone => window.treat('dithering', { size: 0, steps: 4 }, tone + 1), tone);
      let maximum = 0;
      for (let i = 0; i < before.length; i += 4) maximum = Math.max(maximum, Math.abs(before[i] - after[i]));
      assert.ok(maximum <= 16, `one input level caused a ${maximum}/255 flash at tone ${tone}`);
    }
  });
});
