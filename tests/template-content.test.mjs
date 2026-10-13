import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, validateProject, patchLayer, patchTemplateContent, duplicateLayer, fileLayer } from '../src/project.js';
import { CONTENT_PROPERTIES, contentFields, contentFieldPatch, contentIssues } from '../src/template-content.js';
import { captureState } from '../src/choreography.js';

const layer = (project, id) => project.layers.find(l => l.id === id);
const asset = extension => `/assets/12345678-1234-1234-1234-123456789012.${extension}`;
const projectWithMedia = () => validateProject({ ...demoProject(), layers: [...demoProject().layers, fileLayer({ src: asset('png'), name: 'Photo' }, 12, 'media'), fileLayer({ src: asset('glb'), name: 'Model' }, 12, 'model')] });
const field = (id, label = id, extra = {}) => ({ id, label, required: false, ...extra });

test('typed declarations normalize without adding metadata to legacy layers, and null removes them', () => {
  const legacy = validateProject(demoProject());
  assert.deepEqual(contentFields(legacy), []);
  assert(legacy.layers.every(l => !Object.hasOwn(l, 'contentField')));
  assert.deepEqual(validateProject(legacy), legacy);
  const named = patchLayer(legacy, 'headline', { contentField: { id: 'headline', label: '  Headline  ', editorOnly: true } });
  assert.deepEqual(layer(named, 'headline').contentField, field('headline', 'Headline'), 'label trimmed, required defaults to false, unknown keys dropped');
  assert.deepEqual(contentFields(named), [layer(named, 'headline')]);
  assert.deepEqual(validateProject(named), named);
  assert(!Object.hasOwn(layer(legacy, 'headline'), 'contentField'));
  const removed = patchLayer(named, 'headline', { contentField: null });
  assert(!Object.hasOwn(layer(removed, 'headline'), 'contentField'));
  assert.deepEqual(contentFields(removed), []);
});

test('only supported layer types declare fields with unique ids, bounded labels and text-only maxLength', () => {
  let p = projectWithMedia();
  assert.deepEqual(CONTENT_PROPERTIES, { text: 'text', carousel: 'images', logo: 'src', media: 'src', music: 'src' });
  for (const id of ['headline', 'carousel', 'logo', 'media', 'music']) p = patchLayer(p, id, { contentField: field(id) });
  assert.deepEqual(contentFields(p).map(l => l.id), ['carousel', 'headline', 'logo', 'music', 'media']);
  assert.doesNotThrow(() => patchLayer(p, 'headline', { contentField: field('headline', 'x'.repeat(60)) }));
  for (const label of [null, 1, '', '   ', 'x'.repeat(61), 'A\nB', 'A\tB', 'A\0B', 'A\u007fB', 'A\u0085B']) {
    assert.throws(() => patchLayer(p, 'headline', { contentField: field('headline', label) }), /Invalid content field name/, JSON.stringify(label));
  }
  for (const id of [undefined, '', 'Headline', 'two words', '-lead', 'trail-', 'a--b', 'x'.repeat(61), 7]) {
    assert.throws(() => patchLayer(p, 'headline', { contentField: field(id, 'Headline') }), /Invalid content field ID/, JSON.stringify(id));
  }
  for (const contentField of ['Headline', 1, [], undefined]) assert.throws(() => patchLayer(p, 'headline', { contentField }), /Invalid content field\./);
  assert.throws(() => patchLayer(p, 'headline', { contentField: field('carousel', 'Headline') }), /Content field IDs must be unique/);
  assert.throws(() => patchLayer(p, 'headline', { contentField: field('headline', 'Headline', { required: 'yes' }) }), /required must be true or false/);
  for (const maxLength of [1, 500]) assert.equal(layer(patchLayer(p, 'headline', { contentField: field('headline', 'H', { maxLength }) }), 'headline').contentField.maxLength, maxLength);
  for (const maxLength of [0, 501, 1.5, '20', null]) assert.throws(() => patchLayer(p, 'headline', { contentField: field('headline', 'H', { maxLength }) }), /Maximum length must be a whole number from 1 to 500/);
  for (const id of ['carousel', 'logo', 'media', 'music']) assert.throws(() => patchLayer(p, id, { contentField: field(id, id, { maxLength: 20 }) }), /Only text fields accept a maximum length/);
  for (const id of ['background', 'model']) {
    assert.throws(() => patchLayer(p, id, { contentField: field('asset') }), /Unknown layer property/);
    for (const contentField of [field('asset'), null, undefined]) {
      assert.throws(() => validateProject({ ...p, layers: p.layers.map(l => l.id === id ? { ...l, contentField } : l) }), /cannot declare a content field/);
    }
  }
});

