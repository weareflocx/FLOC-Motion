import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, validateProject, patchLayer, linkFormats, switchFormat, resizeDuration } from '../src/project.js';
import { DEFAULT_PROCEDURAL_BACKGROUND, PROCEDURAL_BACKGROUNDS } from '../src/backgrounds.js';
import { DEFAULT_TEXT_STYLE } from '../src/text-style.js';
import { stageMarkup } from '../src/scene.js';
import { createTools } from '../src/webmcp.js';

const layer = (project, id) => project.layers.find(item => item.id === id);

test('legacy compositions keep their appearance and gain idempotent style defaults', () => {
  const raw = demoProject(), before = structuredClone(raw);
  const p = validateProject(raw);
  assert.deepEqual(raw, before);
  for (const [key, value] of Object.entries(DEFAULT_TEXT_STYLE)) assert.equal(layer(p, 'headline')[key], value);
  for (const [key, value] of Object.entries(DEFAULT_PROCEDURAL_BACKGROUND)) assert.equal(layer(p, 'background')[key], value);
  assert.equal(layer(p, 'background').mode, 'color');
  assert.equal(stageMarkup(raw), stageMarkup(p));
  assert.deepEqual(validateProject(p), p);
});

test('all installed procedural backgrounds validate while retaining inactive media', () => {
  for (const { id } of PROCEDURAL_BACKGROUNDS) {
    const p = patchLayer(demoProject(), 'background', { mode: 'procedural', pattern: id, src: '/demo/poster-1.svg' });
    assert.equal(layer(p, 'background').pattern, id);
    const html = stageMarkup(p);
    assert.match(html, /id="background-background"/);
    assert(!html.includes('src="/demo/poster-1.svg"'));
    assert.equal(layer(patchLayer(p, 'background', { mode: 'image' }), 'background').src, '/demo/poster-1.svg');
  }
});

test('style validation rejects unsafe, invalid and out-of-range edits through canonical patches', () => {
  const backgrounds = [{ pattern: 'eval' }, { patternColor: 'red' }, { patternScale: 0 }, { patternIntensity: 1.1 }, { patternSpeed: Infinity }, { patternSeed: 1.5 }, { patternSeed: 65536 }];
  for (const patch of backgrounds) assert.throws(() => patchLayer(demoProject(), 'background', patch));
  for (const patch of [{ lineHeight: 0.49 }, { letterSpacing: NaN }, { letterSpacing: 0.51 }, { textAlign: 'justify' }, { reveal: 'runtime-code' }, { revealDuration: 5.1 }]) assert.throws(() => patchLayer(demoProject(), 'headline', patch));
  assert.throws(() => patchLayer(demoProject(), 'logo', { reveal: 'up' }), /Unknown layer property/);
  assert.throws(() => patchLayer(demoProject(), 'headline', { pattern: 'waves' }), /Unknown layer property/);
  const p = patchLayer(demoProject(), 'headline', { locked: true });
  assert.throws(() => patchLayer(p, 'headline', { letterSpacing: 0 }), /Unlock/);
  const reveal = patchLayer(demoProject(), 'headline', { reveal: 'up', revealDuration: 3, end: 2 });
  assert.equal(layer(reveal, 'headline').revealDuration, 2);
  assert.equal(layer(resizeDuration(reveal, 1), 'headline').revealDuration, 1);
});

test('linked formats retain local type settings and share reveal and procedural settings', () => {
  let p = linkFormats(demoProject());
  p = patchLayer(p, 'headline', { lineHeight: 1.1, letterSpacing: 0.02, textAlign: 'right' });
  p = switchFormat(p, 'portrait');
  p = patchLayer(p, 'headline', { lineHeight: 1.5, letterSpacing: -0.1, textAlign: 'center', reveal: 'right', revealDuration: 1.2 });
  p = patchLayer(p, 'background', { mode: 'procedural', pattern: 'waves', patternSeed: 19 });
  p = switchFormat(p, 'square');
  assert.deepEqual(['lineHeight', 'letterSpacing', 'textAlign'].map(key => layer(p, 'headline')[key]), [1.1, 0.02, 'right']);
  assert.equal(layer(p, 'headline').reveal, 'right');
  assert.equal(layer(p, 'headline').revealDuration, 1.2);
  assert.equal(layer(p, 'background').patternSeed, 19);
  const saved = JSON.parse(JSON.stringify(p));
  p = switchFormat(validateProject(saved), 'portrait');
  assert.deepEqual(['lineHeight', 'letterSpacing', 'textAlign'].map(key => layer(p, 'headline')[key]), [1.5, -0.1, 'center']);
  saved.linkedFormats.layouts.portrait.layers.headline.textAlign = 'justify';
  assert.throws(() => validateProject(saved), /alignment/);
});

test('agent tools discover and edit installed styles without starting a render', async () => {
  let p = demoProject(), saves = 0, renders = 0;
  const tools = createTools({ get: () => p, set: next => { p = next; }, save: async () => saves++, audit() {}, requestExport() { renders++; } });
  const call = (name, args = {}) => tools.find(item => item.name === name).execute(args);
  const effects = JSON.parse(await call('floc_list_effects'));
  assert.deepEqual(effects.backgrounds, PROCEDURAL_BACKGROUNDS);
  assert(effects.textReveals.some(item => item.id === 'up'));
  await call('floc_update_layer', { id: 'background', patch: { mode: 'procedural', pattern: 'grain', patternSeed: 3 } });
  await call('floc_update_layer', { id: 'headline', patch: { lineHeight: 1.4, letterSpacing: 0.03, reveal: 'up' } });
  assert.equal(layer(p, 'headline').lineHeight, 1.4);
  assert.equal(layer(p, 'background').patternSeed, 3);
  await assert.rejects(call('floc_update_layer', { id: 'background', patch: { pattern: 'runtime-glsl' } }));
  assert.equal(saves, 2);
  assert.equal(renders, 0);
});
