import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserCandidates } from '../scripts/renderer-runtime.mjs';

const executablePath = [process.env.HYPERFRAMES_BROWSER_PATH, ...browserCandidates()].find(file => file && existsSync(file));

test('layer names and actions have separate hit areas with mouse, keyboard and touch', { skip: !executablePath && 'Chrome or Edge is required for layout verification' }, async t => {
  const bundle = await build({
    stdin: { resolveDir: path.resolve('src'), loader: 'jsx', contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { LayerList } from './editor/components/LayerList.jsx';
      function Fixture() {
        const [selected, select] = useState(null);
        const names = ['Logo', 'A very long layer name that needs ellipsis without covering the actions'];
        return <LayerList project={{ layers: names.map((name, id) => ({ id, name, type: 'logo', visible: true })) }} selected={selected}
          icons={{ logo: () => <svg width="17" height="17"/> }}
          onSelect={id => { window.events.push(['select', id]); select(id); }}
          onPatch={(id, patch) => window.events.push(['patch', id, patch])}
          onMove={() => {}} onDrop={() => {}}
          onDuplicate={id => window.events.push(['duplicate', id])}
          onRemove={id => window.events.push(['remove', id])}/>;
      }
      window.events = []; createRoot(document.getElementById('root')).render(<Fixture/>);
    ` }, bundle: true, write: false, define: { 'process.env.NODE_ENV': '"production"' }
  });
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  for (const touch of [false, true]) await t.test(touch ? 'touch' : 'mouse', async () => {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: touch ? 480 : 1440, height: 600, hasTouch: touch, isMobile: touch });
      await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div class="panel" style="width:246px"><div id="root"></div></div>');
      await page.addStyleTag({ content: readFileSync(new URL('../src/style.css', import.meta.url), 'utf8') });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.waitForSelector('.layer-select');
      for (const select of await page.$$('.layer-select')) {
        await select.hover();
        const hitArea = await select.evaluate(el => {
          const row = el.parentElement, button = el.getBoundingClientRect(), actions = row.querySelector('.layer-row-actions').getBoundingClientRect();
          return { separate: button.right <= actions.left, contained: actions.right <= row.getBoundingClientRect().right,
            reachable: [.1, .5, .9].every(fraction => el.contains(document.elementFromPoint(button.left + button.width * fraction, button.top + button.height / 2))),
            controls: row.querySelectorAll('.layer-row-actions button').length };
        });
        assert.deepEqual(hitArea, { separate: true, contained: true, reachable: true, controls: 5 });
        await select.click();
        assert.equal(await select.evaluate(el => el.getAttribute('aria-pressed')), 'true');
        await select.focus();
        await page.keyboard.press('Space');
        await page.keyboard.press('Enter');
        assert.equal(await select.evaluate(el => el.getAttribute('aria-pressed')), 'true');
        for (const action of ['Hide', 'Lock', 'Rename', 'Duplicate', 'Delete']) {
          await page.keyboard.press('Tab');
          assert.match(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), new RegExp(`^${action} `));
        }
      }
      const events = await page.evaluate(() => window.events);
      assert.equal(events.length, 6);
      assert(events.every(([action]) => action === 'select'));
      await page.click('[aria-label="Hide Logo"]');
      await page.click('[aria-label="Lock Logo"]');
      await page.click('[aria-label="Duplicate Logo"]');
      await page.click('[aria-label="Delete Logo"]');
      assert.deepEqual(await page.evaluate(() => window.events.slice(-4)), [['patch', 0, { visible: false }], ['patch', 0, { locked: true }], ['duplicate', 0], ['remove', 0]]);
      await page.click('[aria-label="Rename Logo"]');
      await page.waitForSelector('.layer-name-input');
      assert.equal(await page.evaluate(() => document.activeElement.className), 'layer-name-input');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.layer-select[title="Logo"]');
    } finally { await page.close(); }
  });
});
