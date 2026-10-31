import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserCandidates } from '../scripts/renderer-runtime.mjs';

const executablePath = [process.env.HYPERFRAMES_BROWSER_PATH, ...browserCandidates()].find(file => file && existsSync(file));

test('radial icons enter once per opening, keep stable pressed targets and restore focus on dismissal', { skip: !executablePath && 'Chrome or Edge is required', timeout: 60000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { AddLayerDialog } from './editor/components/AddLayerDialog.jsx';
    import { blankProject } from './project.js';
    import './styles/index.css';
    function Harness() {
      const [open, setOpen] = useState(false);
      return <><button id="trigger" onClick={() => setOpen(true)}>Open layer menu</button>
        {open && <AddLayerDialog project={blankProject()} origin={{ x: innerWidth - 10, y: innerHeight - 10 }} onClose={() => setOpen(false)}/>}</>;
    }
    createRoot(document.getElementById('root')).render(<Harness/>);
  `, loader: 'jsx' }, bundle: true, write: false, outdir: 'radial-test', format: 'iife', external: ['/fonts/*'] });
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 480, deviceScaleFactor: 1 });
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
  await page.evaluate(() => {
    window.entrances = [];
    document.addEventListener('animationstart', event => {
      if (event.animationName === 'radial-layer-enter') window.entrances.push(event.target.closest('button').getAttribute('aria-label'));
    });
  });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  const open = async () => {
    await page.click('#trigger');
    await page.waitForSelector('.radial-layer-menu');
    await page.waitForFunction(() => document.querySelector('.radial-layer-menu').getAnimations({ subtree: true }).every(animation => animation.playState === 'finished'));
  };
  await open();
  const initial = await page.evaluate(() => window.entrances.slice());
  assert.deepEqual(initial, await page.$$eval('.radial-layer-option', buttons => buttons.map(button => button.getAttribute('aria-label'))), 'every icon enters exactly once in clockwise order');
  const atRest = await page.$eval('.radial-layer-menu', menu => ({
    background: getComputedStyle(menu).backgroundColor,
    labels: [...menu.querySelectorAll('.radial-layer-label')].filter(label => getComputedStyle(label).display !== 'none').length,
    fits: menu.getBoundingClientRect().right <= innerWidth && menu.getBoundingClientRect().bottom <= innerHeight
  }));
  assert.deepEqual(atRest, { background: 'rgba(0, 0, 0, 0)', labels: 0, fits: true });
  for (const label of ['Text', 'Media', 'Text', 'Sculpture']) {
    await page.hover(`.radial-layer-option[aria-label="${label}"]`);
    assert.equal(await page.$eval(`.radial-layer-option[aria-label="${label}"] .radial-layer-label`, node => getComputedStyle(node).display), 'block');
  }
  await page.mouse.move(0, 0);
  await page.keyboard.press('Tab');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(await page.evaluate(() => window.entrances), initial, 'hover, hover exit and focus never replay the entrance');
  const text = await page.$('.radial-layer-option[aria-label="Text"]');
  const before = await text.boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  assert.deepEqual(await text.boundingBox(), before, 'global active-button transforms cannot move a radial hit target');
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.radial-layer-menu'));
  assert.equal(await page.$eval('#trigger', node => node === document.activeElement), true);
  await open();
  assert.deepEqual(await page.evaluate(() => window.entrances), [...initial, ...initial], 'reopening plays exactly one fresh entrance');
  await page.mouse.click(0, 0);
  await page.waitForFunction(() => !document.querySelector('.radial-layer-menu'));
  assert.equal(await page.$eval('#trigger', node => node === document.activeElement), true);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await open();
  assert.equal(await page.$eval('.radial-layer-menu', menu => menu.getAnimations({ subtree: true }).length), 0, 'reduced motion skips the entrance');
});
