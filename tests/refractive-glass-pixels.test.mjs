import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserCandidates } from '../scripts/renderer-runtime.mjs';

const executablePath = [process.env.HYPERFRAMES_BROWSER_PATH, ...browserCandidates()].find(file => file && existsSync(file));

test('refractive glass bends lower scene pixels without ghosting alpha or refracting upper layers', { skip: !executablePath && 'Chrome or Edge is required for refraction verification', timeout: 120000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import * as THREE from 'three';
    import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
    import { createScene, stageMarkup } from './scene.js';
    import { blankProject, demoProject, fileLayer, patchLayer, validateProject, FORMATS } from './project.js';
    import { DEFAULT_MODEL_STYLE, applyModelPreset } from './model-style.js';
    import { newEffect } from './effects.js';
    const MODEL = '/assets/00000000-0000-4000-8000-000000000001.glb';
    const IMAGE = '/assets/00000000-0000-4000-8000-000000000002.png';
    const errors = [], urls = [];
    let engine, canonical, modelURL, imageURL;
    const root = document.getElementById('stage');
    const style = { ...DEFAULT_MODEL_STYLE, mode: 'replace', shader: 'refractive', color: '#ffffff', roughness: 0,
      ior: 1.6, dispersion: 0, refractionThickness: .7, refractionSamples: 8, refractionResolution: 512,
      environment: 'none', ambientIntensity: 0, keyIntensity: 0, fillIntensity: 0, rimIntensity: 0,
      animationClip: -1, motion: 'none', toneMapping: 'none' };
    // Canonical project edits are validated first. Blob URLs are only this test's transport
    // for locally authored GLB/image bytes, matching the existing model-pixel fixtures.
    const transportImage = image => image.src === IMAGE ? { ...image, src: imageURL } : image;
    const transport = project => ({ ...project, images: project.images.map(transportImage), layers: project.layers.map(layer => ({ ...layer,
      ...(layer.images ? { images: layer.images.map(transportImage) } : {}),
      ...(layer.src === MODEL ? { src: modelURL } : layer.src === IMAGE ? { src: imageURL } : {}) })) });
    async function setup(opacity = 1) {
      const geometry = new THREE.SphereGeometry(1, 48, 32), material = new THREE.MeshStandardMaterial({ color: '#ffffff', opacity, transparent: opacity < 1 });
      try { modelURL = URL.createObjectURL(new Blob([await new GLTFExporter().parseAsync(new THREE.Mesh(geometry, material), { binary: true })], { type: 'model/gltf-binary' })); urls.push(modelURL); }
      finally { geometry.dispose(); material.dispose(); }
      const image = document.createElement('canvas'); image.width = 60; image.height = 20;
      image.getContext('2d').fillStyle = '#00ff00'; image.getContext('2d').fillRect(0, 0, 60, 20);
      imageURL = image.toDataURL();
    }
    function project({ transparent = false, upper = false, second = false, carousel = false, format = 'square', modelStyle = {} } = {}) {
      const base = blankProject(); base.format = format;
      const background = { ...base.layers[0], mode: 'procedural', pattern: 'checkerboard', patternColor: '#000000', patternIntensity: 1, patternSpeed: 0, patternScale: 1 };
      const text = { id: 'title', type: 'text', name: 'Behind', visible: true, locked: false, start: 0, end: 12,
        text: 'REFRACTION\\n0123456789', x: 4, y: 34, width: 92, size: 128, color: '#000000', weight: 700, font: 'geist', fadeIn: 0, fadeOut: 0, rise: false };
      const lens = { ...fileLayer({ src: MODEL, name: 'Lens' }, 12, 'lens'), x: 20, y: 20, size: 60, modelStyle: { ...style, ...modelStyle } };
      base.layers = [...(transparent ? [] : [background]), text, lens];
      if (carousel) {
        base.images = [{ id: 'green-card', name: 'Green card', src: IMAGE }];
        base.layers.splice(base.layers.length - 1, 0, { ...demoProject().layers.find(layer => layer.type === 'carousel'),
          id: 'cards', template: 'horizontal', cardCount: 1, start: 0, end: 12, x: 50, y: 50, size: 1, tilt: 0, yaw: 0, roll: 0, speed: 0, fadeIn: 0,
          effects: [newEffect('optical-warp')] });
      }
      if (second) base.layers.push({ ...lens, id: 'second', x: 42, y: 30, size: 36, modelStyle: { ...style, ior: 1.3, motion: 'float', motionAmplitude: .8 } });
      if (upper) base.layers.push({ ...fileLayer({ src: IMAGE, name: 'Above' }, 12, 'above'), x: 40, y: 47, size: 20 });
      return validateProject(base);
    }
    async function mount(options = {}, renderMode = true, width = 360, height = 360) {
      engine?.dispose(); canonical = project(options);
      const [w, h] = FORMATS[canonical.format]; root.style.width = w + 'px'; root.style.height = h + 'px';
      root.innerHTML = stageMarkup(transport(canonical));
      engine = await createScene(root, transport(canonical), { renderMode, onMediaError: error => errors.push(error.message) });
      engine.setResolution(width, height); await engine.seek(.5); return pixels();
    }
    function pixels() {
      const canvas = root.querySelector('[data-floc-refraction-output]');
      return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    }
    async function change(id, patch, time = .5) {
      canonical = patchLayer(canonical, id, patch);
      if (!engine.update(transport(canonical))) throw new Error('Parameter edit unexpectedly required a rebuild');
      await engine.seek(time); return pixels();
    }
    function difference(a, b, width = 360, inside = () => true) {
      let changed = 0, total = 0;
      for (let i = 0; i < a.length; i += 4) {
        const x = i / 4 % width, y = Math.floor(i / 4 / width); if (!inside(x, y)) continue;
        let delta = 0; for (let c = 0; c < 4; c++) delta += Math.abs(a[i + c] - b[i + c]);
        if (delta > 8) changed++; total += delta;
      }
      return { changed, total };
    }
    const inLens = (x, y) => x > 72 && x < 288 && y > 72 && y < 288;
    const outsideLens = (x, y) => !inLens(x, y) && (x < 70 || x > 290 || y < 70 || y > 290);
    window.exerciseRefraction = async () => {
      await setup(); const result = {};
      const identity = await mount({ upper: true, modelStyle: { ior: 1, refractionThickness: 0 } });
      const refracted = await change('lens', { modelStyle: { ...style } });
      result.refraction = difference(identity, refracted, 360, inLens);
      result.outside = difference(identity, refracted, 360, outsideLens);
      let misplacedGreen = 0, upperGreen = 0;
      for (let i = 0; i < refracted.length; i += 4) if (refracted[i + 1] > 245 && refracted[i] < 10 && refracted[i + 2] < 10) {
        const x = i / 4 % 360, y = Math.floor(i / 4 / 360);
        if (x >= 143 && x <= 217 && y >= 168 && y <= 195) upperGreen++; else misplacedGreen++;
      }
      result.upper = { misplacedGreen, upperGreen };
      const edited = await change('title', { text: 'DIFFERENT\\n9876543210' });
      result.liveText = difference(refracted, edited, 360, inLens);
      result.presets = [];
      for (const preset of ['refractive-clear', 'refractive-frosted', 'refractive-prism']) {
        const p = applyModelPreset(style, preset);
        const frame = await change('lens', { modelStyle: p });
        result.presets.push({ id: preset, delta: difference(identity, frame, 360, inLens) });
      }
      const unbent = await mount({ transparent: true, modelStyle: { ior: 1, refractionThickness: 0 } });
      const bent = await change('lens', { modelStyle: { ...style } });
      const half = await change('lens', { opacity: .5 });
      let cleared = 0, clearedHalf = 0, overlap = 0, opaqueHalf = 0;
      for (let i = 0; i < unbent.length; i += 4) {
        const x = i / 4 % 360, y = Math.floor(i / 4 / 360); if (!inLens(x, y)) continue;
        if (unbent[i + 3] > 250 && bent[i + 3] < 5) { cleared++; if (half[i + 3] >= 120 && half[i + 3] <= 136) clearedHalf++; }
        if (unbent[i + 3] > 250 && bent[i + 3] > 250) { overlap++; if (half[i + 3] > 248) opaqueHalf++; }
      }
      result.alpha = { cleared, clearedHalf, overlap, opaqueHalf };
      const layerOpacity = await change('lens', { opacity: .35 });
      await setup(.35);
      const sourceOpacity = await mount({ transparent: true, modelStyle: { mode: 'original' } });
      result.sourceOpacity = difference(layerOpacity, sourceOpacity);
      const animated = await mount({ second: true });
      await engine.seek(1.5); const moving = pixels(); await engine.seek(.5);
      result.multiple = { motion: difference(animated, moving), reverse: difference(animated, pixels()) };
      result.quality = [];
      for (const refractionSamples of [4, 8, 16]) for (const refractionResolution of [256, 512, 1024, 2048]) {
        await change('lens', { modelStyle: { ...style, refractionSamples, refractionResolution } });
        result.quality.push(difference(identity, pixels(), 360, inLens).changed);
      }
      const exportFrame = await mount({ upper: true });
      const previewFrame = await mount({ upper: true }, false);
      result.previewParity = difference(exportFrame, previewFrame);
      const decode = HTMLImageElement.prototype.decode;
      // Real SVG image decoding can cross a paint; model the slow path without
      // replacing the actual decoder or the actual carousel's rendered pixels.
      HTMLImageElement.prototype.decode = async function(...args) {
        await decode.apply(this, args);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      };
      try {
        const options = { carousel: true, modelStyle: { ior: 1, refractionThickness: 0 } };
        const preview = await mount(options, false), exported = await mount(options, true);
        const center = (180 * 360 + 180) * 4;
        result.carouselCapture = { center: [...preview.slice(center, center + 4)], parity: difference(preview, exported) };
      } finally { HTMLImageElement.prototype.decode = decode; }
      const beforeMove = await mount({ format: 'portrait', modelStyle: { ior: 1, refractionThickness: 0 } }, true, 180, 320);
      const afterMove = await change('lens', { x: -10, y: 5, size: 110 });
      result.identityPlacement = difference(beforeMove, afterMove, 180);
      await change('lens', { modelStyle: { ...style, shader: 'standard' } });
      result.restored = { hiddenSources: root.querySelectorAll('[data-floc-refraction-hidden]').length, display: root.querySelector('[data-floc-refraction-output]').style.display };
      engine.dispose(); urls.forEach(url => URL.revokeObjectURL(url));
      result.cleaned = !root.querySelector('[data-floc-refraction-output]') && !root.querySelector('[data-floc-refraction-hidden]');
      result.errors = errors; return result;
    };
  ` }, bundle: true, write: false, format: 'iife' });
  const angle = process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d11' : 'gl-egl';
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', `--use-angle=${angle}`, '--force-color-profile=srgb'] });
  t.after(() => browser.close());
  const page = await browser.newPage(), failures = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
  await page.setRequestInterception(true);
  page.on('request', request => /^https?:/.test(request.url()) ? (failures.push(`Unexpected request: ${request.url()}`), request.abort()) : request.continue());
  await page.setContent('<style>body{margin:0}#stage{position:relative;overflow:hidden;transform:scale(.33);transform-origin:top left}canvas,img,video{display:block}</style><div id="stage"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(() => window.exerciseRefraction());
  assert.deepEqual(failures, [], 'shaders compile and no external assets are requested');
  assert.deepEqual(result.errors, []);
  assert.ok(result.refraction.changed > 500 && result.refraction.total > 10000, `actual lower pixels must bend: ${JSON.stringify(result.refraction)}`);
  assert.equal(result.outside.total, 0, 'pixels outside the model rectangle keep their original appearance');
  assert.equal(result.upper.misplacedGreen, 0, 'the model must not capture/refract an upper image');
  assert.ok(result.upper.upperGreen > 1000, 'the upper image stays visible on top of the model');
  assert.ok(result.liveText.changed > 300, 'editing lower text refreshes the refraction capture');
  for (const preset of result.presets) assert.ok(preset.delta.changed > 500, `${preset.id} refracts actual composition pixels`);
  assert.ok(result.alpha.cleared > 100, 'transparent refracted regions remove the original, unbent ink');
  assert.ok(result.alpha.clearedHalf > result.alpha.cleared * .95, `half-opacity glass keeps half the old ink: ${JSON.stringify(result.alpha)}`);
  assert.ok(result.alpha.overlap > 100 && result.alpha.opaqueHalf > result.alpha.overlap * .95, 'partial-opacity replacement must not reduce two opaque samples to 75% alpha');
  assert.equal(result.sourceOpacity.changed, 0, 'Original preserves imported opacity instead of making the glass opaque');
  assert.ok(result.multiple.motion.changed > 100, `a second refractive model follows its own motion: ${JSON.stringify(result.multiple)}`);
  assert.equal(result.multiple.reverse.total, 0, 'multiple glass layers are seek-safe without feedback');
  assert.ok(result.quality.every(changed => changed > 500), 'every quality setting retains the actual refraction');
  assert.equal(result.previewParity.total, 0, 'preview and export mode produce the same composition pixels');
  assert.deepEqual(result.carouselCapture.center, [0, 255, 0, 255], 'the actual green carousel card survives asynchronous SVG decoding before the backdrop is sampled');
  assert.equal(result.carouselCapture.parity.total, 0, 'preview retains the same carousel framebuffer that export samples');
  assert.ok(result.identityPlacement.changed < 180 * 320 * .02, `IOR 1 remains an identity when moving/resizing off-canvas in portrait: ${JSON.stringify(result.identityPlacement)}`);
  assert.deepEqual(result.restored, { hiddenSources: 0, display: 'none' });
  assert.equal(result.cleaned, true);
});
