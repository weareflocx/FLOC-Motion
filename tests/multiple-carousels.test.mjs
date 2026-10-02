import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, validateProject, patchLayer, duplicateLayer, carouselImages } from '../src/project.js';
import { stageMarkup } from '../src/scene.js';
import { createTools } from '../src/webmcp.js';

function multiple() {
  const p = demoProject();
  const original = p.layers.find(l => l.type === 'carousel');
  p.layers.push({ ...structuredClone(original), id: 'second', name: 'Second carousel', images: [], start: 2, end: 8, template: 'horizontal' });
  return validateProject(p);
}
test('legacy cards are preserved while new carousels own independent media and timing', () => {
  let p = multiple();
  assert.equal(carouselImages(p, p.layers.find(l => l.id === 'carousel')).length, 6);
  assert.deepEqual(carouselImages(p, p.layers.find(l => l.id === 'second')), []);
  p = patchLayer(p, 'second', { images: [p.images[2]], speed: 40 });
  assert.equal(carouselImages(p, p.layers.find(l => l.id === 'second')).length, 1);
  assert.equal(p.layers.find(l => l.id === 'carousel').speed, 18);
  assert.equal(p.images.length, 6);
  assert.equal(p.layers.find(l => l.id === 'second').start, 2);
  const markup = stageMarkup(p);
  assert.match(markup, /id="carousel-carousel"/);
  assert.match(markup, /id="carousel-second"/);
});
test('each carousel validates local cards, card limits and locks', () => {
  const p = multiple();
  assert.throws(() => patchLayer(p, 'second', { images: Array(25).fill(p.images[0]) }), /24/);
  assert.throws(() => patchLayer(p, 'second', { images: [{ ...p.images[0], src: 'https://example.com/image.png' }] }), /local/);
  assert.throws(() => patchLayer(p, 'second', { images: [{ ...p.images[0], src: '/assets/12345678-1234-1234-1234-123456789012.mp3' }] }), /Carousel cards/);
  assert.throws(() => patchLayer(patchLayer(p, 'second', { locked: true }), 'second', { images: [] }), /Unlock/);
});
test('duplicated carousels retain independent card data', () => {
  const p = duplicateLayer(multiple(), 'carousel', 'copy');
  const copy = p.layers.find(l => l.id === 'copy');
  assert.deepEqual(copy.images, p.images);
  copy.images[0].name = 'Changed copy';
  assert.notEqual(copy.images[0].name, p.images[0].name);
  const next = patchLayer(p, 'copy', { images: [] });
  assert.equal(carouselImages(next, next.layers.find(l => l.id === 'carousel')).length, 6);
});
test('agent motion edits target a specific carousel and reject ambiguous requests', async () => {
  let p = multiple();
  const tools = createTools({ get: () => p, set: next => { p = next; }, save: async () => {}, audit() {} });
  const set = tools.find(t => t.name === 'floc_set_carousel');
  await assert.rejects(() => set.execute({ template: 'horizontal' }), /Specify layerId/);
  await set.execute({ layerId: 'second', template: 'horizontal', speed: 55 });
  assert.equal(p.layers.find(l => l.id === 'second').speed, 55);
  assert.equal(p.layers.find(l => l.id === 'carousel').speed, 18);
});
