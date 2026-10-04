import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMATS, demoProject, validateProject, patchLayer, patchTemplateContent, duplicateLayer, reorderLayer, resizeDuration, fileLayer, linkFormats, switchFormat, resetFormat, unlinkFormats } from '../src/project.js';
import { captureState, choreographyFields, evaluateChoreography } from '../src/choreography.js';

const layer = (project, id) => project.layers.find(entry => entry.id === id);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);
const image = { id: 'replacement', src: '/demo/poster-6.svg', name: 'Replacement' };
const states = entry => [
  { id: 'entry', time: 0, easing: 'linear', values: Object.fromEntries(Object.keys(choreographyFields(entry)).map(key => [key, key === 'opacity' ? .25 : entry[key]])) },
  { id: 'exit', time: 5, easing: 'smooth', values: Object.fromEntries(Object.keys(choreographyFields(entry)).map(key => [key, key === 'opacity' ? .75 : key === 'x' || key === 'y' ? 60 : entry[key]])) }
];

test('legacy format switching keeps the existing flat geometry and content', () => {
  const p = validateProject(demoProject());
  assert.deepEqual(switchFormat(p, 'landscape'), { ...p, format: 'landscape' });
  assert.deepEqual(resetFormat(p), p);
  assert.deepEqual(unlinkFormats(p), p);
  assert.throws(() => switchFormat(p, 'unknown'), /Unknown output format/);
});

test('linking uses the current master and seeds the three common formats without mutating input', () => {
  const raw = validateProject({ ...demoProject(), format: 'portrait34' });
  const before = structuredClone(raw);
  const p = linkFormats(raw);
  assert.deepEqual(raw, before);
  assert.equal(p.linkedFormats.master, 'portrait34');
  assert.deepEqual(Object.keys(p.linkedFormats.layouts).sort(), ['landscape', 'portrait', 'portrait34', 'square']);
  assert.deepEqual(p.layers, before.layers);
  assert.deepEqual(p.layout, before.layout);
  assert.deepEqual(linkFormats(p), p);
  assert.deepEqual(validateProject(p), p);
});

test('text, title, assets, carousel cards, structure, timing and motion are shared from either format', () => {
  let p = linkFormats(demoProject());
  p = switchFormat(p, 'portrait');
  p = validateProject({ ...p, name: 'Shared title', images: [image] });
  p = patchLayer(p, 'headline', { text: 'Updated in portrait', color: '#112233', start: 1, end: 10, fadeIn: .2, opacity: .6 });
  p = patchLayer(p, 'logo', { src: '/demo/poster-2.svg', name: 'Shared asset' });
  p = patchLayer(p, 'carousel', { images: [image], template: 'horizontal', shader: 'wave', speed: 30 });
  p = patchLayer(p, 'background', { color: '#123456' });
  p = patchLayer(p, 'music', { volume: .2, offset: 1 });
  p = patchLayer(p, 'logo', { locked: true, visible: false });
  for (const format of ['square', 'landscape', 'portrait']) {
    p = switchFormat(p, format);
    assert.equal(p.name, 'Shared title');
    assert.deepEqual(p.images, [image]);
    assert.equal(layer(p, 'headline').text, 'Updated in portrait');
    assert.equal(layer(p, 'headline').color, '#112233');
    assert.deepEqual([layer(p, 'headline').start, layer(p, 'headline').end, layer(p, 'headline').fadeIn, layer(p, 'headline').opacity], [1, 10, .2, .6]);
    assert.deepEqual([layer(p, 'logo').src, layer(p, 'logo').name, layer(p, 'logo').locked, layer(p, 'logo').visible], ['/demo/poster-2.svg', 'Shared asset', true, false]);
    assert.deepEqual(layer(p, 'carousel').images, [image]);
    assert.deepEqual([layer(p, 'carousel').template, layer(p, 'carousel').shader, layer(p, 'carousel').speed], ['horizontal', 'wave', 30]);
    assert.equal(layer(p, 'background').color, '#123456');
    assert.equal(layer(p, 'music').volume, .2);
  }
  p = patchLayer(p, 'headline', { text: 'Updated in master' });
  assert.equal(layer(switchFormat(p, 'portrait'), 'headline').text, 'Updated in master');
});

