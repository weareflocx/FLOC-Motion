import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { prepareComposition } from '../server/export.mjs';
import { root } from '../server/runtime-config.mjs';
import { browserCandidates } from './renderer-runtime.mjs';
import { CAROUSEL_EFFECTS, FORMATS, SHADERS, TEMPLATES, demoProject, validateProject } from '../src/project.js';
import { PROCEDURAL_BACKGROUNDS } from '../src/backgrounds.js';
import { FONTS, fontFaceCss } from '../src/fonts.js';
import { DEFAULT_FILTERS, DEFAULT_NOISE } from '../src/effects.js';
import { captureState } from '../src/choreography.js';
import { DEFAULT_LAYOUT } from '../src/layout.js';

// Visual regression harness: the export path (prepareComposition + hf-seek)
// is compared with stored baselines and with the editor preview path
// (stageMarkup + createScene) for the same project and time.
export const GOLDEN_DIR = path.join(root, 'tests/golden');
export const QA_DIR = path.join(root, '.data/qa/golden');
export const CAPTURE_WIDTH = 360;
// A pixel differs when any RGB channel moves by more than `channel` (0-255)
// in the downscaled capture; a comparison fails when more than `ratio` of the
// pixels differ. Every capture uses SwiftShader, so reruns are bit-identical;
// the baseline budget only absorbs Chrome/rasterizer updates. Preview and
// export run different page setups (render mode, CSS transform, card sources),
// so parity allows slightly more antialiasing noise.
export const BASELINE_TOLERANCE = Object.freeze({ channel: 16, ratio: 0.002 });
export const PARITY_TOLERANCE = Object.freeze({ channel: 32, ratio: 0.005 });
export const executablePath = [process.env.HYPERFRAMES_BROWSER_PATH, ...browserCandidates()].find(file => file && existsSync(file));

const DURATION = 4;
const images = Array.from({ length: 6 }, (_, i) => ({ id: `poster-${i + 1}`, src: `/demo/poster-${i + 1}.svg`, name: `Poster ${i + 1}` }));
const base = (name, format) => ({ version: 1, name, format, duration: DURATION, fps: 24, layout: { ...DEFAULT_LAYOUT }, images, layers: [] });
const span = { visible: true, start: 0, end: DURATION };
const colorBackground = color => ({ id: 'background', type: 'background', name: 'Background', ...span, color, mode: 'color', src: '', fit: 'cover', offset: 0, loop: true });
const text = (id, values) => ({ id, type: 'text', name: id, ...span, x: 6, y: 6, size: 48, color: '#ffffff', font: 'geist', weight: 700, width: 80, fadeIn: 0, fadeOut: 0, rise: false, ...values });
const PLANAR = ['zoom-through', 'sweep-reveal', 'window-push'];
// The carousel in slot N (group × 3 + column) gets SHADERS[N % 6] and
// CAROUSEL_EFFECTS[N % 4], so every shader and post effect renders on at least
// one template and a smaller group never reshuffles the groups after it.
function carousel(templateId, index, x) {
  const template = TEMPLATES.find(item => item.id === templateId);
  const layer = { ...demoProject().layers.find(l => l.type === 'carousel'), id: `carousel-${templateId}`, name: template.name, template: templateId, ...template.defaults };
  return { ...layer, ...span, x, y: 50, cardCount: template.defaults?.cardCount ?? 6, speed: template.defaults?.speed ?? 30, loopDuration: template.defaults?.loopDuration ?? 0,
    size: PLANAR.includes(templateId) ? 0.5 : templateId === 'stack-shuffle' ? 0.58 : 1, tilt: templateId === 'flip' ? 0 : -12, roll: 0,
    shader: SHADERS[index % SHADERS.length].id, intensity: 0.6, layerEffect: CAROUSEL_EFFECTS[index % CAROUSEL_EFFECTS.length].id,
    cornerRadius: index % 3 ? 12 : 0, cardShape: index % 2 ? 'squircle' : 'rounded' };
}
// Slot 14 (Monochrome) belonged to the retired Twist; a second Circular keeps that shader covered.
const CAROUSEL_GROUPS = [['circular'], ['horizontal', 'flip', 'showcase'], ['zoom-through', 'sweep-reveal'], ['stack-shuffle', 'sphere', 'spinner'], ['stack', 'stickers', 'circular'], ['window-push', 'wheel']];

