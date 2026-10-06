import test from 'node:test';
import assert from 'node:assert/strict';
import { carouselCard } from '../src/carousel-motion.js';
import { demoProject, patchLayer, validateProject } from '../src/project.js';
import { createTools } from '../src/webmcp.js';

const shuffle = () => patchLayer(demoProject(), 'carousel', { template: 'stack-shuffle' }).layers[1];
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function same(a, b, compareOrder = true) {
  Object.keys(a).filter(key => compareOrder || key !== 'renderOrder').forEach(key => [a[key]].flat().forEach((value, i) => close(value, [b[key]].flat()[i])));
}

test('Stack Shuffle applies and persists its deck settings without changing media or other layers', async () => {
  let project = validateProject(demoProject());
  const before = structuredClone(project);
  const tools = createTools({ get: () => project, set: next => project = next, save: async () => {}, audit: () => {} });
  await tools.find(tool => tool.name === 'floc_set_carousel').execute({ template: 'stack-shuffle' });
  const layer = project.layers[1];
  assert.deepEqual([layer.cardCount, layer.loopDuration, layer.shuffleGap, layer.shuffleRotation, layer.shuffleCorner], [6, 9.6, 36, 28, 15]);
  assert.equal(layer.motionVariant, 'down');
  assert.deepEqual(project.images, before.images);
  assert.deepEqual(project.layers.filter(layer => layer.id !== 'carousel'), before.layers.filter(layer => layer.id !== 'carousel'));
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
  for (const patch of [{ shuffleGap: -1 }, { shuffleGap: 161 }, { shuffleRotation: 181 }, { shuffleCorner: 101 }, { shuffleGap: '36' }, { shuffleRotation: NaN }]) {
    assert.throws(() => patchLayer(project, 'carousel', patch));
  }
});

test('three centered levels hold, then the front drops and the next card advances', () => {
  const layer = shuffle();
  const cards = Array.from({ length: 6 }, (_, i) => carouselCard(layer, i, 6, .2));
  assert.equal(cards.filter(card => card.opacity > 0).length, 3);
  assert.deepEqual(cards.slice(0, 3).map(card => card.scale), [1, .9, .81]);
  assert.deepEqual(cards.slice(0, 3).map(card => card.positionPixels[1]), [0, 36, 72]);
  assert.ok(cards[0].renderOrder > cards[1].renderOrder && cards[1].renderOrder > cards[2].renderOrder);
  same(cards[0], carouselCard(layer, 0, 6, 0));
  const exiting = carouselCard(layer, 0, 6, .6);
  assert.ok(exiting.position[1] < 0 && exiting.rotation[2] > 0);
  const advancing = carouselCard(layer, 1, 6, .6);
  assert.ok(advancing.scale > cards[1].scale && advancing.scale < 1);
  assert.ok(advancing.position[1] < cards[1].position[1]);
  assert.ok(advancing.positionPixels[1] < 36);
  const next = carouselCard(layer, 1, 6, .8);
  assert.equal(next.scale, 1);
  assert.deepEqual(next.position, [0, 0, 0]);
  assert.equal(carouselCard(layer, 0, 6, .8).opacity, 0);
  same(next, carouselCard(layer, 1, 6, 1.5));
});

test('each 1.6-second beat hands off without a visible jump and the full cycle closes', () => {
  const layer = shuffle();
  for (let i = 0; i < 6; i++) for (const time of [0, .2, .6, .8, 1.5]) {
    same(carouselCard(layer, i, 6, time), carouselCard(layer, i, 6, time + 9.6));
    same(carouselCard(layer, i, 6, time), carouselCard(layer, (i + 1) % 6, 6, time + 1.6));
  }
  for (let beat = 1; beat <= 6; beat++) for (let i = 0; i < 6; i++) {
    const a = carouselCard(layer, i, 6, beat * 1.6 - 1e-8);
    const b = carouselCard(layer, i, 6, beat * 1.6 + 1e-8);
    if (a.opacity < .001 && b.opacity < .001) continue;
    // Numeric draw ranks change when the deck advances; visible relative order does not.
    same(a, b, false);
  }
});

test('exit direction, rotation and spacing are independently adjustable and time remains seek-safe', () => {
  const layer = shuffle();
  for (const [motionVariant, axis, sign] of [['down', 1, -1], ['up', 1, 1], ['left', 0, -1], ['right', 0, 1]]) {
    const card = carouselCard({ ...layer, motionVariant }, 0, 6, .6);
    assert.ok(card.position[axis] * sign > 0);
    assert.equal(card.position[1 - axis], 0);
  }
  assert.equal(carouselCard({ ...layer, shuffleRotation: 0 }, 0, 6, .6).rotation[2], 0);
  assert.equal(carouselCard({ ...layer, shuffleGap: 0 }, 1, 6, .2).positionPixels[1], 0);
  same(carouselCard({ ...layer, start: 2 }, 0, 6, 2.6), carouselCard(layer, 0, 6, .6));
  same(carouselCard({ ...layer, speed: 0 }, 0, 6, 12), carouselCard(layer, 0, 6, 0));
  same(carouselCard({ ...layer, speed: -37.5 }, 0, 6, 9), carouselCard(layer, 0, 6, .6));
});