test('framing and typography corrections persist independently through switches and serialized undo snapshots', () => {
  const original = linkFormats(demoProject());
  let p = switchFormat(original, 'landscape');
  p = patchLayer(p, 'headline', { x: 20, y: 30, size: 60, width: 40, font: 'geist', weight: 600 });
  p = patchLayer(p, 'carousel', { x: 62, y: 35, size: 1.9, tilt: 10, yaw: 20, roll: 40, gap: .4, radius: 3, perspective: 50, cardAspect: 1.5 });
  p = patchLayer(p, 'background', { fit: 'contain' });
  p = validateProject({ ...p, layout: { enabled: true, guides: false, marginX: 10, marginY: 12 } });
  const undo = JSON.parse(JSON.stringify(p));
  const master = switchFormat(p, 'square');
  assert.deepEqual(layer(master, 'headline'), layer(original, 'headline'));
  assert.equal(layer(master, 'background').fit, 'cover');
  assert.deepEqual(master.layout, original.layout);
  const restored = switchFormat(master, 'landscape');
  assert.deepEqual(restored.layers, undo.layers);
  assert.deepEqual(restored.layout, undo.layout);
  assert.deepEqual(validateProject(undo), restored);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(original))), original);
});

test('reset recomputes the active format from the current master and preserves shared content', () => {
  let p = switchFormat(linkFormats(demoProject()), 'landscape');
  p = patchLayer(p, 'headline', { x: 35, text: 'Retain this content' });
  p = switchFormat(p, 'square');
  p = patchLayer(p, 'headline', { x: 12, size: 64 });
  assert.deepEqual(resetFormat(p), p);
  p = switchFormat(p, 'landscape');
  assert.equal(layer(p, 'headline').x, 35);
  p = resetFormat(p);
  near(layer(p, 'headline').x, 12 * 1080 / 1920);
  near(layer(p, 'headline').size, 64 * 1080 / 1920);
  assert.equal(layer(p, 'headline').text, 'Retain this content');
  assert.deepEqual(resetFormat(p), p);
});

test('unlink keeps the current effective composition and drops only the linked cache', () => {
  let p = switchFormat(linkFormats(demoProject()), 'portrait');
  p = patchLayer(p, 'headline', { x: 18, text: 'Independent' });
  const expected = structuredClone(p);
  delete expected.linkedFormats;
  assert.deepEqual(unlinkFormats(p), expected);
  assert.equal(p.linkedFormats.master, 'square');
});

test('assistance preserves short-side margins, center offsets, sizes and orientations within canonical bounds', () => {
  let p = patchLayer(demoProject(), 'carousel', { radius: 2 });
  p.layers.push(fileLayer({ name: 'Model', src: '/assets/12345678-1234-1234-1234-123456789012.glb' }, 12, 'model'));
  p = linkFormats(p);
  const landscape = switchFormat(p, 'landscape');
  near(layer(landscape, 'headline').x, 6 * .5625);
  near(layer(landscape, 'headline').size, 48 * .5625);
  near(layer(landscape, 'headline').width, 80 * .5625);
  near(layer(landscape, 'signature').x, 100 - 23 * .5625);
  near(layer(landscape, 'logo').x, 100 - 13 * .5625);
  near(layer(landscape, 'logo').size, 7 * .5625);
  near(layer(landscape, 'model').x, 50 - 25 * .5625);
  near(layer(landscape, 'model').size, 50 * .5625);
  near(landscape.layout.marginX, 5 * .5625);
  const portrait = switchFormat(p, 'portrait');
  near(layer(portrait, 'headline').y, 6 * .5625);
  assert.equal(layer(portrait, 'signature').y, 95);
  near(layer(portrait, 'carousel').y, 50 + 4 * .5625);
  near(layer(portrait, 'carousel').size, 1.35 * .5625);
  near(layer(portrait, 'carousel').gap, .28 * .5625);
  near(layer(portrait, 'carousel').radius, 2 * .5625);
  assert.deepEqual([layer(portrait, 'carousel').tilt, layer(portrait, 'carousel').yaw, layer(portrait, 'carousel').roll], [-12, 0, -26]);
  p = linkFormats(patchLayer(patchLayer(demoProject(), 'headline', { size: 12, width: 5 }), 'carousel', { size: 2.5, gap: 1, radius: 6 }));
  assert.equal(layer(switchFormat(p, 'landscape'), 'headline').size, 12);
  assert.equal(layer(switchFormat(p, 'landscape'), 'headline').width, 5);
  p = linkFormats({ ...unlinkFormats(p), format: 'portrait' });
  assert.deepEqual(['size', 'gap', 'radius'].map(key => layer(switchFormat(p, 'square'), 'carousel')[key]), [2.5, 1, 6]);
});

