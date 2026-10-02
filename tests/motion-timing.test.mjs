import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MOTION, MOTION_CURVES, motionClock, motionEase } from '../src/motion-timing.js';
import { carouselCard, MOTION_VARIANTS } from '../src/carousel-motion.js';
import { demoProject, patchLayer, validateProject } from '../src/project.js';
import { CATALOG, readCatalogSetting } from '../src/catalog.js';
import { createTools } from '../src/webmcp.js';

const motion = patch => ({ ...DEFAULT_MOTION, ...patch });
const layer = patch => ({ ...demoProject().layers[1], loopDuration: 6, start: 0, ...patch });
const close = (a, b) => assert(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('saved and legacy rhythms migrate without changing motion or mutating the input', () => {
  const raw = demoProject(); delete raw.layers[1].motion;
  const before = structuredClone(raw), migrated = validateProject(raw);
  assert.deepEqual(raw, before);
  assert.deepEqual(migrated.layers[1].motion, DEFAULT_MOTION);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(migrated))), migrated);
  for (const template of Object.keys(MOTION_VARIANTS)) for (const t of [0, .234, 1.72, 19.8]) {
    assert.deepEqual(carouselCard({ ...raw.layers[1], template }, 1, 6, t), carouselCard({ ...migrated.layers[1], template }, 1, 6, t));
  }
  const changed = patchLayer(raw, 'carousel', { motion: motion({ curve: 'glide' }), speed: -30 });
  assert.equal(changed.layers[1].motionBaseline.speed, before.layers[1].speed);
  assert.equal(changed.layers[1].motionBaseline.motion.curve, 'native');
});

test('motion and its reset baseline reject malformed, unknown and out-of-bounds settings', () => {
  const invalid = [null, [], {}, motion({ mode: 'boomerang' }), motion({ curve: 'code' }), motion({ action: 0 }), motion({ pause: -1 }), motion({ intensity: 2 }), motion({ intensity: NaN }), motion({ action: '1' }), motion({ script: 'invalid' })];
  for (const settings of invalid) assert.throws(() => patchLayer(demoProject(), 'carousel', { motion: settings }));
  for (const baseline of [null, {}, { name: 'Invalid', motion: DEFAULT_MOTION, speed: 100, loopDuration: 6 }, { name: 'Invalid', motion: motion({ pause: 40 }), speed: 18, loopDuration: 6 }]) assert.throws(() => patchLayer(demoProject(), 'carousel', { motionBaseline: baseline }));
  const p = validateProject(demoProject());
  p.layers[1].locked = true;
  assert.throws(() => patchLayer(p, 'carousel', { motion: motion({ curve: 'smooth' }) }), /Unlock/);
});

test('action duration moves exactly one card and pause holds it, independent of FPS or seek order', () => {
  const l = layer({ motion: motion({ mode: 'steps', action: .5, pause: .5, curve: 'smooth', intensity: 1 }) });
  close(motionClock(l, 6, .25).advance, .5);
  for (const t of [.5, .6, .75, .99]) {
    close(motionClock(l, 6, t).advance, 1);
    assert.deepEqual(carouselCard(l, 1, 6, t), carouselCard(l, 1, 6, .5));
  }
  close(motionClock(l, 6, 1.25).advance, 1.5);
  close(motionClock(l, 6, 6.25).phase, motionClock(l, 6, .25).phase);
  close(motionClock({ ...l, start: 2 }, 6, 2.25).phase, motionClock(l, 6, .25).phase);
  close(motionClock({ ...l, speed: -18 }, 6, .25).advance, -.5);
  close(motionClock({ ...l, speed: 0 }, 6, 23).advance, 0);
  const state = carouselCard(l, 1, 6, .25);
  carouselCard(l, 1, 6, 1000);
  assert.deepEqual(carouselCard(l, 1, 6, .25), state);
});

test('curves have exact endpoints, intensity preserves native progress and expressive curves differ', () => {
  const fingerprints = new Set();
  for (const [curve] of MOTION_CURVES) {
    const settings = motion({ curve, intensity: 1 });
    assert.equal(motionEase(0, settings), 0);
    assert.equal(motionEase(1, settings), 1);
    const values = Array.from({ length: 101 }, (_, i) => motionEase(i / 100, settings));
    assert(values.every(Number.isFinite));
    fingerprints.add(JSON.stringify(values));
    close(motionEase(.23, motion({ curve, intensity: 0 }), .19), .19);
  }
  assert.equal(fingerprints.size, MOTION_CURVES.length - 1); // Original / Linear share the clock's native curve.
  assert(Array.from({ length: 100 }, (_, i) => motionEase(i / 100, motion({ curve: 'elastic', intensity: 1 }))).some(value => value > 1));
  assert(motionEase(.6, motion({ curve: 'bounce', intensity: 1 })) < motionEase(.4, motion({ curve: 'bounce', intensity: 1 })));
});

