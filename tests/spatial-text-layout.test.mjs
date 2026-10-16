import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserCandidates } from '../scripts/renderer-runtime.mjs';

const executablePath = [process.env.HYPERFRAMES_BROWSER_PATH, ...browserCandidates()].find(file => file && existsSync(file));

test('safe-area layout constrains Flat text without moving or rejecting Spatial text', { skip: !executablePath && 'Chrome or Edge is required for text projection', timeout: 120000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import { createScene, stageMarkup } from './scene.js';
    import { blankProject, demoProject, validateProject } from './project.js';
    const root = document.getElementById('stage');
    window.exerciseTextLayout = async () => {
      const results = {};
      async function mount(space, enabled, renderMode, oversized = false) {
        const p = blankProject('Safe text');
        p.layout = { ...p.layout, enabled, marginX: 10, marginY: 10 };
        const text = { ...demoProject().layers.find(layer => layer.type === 'text'), id: 'title',
          name: 'Safe text', space, x: 0, y: 30, width: oversized ? 100 : 35,
          text: 'MMMM', size: oversized ? 180 : 72, roll: oversized ? 45 : 0,
          tilt: oversized ? 65 : 0, yaw: oversized ? 55 : 0, z: oversized ? -50 : 0,
          start: 0, end: 12, fadeIn: 0, fadeOut: 0, rise: false, choreography: [] };
        if (space === 'missing') delete text.space;
        p.layers = [text];
        const project = validateProject(p);
        // Low-level callers can still supply pre-normalization Flat layers.
        if (space === 'missing') delete project.layers[0].space;
        root.innerHTML = stageMarkup(project);
        let engine;
        try {
          engine = await createScene(root, project, { renderMode });
          engine.setResolution(360, 360); await engine.seek(.7);
          const canvas = root.querySelector('[data-floc-scene-output]');
          return { left: root.querySelector('[data-floc-layer="title"]').style.left,
            bounds: engine.projectedBounds('title'),
            pixels: [...canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data] };
        } catch (error) { return { error: error.message }; }
        finally { engine?.dispose(); }
      }
      for (const space of ['spatial', 'flat', 'missing']) {
        results[space] = {
          unconstrained: await mount(space, false, false),
          preview: await mount(space, true, false),
          exported: await mount(space, true, true),
          oversized: await mount(space, true, true, true),
          oversizedUnconstrained: space === 'spatial' ? await mount(space, false, true, true) : null
        };
      }
      return results;
    };
  ` }, bundle: true, write: false, format: 'iife', logLevel: 'silent' });
  const angle = process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d11' : 'gl-egl';
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', `--use-angle=${angle}`] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<style>body{margin:0}#stage{position:relative;width:1080px;height:1080px;overflow:hidden}canvas,img,video{display:block}</style><div id="stage"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(() => window.exerciseTextLayout());
  const spatial = result.spatial;
  assert.equal(spatial.preview.left, '0%', 'Spatial text retains its authored X at the edge');
  assert.deepEqual(spatial.preview.bounds, spatial.unconstrained.bounds, 'safe margins do not move projected Spatial bounds');
  assert.deepEqual(spatial.preview.pixels, spatial.unconstrained.pixels, 'safe margins do not change Spatial preview pixels');
  assert.deepEqual(spatial.exported, spatial.preview, 'Spatial preview and export agree');
  assert.equal(spatial.oversized.error, undefined, 'a projected Spatial plane is not rejected using its oversized rotated source rectangle');
  assert.deepEqual(spatial.oversized, spatial.oversizedUnconstrained);
  for (const space of ['flat', 'missing']) {
    assert.equal(result[space].preview.left, '10%', `${space} retains legacy clamping`);
    assert.deepEqual(result[space].exported, result[space].preview);
    assert.match(result[space].oversized.error, /exceeds the safe area/, `${space} retains export overflow protection`);
  }
});
