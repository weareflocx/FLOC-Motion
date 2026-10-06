import test from 'node:test';
import assert from 'node:assert/strict';
import { carouselCard } from '../src/carousel-motion.js';
import { demoProject, patchLayer, validateProject } from '../src/project.js';
import { createTools } from '../src/webmcp.js';

const windowPush = () => patchLayer(demoProject(), 'carousel', { template: 'window-push' }).layers[1];
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function same(a, b) {
  Object.keys(a).forEach(key => [a[key]].flat().forEach((value, i) => close(value, [b[key]].flat()[i])));
}

test('Window Push defaults and independent zoom/spacing persist through validated agent edits', async () => {
  let project = validateProject(demoProject());
  const before = structuredClone(project);
  const tools = createTools({ get: () => project, set: next => project = next, save: async () => {}, audit: () => {} });
  const tool = tools.find(tool => tool.name === 'floc_set_carousel');
  await tool.execute({ template: 'window-push' });
  const layer = project.layers[1];
  assert.deepEqual([layer.cardCount, layer.loopDuration, layer.size, layer.windowZoom, layer.windowSpacing], [6, 7.2, 1, .5, 0]);
  assert.deepEqual([layer.motionVariant, layer.motion.curve, layer.motion.action, layer.motion.pause], ['right', 'glide', 1.2, 0]);
  assert.deepEqual(project.images, before.images);
  assert.deepEqual(project.layers.filter(layer => layer.id !== 'carousel'), before.layers.filter(layer => layer.id !== 'carousel'));
  await tool.execute({ template: 'window-push', windowZoom: .8, windowSpacing: 36 });
  assert.equal(project.layers[1].windowZoom, .8);
  assert.equal(project.layers[1].windowSpacing, 36);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
  for (const patch of [{ windowZoom: -1 }, { windowZoom: 1.1 }, { windowSpacing: -1 }, { windowSpacing: 161 }, { windowZoom: '50' }, { windowSpacing: NaN }]) {
    assert.throws(() => patchLayer(project, 'carousel', patch));
  }
});

test('two adjacent images push together with a fast start and a long settling tail', () => {
  const layer = windowPush();
  for (const [time, expected] of [[0, 0], [.6, .875], [.9, .984375]]) {
    const outgoing = carouselCard(layer, 0, 6, time);
    const incoming = carouselCard(layer, 1, 6, time);
    close(outgoing.push[0], expected);
    close(incoming.push[0], expected - 1);
    close(outgoing.push[0] - incoming.push[0], 1);
    assert.equal(outgoing.push[1], 0);
    assert.deepEqual(outgoing.position, [0, 0, 0]);
    assert.deepEqual(incoming.position, [0, 0, 0]);
    assert.equal(outgoing.scale, 1);
    assert.equal(incoming.scale, 1);
    assert.ok(incoming.renderOrder > outgoing.renderOrder);
    close(outgoing.push[2], 1 + .5 * expected);
    close(incoming.push[2], 1 + .5 * (1 - expected));
  }
  assert.equal(carouselCard(layer, 2, 6, .6).opacity, 0);
});

test('the same push is used in both crop zones, with adjustable direction, zoom and spacing', () => {
  const layer = windowPush();
  for (const [motionVariant, axis, sign] of [['right', 0, 1], ['left', 0, -1], ['up', 1, 1], ['down', 1, -1]]) {
    const card = carouselCard({ ...layer, motionVariant }, 0, 6, .6);
    close(card.push[axis], .875 * sign);
    assert.equal(card.push[1 - axis], 0);
  }
  assert.equal(carouselCard({ ...layer, windowZoom: 0 }, 1, 6, .6).push[2], 1);
  assert.equal(carouselCard({ ...layer, windowSpacing: 36 }, 1, 6, .6).push[3], 36);
  close(carouselCard({ ...layer, motion: { ...layer.motion, curve: 'linear' } }, 0, 6, .6).push[0], .5);
  // Size adjusts the stationary window, without altering the synchronized push.
  same(carouselCard({ ...layer, size: .5 }, 0, 6, .6), carouselCard(layer, 0, 6, .6));
});

test('handoffs close the loop without visible jumps and retain seek, reverse, pause and hold semantics', () => {
  const layer = windowPush();
  for (let i = 0; i < 6; i++) for (const time of [0, .2, .6, .9]) {
    same(carouselCard(layer, i, 6, time), carouselCard(layer, i, 6, time + 7.2));
    same(carouselCard(layer, i, 6, time), carouselCard(layer, (i + 1) % 6, 6, time + 1.2));
  }
  for (let beat = 1; beat <= 6; beat++) {
    const before = carouselCard(layer, beat % 6, 6, beat * 1.2 - 1e-8);
    const after = carouselCard(layer, beat % 6, 6, beat * 1.2 + 1e-8);
    before.push.slice(0, 3).forEach((value, i) => close(value, after.push[i]));
    assert.equal(before.opacity, after.opacity);
  }
  same(carouselCard({ ...layer, start: 2 }, 1, 6, 2.6), carouselCard(layer, 1, 6, .6));
  same(carouselCard({ ...layer, speed: -50 }, 1, 6, 6.6), carouselCard(layer, 1, 6, .6));
  same(carouselCard({ ...layer, speed: 0 }, 0, 6, 7), carouselCard(layer, 0, 6, 0));
  const actions = { ...layer, motion: { ...layer.motion, mode: 'steps', pause: .5 } };
  close(carouselCard(actions, 0, 6, .6).push[0], .875);
  close(carouselCard(actions, 1, 6, 1.4).push[0], 0);
  assert.deepEqual(carouselCard(layer, 0, 1, .9).push, [0, 0, 1, 0]);
});