test('every family and curve remains finite, seek-safe and periodic with action and hold timing', () => {
  for (const [template, variants] of Object.entries(MOTION_VARIANTS)) for (const [variant] of variants.length ? variants : [['default']]) for (const [curve] of MOTION_CURVES) for (const count of [1, 6, 48]) {
    const l = layer({ template, motionVariant: variant, motion: motion({ mode: 'steps', action: .4, pause: .2, curve, intensity: 1 }) });
    for (const index of [0, count - 1]) {
      const a = carouselCard(l, index, count, .137), b = carouselCard(l, index, count, .137 + .6 * count);
      for (const key of Object.keys(a)) [a[key]].flat().forEach((value, i) => close(value, [b[key]].flat()[i]));
      for (const t of [0, .4, .59, .61, 12, 1000]) {
        const state = carouselCard(l, index, count, t);
        assert(Object.values(state).flat().every(Number.isFinite), `${template}/${curve}`);
        assert(state.opacity >= 0 && state.opacity <= 1);
        assert(state.scale > 0);
      }
    }
  }
});

test('character changes timing without changing orbital spacing or a native Flip hold', () => {
  const l = layer({ motion: motion({ curve: 'glide', intensity: 1 }) });
  const cards = Array.from({ length: 6 }, (_, i) => carouselCard(l, i, 6, .3));
  const distances = cards.map((card, i) => Math.hypot(card.position[0] - cards[(i + 1) % 6].position[0], card.position[2] - cards[(i + 1) % 6].position[2]));
  distances.forEach(distance => close(distance, distances[0]));
  assert.notDeepEqual(cards[0], carouselCard({ ...l, motion: DEFAULT_MOTION }, 0, 6, .3));
  const flip = { ...l, template: 'flip' };
  assert.deepEqual(carouselCard(flip, 1, 6, .2), carouselCard({ ...flip, motion: DEFAULT_MOTION }, 1, 6, .2));
  assert.notDeepEqual(carouselCard(flip, 1, 6, .8), carouselCard({ ...flip, motion: DEFAULT_MOTION }, 1, 6, .8));
  const stickers = { ...l, template: 'stickers' };
  assert.notDeepEqual(carouselCard(stickers, 1, 6, 1.4), carouselCard({ ...stickers, motion: DEFAULT_MOTION }, 1, 6, 1.4));
});

test('catalog rhythm and curve defaults are applied and reset without reverting composition or fades', () => {
  for (const preset of CATALOG) {
    const settings = preset.carouselPatch.motion;
    assert.equal(settings.curve, String(readCatalogSetting(preset.raw, 'animation.Curves.Default')).toLowerCase());
    assert.equal(settings.intensity, readCatalogSetting(preset.raw, 'animation.Easing.Intensity') / 100);
    const sourceAction = readCatalogSetting(preset.raw, 'animation.Motion.Action');
    if (sourceAction > 0) { assert.equal(settings.mode, 'steps'); assert.equal(settings.action, sourceAction); }
    assert.deepEqual(preset.carouselPatch.motionBaseline.motion, settings);
    assert.doesNotThrow(() => patchLayer(demoProject(), 'carousel', preset.carouselPatch));
  }
  let p = patchLayer(demoProject(), 'carousel', CATALOG.find(preset => preset.id === 'stack-stack-01').carouselPatch);
  const baseline = structuredClone(p.layers[1].motionBaseline);
  p = patchLayer(p, 'carousel', { motion: motion({ mode: 'steps', curve: 'elastic', action: .4, pause: .7 }), size: 2, roll: 33, fadeIn: .3 });
  p = patchLayer(p, 'carousel', { motion: baseline.motion, speed: baseline.speed, loopDuration: baseline.loopDuration });
  assert.deepEqual(p.layers[1].motion, baseline.motion);
  assert.equal(p.layers[1].size, 2); assert.equal(p.layers[1].roll, 33); assert.equal(p.layers[1].fadeIn, .3);
  assert.deepEqual(p.images, demoProject().images);
  p = patchLayer(p, 'carousel', { template: 'sphere' });
  assert.deepEqual(p.layers[1].motion, DEFAULT_MOTION);
  assert.equal(p.layers[1].motionBaseline.motion.curve, 'native');
});

test('agent edits share motion validation and reject invalid changes without saving them', async () => {
  let p = demoProject(), saves = 0;
  const tools = createTools({ get: () => p, set: value => { p = value; }, save: async () => { saves++; }, audit: () => {} });
  const set = tools.find(tool => tool.name === 'floc_set_carousel');
  assert(set.inputSchema.properties.motion.properties.curve.enum.includes('elastic'));
  await set.execute({ template: 'stack', motion: motion({ mode: 'steps', curve: 'smooth', pause: .5 }) });
  assert.equal(p.layers[1].motion.pause, .5);
  assert.equal(saves, 1);
  await assert.rejects(set.execute({ template: 'stack', motion: motion({ action: -1 }) }));
  assert.equal(saves, 1);
  assert.equal(p.layers[1].motion.pause, .5);
});
