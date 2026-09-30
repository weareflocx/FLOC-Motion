import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, validateProject, patchLayer, resizeDuration, audioTime, escapeHtml, layerAlpha, TEMPLATES, SHADERS } from '../src/project.js';
import { createTools, registerWebMCP } from '../src/webmcp.js';
import { stageMarkup } from '../src/scene.js';
import { BRAND } from '../src/brand.js';
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
  await call('floc_add_text', { text: 'One more layer.' }); assert.equal(p.layers.length, 7);
  const result = JSON.parse(await call('floc_request_export')); assert.equal(result.state, 'awaiting_user_confirmation'); assert.equal(requested, 1);
  assert.equal(tools.find(t => t.name === 'floc_get_project').annotations.readOnlyHint, true);
});
test('native WebMCP registers with AbortSignal and cleans up; unsupported is explicit', async () => {
  const calls = []; const context = { registerTool: async (tool, options) => calls.push({ tool, options }) };
  const r = registerWebMCP({}, context); await r.ready; assert.equal(calls.length, 10); assert(!calls[0].options.signal.aborted); r.dispose(); assert(calls[0].options.signal.aborted);
  assert.equal(registerWebMCP({}, {}).supported, false);
});
