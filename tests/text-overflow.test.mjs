import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { executablePath } from '../scripts/golden-frames.mjs';
import { demoProject, patchLayer, validateProject } from '../src/project.js';
import { captureState } from '../src/choreography.js';
import { fontFaceCss } from '../src/fonts.js';

// Text layout is measured by the real browser with the stage markup that preview and export share.
test('batch review measures text content in the browser, at every choreography pose', { skip: !executablePath && 'Chrome or Edge is required to lay out text', timeout: 120000 }, async () => {
  const bundle = (await build({ entryPoints: [new URL('../src/editor/text-overflow.js', import.meta.url).pathname], bundle: true, write: false, format: 'iife', globalName: 'flocOverflow', platform: 'browser', logLevel: 'silent' })).outputFiles[0].text;
  const page = `<!doctype html><html><head><style>${fontFaceCss('/fonts/')}</style></head><body><script src="/bundle.js"></script></body></html>`;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/') return res.writeHead(200, { 'Content-Type': 'text/html' }).end(page);
    if (req.url === '/bundle.js') return res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(bundle);
    const font = req.url.match(/^\/fonts\/([a-z0-9-]+\.woff2)$/);
    if (font) return res.writeHead(200, { 'Content-Type': 'font/woff2' }).end(await readFile(new URL(`../public/fonts/${font[1]}`, import.meta.url)));
    res.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const tab = await browser.newPage();
    await tab.goto(`http://127.0.0.1:${server.address().port}/`);
    const field = { id: 'headline', label: 'Headline', required: true };
    const text = (content, fields = {}, layout = {}) => {
      const p = validateProject({ ...demoProject(), layout: { ...demoProject().layout, ...layout } });
      return patchLayer(p, 'headline', { contentField: field, text: content, x: 8, y: 70, size: 42, width: 78, roll: 0, ...fields });
    };
    const long = 'Launch week brings every product, every story and every customer into one long headline. '.repeat(4).trim();
    const posed = (() => { const p = text('A headline that wraps'); const headline = p.layers.find(l => l.id === 'headline'); return patchLayer(p, 'headline', { choreography: captureState(headline, 2, p.fps, { size: 180 }, 'big') }); })();
    const cases = {
      short: text('Short headline', {}, { enabled: true }),
      long: text(long, { size: 96 }, { enabled: true }),
      pastFrame: text(long, { y: 80 }),
      posed,
      hidden: patchLayer(text(long, { size: 96 }, { enabled: true }), 'headline', { visible: false })
    };
    const issues = await tab.evaluate(async projects => Object.fromEntries(await Promise.all(Object.entries(projects).map(async ([name, project]) => [name, (await window.flocOverflow.textOverflowIssues(project)).map(issue => issue.message)]))), cases);
    assert.deepEqual(issues, {
      short: [],
      long: ['Headline does not fit the safe area.'],
      pastFrame: ['Headline runs past the frame.'],
      posed: ['Headline runs past the frame.'],
      hidden: []
    });
    assert.equal(await tab.evaluate(() => document.body.children.length), 1, 'the measuring box is removed');
  } finally {
    await browser.close();
    server.close();
  }
});