test('editor declarations keep their id through renames and pick free ids for repeated labels', () => {
  let p = validateProject(demoProject());
  p = patchLayer(p, 'headline', contentFieldPatch(p, 'headline', { label: 'Title', required: true, maxLength: 24 }));
  assert.deepEqual(layer(p, 'headline').contentField, field('title', 'Title', { required: true, maxLength: 24 }));
  p = patchLayer(p, 'carousel', contentFieldPatch(p, 'carousel', { label: 'Title', maxLength: 10 }));
  assert.deepEqual(layer(p, 'carousel').contentField, field('title-2', 'Title'), 'media fields ignore maxLength');
  p = patchLayer(p, 'headline', contentFieldPatch(p, 'headline', { label: 'Main headline', required: false }));
  assert.deepEqual(layer(p, 'headline').contentField, field('title', 'Main headline'), 'renaming keeps the stable id');
  assert.deepEqual(contentFieldPatch(p, 'headline', { label: '   ' }), { contentField: null });
});

test('content issues flag empty required values and text over its maximum length', () => {
  let p = validateProject(demoProject());
  p = patchLayer(p, 'headline', { contentField: field('headline', 'Headline', { required: true, maxLength: 5 }) });
  p = patchLayer(p, 'logo', { contentField: field('logo', 'Logo', { required: true }) });
  p = patchLayer(p, 'carousel', { contentField: field('cards', 'Cards', { required: true }) });
  p = patchTemplateContent(patchTemplateContent(p, 'headline', 'ABC'), 'logo', '/demo/poster-3.svg');
  assert.deepEqual(contentIssues(p), []);
  const empty = patchTemplateContent(patchTemplateContent(patchTemplateContent(p, 'headline', '  \n'), 'logo', ''), 'carousel', []);
  assert.deepEqual(contentIssues(empty).map(issue => [issue.fieldId, issue.kind]), [['cards', 'required'], ['headline', 'required'], ['logo', 'required']]);
  assert.deepEqual(contentIssues(patchTemplateContent(p, 'headline', 'ABCDEF')).map(issue => [issue.fieldId, issue.kind, issue.message]), [['headline', 'maxLength', 'Headline is longer than 5 characters.']]);
});

test('declaring and directly editing locked layers still requires unlocking', () => {
  let p = patchLayer(validateProject(demoProject()), 'headline', { locked: true });
  assert.throws(() => patchLayer(p, 'headline', { contentField: field('headline', 'Headline') }), /Unlock/);
  assert.throws(() => patchLayer(p, 'headline', { locked: false, contentField: 'Headline' }), /Unlock/);
  p = patchLayer(p, 'headline', { locked: false });
  p = patchLayer(p, 'headline', { contentField: field('headline', 'Headline') });
  p = patchLayer(p, 'headline', { locked: true });
  for (const patch of [{ text: 'New' }, { contentField: null }, { x: 20 }, { locked: false, text: 'New' }]) assert.throws(() => patchLayer(p, 'headline', patch), /Unlock/);
});

test('explicit content edits change only the declared authoritative property, including locked layers', () => {
  let p = projectWithMedia();
  const headline = layer(p, 'headline');
  p = patchLayer(p, 'headline', { choreography: captureState(headline, 0, p.fps, {}, 'first') });
  for (const id of ['headline', 'carousel', 'logo', 'media', 'music']) {
    p = patchLayer(p, id, { contentField: field(id) });
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
  let p = patchLayer(validateProject(demoProject()), 'carousel', { contentField: field('main-cards', 'Main cards') });
  p = duplicateLayer(p, 'carousel', 'second');
  p = patchLayer(p, 'second', { contentField: field('secondary-cards', 'Secondary cards') });
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
  for (const id of ['headline', 'carousel', 'logo', 'media', 'music']) p = patchLayer(p, id, { contentField: field(id) });
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
  p = patchLayer(p, 'headline', { contentField: field('headline', 'Headline'), choreography: captureState(layer(p, 'headline'), 0, p.fps, {}, 'first') });
  const next = duplicateLayer(p, 'headline', 'copy');
  assert.deepEqual(layer(next, 'headline').contentField, field('headline', 'Headline'));
  assert(!Object.hasOwn(layer(next, 'copy'), 'contentField'));
  assert.deepEqual(contentFields(next).map(l => l.id), ['headline']);
  assert.deepEqual(layer(next, 'copy').choreography, layer(next, 'headline').choreography);
  layer(next, 'copy').choreography[0].values.x = 20;
  assert.equal(layer(next, 'headline').choreography[0].values.x, 6);
  assert.throws(() => patchTemplateContent(next, 'copy', 'New'), /no declared content field/);
});
