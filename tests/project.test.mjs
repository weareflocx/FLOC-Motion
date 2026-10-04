import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, validateProject, patchLayer, resizeDuration, audioTime, escapeHtml, layerAlpha, fitFades, TEMPLATES, SHADERS } from '../src/project.js';
import { createTools, registerWebMCP } from '../src/webmcp.js';
import { stageMarkup } from '../src/scene.js';
import { BRAND } from '../src/brand.js';
import { CATALOG, getCatalogEntry, listCatalog } from '../src/catalog.js';
import { stat, readFile } from 'node:fs/promises';

test('FLOC defaults use verified monochrome identifiers and reject unknown brand assets', async () => {
  const p = demoProject();
  assert.equal(p.layers.find(l => l.type === 'background').color, '#000000');
  assert.equal(p.layers.find(l => l.type === 'logo').src, BRAND.assets.symbolWhite);
  assert(stageMarkup(p).includes(BRAND.assets.symbolWhite));
  for (const src of Object.values(BRAND.assets)) assert((await stat(new URL(`../public${src}`, import.meta.url))).size > 0);
  assert.throws(() => patchLayer(p, 'logo', { src: '/brand/untrusted.svg' }));
  for (let i = 1; i <= 6; i++) {
    const svg = await readFile(new URL(`../public/demo/poster-${i}.svg`, import.meta.url), 'utf8');
    for (const color of svg.match(/#[\da-f]{6}/gi) || []) assert(['#000000', '#ffffff', '#f4f4f4'].includes(color));
  }
});

test('demo project validates and all presets are selectable without losing assets', () => {
  const p = demoProject(); assert.equal(validateProject(p).images.length, 6);
  for (const t of TEMPLATES) for (const s of SHADERS) { const next = patchLayer(p, 'carousel', { template: t.id, shader: s.id }); assert.deepEqual(next.images, p.images); assert.equal(next.layers.find(l => l.id === 'headline').text, p.layers[2].text); }
});
test('switching a media background to color preserves its source without rendering it', () => {
  for (const [mode, extension] of [['image', 'svg'], ['video', 'mp4']]) {
    const src = `/assets/12345678-1234-1234-1234-123456789012.${extension}`;
    const media = patchLayer(demoProject(), 'background', { mode, src });
    const solid = patchLayer(media, 'background', { mode: 'color' });
    assert.equal(solid.layers.find(l => l.id === 'background').src, src);
    assert.deepEqual(validateProject(solid), solid);
    assert.ok(!stageMarkup(solid).includes(src));
    assert.throws(() => patchLayer(solid, 'background', { mode: mode === 'video' ? 'image' : 'video' }), /background asset type/);
  }
  assert.throws(() => patchLayer(demoProject(), 'background', { src: '/assets/12345678-1234-1234-1234-123456789012.mp3' }), /background asset type/);
});
test('local catalog normalizes all source recipes into safe FLOC patches', () => {
  assert.equal(CATALOG.length, 108);
  assert.equal(new Set(CATALOG.map(entry => entry.id)).size, 108);
  const orbit = getCatalogEntry('orbit-pure-01');
  assert.equal(orbit.carouselPatch.template, 'circular');
  assert.equal(orbit.carouselPatch.shader, 'none');
  assert.equal(orbit.support.kind, 'reconstructed_recipe');
  assert(orbit.thumbnail.startsWith('/catalog/visuals/'));
  assert.equal(listCatalog({ family: 'Orbit', limit: 200 }).length, 24);
  assert.equal(listCatalog({ query: 'lightroom' }).length, 8);
});
test('reject external, traversal and executable asset sources', () => {
  for (const src of ['https://example.com/a.png', '/assets/../../secret', 'javascript:alert(1)', '/demo/unknown.svg']) { const p = demoProject(); p.images[0].src = src; assert.throws(() => validateProject(p)); }
});
test('reject invalid IDs, timing, dimensions and effect values', () => {
  assert.throws(() => patchLayer(demoProject(), 'carousel', { shader: 'eval' }));
  assert.throws(() => patchLayer(demoProject(), 'carousel', { speed: NaN }));
  assert.throws(() => patchLayer(demoProject(), 'headline', { end: 40 }));
  assert.throws(() => patchLayer(demoProject(), 'headline', { type: 'logo' }));
  const p = demoProject(); p.layers[1].id = 'background'; assert.throws(() => validateProject(p));
});
test('duration changes preserve bounded layer ranges and extend full-length tracks', () => {
  const p = patchLayer(demoProject(), 'headline', { start: 7, end: 9 });
  const shortened = resizeDuration(p, 3); assert.equal(shortened.layers[2].end, 3); assert(shortened.layers[2].start < 3);
  const extended = resizeDuration(demoProject(), 20); assert(extended.layers.every(l => l.end === 20));
});
test('layer timing and audio seek are independently deterministic', () => {
  const p = demoProject(); const l = p.layers[2]; assert.equal(layerAlpha(l, 1), 1); assert.equal(layerAlpha(l, -1), 0); assert.equal(layerAlpha(l, 12), 0);
  const music = { start: 2, offset: 3, loop: true }; assert.equal(audioTime(music, 4, 5), 3); assert.equal(audioTime(music, 3, 5), 4);
  assert.equal(audioTime({ ...music, loop: false }, 8, 5), 5);
});
test('legacy text entrances migrate to fades and rise without mutating the input', () => {
  const raw = demoProject(); const legacy = { ...raw.layers[2], id: 'legacy-rise' };
  for (const l of [raw.layers[2], raw.layers[3], legacy]) { delete l.fadeIn; delete l.fadeOut; delete l.rise; }
  raw.layers[2].animation = 'fade'; raw.layers[3].animation = 'none'; legacy.animation = 'rise'; raw.layers.push(legacy);
  const before = structuredClone(raw); const p = validateProject(raw);
  const fades = id => { const l = p.layers.find(l => l.id === id); return [l.fadeIn, l.fadeOut, l.rise]; };
  assert.deepEqual(raw, before);
  assert.deepEqual(fades('headline'), [0.45, 0.25, false]); assert.deepEqual(fades('signature'), [0, 0, false]); assert.deepEqual(fades('legacy-rise'), [0.45, 0.25, true]);
  assert(p.layers.every(l => !Object.hasOwn(l, 'animation')));
  assert.equal(layerAlpha(p.layers[2], 0.225), 0.5); assert.equal(layerAlpha(p.layers[2], 11.875), 0.5);
  const invalid = structuredClone(before); invalid.layers[2].animation = 'spin'; assert.throws(() => validateProject(invalid), /Unknown text style/);
  const bare = demoProject(); for (const key of ['fadeIn', 'fadeOut', 'rise']) delete bare.layers[2][key];
  const text = validateProject(bare).layers[2]; assert.deepEqual([text.fadeIn, text.fadeOut, text.rise], [0, 0, false]);
});
test('fades belong to text, logo and carousel layers only', () => {
  const raw = demoProject(); for (const l of raw.layers) { delete l.fadeIn; delete l.fadeOut; }
  raw.layers[0].fadeIn = 2; raw.layers[5].fadeOut = 2;
  const p = validateProject(raw);
  for (const l of p.layers) assert.equal(Object.hasOwn(l, 'fadeIn') && Object.hasOwn(l, 'fadeOut'), ['text', 'logo', 'carousel'].includes(l.type));
  assert(p.layers.filter(l => Object.hasOwn(l, 'fadeIn')).every(l => l.fadeIn === 0 && l.fadeOut === 0));
  assert.throws(() => patchLayer(p, 'background', { fadeIn: 1 }), /Unknown layer property/);
});
test('fade ramps are linear for text, logo and carousel and zero fades cut', () => {
  for (const id of ['headline', 'logo', 'carousel']) {
    const l = patchLayer(demoProject(), id, { start: 1, end: 3, fadeIn: 0.5, fadeOut: 1 }).layers.find(l => l.id === id);
    assert.deepEqual([0.99, 1, 1.25, 1.5, 2, 2.5, 3].map(t => layerAlpha(l, t)), [0, 0, 0.5, 1, 1, 0.5, 0]);
    const cut = { ...l, fadeIn: 0, fadeOut: 0 }; assert.deepEqual([0.99, 1, 2.99, 3].map(t => layerAlpha(cut, t)), [0, 1, 1, 0]);
    assert.equal(layerAlpha({ ...l, visible: false }, 2), 0);
  }
});
test('fades fit inside the layer on every edit and re-validation is idempotent', () => {
  let p = patchLayer(demoProject(), 'logo', { start: 0, end: 2, fadeIn: 1.5, fadeOut: 4.5 });
  let logo = p.layers.find(l => l.id === 'logo'); assert.deepEqual([logo.fadeIn, logo.fadeOut], [0.5, 1.5]);
  p = patchLayer(p, 'logo', { end: 1 }); logo = p.layers.find(l => l.id === 'logo'); assert.deepEqual([logo.fadeIn, logo.fadeOut], [0.25, 0.75]);
  const long = patchLayer(demoProject(), 'headline', { fadeIn: 5, fadeOut: 5 }); const short = resizeDuration(long, 3);
  assert.deepEqual([short.layers[2].fadeIn, short.layers[2].fadeOut], [1.5, 1.5]);
  const odd = patchLayer(demoProject(), 'carousel', { start: 0.1, end: 0.4, fadeIn: 0.2, fadeOut: 0.1 + 0.2 }); const c = odd.layers[1];
  assert(c.fadeIn + c.fadeOut <= c.end - c.start + 1e-9); assert.deepEqual(validateProject(odd), odd); assert.deepEqual(validateProject(validateProject(long)), validateProject(long));
  assert.deepEqual(fitFades(1, 3, 2), { fadeIn: 0.5, fadeOut: 1.5 }); assert.deepEqual(fitFades(0, 0, 2), { fadeIn: 0, fadeOut: 0 });
});
test('invalid fades and rise values fail with actionable messages', () => {
  for (const fadeIn of [-0.1, NaN, '1', 31]) assert.throws(() => patchLayer(demoProject(), 'logo', { fadeIn }), /Fade in must be between 0 and 30/);
  assert.throws(() => patchLayer(demoProject(), 'carousel', { fadeOut: Infinity }), /Fade out must be between 0 and 30/);
  assert.throws(() => patchLayer(demoProject(), 'headline', { rise: 'yes' }), /rise must be true or false/);
});
test('generated composition escapes user markup and does not execute text', () => {
  const p = patchLayer(demoProject(), 'headline', { text: '<img src=x onerror="alert(1)"> & hello' });
  const html = stageMarkup(p); assert(!html.includes('<img src=x')); assert(html.includes('&lt;img')); assert.equal(escapeHtml("'"), '&#39;');
});
test('WebMCP uses shared validation, persists mutations and gates rendering', async () => {
  let p = demoProject(); let saves = 0; let requested = 0;
  const tools = createTools({ get: () => p, set: n => { p = n; }, save: async () => saves++, seek: () => {}, audit: () => {}, requestExport: () => requested++, exportStatus: () => ({ state: 'idle' }) });
  const call = (name, args = {}) => tools.find(t => t.name === name).execute(args);
  await call('floc_set_shader', { shader: 'wave', intensity: 0.7 }); assert.equal(p.layers[1].shader, 'wave'); assert.equal(saves, 1);
  await assert.rejects(call('floc_set_shader', { shader: 'unknown' })); assert.equal(saves, 1);
  await call('floc_add_text', { text: 'One more layer.' }); assert.equal(p.layers.length, 7); assert.deepEqual([p.layers[6].fadeIn, p.layers[6].fadeOut, p.layers[6].rise], [0.45, 0.25, false]);
  await call('floc_update_layer', { id: 'logo', patch: { fadeIn: 1, fadeOut: 2 } }); assert.deepEqual([p.layers[4].fadeIn, p.layers[4].fadeOut], [1, 2]);
  const result = JSON.parse(await call('floc_request_export')); assert.equal(result.state, 'awaiting_user_confirmation'); assert.equal(requested, 1);
  assert.equal(tools.find(t => t.name === 'floc_get_project').annotations.readOnlyHint, true);
});
test('WebMCP exposes and applies local catalog recipes through project validation', async () => {
  let p = demoProject(); let saves = 0;
  const tools = createTools({ get: () => p, set: n => { p = n; }, save: async () => saves++, seek: () => {}, audit: () => {}, requestExport: () => {}, exportStatus: () => ({ state: 'idle' }) });
  const call = (name, args = {}) => tools.find(t => t.name === name).execute(args);
  const listed = JSON.parse(await call('floc_list_catalog', { family: 'Orbit', limit: 2 }));
  assert.equal(listed.templates.length, 2);
  const preset = JSON.parse(await call('floc_get_preset', { id: 'orbit-pure-01' }));
  assert.equal(preset.id, 'orbit-pure-01');
  const applied = JSON.parse(await call('floc_apply_preset', { id: 'orbit-pure-01' }));
  assert.equal(applied.preset.id, 'orbit-pure-01');
  assert.equal(p.layers[1].template, 'circular');
  assert.equal(saves, 1);
});
test('native WebMCP registers with AbortSignal and cleans up; unsupported is explicit', async () => {
  const calls = []; const context = { registerTool: async (tool, options) => calls.push({ tool, options }) };
  const r = registerWebMCP({}, context); await r.ready; assert.equal(calls.length, 14); assert(!calls[0].options.signal.aborted); r.dispose(); assert(calls[0].options.signal.aborted);
  assert.equal(registerWebMCP({}, {}).supported, false);
});