test('all five formats materialize safely and lazy formats derive from the master', () => {
  let p = linkFormats(demoProject());
  assert.equal(Object.hasOwn(p.linkedFormats.layouts, 'portrait34'), false);
  p = patchLayer(switchFormat(p, 'portrait'), 'headline', { x: 40 });
  p = switchFormat(p, 'portrait34');
  assert.equal(layer(p, 'headline').x, 6);
  for (const format of Object.keys(FORMATS)) {
    p = switchFormat(p, format);
    assert.equal(p.format, format);
    assert.deepEqual(validateProject(p), p);
  }
  assert.equal(Object.keys(p.linkedFormats.layouts).length, 5);
});

test('link and reset keep center framing continuous across the baseline midpoint', () => {
  const versions = [49.99, 50].map(position => linkFormats(patchLayer(demoProject(), 'headline', { x: position, y: position })));
  for (const [format, axis] of [['landscape', 'x'], ['portrait', 'y']]) {
    const linked = versions.map(project => switchFormat(project, format));
    assert.ok(Math.abs(layer(linked[0], 'headline')[axis] - layer(linked[1], 'headline')[axis]) < .02);
    assert.equal(layer(linked[1], 'headline')[axis], 50);
    const reset = linked.map(project => resetFormat(patchLayer(project, 'headline', { [axis]: 20 })));
    assert.ok(Math.abs(layer(reset[0], 'headline')[axis] - layer(reset[1], 'headline')[axis]) < .02);
    assert.equal(layer(reset[1], 'headline')[axis], 50);
  }
});

test('choreography adapts with baseline anchors and shares state timing, easing and opacity', () => {
  let p = patchLayer(demoProject(), 'headline', { x: 40, y: 40 });
  p = patchLayer(p, 'headline', { choreography: states(layer(p, 'headline')) });
  p = linkFormats(p);
  let landscape = switchFormat(p, 'landscape');
  const adapted = layer(landscape, 'headline').choreography;
  near(adapted[0].values.x, 30 + (40 - 30) * .5625);
  near(adapted[1].values.x, 30 + (60 - 30) * .5625);
  near(adapted[1].values.size, 48 * .5625);
  assert.deepEqual(adapted.map(({ id, time, easing, values }) => [id, time, easing, values.opacity]), [['entry', 0, 'linear', .25], ['exit', 5, 'smooth', .75]]);
  const edited = structuredClone(adapted);
  edited[1].time = 7;
  edited[1].easing = 'ease-out';
  edited[1].values.opacity = .4;
  edited[1].values.x = 80;
  landscape = patchLayer(landscape, 'headline', { choreography: edited });
  const square = switchFormat(landscape, 'square');
  const end = layer(square, 'headline').choreography[1];
  assert.deepEqual([end.time, end.easing, end.values.opacity, end.values.x], [7, 'ease-out', .4, 60]);
  assert.equal(layer(switchFormat(square, 'landscape'), 'headline').choreography[1].values.x, 80);
  const cached = landscape.linkedFormats.layouts.landscape.layers.headline.choreography.exit;
  assert.deepEqual(Object.keys(cached).sort(), ['size', 'x', 'y']);
  const portrait = switchFormat(square, 'portrait');
  near(layer(portrait, 'headline').choreography[1].values.y, 30 + (60 - 30) * .5625);
});

