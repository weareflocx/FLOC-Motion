import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, patchLayer, resizeDuration, validateProject, assertLocksRespected, linkFormats, switchFormat } from '../src/project.js';
import { textMotionAt, textMotionPreset, textMotionPresetPatch, textMotionStyle } from '../src/text-motion.js';

const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);
const headline = project => project.layers.find(layer => layer.id === 'headline');
const legacy = values => {
  const project = { ...demoProject(), version: 17 };
  Object.assign(headline(project), { start: 2, end: 8, reveal: 'none', revealDuration: .6, rise: false, ...values });
  return headline(validateProject(project));
};
const px = (layer, time) => textMotionAt(layer, time).offsetY * 1080 / 100;

test('v17 Rise and wipe reveals migrate to the same movement, mask and fades', () => {
  // Rise moved 24 px down-to-rest over the fade in and back down over the fade out.
  const rise = legacy({ rise: true, fadeIn: .5, fadeOut: .4 });
  for (const time of [2, 2.1, 2.25, 2.5, 5, 7.6, 7.8, 7.99]) close(px(rise, time), (1 - Math.min(1, (time - 2) / .5, (8 - time) / .4)) * 24, `rise ${time}`);
  assert.deepEqual([rise.fadeIn, rise.fadeOut], [.5, .4]);
  // A wipe with an independent fade keeps both durations; the mask matches the old inset.
  const wipe = legacy({ reveal: 'right', revealDuration: .6, fadeIn: .45, fadeOut: .25 });
  assert.deepEqual([wipe.fadeIn, wipe.entry.duration, wipe.exit.mirror, wipe.exit.motion], [.45, .6, false, 'none']);
  for (const [time, hidden] of [[2, 1], [2.15, .75], [2.45, .25]]) {
    assert.equal(textMotionStyle(textMotionAt(wipe, time), 400, 100, 1080).clipPath, `inset(0px ${Number((hidden * 400).toFixed(4))}px 0px 0px)`);
  }
  assert.equal(textMotionStyle(textMotionAt(wipe, 2.6), 400, 100, 1080).clipPath, 'none');
  assert.equal(textMotionStyle(textMotionAt(wipe, 7.9), 400, 100, 1080).clipPath, 'none', 'the old wipe had no exit');
  // Rise only on the fade-out side sinks as before; Rise without fades does nothing.
  const sink = legacy({ rise: true, fadeIn: 0, fadeOut: .5 });
  assert.deepEqual([sink.entry.motion, sink.exit.motion, sink.exit.direction], ['none', 'slide', 'down']);
  close(px(sink, 7.75), 12, 'sink'); close(px(legacy({ rise: true, fadeIn: 0, fadeOut: 0 }), 2), 0, 'no fades');
  assert.throws(() => legacy({ reveal: 'diagonal' }), /Unknown text reveal/);
  assert.throws(() => legacy({ rise: 'yes' }), /rise must be true or false/);
});

test('exits retrace the entry when mirrored and otherwise leave in their own direction', () => {
  let p = patchLayer(demoProject(), 'headline', { start: 0, end: 10, entry: { motion: 'slide', direction: 'right', amount: 10, duration: 1, character: 'linear' }, exit: { mirror: true, duration: 2 } });
  close(textMotionAt(headline(p), 0).offsetX, -10, 'entry starts on the left'); close(textMotionAt(headline(p), .5).offsetX, -5, 'entry halfway');
  close(textMotionAt(headline(p), 5).offsetX, 0, 'rests between');
  close(textMotionAt(headline(p), 9).offsetX, -5, 'mirrored exit retraces to the left');
  p = patchLayer(p, 'headline', { exit: { mirror: false, motion: 'slide', direction: 'up', amount: 4, duration: 2, character: 'linear' } });
  close(textMotionAt(headline(p), 9).offsetY, -2, 'exit up leaves upward'); close(textMotionAt(headline(p), 9).offsetX, 0, 'exit ignores the entry direction');
  p = patchLayer(p, 'headline', { exit: { motion: 'rise' } });
  assert.ok(textMotionAt(headline(p), 9.5).offsetY < 0, 'Rise exits upward');
  p = patchLayer(p, 'headline', { entry: { motion: 'scale', amount: 40, duration: 1 }, exit: { motion: 'scale', amount: 40 } });
  close(textMotionAt(headline(p), .5).scale, .8, 'entry grows'); close(textMotionAt(headline(p), 9.5).scale, .7, 'exit shrinks');
  // Overshooting characters pass the resting pose without changing where they end.
  p = patchLayer(p, 'headline', { entry: { motion: 'slide', direction: 'up', amount: 6, character: 'weighted', duration: 1 } });
  assert.ok(Array.from({ length: 99 }, (_, i) => textMotionAt(headline(p), i / 100).offsetY).some(value => value < 0), 'Weighted overshoots');
  close(textMotionAt(headline(p), 1).offsetY, 0, 'and lands at rest');
  const before = textMotionAt(headline(p), .37); textMotionAt(headline(p), 9.9); assert.deepEqual(textMotionAt(headline(p), .37), before, 'seek-safe');
});

