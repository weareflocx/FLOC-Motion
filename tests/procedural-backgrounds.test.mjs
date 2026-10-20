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

test('animated speed and direction integrate over time, so keyframes never make the pattern jump', () => {
  const keyed = (values, easing = 'linear') => values.map(([time, value], i) => ({ id: `s${i}`, time, easing, values: value }));
  const grid = { type: 'background', mode: 'procedural', pattern: 'grid', start: 0, end: 6, patternSpeed: 0, patternDirection: 315 };
  // Speed ramps linearly from 0 to 1 over 4 s: the pattern travels the ramp's area.
  const ramp = { ...grid, choreography: keyed([[0, { patternSpeed: 0 }], [4, { patternSpeed: 1 }]]) };
  const at = seconds => backgroundUniforms(ramp, seconds, 1080, 1080);
  assert.ok(Math.abs(at(2).time - 0.5) < 1e-9 && Math.abs(at(4).time - 2) < 1e-9 && Math.abs(at(5).time - 3) < 1e-9);
  assert.equal(at(0).frame, 0, 'grain is frozen while the animated speed is zero');
  // While a state turns the direction, the pattern moves along the current
  // direction at the current speed instead of swinging its whole path around.
  const turn = { ...grid, patternSpeed: 1, choreography: keyed([[0, { patternDirection: 0 }], [3, { patternDirection: 90 }]], 'ease-in-out') };
  for (const seconds of [0.75, 1.5, 2.25]) {
    const before = backgroundUniforms(turn, seconds - 1e-4, 1080, 1080).drift, after = backgroundUniforms(turn, seconds + 1e-4, 1080, 1080).drift;
    const { direction } = backgroundUniforms(turn, seconds, 1080, 1080), rate = 0.25 * Math.SQRT2;
    assert.ok([0, 1].every(i => Math.abs((after[i] - before[i]) / 2e-4 - rate * direction[i]) < 1e-3), `velocity follows the direction at ${seconds} s`);
  }
  // A looping background with animated speed still ends on whole lattice steps.
  const loop = backgroundUniforms({ ...ramp, patternLoop: true }, 6 - 1e-9, 1080, 1080);
  assert.ok(loop.drift.every(cells => Math.abs(cells - Math.round(cells)) < 1e-6) && loop.drift.some(cells => Math.round(cells) !== 0), JSON.stringify(loop.drift));
  assert.ok(Math.abs(loop.time - loop.loop) < 1e-6);
  // Animated colors and pattern values reach the shader.
  const colors = backgroundUniforms({ ...grid, color: '#000000', choreography: keyed([[0, { color: '#000000', patternIntensity: 0 }], [2, { color: '#ffffff', patternIntensity: 1 }]]) }, 2, 1080, 1080);
  assert.deepEqual([colors.base, colors.weight], [[1, 1, 1], 1]);
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
      tile: layer => { const canvas = document.createElement('canvas'); canvas.width = 144; canvas.height = 81; drawBackgroundPreview(canvas, layer); const data = canvas.getContext('2d').getImageData(0, 0, 144, 81).data; let max = 0; for (let i = 0; i < data.length; i += 4) max = Math.max(max, data[i]); return { max, mean: coverage(data) * 255 }; },
      // Mean absolute RGB difference (0–255) between frame b and frame a moved up by \`up\` pixels.
      difference: (a, timeA, b, timeB, up = 0) => {
        const first = pixels(a, timeA), second = pixels(b, timeB);
        let sum = 0, count = 0;
        for (let y = Math.max(0, -up); y < 270 - Math.max(0, up); y++) for (let x = 0; x < 480; x++) for (let c = 0; c < 3; c++) {
          sum += Math.abs(second[(y * 480 + x) * 4 + c] - first[((y + up) * 480 + x) * 4 + c]); count++;
        }
        return sum / count;
      },
      // Mean red value of the square of radius r pixels around a point given as fractions of the frame.
      region: (layer, time, fx, fy, r) => {
        const data = pixels(layer, time), cx = Math.round(fx * 480), cy = Math.round(fy * 270);
        let sum = 0, count = 0;
        for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) { sum += data[(y * 480 + x) * 4]; count++; }
        return sum / count;
      }
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
    // At full intensity no pattern disappears or floods the frame, even at the smallest scale.
    for (const patternScale of [1, 0.1]) {
      const weight = await run('coverage', { ...layer, patternIntensity: 1, patternScale }, 2);
      assert(weight > 0.008 && weight < 0.4, `${pattern} visual weight ${weight} at scale ${patternScale}`);
    }
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

  // Seamless loops: approaching the layer's end converges on its first frame,
  // while every pattern still moves mid-loop. Grain frames are independent,
  // so grain needs no loop.
  const looping = { ...base, start: 0, end: 6, patternLoop: true, patternSpeed: 0.7, patternIntensity: 1 };
  for (const pattern of IDS.filter(id => id !== 'grain')) {
    const layer = { ...looping, pattern };
    const seam = await run('difference', layer, 0, layer, 6 - 1e-3);
    assert(seam < 0.3, `${pattern} loop seam ${seam}`);
    const midway = await run('difference', layer, 0, layer, 3);
    assert(midway > 1, `${pattern} moves within its loop ${midway}`);
    const unlooped = { ...layer, patternLoop: false };
    assert(await run('difference', unlooped, 0, unlooped, 6 - 1e-3) > seam + 0.5, `${pattern} only closes when looping`);
  }

  // Direction 90° moves straight up: dots cells are 23 px at 480×270, and
  // this much time drifts them 10 px.
  const rising = { ...base, pattern: 'dots', patternIntensity: 1, patternSpeed: 1, patternDirection: 90 };
  const tenPixels = 10 / 23 / (0.25 * Math.SQRT2);
  assert(await run('difference', rising, 0, rising, tenPixels, 10) < 1, 'direction 90 moves up');
  assert(await run('difference', rising, 0, rising, tenPixels, -10) > 5, 'direction 90 does not move down');

  // Rays leave their focus dark, wherever it is placed.
  for (const [x, y] of [[20, 80], [80, 20]]) {
    const rays = { ...base, pattern: 'rays', patternIntensity: 1, patternFocusX: x, patternFocusY: y };
    assert(await run('region', rays, 1, x / 100, y / 100, 4) < 2, `rays centered on ${x}, ${y}`);
    assert(await run('coverage', rays, 1) > 0.02);
  }
  assert.deepEqual(errors, []);
});

