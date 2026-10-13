import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserCandidates } from '../scripts/renderer-runtime.mjs';
import { DEFAULT_PROCEDURAL_BACKGROUND, PROCEDURAL_BACKGROUNDS, backgroundUniforms } from '../src/backgrounds.js';
import { stageMarkup } from '../src/scene.js';
import { demoProject, validateProject } from '../src/project.js';

const executablePath = [process.env.HYPERFRAMES_BROWSER_PATH, ...browserCandidates()].find(file => file && existsSync(file));
const IDS = PROCEDURAL_BACKGROUNDS.map(({ id }) => id);

test('grain advances exactly once per video frame and speed zero freezes everything', () => {
  for (const fps of [24, 25, 30, 60]) for (let frame = 0; frame < 3 * fps; frame++) {
    assert.equal(backgroundUniforms({ pattern: 'grain' }, frame / fps, 1920, 1080, fps).frame, frame);
  }
  const frozen = t => backgroundUniforms({ pattern: 'noise', patternSpeed: 0, patternGrain: 0.5 }, t, 1920, 1080, 30);
  assert.deepEqual(frozen(80), frozen(0));
  const forward = backgroundUniforms({ pattern: 'waves', patternSpeed: 1.5 }, 2, 1920, 1080);
  const reverse = backgroundUniforms({ pattern: 'waves', patternSpeed: -1.5 }, 2, 1920, 1080);
  assert.equal(reverse.time, -forward.time);
  assert.equal(reverse.frame, forward.frame);
});

test('exports at any resolution share scene geometry, and inputs are clamped', () => {
  const normal = backgroundUniforms({ pattern: 'mesh' }, 1, 1080, 1920);
  const high = backgroundUniforms({ pattern: 'mesh' }, 1, 2160, 3840);
  assert.equal(high.unit, normal.unit * 2);
  assert.deepEqual({ ...high, unit: 0 }, { ...normal, unit: 0 });
  const extreme = backgroundUniforms({ pattern: 'runtime-glsl', patternScale: 99, patternIntensity: -1, patternSpeed: Infinity, patternVignette: 7, patternGrain: -3 }, -5, 1080, 1080);
  assert.equal(extreme.pattern, IDS.indexOf(DEFAULT_PROCEDURAL_BACKGROUND.pattern));
  assert.deepEqual([extreme.scale, extreme.weight, extreme.time, extreme.vignette, extreme.grain], [4, 0, 0, 1, 0]);
});

test('procedural stage markup has native dimensions, timing and authored stacking', () => {
  const p = validateProject(demoProject());
  const background = p.layers.find(layer => layer.type === 'background');
  const markup = stageMarkup({ ...p, format: 'portrait', layers: [{ ...background, mode: 'procedural', visible: false, start: 2, end: 7 }] });
  assert.match(markup, /id="background-background"/);
  assert.match(markup, /width="1080" height="1920"/);
  assert.match(markup, /data-start="2" data-duration="5" data-track-index="0"/);
  assert.match(markup, /z-index:0;opacity:0/);
  assert.doesNotMatch(markup, /<img|<video/);
  const legacy = stageMarkup({ ...p, layers: [background] });
  assert.match(legacy, /background:#/);
  assert.doesNotMatch(legacy, /<canvas/);
});

test('rendered patterns are distinct, seek-safe, balanced, stable in motion and legible as tiles', { skip: !executablePath && 'Chrome or Edge is required for WebGL verification', timeout: 120000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import { drawProceduralBackground, drawBackgroundPreview } from './backgrounds.js';
    const pixels = (layer, time, width = 480, height = 270) => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      if (!drawProceduralBackground(canvas, layer, time)) throw new Error('not drawn');
      return canvas.getContext('2d').getImageData(0, 0, width, height).data;
    };
    const digest = data => { let h = 2166136261; for (let i = 0; i < data.length; i += 4) h = Math.imul(h ^ data[i] ^ (data[i + 1] << 8) ^ (data[i + 2] << 16), 16777619); return h >>> 0; };
    // Mean distance from black, 0–1, on a black base with white ink.
    const coverage = data => { let sum = 0; for (let i = 0; i < data.length; i += 4) sum += data[i]; return sum / (data.length / 4) / 255; };
    window.probe = {
      digest: (layer, time) => digest(pixels(layer, time)),
      coverage: (layer, time) => coverage(pixels(layer, time, 960, 540)),
      // Brightest pixel of one row segment that a grid line crosses.
      linePeak: (layer, time) => { const data = pixels(layer, time, 1920, 1080); let max = 0; for (let x = 200; x < 400; x++) max = Math.max(max, data[(540 * 1920 + x) * 4]); return max; },
      tile: layer => { const canvas = document.createElement('canvas'); canvas.width = 144; canvas.height = 81; drawBackgroundPreview(canvas, layer); const data = canvas.getContext('2d').getImageData(0, 0, 144, 81).data; let max = 0; for (let i = 0; i < data.length; i += 4) max = Math.max(max, data[i]); return { max, mean: coverage(data) * 255 }; }
    };` }, bundle: true, write: false, format: 'iife' });
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });
  t.after(() => browser.close());
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<body></body>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const base = { color: '#000000', patternColor: '#ffffff', patternScale: 1, patternIntensity: 0.35, patternSpeed: 0.2, patternSeed: 1, patternVignette: 0, patternGrain: 0 };
  const run = (name, ...args) => page.evaluate((name, args) => window.probe[name](...args), name, args);

  const digests = [];
  for (const pattern of IDS) {
    const layer = { ...base, pattern };
    const before = await run('digest', layer, 0.4);
    await run('digest', layer, 8);
    assert.equal(await run('digest', layer, 0.4), before, `${pattern} reverse seek`);
    assert.notEqual(await run('digest', { ...layer, patternSeed: 37 }, 0.4), before, `${pattern} seed`);
    assert.notEqual(await run('digest', layer, 1.7), before, `${pattern} motion`);
    const still = { ...layer, patternSpeed: 0, patternGrain: 0.4 };
    assert.equal(await run('digest', still, 80), await run('digest', still, 0), `${pattern} frozen`);
    digests.push(before);
    // At full intensity no pattern disappears or floods the frame.
    const weight = await run('coverage', { ...layer, patternIntensity: 1 }, 2);
    assert(weight > 0.008 && weight < 0.4, `${pattern} visual weight ${weight}`);
    const tile = await run('tile', layer);
    assert(tile.max >= 20 && tile.mean >= 1.5, `${pattern} tile ${JSON.stringify(tile)}`);
  }
  assert.equal(new Set(digests).size, IDS.length);

  // Slow drift moves lines by fractions of a pixel; antialiasing keeps them at full brightness.
  const peaks = [];
  for (let frame = 0; frame < 12; frame++) peaks.push(await run('linePeak', { ...base, pattern: 'grid' }, 2 + frame / 24));
  assert(Math.max(...peaks) - Math.min(...peaks) <= 3, `grid line shimmer ${peaks}`);

  // Vignette darkens the corners; grain adds texture without shifting the average.
  const plain = { ...base, color: '#808080', pattern: 'gradient', patternIntensity: 0 };
  assert(await run('coverage', { ...plain, patternVignette: 1 }, 1) < await run('coverage', plain, 1) - 0.05);
  assert(Math.abs(await run('coverage', { ...plain, patternGrain: 1 }, 1) - await run('coverage', plain, 1)) < 0.01);
  assert.notEqual(await run('digest', { ...plain, patternGrain: 1 }, 1), await run('digest', plain, 1));
  assert.deepEqual(errors, []);
});
