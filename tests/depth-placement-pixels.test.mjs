import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserCandidates } from '../scripts/renderer-runtime.mjs';

const executablePath = [process.env.HYPERFRAMES_BROWSER_PATH, ...browserCandidates()].find(file => file && existsSync(file));

test('scene depth info reports each Wheel card and plane, and each next stop places text past exactly one more card', { skip: !executablePath && 'Chrome or Edge is required for depth placement verification', timeout: 120000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import { createScene, stageMarkup } from './scene.js';
    import { blankProject, demoProject, patchLayer, validateProject } from './project.js';
    import { depthCounts, depthGuide, nextDepth } from './editor/depth.js';
    const colors = { red: [255, 0, 0], green: [0, 255, 0], blue: [0, 0, 255], yellow: [255, 255, 0] };
    const svg = rgb => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="rgb(' + rgb.join(',') + ')"/></svg>');
    const local = new Map(Object.keys(colors).map((name, index) => ['/assets/00000000-0000-4000-8000-00000000000' + (index + 1) + '.svg', svg(colors[name])]));
    const transport = value => ({ ...value, images: value.images.map(image => ({ ...image, src: local.get(image.src) ?? image.src })) });
    const root = document.getElementById('stage'), errors = [];
    let engine, project;
    async function patch(id, value, time) { project = patchLayer(project, id, value); if (!engine.update(transport(project))) throw new Error('A depth edit unexpectedly rebuilt the scene'); await engine.seek(time); return pixels(); }
    const pixels = () => { const c = root.querySelector('[data-floc-scene-output]'); return c.getContext('2d').getImageData(0, 0, c.width, c.height).data; };
    // Classify by dominant channels: card shading darkens colors without changing their hue.
    function classify(data, i) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a < 200) return null;
      if (Math.max(r, g, b) < 40) return 'black';
      if (r > 100 && g > 100 && b < .4 * Math.min(r, g)) return 'yellow';
      if (r > 100 && g < .4 * r && b < .4 * r) return 'red';
      if (g > 100 && r < .4 * g && b < .4 * g) return 'green';
      if (b > 100 && r < .4 * b && g < .4 * b) return 'blue';
      return null;
    }
    window.exerciseDepth = async () => {
      const p = blankProject('Wheel depth');
      const names = Object.keys(colors);
      p.images = names.map((name, index) => ({ id: name, name, src: [...local.keys()][index] }));
      p.layers.push({ ...demoProject().layers.find(layer => layer.type === 'carousel'), id: 'wheel', space: 'spatial', template: 'wheel', motionVariant: 'ring', x: 50, y: 50, z: 0, size: 0.6, radius: 2, gap: 0.2, cardAspect: 1, cardCount: 4, speed: 30, tilt: 60, yaw: 0, roll: 0, curve: 0, cornerRadius: 0, fadeIn: 0, fadeOut: 0 });
      p.layers.push({ id: 'title', type: 'text', name: 'Center text', space: 'spatial', visible: true, locked: false, start: 0, end: 12, text: 'MMMMM\\nMMMMM\\nMMMMM\\nMMMMM\\nMMMMM', font: 'geist', weight: 700, color: '#000000', x: 5, y: 6, z: 0, tilt: 0, yaw: 0, roll: 0, width: 90, size: 150, fadeIn: 0, fadeOut: 0, rise: false });
      project = validateProject(p);
      root.innerHTML = stageMarkup(transport(project));
      engine = await createScene(root, transport(project), { onMediaError: error => errors.push(error.message) });
      engine.setResolution(360, 360);
      const result = { errors };
      await engine.seek(.5); result.earlier = engine.depthInfo().find(item => item.id === 'wheel');
      // Tilted cards are slanted planes. Pick a frame whose first two stops from the back do not cut
      // through any card, so each glyph's visibility depends only on the stop (not on where a card crosses it).
      const cuts = (info, z) => info.some(item => item.id === 'wheel' && item.pieces.some(piece => piece.min < z && piece.max > z));
      let time = null;
      for (let step = 0; step <= 60 && time === null; step++) {
        await engine.seek(step / 10);
        const info = engine.depthInfo(), guide = depthGuide(info, 'title');
        const first = nextDepth(guide, guide.back, 1), second = nextDepth(guide, first, 1);
        if (!cuts(info, first) && !cuts(info, second)) time = step / 10;
      }
      result.time = time;
      if (time === null) { engine.dispose(); return result; }
      await engine.seek(time);
      const info = engine.depthInfo(), guide = depthGuide(info, 'title');
      result.wheel = info.find(item => item.id === 'wheel'); result.plane = info.find(item => item.id === 'title');
      result.stops = guide.stops; result.back = guide.back; result.front = guide.front;
      const back = await patch('title', { z: guide.back }, time);
      const front = await patch('title', { z: guide.front }, time);
      result.steps = [];
      // From behind everything, each next stop toward the camera (⌘] / ruler Page Up) passes one more card.
      for (let z = guide.back, count = 0; count < 2; count++) {
        z = nextDepth(guide, z, 1);
        const shown = await patch('title', { z }, time);
        const step = { z, counts: depthCounts(guide, z), edited: engine.depthInfo().find(item => item.id === 'title') };
        // Wherever the frontmost card covers a glyph, the glyph shows exactly when the text is in front of that card.
        step.cards = result.wheel.pieces.map(piece => ({ color: names[piece.card], center: (piece.min + piece.max) / 2, overlap: 0, black: 0, card: 0 }));
        const byColor = Object.fromEntries(step.cards.map(card => [card.color, card]));
        for (let i = 0; i < front.length; i += 4) {
          if (classify(front, i) !== 'black') continue;
          const card = byColor[classify(back, i)]; if (!card) continue;
          card.overlap++;
          const pixel = classify(shown, i);
          if (pixel === 'black') card.black++; else if (pixel === card.color) card.card++;
        }
        result.steps.push(step);
      }
      engine.dispose(); return result;
    };
  ` }, bundle: true, write: false, format: 'iife' });
  const angle = process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d11' : 'gl-egl';
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', `--use-angle=${angle}`, '--force-color-profile=srgb'] });
  t.after(() => browser.close());
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setRequestInterception(true);
  page.on('request', request => /^https?:/.test(request.url()) ? (errors.push('Unexpected external request'), request.abort()) : request.continue());
  await page.setContent('<style>body{margin:0}#stage{position:relative;width:1080px;height:1080px;overflow:hidden;transform:scale(.3333333333333333);transform-origin:0 0}canvas,img,video{display:block}</style><div id="stage"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(() => window.exerciseDepth());
  assert.deepEqual(errors, []);
  assert.deepEqual(result.errors, []);
  assert.notEqual(result.time, null, `a frame exists whose first stops pass between whole cards: ${JSON.stringify(result.earlier)}`);
  const { wheel, plane, earlier } = result;
  assert.equal(wheel.pieces.length, 4, 'one piece per visible Wheel card');
  assert.equal(new Set(wheel.pieces.map(piece => Math.round((piece.min + piece.max) / 2))).size >= 2, true, 'cards sit at distinct depths');
  assert.ok(wheel.min < 0 && wheel.max > 0, `cards span the text plane: ${JSON.stringify(wheel)}`);
  assert.equal(wheel.min, Math.min(...wheel.pieces.map(piece => piece.min)));
  assert.equal(wheel.max, Math.max(...wheel.pieces.map(piece => piece.max)));
  assert.ok(earlier.pieces.some((piece, index) => Math.abs(piece.min - wheel.pieces[index].min) > 1), 'pieces follow the turning wheel at another time');
  assert.deepEqual(plane.pieces, [{ min: 0, max: 0 }], 'a plane reports its own depth');
  assert.deepEqual([plane.min, plane.max], [0, 0]);
  assert.deepEqual(result.steps.map(step => step.counts), [{ inFront: 1, behind: 3 }, { inFront: 2, behind: 2 }], `one card per step: ${JSON.stringify(result.stops)}`);
  for (const step of result.steps) {
    assert.ok(step.z > result.back && step.z < result.front);
    assert.deepEqual(step.edited.pieces, [{ min: step.z, max: step.z }], 'the edited plane reports its new depth');
    // Every card that covers glyphs must be on the reported side of the stop, with cards on both sides checked.
    const covering = step.cards.filter(card => card.overlap >= 10);
    assert.ok(covering.some(card => card.center < step.z) && covering.some(card => card.center > step.z), `cards on both sides cover glyphs at ${step.z}: ${JSON.stringify(step.cards)}`);
    for (const card of covering) {
      const textFirst = card.center < step.z;
      assert.ok((textFirst ? card.black : card.card) >= card.overlap * .95, `at ${step.z} the ${card.color} card is ${textFirst ? 'behind' : 'in front of'} the text: ${JSON.stringify(card)}`);
    }
  }
});
