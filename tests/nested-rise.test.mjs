import test from 'node:test';
import assert from 'node:assert/strict';
import { carouselCard } from '../src/carousel-motion.js';
import { demoProject, patchLayer, validateProject } from '../src/project.js';
import { createTools } from '../src/webmcp.js';

const nested = () => patchLayer(demoProject(), 'carousel', { template: 'nested-rise' }).layers[1];
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test('Nested Rise applies its reference settings through validated edits and agent tools', async () => {
  let project = validateProject(demoProject());
  const images = structuredClone(project.images);
  const otherLayers = project.layers.filter(layer => layer.id !== 'carousel');
  const tools = createTools({ get: () => project, set: next => project = next, save: async () => {}, audit: () => {} });
  await tools.find(tool => tool.name === 'floc_set_carousel').execute({ template: 'nested-rise' });
  const layer = project.layers[1];
  assert.equal(layer.cardCount, 8);
  assert.equal(layer.loopDuration, 4.8);
  close(layer.loopDuration / layer.cardCount, .6);
  assert.equal(layer.cardAspect, 4 / 3);
  assert.equal(layer.size, 1);
  assert.deepEqual([layer.tilt, layer.yaw, layer.roll, layer.cornerRadius], [0, 0, 0, 0]);
  assert.deepEqual(project.images, images);
  assert.deepEqual(project.layers.filter(layer => layer.id !== 'carousel'), otherLayers);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
  assert.equal(patchLayer(project, 'carousel', { template: 'nested-rise', size: .8 }).layers[1].size, .8);
});

test('cards grow together with decreasing speed, a fixed bottom and smaller cards in front', () => {
  const layer = nested();
  const samples = [.15, .3, .45, .6].map(time => carouselCard(layer, 0, 8, time));
  const growth = samples.slice(1).map((card, i) => card.scale - samples[i].scale);
  assert.ok(growth.every(value => value > 0));
  assert.ok(growth[0] > growth[1] && growth[1] > growth[2]);
  const cards = Array.from({ length: 8 }, (_, i) => carouselCard(layer, i, 8, .3));
  assert.ok(cards.filter(card => card.scale < 1 && card.scale > .001).length >= 3);
  for (const card of cards) {
    close(card.position[0], 0);
    close(card.position[2], 0);
    close(card.position[1] - card.scale * layer.size / (2 * layer.cardAspect), -layer.size / (2 * layer.cardAspect));
    assert.deepEqual(card.rotation, [0, 0, 0]);
    for (const other of cards) if (card.scale < other.scale) assert.ok(card.renderOrder > other.renderOrder);
  }
});

test('each beat introduces the next image; recycling happens behind an opaque full-size card', () => {
  const layer = nested();
  for (let index = 0; index < 8; index++) {
    const a = carouselCard(layer, index, 8, index * .6 + .13);
    const b = carouselCard(layer, (index + 1) % 8, 8, index * .6 + .73);
    close(a.scale, b.scale);
    for (const time of [index * .6, index * .6 + 4.8]) {
      const cards = Array.from({ length: 8 }, (_, i) => carouselCard(layer, i, 8, time - 1e-8 + (time === 0 ? 4.8 : 0)));
      const recycling = cards[index];
      assert.ok(cards.some(card => card.scale === 1 && card.opacity === 1 && card.renderOrder > recycling.renderOrder));
    }
    for (const time of [0, .13, .59, 2.77, 4.799]) {
      const initial = carouselCard(layer, index, 8, time);
      const loop = carouselCard(layer, index, 8, time + 4.8);
      Object.keys(initial).forEach(key => [initial[key]].flat().forEach((value, i) => close(value, [loop[key]].flat()[i])));
    }
  }
});