test('shared-context backgrounds crop the target viewport and rebuild after root recovery', { skip: !executablePath && 'Chrome or Edge is required for shared WebGL verification', timeout: 60000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import * as THREE from 'three';
    import { drawProceduralBackground, PROCEDURAL_BACKGROUNDS } from './backgrounds.js';
    import { createSceneRenderer } from './scene-renderer.js';
    Object.assign(window, { THREE, createSceneRenderer, drawProceduralBackground, patterns: PROCEDURAL_BACKGROUNDS.map(value => value.id) });
  ` }, bundle: true, write: false, format: 'iife' });
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });
  t.after(() => browser.close());
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<body></body>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const { THREE } = window, rendering = window.createSceneRenderer(), { renderer, canvas } = rendering;
    let rt, texture, unwatch;
    const pixels = target => target.getContext('2d').getImageData(0, 0, target.width, target.height).data;
    const difference = (a, b) => {
      let maximum = 0; for (let i = 0; i < a.length; i++) maximum = Math.max(maximum, Math.abs(a[i] - b[i]));
      return maximum;
    };
    const contextEvent = (type, trigger) => new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); canvas.removeEventListener(type, done); };
      const done = () => { cleanup(); resolve(); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for ' + type)); }, 3000);
      canvas.addEventListener(type, done, { once: true });
      try { trigger(); } catch (error) { cleanup(); reject(error); }
    });
    try {
      rendering.capacity(1024, 768);
      const target = document.createElement('canvas'); target.width = 192; target.height = 108;
      const expected = document.createElement('canvas'); expected.width = 192; expected.height = 108;
      const visible = document.createElement('canvas'); document.body.append(visible);
      rt = new THREE.WebGLRenderTarget(64, 64);
      renderer.setRenderTarget(rt); renderer.setViewport(3, 4, 50, 48); renderer.setScissor(5, 6, 40, 36); renderer.setScissorTest(true);
      const gl = renderer.getContext(), viewport = [...gl.getParameter(gl.VIEWPORT)], scissor = [...gl.getParameter(gl.SCISSOR_BOX)];
      const differences = [];
      for (const pattern of window.patterns) {
        const layer = { pattern, color: '#17223a', patternColor: '#edab71', patternSeed: 29, patternIntensity: .8, patternVignette: .4 };
        if (!window.drawProceduralBackground(expected, layer, 1.3, 24) || !window.drawProceduralBackground(target, layer, 1.3, 24, renderer)) throw new Error('Background was not drawn: ' + pattern);
        differences.push({ pattern, maximum: difference(pixels(target), pixels(expected)) });
      }
      const state = { target: renderer.getRenderTarget() === rt, viewport: [...gl.getParameter(gl.VIEWPORT)], scissor: [...gl.getParameter(gl.SCISSOR_BOX)], scissorTest: renderer.getScissorTest() };
      renderer.setRenderTarget(null); renderer.setViewport(0, 0, 1024, 768); renderer.setScissorTest(false);
      renderer.setClearColor('#ff00ff', 1); renderer.clear();
      const reuse = new Uint8Array(4); gl.readPixels(20, 20, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, reuse);
      texture = new THREE.CanvasTexture(target);
      texture.minFilter = texture.magFilter = THREE.NearestFilter;
      let requestedTime = .7, restoredDraw = false;
      const settings = { pattern: 'waves', patternSeed: 12, color: '#121212', patternGrain: .4 };
      const drawVisible = () => {
        if (!window.drawProceduralBackground(target, settings, requestedTime, 24, renderer)) return false;
        texture.needsUpdate = true;
        rendering.frame(target.width, target.height); rendering.drawCopy(texture); rendering.copyTo(visible);
        return true;
      };
      unwatch = rendering.watch({ restored() { restoredDraw = drawVisible(); } });
      if (!drawVisible()) throw new Error('Initial visible background was not drawn');
      window.drawProceduralBackground(expected, settings, requestedTime, 24);
      const visibleBefore = new Uint8ClampedArray(pixels(visible));
      const initialMaximum = difference(visibleBefore, pixels(expected));
      await contextEvent('webglcontextlost', () => renderer.forceContextLoss());
      const rootLost = rendering.lost;
      requestedTime = 2.3;
      const lostDraw = drawVisible(), retainedMaximum = difference(pixels(visible), visibleBefore);
      // Restoration is not permitted until the browser finishes the loss event.
      await new Promise(resolve => setTimeout(resolve, 100));
      await contextEvent('webglcontextrestored', () => renderer.forceContextRestore());
      window.drawProceduralBackground(expected, settings, requestedTime, 24);
      const recoveredMaximum = difference(pixels(visible), pixels(expected));
      const advancedMaximum = difference(pixels(visible), visibleBefore);
      return { differences, state, viewport, scissor, reuse: [...reuse], rootLost, lostDraw, restoredDraw,
        initialMaximum, retainedMaximum, recoveredMaximum, advancedMaximum, rootRecovered: !rendering.lost,
        visibleSize: [visible.width, visible.height], rootSize: [canvas.width, canvas.height] };
    } finally {
      unwatch?.(); texture?.dispose(); rt?.dispose(); rendering.dispose();
    }
  });
  for (const { pattern, maximum } of result.differences) assert.ok(maximum <= 1, `${pattern} keeps its actual shader pixels inside the smaller target: ${maximum}`);
  assert.equal(result.state.target, true); assert.equal(result.state.scissorTest, true);
  assert.deepEqual(result.state.viewport, result.viewport); assert.deepEqual(result.state.scissor, result.scissor);
  assert.deepEqual(result.reuse, [255, 0, 255, 255], 'Three can draw normally after the native shader pass');
  assert.ok(result.initialMaximum <= 1, `The common scene surface crops the source without scaling: ${result.initialMaximum}`);
  assert.deepEqual(result.visibleSize, [192, 108]); assert.deepEqual(result.rootSize, [1024, 768]);
  assert.equal(result.rootLost, true); assert.equal(result.lostDraw, false);
  assert.equal(result.retainedMaximum, 0, 'The visible output retains its last frame while the shared context is lost');
  assert.equal(result.rootRecovered, true); assert.equal(result.restoredDraw, true);
  assert.ok(result.recoveredMaximum <= 1, `Root recovery redraws the requested frame on the visible surface: ${result.recoveredMaximum}`);
  assert.ok(result.advancedMaximum > 1, 'Recovery displays the newly requested frame rather than stale pixels');
  assert.deepEqual(errors, []);
});