test('new choreography states are seeded, removed states pruned and locked edits remain protected', () => {
  let p = linkFormats(demoProject());
  p = switchFormat(p, 'landscape');
  p = patchLayer(p, 'headline', { choreography: states(layer(p, 'headline')) });
  const master = switchFormat(p, 'square');
  assert.equal(layer(master, 'headline').choreography.length, 2);
  near(layer(master, 'headline').choreography[0].values.x, 6);
  p = patchLayer(master, 'headline', { choreography: [layer(master, 'headline').choreography[0]] });
  for (const layout of Object.values(p.linkedFormats.layouts)) assert.deepEqual(Object.keys(layout.layers.headline.choreography), ['entry']);
  p = patchLayer(p, 'headline', { locked: true });
  assert.throws(() => patchLayer(switchFormat(p, 'portrait'), 'headline', { x: 20 }), /Unlock/);
  assert.throws(() => duplicateLayer(p, 'headline', 'copy'), /Unlock/);
  assert.equal(layer(switchFormat(p, 'portrait'), 'headline').locked, true);
});

test('no-op capture stays at every cached baseline after manual format corrections', () => {
  let p = patchLayer(demoProject(), 'headline', { x: 40, y: 40 });
  p = linkFormats(p);
  const master = structuredClone(p);
  p = switchFormat(p, 'portrait');
  p = patchLayer(p, 'headline', { x: 32, y: 28, size: 70 });
  p = patchLayer(p, 'carousel', { x: 32, y: 28, size: 1.6, tilt: 20, yaw: 30, roll: 40 });
  const portrait = structuredClone(p);
  p = switchFormat(p, 'landscape');
  near(layer(p, 'headline').x, 35.625);
  p = patchLayer(p, 'headline', { choreography: captureState(layer(p, 'headline'), 0, p.fps, {}, 'text-state') });
  p = patchLayer(p, 'carousel', { choreography: captureState(layer(p, 'carousel'), 0, p.fps, {}, 'carousel-state') });
  for (const [format, baseline] of [['square', master], ['portrait', portrait], ['landscape', p]]) {
    const next = switchFormat(p, format);
    for (const id of ['headline', 'carousel']) {
      const entry = layer(next, id), original = layer(baseline, id);
      const values = entry.choreography[0].values;
      for (const field of Object.keys(choreographyFields(entry)).filter(field => field !== 'opacity')) near(values[field], original[field]);
    }
  }
});

test('new state deltas scale onto destination geometry and orientation without replacing existing poses', () => {
  let p = linkFormats(demoProject());
  p = switchFormat(p, 'portrait');
  p = patchLayer(p, 'carousel', { x: 32, y: 28, size: 1.6, tilt: 20, yaw: 30, roll: 40 });
  p = switchFormat(p, 'landscape');
  const source = layer(p, 'carousel');
  p = patchLayer(p, 'carousel', { choreography: captureState(source, 0, p.fps, { x: source.x + 4, y: source.y + 4, size: source.size + .2, tilt: source.tilt + 5, yaw: source.yaw + 6, roll: source.roll + 7 }, 'first') });
  let portrait = switchFormat(p, 'portrait');
  const first = layer(portrait, 'carousel').choreography[0].values;
  near(first.x, 32 + 4 / .5625);
  near(first.y, 28 + 4 * .5625);
  near(first.size, 1.6 + .2 * .5625);
  assert.deepEqual([first.tilt, first.yaw, first.roll], [25, 36, 47]);
  portrait = patchLayer(portrait, 'carousel', { choreography: layer(portrait, 'carousel').choreography.map(state => ({ ...state, values: { ...state.values, x: 70 } })) });
  p = switchFormat(portrait, 'landscape');
  p = patchLayer(p, 'carousel', { choreography: captureState(layer(p, 'carousel'), 2, p.fps, {}, 'second') });
  portrait = switchFormat(p, 'portrait');
  assert.equal(layer(portrait, 'carousel').choreography[0].values.x, 70);
  assert.equal(layer(portrait, 'carousel').choreography.length, 2);
});

