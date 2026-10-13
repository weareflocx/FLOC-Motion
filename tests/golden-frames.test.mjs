import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { TEMPLATES } from '../src/project.js';
import { PROCEDURAL_BACKGROUNDS } from '../src/backgrounds.js';
import { EFFECTS } from '../src/effects.js';
import { FONTS } from '../src/fonts.js';
import { FIXTURES, GOLDEN_DIR, QA_DIR, checkFrame, executablePath, fixtureHash, frameName, openGoldenSession } from '../scripts/golden-frames.mjs';

const manifestFile = path.join(GOLDEN_DIR, 'manifest.json');
const update = 'Run `npm run golden:update` after an intentional fixture or rendering change.';

test('golden fixtures cover every template, background, font and effect, on carousels and other layers', () => {
  const layers = FIXTURES.flatMap(fixture => fixture.project.layers);
  const used = (type, field) => new Set(layers.filter(layer => layer.type === type).map(layer => layer[field]));
  const missing = [
    ...TEMPLATES.filter(({ id }) => !used('carousel', 'template').has(id)).map(({ id }) => `template ${id}`),
    ...PROCEDURAL_BACKGROUNDS.filter(({ id }) => !layers.some(layer => layer.type === 'background' && layer.mode === 'procedural' && layer.pattern === id)).map(({ id }) => `background ${id}`),
    ...FONTS.flatMap(font => font.weights.filter(weight => !layers.some(layer => layer.type === 'text' && layer.font === font.id && layer.weight === weight)).map(weight => `font ${font.id} ${weight}`)),
    ...EFFECTS.filter(({ id }) => !layers.some(layer => layer.effects?.some(effect => effect.type === id))).map(({ id }) => `effect ${id}`),
    ...EFFECTS.filter(({ id }) => !layers.some(layer => layer.type === 'carousel' && layer.effects.some(effect => effect.type === id))).map(({ id }) => `carousel effect ${id}`),
    ...['halftone', 'duotone', 'chromatic'].filter(id => !layers.some(layer => ['text', 'media'].includes(layer.type) && layer.effects?.some(effect => effect.type === id))).map(id => `text or media effect ${id}`)
  ];
  assert.deepEqual(missing, [], 'Add the new option to a fixture in scripts/golden-frames.mjs, then run `npm run golden:update`.');
});

test('export frames match the golden baselines and the editor preview', { skip: !executablePath && 'Chrome or Edge is required for golden frame verification', timeout: 240000 }, async t => {
  assert(existsSync(manifestFile), `Missing ${path.relative(process.cwd(), manifestFile)}. ${update}`);
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  assert.deepEqual(Object.keys(manifest.fixtures), FIXTURES.map(fixture => fixture.id), `Golden fixtures changed. ${update}`);
  for (const fixture of FIXTURES) assert.equal(manifest.fixtures[fixture.id].hash, fixtureHash(fixture), `Fixture ${fixture.id} changed. ${update}`);
  await rm(QA_DIR, { recursive: true, force: true });
  const session = await openGoldenSession();
  t.after(() => session.close());
  const captures = await session.captureAll(FIXTURES);
  for (const fixture of FIXTURES) await t.test(fixture.id, async () => {
    const failures = [];
    for (const frame of captures[fixture.id]) {
      const baseline = readFileSync(path.join(GOLDEN_DIR, frameName(fixture.id, frame.time)));
      failures.push(...(await checkFrame(session, fixture, frame, baseline)).failures);
    }
    if (failures.length) assert.fail(`${failures.join('\n')}\nBaselines were captured with ${manifest.browser}; this run used ${await session.browserVersion()}. ${update}`);
  });
});