// The Horizontal carousel (slot 1, Halftone) also covers Optical Warp after a Paper effect.
function carouselFixtures() {
  return CAROUSEL_GROUPS.map((group, g) => {
    const project = base(`Carousels ${group.join(' ')}`, 'landscape');
    // Window Push fills the canvas, so its partner sits beside the window.
    const columns = group.length === 3 ? [22, 50, 78] : group.length === 1 ? [50] : group.includes('window-push') ? [50, 72] : [28, 72];
    project.layers = [colorBackground('#16181d'), ...group.map((id, i) => ({ ...carousel(id, g * 3 + i, columns[i]), ...(id === 'horizontal' && { effects: [{ ...DEFAULT_FILTERS['optical-warp'], amount: 0.6 }] }) }))];
    return { id: `carousels-${group.join('-')}`, times: [0.5, 1.7], project };
  });
}
// Twelve full-canvas backgrounds offset into a 4 × 3 grid: in row-major order
// each later layer covers the cells at and after its own, so every cell shows
// exactly one pattern.
function backgroundFixture() {
  const project = base('Backgrounds and fonts', 'portrait34');
  const backgrounds = PROCEDURAL_BACKGROUNDS.map(({ id }, i) => ({ id: `pattern-${id}`, type: 'background', name: id, ...span, mode: 'procedural', src: '', fit: 'cover', offset: 0, loop: true,
    color: ['#0b1020', '#1f0b14', '#0b1f14', '#1a1a0b'][i % 4], pattern: id, patternColor: ['#ffffff', '#ff5a36', '#3ad1ff', '#d6ff3a'][i % 4], patternScale: 1, patternIntensity: 0.7, patternSpeed: 0.6, patternSeed: i + 3, x: i % 4 * 25, y: Math.floor(i / 4) * 100 / 3 }));
  const styles = FONTS.flatMap(font => font.weights.map(weight => ({ font: font.id, weight })));
  const reveals = ['up', 'none', 'right', 'none', 'down', 'left', 'none'];
  const texts = styles.map(({ font, weight }, i) => text(`text-${font}-${weight}`, { text: `${font} ${weight}\nMotion 0123`, font, weight, x: 4 + i % 2 * 46, y: 4 + i * 13, size: font === 'druk-wide' ? 34 : 44, width: 50,
    textAlign: ['left', 'center', 'right'][i % 3], reveal: reveals[i], revealDuration: 1.2, fadeIn: i % 3 === 1 ? 1 : 0, rise: i % 3 === 1, letterSpacing: i % 2 ? 0.05 : -0.035 }));
  project.layers = [...backgrounds, ...texts, { id: 'logo', type: 'logo', name: 'Logo', ...span, src: '/brand/floc-symbol-white.svg', x: 82, y: 88, size: 12, fadeIn: 1, fadeOut: 0 }];
  return { id: 'backgrounds-fonts', times: [0.5, 1.7], project };
}
// The stack carousel warps in WebGL with a choreographed amount, before the
// CSS blur on its canvas.
function effectFixture() {
  const project = base('Effect layers', 'square');
  const stack = { ...carousel('stack', 1, 70), y: 36, size: 0.6, shader: 'none', layerEffect: 'none', effects: [{ ...DEFAULT_FILTERS['optical-warp'], axis: 'vertical', center: 0.4, amount: 0.15 }, { ...DEFAULT_FILTERS.blur, mode: 'progressive', direction: 'bottom', amount: 18 }] };
  stack.choreography = captureState(stack, 0, project.fps, { warpAmount: 0.15 }, 'warp-from');
  stack.choreography = captureState(stack, 3, project.fps, { warpAmount: 0.9 }, 'warp-to');
  project.layers = [
    { ...colorBackground('#000000'), mode: 'image', src: '/demo/poster-3.svg' },
    { id: 'warped', type: 'media', name: 'Warped poster', ...span, src: '/demo/poster-1.svg', x: 4, y: 6, size: 42, offset: 0, loop: false, fadeIn: 0, fadeOut: 0, effects: [{ ...DEFAULT_FILTERS['optical-warp'], amount: 0.8 }] },
    { id: 'adjustment', type: 'effect', name: 'Monochrome adjustment', ...span, start: 1, effectScope: 'below', effects: [{ ...DEFAULT_FILTERS.monochrome, amount: 0.85 }], opacity: 1, fadeIn: 0.4, fadeOut: 0 },
    stack,
    { id: 'logo', type: 'logo', name: 'Logo', ...span, src: '/brand/floc-symbol-white.svg', x: 8, y: 62, size: 22, fadeIn: 1, fadeOut: 0, effects: [{ ...DEFAULT_FILTERS.blur, amount: 6 }, { ...DEFAULT_NOISE, animated: true, color1: '#ff0040', opacity: 0.7, sizeX: 3, sizeY: 3, seed: 11 }] },
    text('grain-title', { text: 'NOISE\nTEXT', x: 44, y: 66, size: 96, font: 'druk-wide', weight: 900, width: 54, effects: [{ ...DEFAULT_NOISE, mode: 'duo', color1: '#ff0040', color2: '#00e0ff', opacity: 0.8, sizeX: 3, sizeY: 3 }] }),
    { id: 'grain', type: 'effect', name: 'Grain', ...span, effectScope: 'overlay', effects: [{ ...DEFAULT_NOISE, mode: 'multi', animated: true, opacity: 0.25, sizeX: 6, sizeY: 6, seed: 7 }], opacity: 0.8, fadeIn: 0, fadeOut: 0 }
  ];
  return { id: 'effects', times: [0.5, 1.7, 2.9], project };
}

