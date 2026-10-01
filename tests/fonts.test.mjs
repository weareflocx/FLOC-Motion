import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FONTS, FONT_FILES, fontFaceCss } from '../src/fonts.js';
import { demoProject, validateProject, patchLayer } from '../src/project.js';
import { stageMarkup } from '../src/scene.js';

test('studio font families and genuine weights are validated and rendered', () => {
  for (const font of FONTS) for (const weight of font.weights) {
    const p = patchLayer(demoProject(), 'headline', { font: font.id, weight });
    assert.match(stageMarkup(p), new RegExp(`font-family:${font.family};font-weight:${weight}`));
  }
  assert.throws(() => patchLayer(demoProject(), 'headline', { font: 'remote-font', weight: 900 }), /text style/);
  assert.throws(() => patchLayer(demoProject(), 'headline', { font: 'druk-wide', weight: 400 }), /text style/);
});
test('legacy projects retain Geist and their existing weight', () => {
  const p = demoProject(); const l = p.layers.find(l => l.id === 'headline');
  delete l.font; l.weight = 800;
  const validated = validateProject(p).layers.find(l => l.id === 'headline');
  assert.equal(validated.font, 'geist'); assert.equal(validated.weight, 800);
  assert.equal(patchLayer(p, 'headline', { font: 'geist-mono', weight: 700 }).layers.find(l => l.id === 'headline').font, 'geist-mono');
});
test('all preview and export font faces use bundled WOFF2 assets', async () => {
  for (const font of FONT_FILES) {
    const bytes = await readFile(new URL(`../public/fonts/${font.file}`, import.meta.url));
    assert.equal(bytes.subarray(0, 4).toString(), 'wOF2');
    assert.ok(fontFaceCss('/fonts/').includes(`/fonts/${font.file}`));
    assert.ok(fontFaceCss('./').includes(`./${font.file}`));
  }
});
