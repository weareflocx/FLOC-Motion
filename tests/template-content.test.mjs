import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, validateProject, patchLayer, patchTemplateContent, duplicateLayer, fileLayer } from '../src/project.js';
import { CONTENT_PROPERTIES, contentFields } from '../src/template-content.js';
import { captureState } from '../src/choreography.js';

const layer = (project, id) => project.layers.find(l => l.id === id);
const asset = extension => `/assets/12345678-1234-1234-1234-123456789012.${extension}`;
const projectWithMedia = () => validateProject({ ...demoProject(), layers: [...demoProject().layers, fileLayer({ src: asset('png'), name: 'Photo' }, 12, 'media'), fileLayer({ src: asset('glb'), name: 'Model' }, 12, 'model')] });

test('content declarations normalize names without adding metadata to legacy layers', () => {
  const raw = demoProject();
  const legacy = validateProject(raw);
  assert.deepEqual(contentFields(legacy), []);
  assert(legacy.layers.every(l => !Object.hasOwn(l, 'contentField')));
  assert.deepEqual(validateProject(legacy), legacy);
  const named = patchLayer(legacy, 'headline', { contentField: '  Headline  ' });
  assert.equal(layer(named, 'headline').contentField, 'Headline');
  assert.deepEqual(contentFields(named), [layer(named, 'headline')]);
  assert.deepEqual(validateProject(named), named);
  assert(!Object.hasOwn(layer(legacy, 'headline'), 'contentField'));
  for (const contentField of ['', '   ']) {
    const disabled = patchLayer(named, 'headline', { contentField });
    assert(!Object.hasOwn(layer(disabled, 'headline'), 'contentField'));
    assert.deepEqual(contentFields(disabled), []);
    assert.deepEqual(validateProject(disabled), disabled);
  }
});

test('only supported layer types declare bounded content names', () => {
  let p = projectWithMedia();
  assert.deepEqual(CONTENT_PROPERTIES, { text: 'text', carousel: 'images', logo: 'src', media: 'src', music: 'src' });
  for (const id of ['headline', 'carousel', 'logo', 'media', 'music']) p = patchLayer(p, id, { contentField: id });
  assert.deepEqual(contentFields(p).map(l => l.id), ['carousel', 'headline', 'logo', 'music', 'media']);
  assert.doesNotThrow(() => patchLayer(p, 'headline', { contentField: 'x'.repeat(60) }));
  for (const contentField of [undefined, null, 1, {}, [], 'x'.repeat(61), 'A\nB', 'A\tB', 'A\0B', 'A\u007fB', 'A\u0085B']) {
    assert.throws(() => patchLayer(p, 'headline', { contentField }), /Invalid content field name/);
  }
  for (const id of ['background', 'model']) {
    assert.throws(() => patchLayer(p, id, { contentField: 'Asset' }), /Unknown layer property/);
    for (const contentField of ['Asset', '', undefined]) {
      assert.throws(() => validateProject({ ...p, layers: p.layers.map(l => l.id === id ? { ...l, contentField } : l) }), /cannot declare a content field/);
    }
  }
});

test('declaring and directly editing locked layers still requires unlocking', () => {
  let p = patchLayer(validateProject(demoProject()), 'headline', { locked: true });
  assert.throws(() => patchLayer(p, 'headline', { contentField: 'Headline' }), /Unlock/);
  assert.throws(() => patchLayer(p, 'headline', { locked: false, contentField: 'Headline' }), /Unlock/);
  p = patchLayer(p, 'headline', { locked: false });
  p = patchLayer(p, 'headline', { contentField: 'Headline' });
  p = patchLayer(p, 'headline', { locked: true });
  for (const patch of [{ text: 'New' }, { contentField: '' }, { x: 20 }, { locked: false, text: 'New' }]) assert.throws(() => patchLayer(p, 'headline', patch), /Unlock/);
});

