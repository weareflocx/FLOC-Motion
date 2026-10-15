import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, validateProject, patchLayer, carouselImages, PROJECT_LIMITS } from '../src/project.js';
import { assetLayer, assetUse, cardFromAsset, matchesLibrary, projectSources, sourcePatch } from '../src/media-library.js';

const src = ext => `/assets/12345678-1234-4234-8234-12345678901${ext.length}.${ext}`;
const asset = (ext, name = `file.${ext}`) => ({ id: '12345678-1234-4234-8234-123456789012', src: src(ext), name });

test('library filters group GIFs with video and search names case-insensitively', () => {
  const items = ['png', 'gif', 'mp4', 'mp3', 'glb'].map(ext => asset(ext, `Brand ${ext.toUpperCase()}`));
  const shown = filter => items.filter(item => matchesLibrary(item, filter)).map(item => item.src.split('.').pop());
  assert.deepEqual(shown('all'), ['png', 'gif', 'mp4', 'mp3', 'glb']);
  assert.deepEqual(shown('video'), ['gif', 'mp4']);
  assert.deepEqual(shown('image'), ['png']);
  assert.deepEqual(shown('model'), ['glb']);
  assert.deepEqual(items.filter(item => matchesLibrary(item, 'all', '  brand mp ')).map(item => item.name), ['Brand MP4', 'Brand MP3']);
});

test('the selected layer offers cards for carousels and a source only for matching kinds', () => {
  const project = validateProject(demoProject());
  const layer = type => project.layers.find(item => item.type === type);
  assert.equal(assetUse(asset('mp4'), layer('carousel'), project), 'cards');
  assert.equal(assetUse(asset('mp3'), layer('carousel'), project), null);
  assert.equal(assetUse(asset('svg'), layer('logo'), project), 'source');
  assert.equal(assetUse(asset('gif'), layer('logo'), project), null);
  assert.equal(assetUse(asset('mp3'), layer('music'), project), 'source');
  assert.equal(assetUse(asset('webm'), layer('background'), project), 'source');
  assert.equal(assetUse(asset('png'), layer('text'), project), null);
  assert.equal(assetUse(asset('png'), { ...layer('logo'), locked: true }, project), null);
  assert.equal(assetUse({ ...asset('png'), src: layer('logo').src }, layer('logo'), project), null, 'the current source is not offered again');
  const full = patchLayer(project, 'carousel', { images: Array.from({ length: PROJECT_LIMITS.maxImages }, (_, index) => cardFromAsset(asset('png'), `card-${index}`)) });
  assert.equal(assetUse(asset('png'), full.layers.find(item => item.type === 'carousel'), full), null, 'a full carousel takes no more cards');
});

test('reused assets become valid cards, sources and layers centered on a drop point', () => {
  const project = validateProject(demoProject());
  const carousel = project.layers.find(item => item.type === 'carousel');
  const card = asset('png', 'poster.png');
  const twice = patchLayer(project, carousel.id, { images: [...carouselImages(project, carousel), cardFromAsset(card, 'a'), cardFromAsset(card, 'b')] });
  assert.equal(carouselImages(twice, twice.layers.find(item => item.id === carousel.id)).filter(item => item.src === card.src).length, 2);
  assert(projectSources(twice).has(card.src));
  const background = project.layers.find(item => item.type === 'background');
  assert.deepEqual(sourcePatch(background, asset('mp4')), { src: src('mp4'), mode: 'video' });
  assert.deepEqual(sourcePatch(background, asset('jpg')), { src: src('jpg'), mode: 'image' });
  // Landscape 1920×1080: a 50%-wide 2:1 image dropped at the center spans x 25–75 and y 27.8–72.2.
  const landscape = { ...project, format: 'landscape' };
  const media = assetLayer(asset('png'), landscape, 'dropped-media', { x: 50, y: 50, aspect: 0.5 });
  assert.deepEqual([media.type, media.x, media.y, media.size], ['media', 25, 27.8, 50]);
  const model = assetLayer(asset('glb'), landscape, 'dropped-model', { x: 80, y: 20, aspect: 0.5 });
  assert.deepEqual([model.type, model.x, model.y], ['model', 55, -24.4]);
  const music = assetLayer(asset('mp3'), landscape, 'dropped-music', { x: 10, y: 10 });
  assert.deepEqual([music.type, Object.hasOwn(music, 'x')], ['music', false]);
  validateProject({ ...landscape, layers: [...landscape.layers, media, model, music] });
});
