import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserCandidates } from '../scripts/renderer-runtime.mjs';

const executablePath = [process.env.HYPERFRAMES_BROWSER_PATH, ...browserCandidates()].find(file => file && existsSync(file));

test('cancelling a file picker preserves the containing modal draft; Escape still closes the dialog', { skip: !executablePath && 'Chromium is required for native dialog verification', timeout: 30000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { Modal } from './editor/controls.jsx';
    function Fixture() {
      const [open, setOpen] = useState(true), [draft, setDraft] = useState('');
      return open ? <Modal labelledBy="title" onClose={() => setOpen(false)}><section>
        <h2 id="title">Replace card</h2>
        <input aria-label="Draft content" value={draft} onChange={event => setDraft(event.target.value)}/>
        <input type="file"/>
      </section></Modal> : <p>Closed</p>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `, loader: 'jsx' }, bundle: true, format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.waitForSelector('dialog[open]');
  await page.type('input[aria-label="Draft content"]', 'Keep this replacement');
  await page.$eval('input[type="file"]', input => input.dispatchEvent(new Event('cancel', { bubbles: true })));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  assert.equal(await page.$eval('dialog', dialog => dialog.open), true);
  assert.equal(await page.$eval('input[aria-label="Draft content"]', input => input.value), 'Keep this replacement');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog'));
  assert.equal(await page.$eval('body', body => body.textContent.trim()), 'Closed');
});