export const FIXTURES = [...carouselFixtures(), backgroundFixture(), effectFixture()].map(fixture => ({ ...fixture, project: validateProject(fixture.project) }));
// The schema version is left out: a version bump that keeps the project's content keeps its frames.
export const fixtureHash = fixture => createHash('sha256').update(JSON.stringify({ times: fixture.times, project: { ...fixture.project, version: undefined } })).digest('hex').slice(0, 16);
export const frameName = (id, time) => `${id}-${time.toFixed(2)}s.png`;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webm': 'video/webm', '.woff2': 'font/woff2', '.json': 'application/json' };
function serve(routes, exportRoot) {
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (routes.has(pathname)) { const [type, body] = routes.get(pathname); res.writeHead(200, { 'Content-Type': type }); return res.end(body); }
      const [prefix, folder] = pathname.startsWith('/export/') ? ['/export/', exportRoot] : ['/', path.join(root, 'public')];
      const file = path.join(folder, path.normalize(pathname.slice(prefix.length)));
      if (!file.startsWith(folder + path.sep)) throw new Error('Outside served folder');
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Downscaling and comparison run in a CPU-backed canvas so PNG decoding needs
// no extra Node dependencies.
async function imageTools(page) {
  await page.evaluate(() => {
    const load = async base64 => { const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode(); return image; };
    const canvas = (width, height) => { const node = document.createElement('canvas'); node.width = width; node.height = height; return [node, node.getContext('2d', { willReadFrequently: true })]; };
    const encode = node => node.toDataURL('image/png').slice('data:image/png;base64,'.length);
    window.shrink = async (base64, width) => {
      const image = await load(base64);
      const [node, context] = canvas(width, Math.round(image.naturalHeight * width / image.naturalWidth));
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, node.width, node.height);
      return encode(node);
    };
    window.compare = async (actualBase64, expectedBase64, channel) => {
      const [actual, expected] = await Promise.all([load(actualBase64), load(expectedBase64)]);
      if (actual.naturalWidth !== expected.naturalWidth || actual.naturalHeight !== expected.naturalHeight) return { size: [actual.naturalWidth, actual.naturalHeight, expected.naturalWidth, expected.naturalHeight] };
      const pixels = image => { const [, context] = canvas(image.naturalWidth, image.naturalHeight); context.drawImage(image, 0, 0); return context.getImageData(0, 0, image.naturalWidth, image.naturalHeight); };
      const a = pixels(actual), b = pixels(expected);
      const [diffCanvas, diffContext] = canvas(a.width, a.height);
      const diff = diffContext.createImageData(a.width, a.height);
      let differing = 0, maxDelta = 0;
      for (let i = 0; i < a.data.length; i += 4) {
        const delta = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
        maxDelta = Math.max(maxDelta, delta);
        const gray = (b.data[i] + b.data[i + 1] + b.data[i + 2]) / 12;
        if (delta > channel) { differing++; diff.data.set([255, 0, 64, 255], i); } else diff.data.set([gray, gray, gray, 255], i);
      }
      diffContext.putImageData(diff, 0, 0);
      return { ratio: differing / (a.width * a.height), maxDelta, diff: differing ? encode(diffCanvas) : null };
    };
  });
}