test('neutral midpoint capture preserves the existing local animation curve in every format', () => {
  let p = patchLayer(demoProject(), 'headline', { x: 40 });
  const authored = states(layer(p, 'headline'));
  authored[0].values.x = 20;
  authored[1].time = 4;
  authored[1].easing = 'linear';
  authored[1].values.x = 80;
  p = patchLayer(p, 'headline', { choreography: authored });
  p = linkFormats(p);
  const master = switchFormat(p, 'square');
  p = switchFormat(p, 'landscape');
  const corrected = layer(p, 'headline').choreography.map((state, index) => ({ ...state, values: { ...state.values, x: index ? 30 : 10 } }));
  p = patchLayer(p, 'headline', { choreography: corrected });
  const prior = { square: master, landscape: p, portrait: switchFormat(p, 'portrait') };
  const captured = captureState(layer(p, 'headline'), 2, p.fps, {}, 'midpoint').map(state => state.id === 'midpoint' ? { ...state, easing: 'linear' } : state);
  p = patchLayer(p, 'headline', { choreography: captured });
  for (const [format, before] of Object.entries(prior)) {
    const next = switchFormat(p, format);
    for (const time of [0, 1, 2, 3, 4]) {
      const poseBefore = evaluateChoreography(layer(before, 'headline'), time);
      const poseAfter = evaluateChoreography(layer(next, 'headline'), time);
      for (const field of Object.keys(choreographyFields(layer(next, 'headline')))) near(poseAfter[field], poseBefore[field]);
    }
  }
  near(layer(switchFormat(p, 'square'), 'headline').choreography.find(state => state.id === 'midpoint').values.x, 50);
});

test('add, duplicate, remove, reorder and duration edits maintain the shared structure', () => {
  let p = switchFormat(linkFormats(demoProject()), 'landscape');
  p = validateProject({ ...p, layers: [...p.layers, { ...layer(p, 'headline'), id: 'new-text', text: 'New' }] });
  p = duplicateLayer(p, 'carousel', 'copy-carousel');
  p = reorderLayer(p, 'new-text', 'background', 'below');
  p = validateProject({ ...p, layers: p.layers.filter(entry => entry.id !== 'signature') });
  p = resizeDuration(p, 3);
  const ids = p.layers.map(entry => entry.id);
  for (const format of Object.keys(FORMATS)) {
    p = switchFormat(p, format);
    assert.deepEqual(p.layers.map(entry => entry.id), ids);
    assert.equal(layer(p, 'new-text').text, 'New');
    assert.equal(p.duration, 3);
    assert.ok(p.layers.every(entry => entry.end === 3));
    assert.deepEqual(layer(p, 'copy-carousel').images, p.images);
    assert.equal(p.linkedFormats.layouts[format].layers.signature, undefined);
    assert.ok(p.linkedFormats.layouts[format].layers['new-text']);
  }
});

test('declared template content updates from a locked format remain shared', () => {
  let p = patchLayer(demoProject(), 'headline', { contentField: 'Headline', locked: true });
  p = switchFormat(linkFormats(p), 'portrait');
  p = patchTemplateContent(p, 'headline', 'A shared replacement');
  const master = switchFormat(p, 'square');
  assert.equal(layer(master, 'headline').text, 'A shared replacement');
  assert.equal(layer(master, 'headline').contentField, 'Headline');
  assert.equal(layer(master, 'headline').locked, true);
});

