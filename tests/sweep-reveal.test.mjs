import test from 'node:test';
import assert from 'node:assert/strict';
import { carouselCard } from '../src/carousel-motion.js';
import { motionEase, sweepProgress } from '../src/motion-timing.js';
import { demoProject, patchLayer, validateProject } from '../src/project.js';
import { createTools } from '../src/webmcp.js';

const sweep = () => patchLayer(demoProject(), 'carousel', { template: 'sweep-reveal' }).layers[1];
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test('Sweep Reveal applies through the validated agent model and preserves media and other layers', async () => {
  let project = validateProject(demoProject());
  const before = structuredClone(project);
  const tools = createTools({ get: () => project, set: next => project = next, save: async () => {}, audit: () => {} });
  await tools.find(tool => tool.name === 'floc_set_carousel').execute({ template: 'sweep-reveal' });
  const layer = project.layers[1];
  assert.deepEqual([layer.cardCount, layer.cardAspect, layer.loopDuration, layer.size, layer.cornerRadius], [6, 4 / 3, 10.2, 1, 0]);
  assert.equal(layer.motionVariant, 'right');
  assert.deepEqual([layer.motion.curve, layer.motion.action, layer.motion.pause], ['glide', 1.7, 0]);
  assert.deepEqual(project.images, before.images);
  assert.deepEqual(project.layers.filter(layer => layer.id !== 'carousel'), before.layers.filter(layer => layer.id !== 'carousel'));
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
});

test('a clean mask reveals the next fixed image with slow-fast-slow motion', () => {
  const layer = sweep();
  for (const [time, observed] of [[.4, .06], [.9, .56], [1.3, .93]]) {
    const current = carouselCard(layer, 0, 6, time);
    const next = carouselCard(layer, 1, 6, time);
    assert.deepEqual(current.clip, [0, 0, 1, 1]);
    assert.ok(Math.abs(next.clip[2] - observed) < .03);
    assert.ok(next.renderOrder > current.renderOrder);
    for (let i = 0; i < 6; i++) {
      const card = carouselCard(layer, i, 6, time);
      assert.deepEqual(card.position, [0, 0, 0]);
      assert.deepEqual(card.rotation, [0, 0, 0]);
      assert.equal(card.scale, 1);
      assert.equal(card.opacity, i <= 1 ? 1 : 0);
    }
  }
  assert.equal(carouselCard(layer, 1, 6, 0).opacity, 0);
  close(sweepProgress(.5, layer.motion), .5);
  // Existing carousel Glide remains its original ease-out curve.
  close(motionEase(.5, layer.motion), .875);
});

test('all four sweep directions expose the correct edge, and Linear remains adjustable', () => {
  const layer = sweep();
  const progress = sweepProgress(.4 / 1.7, layer.motion);
  for (const [motionVariant, expected] of [
    ['right', [0, 0, progress, 1]], ['left', [1 - progress, 0, 1, 1]],
    ['up', [0, 0, 1, progress]], ['down', [0, 1 - progress, 1, 1]]
  ]) carouselCard({ ...layer, motionVariant }, 1, 6, .4).clip.forEach((value, i) => close(value, expected[i]));
  close(carouselCard({ ...layer, motion: { ...layer.motion, curve: 'linear' } }, 1, 6, .4).clip[2], .4 / 1.7);
});

test('the visible composition hands off continuously, closes the loop and supports seeking and pauses', () => {
  const layer = sweep();
  const visibleAt = (time, x) => Array.from({ length: 6 }, (_, i) => ({ i, ...carouselCard(layer, i, 6, time) }))
    .filter(card => card.opacity > 0 && x >= card.clip[0] && x <= card.clip[2])
    .sort((a, b) => b.renderOrder - a.renderOrder)[0].i;
  for (let beat = 1; beat <= 6; beat++) for (const x of [.001, .25, .5, .999]) {
    assert.equal(visibleAt(beat * 1.7 - 1e-7, x), visibleAt(beat * 1.7 + 1e-7, x));
  }
  for (let i = 0; i < 6; i++) {
    const card = carouselCard(layer, i, 6, .9);
    for (const shifted of [carouselCard(layer, i, 6, 11.1), carouselCard({ ...layer, start: 2 }, i, 6, 2.9), carouselCard({ ...layer, speed: -layer.speed }, i, 6, 9.3)]) {
      Object.keys(card).forEach(key => [card[key]].flat().forEach((value, j) => close(value, [shifted[key]].flat()[j])));
    }
  }
  assert.deepEqual(carouselCard({ ...layer, speed: 0 }, 0, 6, 7), carouselCard(layer, 0, 6, 0));
  const actions = { ...layer, motion: { ...layer.motion, mode: 'steps', pause: .5 } };
  close(carouselCard(actions, 1, 6, .9).clip[2], carouselCard(layer, 1, 6, .9).clip[2]);
  assert.equal(carouselCard(actions, 1, 6, 2).opacity, 1);
  close(carouselCard(actions, 2, 6, 2).clip[2], 0);
  assert.deepEqual(carouselCard(layer, 0, 1, .9).clip, [0, 0, 1, 1]);
});
