import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserCandidates } from '../scripts/renderer-runtime.mjs';
import { demoProject, validateProject } from '../src/project.js';
import { DEFAULT_NOISE } from '../src/effects.js';

const executablePath = [process.env.HYPERFRAMES_BROWSER_PATH, ...browserCandidates()].find(file => file && existsSync(file));

test('preview composites empty areas and translucent grain over the opaque export backdrop, not the workspace', { skip: !executablePath && 'Chrome or Edge is required for preview verification', timeout: 60000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import { createScene, stageMarkup } from './scene.js';
    window.mount = async project => {
      window.scene?.dispose();
      const stage = document.querySelector('.stage');
      stage.innerHTML = stageMarkup(project);
      window.scene = await createScene(stage, project);
      await window.scene.seek(1, false);
    };
  ` }, bundle: true, write: false, format: 'iife' });
  const css = await readFile('src/styles/canvas.css', 'utf8');
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 1200, deviceScaleFactor: 1 });
  await page.setContent(`<style>${css}body{margin:0}.preview-wrap{width:1200px;height:1200px;border:0;border-radius:0}.stage-holder{height:100%}.stage{width:1080px;height:1080px;transform:translate(-50%,-50%);box-shadow:none}</style><div class="preview-wrap"><div class="stage-holder"><div class="stage"></div></div></div>`);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const demo = demoProject();
  const background = { ...demo.layers[0], color: '#000000', mode: 'color', effects: [{ ...DEFAULT_NOISE, mode: 'multi', opacity: .3, sizeX: 3, sizeY: 3 }] };
  const capture = async project => {
    await page.evaluate(project => window.mount(project), validateProject(project));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return (await page.$('.stage')).screenshot({ type: 'png' });
  };
  for (const [name, layers] of [['empty', []], ['translucent noise', [{ ...background, opacity: .5 }]], ['opaque background', [{ ...background, opacity: 1 }]]]) {
    const project = { ...demo, layers };
    await page.evaluate(() => { document.querySelector('.stage').style.background = ''; });
    const actual = await capture(project);
    // Opaque exports flatten the scene over white; alpha exports remain a separate opt-in.
    await page.evaluate(() => { document.querySelector('.stage').style.background = '#fff'; });
    const expected = await capture(project);
    const difference = await page.evaluate(async (a, b) => {
      const load = async src => { const image = new Image(); image.src = src; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); return context.getImageData(0, 0, canvas.width, canvas.height).data; };
      const left = await load(a), right = await load(b); let max = 0;
      for (let i = 0; i < left.length; i++) max = Math.max(max, Math.abs(left[i] - right[i]));
      return max;
    }, 'data:image/png;base64,' + Buffer.from(actual).toString('base64'), 'data:image/png;base64,' + Buffer.from(expected).toString('base64'));
    assert.ok(difference <= 1, `${name}: preview leaks the workspace into composition pixels (maximum channel difference ${difference})`);
  }
});