test('duplicates retain each format correction from the source layer', () => {
  let p = linkFormats(demoProject());
  p = switchFormat(p, 'portrait');
  p = patchLayer(p, 'headline', { x: 30, y: 35, size: 70 });
  p = patchLayer(p, 'headline', { choreography: states(layer(p, 'headline')) });
  p = switchFormat(p, 'square');
  p = duplicateLayer(p, 'headline', 'headline-copy');
  for (const format of ['square', 'portrait', 'landscape']) {
    p = switchFormat(p, format);
    const source = layer(p, 'headline'), copy = layer(p, 'headline-copy');
    assert.deepEqual([copy.x, copy.y, copy.size, copy.choreography], [source.x, source.y, source.size, source.choreography]);
  }
});

test('unsafe shared properties cannot enter active, inactive or removed layer caches', () => {
  for (const format of ['square', 'portrait']) for (const property of ['text', 'src', 'images', 'contentField', 'locked', 'start', 'motion', 'opacity', 'type']) {
    const p = linkFormats(demoProject());
    p.linkedFormats.layouts[format].layers.headline[property] = property === 'images' ? [] : 'unsafe';
    assert.throws(() => validateProject(p), /framing and typography|Invalid linked format object/);
  }
  const p = linkFormats(demoProject());
  p.layers = p.layers.filter(entry => entry.id !== 'headline');
  p.linkedFormats.layouts.portrait.layers.headline.text = 'Unsafe removed layer';
  assert.throws(() => validateProject(p), /framing and typography/);
  delete p.linkedFormats.layouts.portrait.layers.headline.text;
  p.linkedFormats.layouts.portrait.layers.headline.x = 'invalid';
  assert.throws(() => validateProject(p), /linked x/);
});

test('malformed metadata, unsafe keys and invalid inactive framing are rejected before normalization', () => {
  const mutations = [
    p => { p.linkedFormats = null; },
    p => { p.linkedFormats.extra = true; },
    p => { p.linkedFormats.master = 'unknown'; },
    p => { delete p.linkedFormats.layouts.square; },
    p => { p.linkedFormats.layouts.unknown = p.linkedFormats.layouts.square; },
    p => { p.linkedFormats.layouts.portrait = []; },
    p => { p.linkedFormats.layouts.portrait.layers = []; },
    p => { p.linkedFormats.layouts.portrait.layout.marginY = 26; },
    p => { p.linkedFormats.layouts.portrait.layers.headline.x = 99; },
    p => { p.linkedFormats.layouts.square.layers.headline.size = 181; },
    p => { p.linkedFormats.layouts.portrait.layers.headline.font = 'unknown'; },
    p => { p.linkedFormats.layouts.portrait.layers.headline.weight = 999; },
    p => { p.linkedFormats.layouts.portrait.layers.headline.choreography = []; },
    p => { p.linkedFormats.layouts.portrait.layers.headline.choreography.removed = { opacity: 1 }; },
    p => { p.linkedFormats.layouts.portrait.layers.headline.choreography.removed = { x: NaN }; },
    p => { p.linkedFormats.layouts.portrait.layers.headline.choreography.removed = { x: 200 }; },
    p => { p.linkedFormats.layouts.portrait.layers.headline.choreography.removed = { tilt: 20 }; },
    p => { p.linkedFormats.layouts.portrait.layers.headline.choreography = JSON.parse('{"__proto__":{}}'); },
    p => { p.linkedFormats.layouts.portrait.layers = JSON.parse('{"constructor":{}}'); },
    p => { p.linkedFormats.layouts.portrait.layers.headline = Object.create({ x: 1 }); }
  ];
  for (const mutate of mutations) {
    const p = linkFormats(demoProject());
    mutate(p);
    assert.throws(() => validateProject(p));
  }
});
