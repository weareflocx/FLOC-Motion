import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserCandidates } from '../scripts/renderer-runtime.mjs';

const executablePath = [process.env.HYPERFRAMES_BROWSER_PATH, ...browserCandidates()].find(file => file && existsSync(file));
const LIVE = 'dialog[open] .radial-layer-menu';

test('radial menu glues to the pointer until it pauses, folds out without blocking, reopens on right-click and restores focus', { skip: !executablePath && 'Chrome or Edge is required', timeout: 90000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import React, { useCallback, useRef, useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { AddLayerDialog } from './editor/components/AddLayerDialog.jsx';
    import { blankProject, validateProject } from './project.js';
    import { useCompositionActions } from './editor/useCompositionActions.js';
    import './styles/index.css';
    function Harness() {
      const [menu, setMenu] = useState(null);
      const [project, setProject] = useState(blankProject);
      const projectRef = useRef(project);
      const [selected, setSelected] = useState(null);
      const actions = useCompositionActions({ project, projectRef, selected, setSelected, setLeftTab() {},
        change(next) { projectRef.current = validateProject(next); setProject(projectRef.current); return projectRef.current; }
      });
      // The canvas area leaves an 80 px strip on the right, standing in for the inspector.
      const area = useCallback(() => new DOMRect(0, 0, innerWidth - 80, innerHeight), []);
      const open = point => setMenu(current => ({ ...point, id: (current?.id ?? 0) + 1 }));
      return <><button id="trigger" onClick={() => open({ x: innerWidth - 10, y: innerHeight - 10 })}>Open layer menu</button>
        <output id="layers">{project.layers.map(layer => layer.type).join(',')}</output>
        {menu && <AddLayerDialog key={menu.id} project={project} radial={{ origin: menu, area, onReopen: open }} onAddText={actions.addText} onClose={() => setMenu(null)}/>}</>;
    }
    createRoot(document.getElementById('root')).render(<Harness/>);
  `, loader: 'jsx' }, bundle: true, write: false, outdir: 'radial-test', format: 'iife', external: ['/fonts/*'] });
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<div id="root"></div>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 480, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
  await page.evaluate(() => {
    window.entrances = [];
    window.exits = [];
    document.addEventListener('animationstart', event => {
      if (event.animationName === 'radial-layer-enter') window.entrances.push(event.target.closest('button').getAttribute('aria-label'));
    });
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
      if (!node.classList?.contains('radial-layer-ghost')) return;
      window.exits.push({
        chosen: node.querySelector('.is-chosen')?.dataset.option ?? null,
        animations: node.getAnimations({ subtree: true }).length,
        focus: document.activeElement?.id || document.activeElement?.tagName,
        liveDialogs: document.querySelectorAll('dialog[open]').length
      });
    }))).observe(document.body, { childList: true });
  });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  const settleEntrance = () => page.waitForFunction(selector => document.querySelector(selector).getAnimations({ subtree: true }).every(animation => animation.playState === 'finished'), {}, LIVE);
  const open = async () => {
    await page.click('#trigger');
    await page.waitForSelector(LIVE);
    await settleEntrance();
  };
  const closed = () => page.waitForFunction(() => !document.querySelector('dialog[open]') && !document.querySelector('.radial-layer-ghost'));
  const center = () => page.$eval(LIVE, menu => { const box = menu.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; });
  const settle = () => page.evaluate(selector => new Promise(resolve => {
    const menu = document.querySelector(selector);
    let previous = menu.getBoundingClientRect(), still = 0;
    function sample() {
      const next = menu.getBoundingClientRect();
      still = Math.hypot(next.x - previous.x, next.y - previous.y) < .1 ? still + 1 : 0;
      previous = next;
      if (still >= 4) resolve(); else requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  }), LIVE);

  await open();
  const initial = await page.evaluate(() => window.entrances.slice());
  assert.deepEqual(initial, await page.$$eval(`${LIVE} .radial-layer-option`, buttons => buttons.map(button => button.getAttribute('aria-label'))), 'every icon enters exactly once in clockwise order');
  const atRest = await page.$eval(LIVE, menu => ({
    background: getComputedStyle(menu).backgroundColor,
    labels: [...menu.querySelectorAll('.radial-layer-label')].filter(label => getComputedStyle(label).display !== 'none').length,
    insideArea: menu.getBoundingClientRect().right <= innerWidth - 80 && menu.getBoundingClientRect().bottom <= innerHeight
  }));
  assert.deepEqual(atRest, { background: 'rgba(0, 0, 0, 0)', labels: 0, insideArea: true }, 'a corner opening is kept inside the canvas area');
  for (const label of ['Text', 'Media', 'Text', 'Sculpture']) {
    await page.hover(`${LIVE} .radial-layer-option[aria-label="${label}"]`);
    assert.equal(await page.$eval(`${LIVE} .radial-layer-option[aria-label="${label}"] .radial-layer-label`, node => getComputedStyle(node).display), 'block');
  }
  await page.keyboard.press('Tab');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(await page.evaluate(() => window.entrances), initial, 'hover, hover exit and focus never replay the entrance');
  const text = await page.$(`${LIVE} .radial-layer-option[aria-label="Text"]`);
  const before = await text.boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  assert.deepEqual(await text.boundingBox(), before, 'global active-button transforms cannot move a radial hit target');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await closed();
  assert.deepEqual(await page.evaluate(() => window.exits.at(-1)), { chosen: null, animations: 9, focus: 'trigger', liveDialogs: 0 },
    'Escape closes the dialog and restores focus at once while a detached copy folds out');

  await open();
  assert.deepEqual(await page.evaluate(() => window.entrances), [...initial, ...initial], 'reopening plays exactly one fresh entrance');
  const opened = await center();
  // A right-click leaves the pointer at the center; the test trigger button sits elsewhere.
  await page.mouse.move(opened.x, opened.y);
  const firstText = await (await page.$(`${LIVE} .radial-layer-option[aria-label="Text"]`)).boundingBox();
  await page.mouse.move(firstText.x + firstText.width / 2, firstText.y + firstText.height / 2, { steps: 12 });
  await settle();
  assert.deepEqual(await center(), opened, 'the menu opens fixed, so the pointer goes straight to an icon');
  await page.mouse.move(200, 200, { steps: 10 });
  await page.waitForFunction(selector => {
    const box = document.querySelector(selector).getBoundingClientRect();
    return Math.hypot(box.x + box.width / 2 - 200, box.y + box.height / 2 - 200) < 1;
  }, { timeout: 2000 }, LIVE);
  await settle();
  const glued = await center();
  await new Promise(resolve => setTimeout(resolve, 250));
  const textBox = await (await page.$(`${LIVE} .radial-layer-option[aria-label="Text"]`)).boundingBox();
  await page.mouse.move(textBox.x + textBox.width / 2, textBox.y + textBox.height / 2, { steps: 12 });
  await settle();
  assert.deepEqual(await center(), glued, 'leaving the ring glues it to the pointer and pausing fixes it again');
  await page.mouse.click(textBox.x + textBox.width / 2, textBox.y + textBox.height / 2);
  await closed();
  assert.equal(await page.$eval('#layers', node => node.textContent), 'background,text', 'the followed menu still creates a real validated text layer');
  assert.equal((await page.evaluate(() => window.exits.at(-1))).chosen, 'text', 'the chosen icon pops in the exit');

  await open();
  const firstCenter = await center();
  await page.mouse.click(60, 60, { button: 'right' });
  await page.waitForFunction(count => window.entrances.length === count, {}, initial.length * 4);
  await settleEntrance();
  const moved = await center();
  assert.ok(moved.x < firstCenter.x - 50 && moved.y < firstCenter.y - 50, 'right-clicking elsewhere on the canvas moves the menu there');
  assert.equal(await page.$$eval('dialog[open]', dialogs => dialogs.length), 1);
  await page.mouse.click(620, 240, { button: 'right' });
  await closed();
  assert.equal(await page.$('dialog[open]'), null, 'right-clicking outside the canvas closes the menu');

  await open();
  await page.mouse.move(620, 240, { steps: 10 });
  await settle();
  assert.ok((await page.$eval(LIVE, menu => menu.getBoundingClientRect().right)) <= 560 + .5, 'the glued ring stops at the canvas area edge');
  await page.mouse.move(200, 200);
  await page.keyboard.press('Tab');
  const keyboardCenter = await center();
  await settle();
  assert.deepEqual(await center(), keyboardCenter, 'a key fixes the glued ring at once');
  await page.setViewport({ width: 380, height: 340, deviceScaleFactor: 1 });
  await settle();
  assert.equal(await page.$eval(LIVE, menu => {
    const box = menu.getBoundingClientRect();
    return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
  }), true, 'viewport changes keep the moved menu inside the screen');
  await page.keyboard.press('Escape');
  await closed();
  await page.setViewport({ width: 640, height: 480, deviceScaleFactor: 1 });

  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const exitsBefore = await page.evaluate(() => window.exits.length);
  await open();
  assert.equal(await page.$eval(LIVE, menu => menu.getAnimations({ subtree: true }).length), 0, 'reduced motion skips the entrance');
  const reducedCenter = await center();
  await page.mouse.move(140, 180);
  await settle();
  assert.deepEqual(await center(), reducedCenter, 'reduced motion disables cursor following');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  assert.equal(await page.evaluate(() => window.exits.length), exitsBefore, 'reduced motion closes without an exit animation');
});
