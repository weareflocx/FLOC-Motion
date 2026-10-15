import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserCandidates } from '../scripts/renderer-runtime.mjs';
import { demoProject, validateProject } from '../src/project.js';

const executablePath = [process.env.HYPERFRAMES_BROWSER_PATH, ...browserCandidates()].find(file => file && existsSync(file));

function wav() {
  const samples = 8000 * 8, bytes = samples * 2, result = Buffer.alloc(44 + bytes);
  result.write('RIFF', 0); result.writeUInt32LE(36 + bytes, 4); result.write('WAVEfmt ', 8);
  result.writeUInt32LE(16, 16); result.writeUInt16LE(1, 20); result.writeUInt16LE(1, 22);
  result.writeUInt32LE(8000, 24); result.writeUInt32LE(16000, 28);
  result.writeUInt16LE(2, 32); result.writeUInt16LE(16, 34);
  result.write('data', 36); result.writeUInt32LE(bytes, 40);
  return result;
}

test('late audio metadata applies the latest seek/playback state and ignores disposed scenes', { skip: !executablePath && 'Chrome or Edge is required for media verification' }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import { createScene, stageMarkup } from './scene.js';
    window.makeScene = (root, project) => { root.innerHTML = stageMarkup(project); return createScene(root, project); };
  ` }, bundle: true, write: false, format: 'iife' });
  const demo = demoProject(), project = validateProject({ ...demo, images: [], layers: [demo.layers[0], {
    ...demo.layers.find(layer => layer.type === 'music'), start: 1, end: 8, offset: .5, loop: true,
    src: '/assets/5c6e62a1-59b0-4b79-a752-a943d49cd13d.wav'
  }] });
  const audio = wav();
  let gate, release = () => {};
  const server = http.createServer(async (req, res) => {
    if (req.url.endsWith('.wav')) {
      await gate;
      if (!res.destroyed) {
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
        res.writeHead(range ? 206 : 200, {
          'Content-Type': 'audio/wav', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes',
          ...(range ? { 'Content-Range': `bytes ${start}-${end}/${audio.length}` } : {}), 'Cache-Control': 'no-store'
        });
        res.end(audio.subarray(start, end + 1));
      }
    } else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<div id="root" style="position:relative;width:1080px;height:1080px"></div>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { release(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  t.after(() => browser.close());
  for (const state of ['paused', 'playing', 'disposed']) {
    gate = new Promise(resolve => { release = resolve; });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(async project => {
        window.engine = await window.makeScene(document.getElementById('root'), project);
        window.audio = document.querySelector('audio');
        await window.engine.seek(3, true);
        await window.engine.seek(4, false);
      }, project);
      assert.equal(await page.evaluate(() => Number.isFinite(window.audio.duration)), false);
      if (state === 'playing') await page.evaluate(() => window.engine.seek(4, true));
      if (state === 'disposed') await page.evaluate(() => window.engine.dispose());
      await page.evaluate(() => { window.releasedAt = performance.now(); });
      release();
      if (state === 'disposed') {
        await page.evaluate(() => window.audio.dispatchEvent(new Event('loadedmetadata')));
        assert.equal(await page.evaluate(() => window.audio.paused), true);
        assert.equal(await page.evaluate(() => window.audio.hasAttribute('src')), false);
      } else {
        await page.waitForFunction(() => Number.isFinite(window.audio.duration));
        // Playing audio keeps advancing after the seek lands, by as much time as has elapsed since
        // the metadata was released; a slow machine may not observe the first 200 ms window.
        await page.waitForFunction(() => window.audio.currentTime > 3.3 && window.audio.currentTime < 3.7 + (performance.now() - window.releasedAt) / 1000, { timeout: 5000 });
        await page.waitForFunction(playing => window.audio.paused === !playing, {}, state === 'playing');
        if (state === 'paused') assert(Math.abs(await page.evaluate(() => window.audio.currentTime) - 3.5) < .03);
        await page.evaluate(() => window.engine.dispose());
      }
      assert.deepEqual(errors, []);
    } finally { release(); await page.close(); }
  }
});