test('explicit content edits change only the declared authoritative property, including locked layers', () => {
  let p = projectWithMedia();
  const headline = layer(p, 'headline');
  p = patchLayer(p, 'headline', { choreography: captureState(headline, 0, p.fps, {}, 'first') });
  for (const id of ['headline', 'carousel', 'logo', 'media', 'music']) {
    p = patchLayer(p, id, { contentField: id });
    p = patchLayer(p, id, { locked: true });
  }
  const before = structuredClone(p);
  const edits = { headline: 'NEW\nHEADLINE', carousel: [{ id: 'new', src: '/demo/poster-2.svg', name: 'New card' }], logo: '/demo/poster-3.svg', media: asset('mp4'), music: asset('mp3') };
  for (const [id, value] of Object.entries(edits)) {
    const next = patchTemplateContent(p, id, value);
    const expected = structuredClone(p);
    layer(expected, id)[CONTENT_PROPERTIES[layer(expected, id).type]] = value;
    assert.deepEqual(next, expected);
    assert.deepEqual(p, before);
    assert.equal(layer(next, id).locked, true);
    assert.deepEqual(validateProject(next), next);
  }
});

test('carousel content replacements stay local to their own carousel', () => {
  let p = patchLayer(validateProject(demoProject()), 'carousel', { contentField: 'Main cards' });
  p = duplicateLayer(p, 'carousel', 'second');
  p = patchLayer(p, 'second', { contentField: 'Secondary cards' });
  const previous = structuredClone(p);
  const images = [{ id: 'replacement', src: '/demo/poster-6.svg', name: 'Replacement' }];
  const next = patchTemplateContent(p, 'carousel', images);
  assert(Object.hasOwn(layer(next, 'carousel'), 'images'));
  assert.deepEqual(layer(next, 'carousel').images, images);
  assert.deepEqual(next.images, previous.images);
  assert.deepEqual(layer(next, 'second'), layer(previous, 'second'));
  assert.deepEqual(p, previous);
  images[0].name = 'Caller changed';
  assert.equal(layer(next, 'carousel').images[0].name, 'Replacement');
});

test('content edits reject missing declarations and invalid content or unsafe assets', () => {
  let p = projectWithMedia();
  assert.throws(() => patchTemplateContent(p, 'missing', 'New'), /Layer not found/);
  for (const id of ['headline', 'background', 'model']) assert.throws(() => patchTemplateContent(p, id, 'New'), /no declared content field/);
  for (const id of ['headline', 'carousel', 'logo', 'media', 'music']) p = patchLayer(p, id, { contentField: id });
  const before = structuredClone(p);
  const invalid = {
    headline: [undefined, null, {}, 'x'.repeat(501)],
    carousel: [undefined, null, {}, [{ id: 'bad', src: 'https://example.com/photo.png', name: 'Bad' }], [{ id: 'bad', src: asset('mp3'), name: 'Audio' }], [{ id: 'bad', src: '', name: 'Empty' }]],
    logo: [undefined, 'https://example.com/logo.png', asset('mp4'), '/assets/../../logo.svg'],
    media: [undefined, '', asset('glb'), asset('mp3')],
    music: [undefined, 'https://example.com/audio.mp3', asset('png')]
  };
  for (const [id, values] of Object.entries(invalid)) for (const value of values) assert.throws(() => patchTemplateContent(p, id, value));
  assert.deepEqual(p, before);
  for (const [id, value] of [['headline', ''], ['carousel', []], ['logo', ''], ['music', '']]) assert.doesNotThrow(() => patchTemplateContent(p, id, value));
});

test('duplicate layers clear slot declarations while retaining independent choreography', () => {
  let p = validateProject(demoProject());
  p = patchLayer(p, 'headline', { contentField: 'Headline', choreography: captureState(layer(p, 'headline'), 0, p.fps, {}, 'first') });
  const next = duplicateLayer(p, 'headline', 'copy');
  assert.equal(layer(next, 'headline').contentField, 'Headline');
  assert(!Object.hasOwn(layer(next, 'copy'), 'contentField'));
  assert.deepEqual(contentFields(next).map(l => l.id), ['headline']);
  assert.deepEqual(layer(next, 'copy').choreography, layer(next, 'headline').choreography);
  layer(next, 'copy').choreography[0].values.x = 20;
  assert.equal(layer(next, 'headline').choreography[0].values.x, 6);
  assert.throws(() => patchTemplateContent(next, 'copy', 'New'), /no declared content field/);
});
