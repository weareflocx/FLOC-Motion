import test from 'node:test';
import assert from 'node:assert/strict';
import { carouselCard } from '../src/carousel-motion.js';
import { demoProject, patchLayer, validateProject } from '../src/project.js';
import { createTools } from '../src/webmcp.js';

const zoom = () => patchLayer(demoProject(), 'carousel', { template: 'zoom-through' }).layers[1];
const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
function same(a, b) {
  Object.keys(a).forEach(key => [a[key]].flat().forEach((value, i) => close(value, [b[key]].flat()[i])));
}

test('Zoom Through installs the reference defaults through validated agent edits', async () => {
  let project = validateProject(demoProject());
  const images = structuredClone(project.images);
  const otherLayers = project.layers.filter(layer => layer.id !== 'carousel');
  const tools = createTools({ get: () => project, set: next => project = next, save: async () => {}, audit: () => {} });
  const set = tools.find(tool => tool.name === 'floc_set_carousel');
  assert.ok(set.inputSchema.properties.template.enum.includes('zoom-through'));
  await set.execute({ template: 'zoom-through' });
  const layer = project.layers[1];
  assert.deepEqual([layer.cardCount, layer.loopDuration, layer.cardAspect, layer.size], [8, 4.8, 4 / 3, 1]);
  assert.deepEqual([layer.tilt, layer.yaw, layer.roll, layer.zoomRotation, layer.cornerRadius], [0, 0, 0, 0, 0]);
  assert.deepEqual(project.images, images);
  assert.deepEqual(project.layers.filter(layer => layer.id !== 'carousel'), otherLayers);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
  await set.execute({ template: 'zoom-through', zoomRotation: 45 });
  assert.equal(project.layers[1].zoomRotation, 45);
  for (const zoomRotation of [-181, 181, NaN, Infinity, '45']) {
    assert.throws(() => patchLayer(project, 'carousel', { zoomRotation }), /Entry rotation/);
  }
});

test('centered cards approximate the measured widths with overlapping, decelerating growth', () => {
  const layer = zoom();
  for (const [time, width] of [[0, .5], [.3, .81], [.6, .95]]) {
    const card = carouselCard(layer, 0, 8, time);
    close(card.scale, width, .015);
    assert.deepEqual(card.position, [0, 0, 0]);
    assert.deepEqual(card.rotation, [0, 0, 0]);
  }
  const scales = [0, .15, .3, .45, .6].map(time => carouselCard(layer, 0, 8, time).scale);
  const growth = scales.slice(1).map((scale, i) => scale - scales[i]);
  assert.ok(growth.every((value, i) => value > 0 && (i === 0 || value < growth[i - 1])));
  const cards = Array.from({ length: 8 }, (_, i) => carouselCard(layer, i, 8, .37));
  assert.ok(cards.filter(card => card.scale > .001 && card.scale < 1).length >= 2);
  for (const card of cards) for (const other of cards) {
    if (card.scale < other.scale) assert.ok(card.renderOrder > other.renderOrder);
  }
});

test('card cadence, loop closure, reverse, pause and layer start remain deterministic', () => {
  const layer = zoom();
  for (let i = 0; i < 8; i++) {
    same(carouselCard(layer, i, 8, .13), carouselCard(layer, (i + 1) % 8, 8, .73));
    for (const time of [0, .299, .301, 1.9, 4.799]) {
      same(carouselCard(layer, i, 8, time), carouselCard(layer, i, 8, time + 4.8));
    }
  }
  same(carouselCard({ ...layer, speed: -75 }, 0, 8, 1), carouselCard(layer, 0, 8, 3.8));
  same(carouselCard({ ...layer, speed: 0 }, 0, 8, 12), carouselCard(layer, 0, 8, 0));
  same(carouselCard({ ...layer, start: 2 }, 0, 8, 2.6), carouselCard(layer, 0, 8, .6));
  // Before a card wraps, a newer, full-size opaque card covers it completely.
  for (const count of [2, 8, 48]) for (let i = 0; i < count; i++) {
    const time = (i - .5 + count) / count * layer.loopDuration - 1e-8;
    const cards = Array.from({ length: count }, (_, index) => carouselCard(layer, index, count, time));
    assert.ok(cards.some(card => card.scale === 1 && card.opacity === 1 && card.renderOrder > cards[i].renderOrder));
  }
});

test('entry rotation straightens each card while preserving centered geometry', () => {
  const layer = { ...zoom(), zoomRotation: 60 };
  const first = carouselCard(layer, 0, 8, 0);
  const later = carouselCard(layer, 0, 8, .6);
  const arrived = carouselCard(layer, 0, 8, 1.2);
  assert.ok(first.rotation[2] > later.rotation[2] && later.rotation[2] > 0);
  assert.equal(arrived.rotation[2], 0);
  assert.deepEqual(arrived.position, [0, 0, 0]);
  close(carouselCard({ ...layer, zoomRotation: -60 }, 0, 8, 0).rotation[2], -first.rotation[2]);
  same(first, carouselCard(layer, 0, 8, 4.8));
});