test('Reveal clips a window fixed at the resting box while the text travels inside it', () => {
  const p = patchLayer(demoProject(), 'headline', { start: 0, end: 10, entry: { motion: 'reveal', direction: 'up', amount: 10, duration: 1, character: 'linear' } });
  const sample = textMotionAt(headline(p), .5), style = textMotionStyle(sample, 400, 200, 1080);
  // Halfway: 54 px below rest, the lower half of the box is open; in element space the window rises by 54 px.
  assert.equal(style.transform, 'translate(0px,54px)');
  assert.equal(style.clipPath, 'inset(46px 0px 54px 0px)');
});

test('presets are recipes over movement and fade that keep timing, direction and character', () => {
  let p = validateProject(demoProject());
  assert.deepEqual([textMotionPreset(headline(p), 'entry'), textMotionPreset(headline(p), 'exit')], ['fade', 'mirror']);
  p = patchLayer(p, 'headline', textMotionPresetPatch(headline(p), 'entry', 'slide'));
  assert.deepEqual([headline(p).entry.motion, headline(p).entry.duration, headline(p).fadeIn], ['slide', .45, .45], 'Slide inherits the fade length');
  p = patchLayer(p, 'headline', { entry: { direction: 'left', character: 'elastic', duration: .8 } });
  p = patchLayer(p, 'headline', textMotionPresetPatch(headline(p), 'entry', 'reveal'));
  assert.deepEqual([headline(p).entry.motion, headline(p).entry.direction, headline(p).entry.character, headline(p).entry.duration, headline(p).fadeIn], ['reveal', 'left', 'elastic', .8, 0]);
  p = patchLayer(p, 'headline', textMotionPresetPatch(headline(p), 'exit', 'scale'));
  assert.deepEqual([headline(p).exit.mirror, headline(p).exit.motion, textMotionPreset(headline(p), 'exit')], [false, 'scale', 'scale']);
  p = patchLayer(p, 'headline', textMotionPresetPatch(headline(p), 'entry', 'none'));
  assert.deepEqual([textMotionPreset(headline(p), 'entry'), headline(p).fadeIn], ['none', 0]);
  assert.throws(() => textMotionPresetPatch(headline(p), 'entry', 'teleport'), /Unknown text motion preset/);
});

test('movement is shared across linked formats, refits with clip timing and respects locks', () => {
  let p = linkFormats(patchLayer(demoProject(), 'headline', { entry: { motion: 'rise', duration: 2 } }));
  p = switchFormat(p, 'portrait'); p = patchLayer(p, 'headline', { entry: { amount: 7 } }); p = switchFormat(p, 'square');
  assert.equal(headline(p).entry.amount, 7);
  const locked = patchLayer(p, 'headline', { locked: true });
  assert.throws(() => patchLayer(locked, 'headline', { entry: { amount: 1 } }), /Unlock/);
  const resized = resizeDuration(locked, 1);
  assert.doesNotThrow(() => assertLocksRespected(locked, resized, { allow: ['timing'] }));
  assert.ok(headline(resized).entry.duration <= 1 && headline(resized).entry.amount === 7);
  assert.throws(() => assertLocksRespected(locked, { ...resized, layers: resized.layers.map(layer => layer.id === 'headline' ? { ...layer, entry: { ...layer.entry, amount: 3 } } : layer) }, { allow: ['timing'] }));
  for (const bad of [null, [], { motion: 'scale', amount: 51 }, { character: 'bouncy' }, { direction: 'diagonal' }, { code: 'x' }]) assert.throws(() => patchLayer(demoProject(), 'headline', { entry: bad }));
  assert.throws(() => patchLayer(demoProject(), 'headline', { exit: { mirror: 'yes' } }), /mirror/);
});