// SwiftShader serializes WebGL inside one browser's GPU process, so
// parallelism comes from separate browsers.
const defaultLanes = Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 2)));
export async function openGoldenSession({ lanes = defaultLanes } = {}) {
  const { default: puppeteer } = await import('puppeteer-core');
  const work = await mkdtemp(path.join(os.tmpdir(), 'floc-golden-'));
  const bundle = await build({ stdin: { resolveDir: path.join(root, 'src'), contents: `
    import { createScene, stageMarkup } from './scene.js';
    import { FORMATS } from './project.js';
    // Mirrors src/editor/Stage.jsx: prepare detached, activate, then fit at 100 %.
    window.flocPreview = async project => {
      const stage = document.querySelector('.stage'), [width, height] = FORMATS[project.format], errors = [];
      stage.style.width = width + 'px'; stage.style.height = height + 'px';
      const node = document.createElement('div');
      node.style.cssText = 'position:absolute;inset:0';
      node.innerHTML = stageMarkup(project);
      const scene = await createScene(node, project, { onMediaError: error => errors.push(error.message) });
      scene.seek(0, false); stage.replaceChildren(node);
      scene.setResolution(width, height); await scene.seek(0, false);
      window.flocSeek = async time => { await scene.seek(time, false); if (errors.length) throw new Error(errors.join(' ')); };
    };
  ` }, bundle: true, write: false, format: 'iife', minify: true });
  const routes = new Map([
    ['/preview.html', ['text/html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${fontFaceCss('/fonts/')}*{box-sizing:border-box}body{margin:0}.stage{position:absolute;left:0;top:0;overflow:hidden;font-family:Geist,Arial,sans-serif}</style></head><body><div class="stage"></div><script src="/preview.js"></script></body></html>`]],
    ['/preview.js', ['text/javascript', bundle.outputFiles[0].text]],
    ['/tools.html', ['text/html', '<!doctype html><title>tools</title>']]
  ]);
  const server = await serve(routes, work);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browsers = await Promise.all(Array.from({ length: lanes }, async () => {
    // WebGL runs on SwiftShader for reproducible pixels; software compositing avoids a second emulated GL pass.
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing', '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text', '--hide-scrollbars', '--mute-audio'] });
    const tools = await browser.newPage();
    await tools.goto(`${origin}/tools.html`);
    await imageTools(tools);
    return { browser, tools };
  }));
  async function render({ browser, tools }, url, selector, fixture, start, seek) {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => errors.push(`Request failed: ${request.url()}`));
    try {
      const [width, height] = FORMATS[fixture.project.format];
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      await page.goto(url, { waitUntil: 'load' });
      await page.evaluate(start, fixture.project);
      const frames = [];
      for (const time of fixture.times) {
        await page.evaluate(seek, time);
        // Let the compositor present the drawn frame before capturing it.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const full = await (await page.$(selector)).screenshot({ encoding: 'base64' });
        frames.push(Buffer.from(await tools.evaluate((value, width) => window.shrink(value, width), full, CAPTURE_WIDTH), 'base64'));
      }
      if (errors.length) throw new Error(errors.join('\n'));
      return frames;
    } finally { await page.close(); }
  }
  const exportStart = () => window.__flocReady;
  // Same contract as the HyperFrames runtime: waitUntil is synchronous-only.
  const exportSeek = time => new Promise((resolve, reject) => {
    const pending = []; let open = true;
    window.dispatchEvent(new CustomEvent('hf-seek', { detail: { time, waitUntil: promise => { if (!open) throw new Error('hf-seek waitUntil() must be called synchronously'); pending.push(promise); } } }));
    open = false;
    Promise.all(pending).then(resolve, reject);
  });
  return {
    // Resolves to { [fixture.id]: [{ time, exported, preview }] } with PNG buffers.
    async captureAll(fixtures) {
      // prepareComposition rebuilds the shared engine bundle, so preparation is serial.
      let chain = Promise.resolve();
      const prepared = fixtures.map(fixture => chain = chain.catch(() => {}).then(() => prepareComposition(fixture.project, path.join(work, fixture.id))));
      const jobs = [
        ...fixtures.map(fixture => ({ fixture, kind: 'preview', run: lane => render(lane, `${origin}/preview.html`, '.stage', fixture, project => window.flocPreview(project), time => window.flocSeek(time)) })),
        ...fixtures.map((fixture, i) => ({ fixture, kind: 'exported', run: async lane => { await prepared[i]; return render(lane, `${origin}/export/${fixture.id}/index.html`, '.composition', fixture, exportStart, exportSeek); } }))
      ];
      const results = Object.fromEntries(fixtures.map(fixture => [fixture.id, fixture.times.map(time => ({ time }))]));
      let next = 0;
      await Promise.all(browsers.map(async lane => {
        while (next < jobs.length) {
          const { fixture, kind, run } = jobs[next++];
          try { (await run(lane)).forEach((frame, i) => { results[fixture.id][i][kind] = frame; }); }
          catch (error) { throw new Error(`${fixture.id} (${kind === 'exported' ? 'export' : 'preview'}): ${error.message}`, { cause: error }); }
        }
      }));
      await Promise.allSettled(prepared);
      return results;
    },
    async compare(actual, expected, tolerance) {
      const result = await browsers[0].tools.evaluate((a, b, channel) => window.compare(a, b, channel), actual.toString('base64'), expected.toString('base64'), tolerance.channel);
      if (result.size) return { ok: false, summary: `size ${result.size[0]}×${result.size[1]} vs ${result.size[2]}×${result.size[3]}` };
      return { ok: result.ratio <= tolerance.ratio, ratio: result.ratio, maxDelta: result.maxDelta, diff: result.diff && Buffer.from(result.diff, 'base64'),
        summary: `${(result.ratio * 100).toFixed(3)}% pixels differ by >${tolerance.channel}/255 (limit ${(tolerance.ratio * 100).toFixed(3)}%), max channel delta ${result.maxDelta}` };
    },
    browserVersion: () => browsers[0].browser.version(),
    async close() {
      await Promise.all(browsers.map(async ({ browser }) => {
        const child = browser.process();
        await browser.close();
        // Chrome's updater and crash handler may inherit stdio and outlive the browser.
        for (const stream of [child?.stdin, child?.stdout, child?.stderr]) stream?.destroy();
      }));
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
      await rm(work, { recursive: true, force: true });
    }
  };
}

// Writes the failing capture and its diff for inspection; returns the paths.
export async function writeFailure(name, images) {
  await mkdir(QA_DIR, { recursive: true });
  const written = [];
  for (const [suffix, buffer] of Object.entries(images)) if (buffer) {
    const file = path.join(QA_DIR, name.replace(/\.png$/, `-${suffix}.png`));
    await writeFile(file, buffer); written.push(path.relative(root, file));
  }
  return written;
}

// Compares one capture with its baseline (when given) and with the preview
// path. Failing captures and diffs are written to QA_DIR.
export async function checkFrame(session, fixture, frame, baseline) {
  const name = frameName(fixture.id, frame.time), failures = [], notes = [];
  if (baseline) {
    const result = await session.compare(frame.exported, baseline, BASELINE_TOLERANCE);
    notes.push(`baseline ${result.summary}`);
    if (!result.ok) failures.push(`${name}: export vs baseline: ${result.summary}; see ${(await writeFailure(name, { actual: frame.exported, expected: baseline, diff: result.diff })).join(', ')}`);
  }
  const parity = await session.compare(frame.preview, frame.exported, PARITY_TOLERANCE);
  notes.push(`parity ${parity.summary}`);
  if (!parity.ok) failures.push(`${name}: preview vs export: ${parity.summary}; see ${(await writeFailure(name, { export: frame.exported, preview: frame.preview, 'parity-diff': parity.diff })).join(', ')}`);
  return { failures, summary: `${name}: ${notes.join('; ')}` };
}

async function update() {
  if (!executablePath) throw new Error('Chrome or Edge is required to capture golden frames.');
  const started = Date.now();
  const session = await openGoldenSession();
  const manifest = { captureWidth: CAPTURE_WIDTH, browser: await session.browserVersion(), baselineTolerance: BASELINE_TOLERANCE, parityTolerance: PARITY_TOLERANCE, fixtures: {} };
  const failures = [], outputs = new Map();
  await rm(QA_DIR, { recursive: true, force: true });
  try {
    const captures = await session.captureAll(FIXTURES);
    for (const fixture of FIXTURES) {
      for (const frame of captures[fixture.id]) {
        const result = await checkFrame(session, fixture, frame);
        console.log(result.summary);
        failures.push(...result.failures);
        outputs.set(frameName(fixture.id, frame.time), frame.exported);
      }
      manifest.fixtures[fixture.id] = { hash: fixtureHash(fixture), format: fixture.project.format, frames: fixture.times.map(time => frameName(fixture.id, time)) };
    }
  } finally { await session.close(); }
  // Baselines double as parity references; never store a mismatched preview/export pair.
  if (failures.length) throw new Error(`Preview/export parity failed; baselines were not updated:\n${failures.join('\n')}`);
  await rm(GOLDEN_DIR, { recursive: true, force: true });
  await mkdir(GOLDEN_DIR, { recursive: true });
  for (const [name, buffer] of outputs) await writeFile(path.join(GOLDEN_DIR, name), buffer);
  await writeFile(path.join(GOLDEN_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Wrote ${outputs.size} golden frames to ${path.relative(root, GOLDEN_DIR)} in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--update')) { console.error('Usage: node scripts/golden-frames.mjs --update'); process.exit(2); }
  await update();
}
