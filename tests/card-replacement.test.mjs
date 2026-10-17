import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { carouselImages, demoProject, linkFormats, patchLayer, PROJECT_LIMITS, switchFormat, validateProject } from '../src/project.js';
import { isVisualAsset, matchesLibrary, replaceCardImages } from '../src/editor/media-library.js';
import { applyDiff, diffProjects, revertDiff } from '../src/editor/history.js';

const asset = (ext = 'mp4') => ({ src: `/assets/12345678-1234-4234-8234-123456789012.${ext}`, name: `Replacement.${ext}` });
const plain = value => JSON.parse(JSON.stringify(value));

test('replacing one borrowed card preserves identity, other carousels and all authored settings through undo/redo', () => {
  const original = demoProject();
  original.layers.push({ ...original.layers.find(layer => layer.type === 'carousel'), id: 'other-carousel' });
  const project = validateProject(original), before = structuredClone(project), id = project.images[1].id;
  const next = patchLayer(project, 'carousel', { images: replaceCardImages(project, 'carousel', id, asset()) });
  const oldLayer = project.layers.find(layer => layer.id === 'carousel'), newLayer = next.layers.find(layer => layer.id === 'carousel');
  assert.deepEqual(newLayer.images.map(card => card.id), project.images.map(card => card.id));
  assert.deepEqual(newLayer.images[1], { id, ...asset() });
  assert.deepEqual(newLayer.images.filter(card => card.id !== id), project.images.filter(card => card.id !== id));
  const { images, ...settings } = newLayer;
  assert.deepEqual(settings, oldLayer);
  assert.deepEqual(next.images, project.images);
  assert.deepEqual(carouselImages(next, next.layers.find(layer => layer.id === 'other-carousel')), project.images);
  assert.deepEqual(next.layers.filter(layer => layer.id !== 'carousel'), project.layers.filter(layer => layer.id !== 'carousel'));
  assert.deepEqual(project, before);
  const ops = diffProjects(project, next);
  assert.deepEqual(revertDiff(next, ops), project);
  assert.deepEqual(applyDiff(project, ops), next);
});

test('a full reordered carousel replaces the stable card ID without appending or changing its count', () => {
  let project = validateProject(demoProject());
  const cards = Array.from({ length: PROJECT_LIMITS.maxImages }, (_, index) => ({ id: `card-${index}`, src: '/demo/poster-1.svg', name: `Original ${index}` })).reverse();
  project = patchLayer(project, 'carousel', { images: cards, cardCount: PROJECT_LIMITS.maxImages });
  const next = patchLayer(project, 'carousel', { images: replaceCardImages(project, 'carousel', 'card-0', asset('gif')) });
  const layer = next.layers.find(item => item.id === 'carousel');
  assert.equal(layer.images.length, PROJECT_LIMITS.maxImages);
  assert.equal(layer.cardCount, PROJECT_LIMITS.maxImages);
  assert.deepEqual(layer.images.at(-1), { id: 'card-0', ...asset('gif') });
  assert.deepEqual(layer.images.slice(0, -1), cards.slice(0, -1));
});

test('card replacement shares content across linked formats without changing their framing', () => {
  const project = linkFormats(validateProject(demoProject()));
  const portraitBefore = switchFormat(project, 'portrait');
  const id = carouselImages(project, project.layers.find(layer => layer.id === 'carousel'))[0].id;
  const next = patchLayer(project, 'carousel', { images: replaceCardImages(project, 'carousel', id, asset('webm')) });
  const portrait = switchFormat(next, 'portrait');
  const before = portraitBefore.layers.find(layer => layer.id === 'carousel'), after = portrait.layers.find(layer => layer.id === 'carousel');
  assert.equal(after.images[0].id, id);
  assert.equal(after.images[0].src, asset('webm').src);
  assert.deepEqual({ ...after, images: undefined }, { ...before, images: undefined });
});

test('locked, removed and non-visual targets fail without changing the original project', () => {
  const project = validateProject(demoProject()), before = structuredClone(project), id = project.images[0].id;
  assert.throws(() => replaceCardImages(patchLayer(project, 'carousel', { locked: true }), 'carousel', id, asset()), /Unlock/);
  assert.throws(() => replaceCardImages(project, 'removed-carousel', id, asset()), /no longer exists/);
  assert.throws(() => replaceCardImages(project, 'carousel', 'removed-card', asset()), /no longer exists/);
  assert.throws(() => replaceCardImages(project, 'carousel', id, asset('mp3')), /image, GIF or video/);
  assert.throws(() => replaceCardImages(project, 'carousel', id, { ...asset(), src: 'https://example.com/video.mp4' }), /image, GIF or video/);
  assert.deepEqual(project, before);
});

const source = fs.readFileSync(new URL('../src/editor/components/ReplaceCardDialog.jsx', import.meta.url), 'utf8');
const compiled = (await transform(source.replace(/^import .*;\n/gm, '').replace(/export function/g, 'function'), { loader: 'jsx' })).code;
const nodes = node => [node, ...(node?.children || []).flat(Infinity).flatMap(child => child && typeof child === 'object' ? nodes(child) : [])];
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function dialog(upload) {
  const slots = [], uploads = [], history = [];
  const projectRef = { current: validateProject(demoProject()) };
  const cardId = projectRef.current.images[1].id;
  let cursor = 0, closes = 0;
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    SquaresFour() {}, UploadSimple() {}, X() {}, Modal() {}, IconButton() {}, AssetThumb() {},
    carouselImages, replaceCardImages, useMediaLibrary: () => ({ assets: [], loading: false, error: '' }),
    isVisualAsset, matchesLibrary,
    useId: () => 'replace-card',
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useState(value) { const index = cursor++; slots[index] ??= { value }; return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
    useEffect(effect) { const index = cursor++; if (!slots[index]) slots[index] = { cleanup: effect() }; },
    async uploadAssets(files) { uploads.push(files); return upload(files); }
  };
  vm.createContext(context);
  vm.runInContext(compiled + '\nthis.component = ReplaceCardDialog;', context);
  const render = () => {
    cursor = 0;
    return context.component({ project: projectRef.current, projectRef, layerId: 'carousel', cardId,
      onPatch(id, fields) { const next = patchLayer(projectRef.current, id, plain(fields)); history.push(diffProjects(projectRef.current, next)); projectRef.current = next; return next; },
      onClose() { closes++; } });
  };
  const choose = files => nodes(render()).find(node => node.type === 'input' && node.props.type === 'file').props.onChange({ target: { files, value: 'chosen' } });
  const error = () => nodes(render()).find(node => node.props?.role === 'alert')?.children.join('');
  return { projectRef, cardId, history, uploads, render, choose, error, close: () => render().props.onClose(), closes: () => closes, dispose: () => slots.forEach(slot => slot?.cleanup?.()) };
}

test('a pending or failed upload never commits partially, retries remain one undoable replacement', async () => {
  const gate = deferred(); let attempts = 0;
  const h = dialog(() => ++attempts === 1 ? gate.promise : Promise.resolve([asset('gif')]));
  const before = structuredClone(h.projectRef.current);
  const first = h.choose([{ name: 'card.mp4' }]);
  await h.choose([{ name: 'duplicate.mp4' }]); h.close();
  assert.equal(h.uploads.length, 1);
  assert.equal(h.closes(), 0);
  assert.deepEqual(h.projectRef.current, before);
  gate.reject(new Error('Upload failed')); await first;
  assert.match(h.error(), /Upload failed/);
  assert.equal(h.history.length, 0);
  await h.choose([{ name: 'retry.gif' }]);
  assert.equal(h.closes(), 1);
  assert.equal(h.history.length, 1);
  assert.deepEqual(revertDiff(h.projectRef.current, h.history[0]), before);
  assert.equal(h.projectRef.current.layers.find(layer => layer.id === 'carousel').images[1].id, h.cardId);
});

test('an intervening project edit or unmount prevents a late upload from overwriting current content', async () => {
  const changed = deferred(), h = dialog(() => changed.promise);
  const first = h.choose([{ name: 'card.mp4' }]);
  h.projectRef.current = patchLayer(h.projectRef.current, 'headline', { text: 'Keep this intervening edit' });
  const latest = structuredClone(h.projectRef.current);
  changed.resolve([asset()]); await first;
  assert.deepEqual(h.projectRef.current, latest);
  assert.equal(h.history.length, 0);
  assert.match(h.error(), /composition changed/i);
  const pending = deferred(), closed = dialog(() => pending.promise);
  const before = structuredClone(closed.projectRef.current);
  const upload = closed.choose([{ name: 'card.mp4' }]); closed.dispose();
  pending.resolve([asset()]); await upload;
  assert.deepEqual(closed.projectRef.current, before);
  assert.equal(closed.history.length, 0);
});

test('cancelled, multiple or unsupported file selections do not upload or alter cards', async () => {
  const h = dialog(() => { throw new Error('Unexpected upload'); });
  const before = structuredClone(h.projectRef.current);
  await h.choose([]);
  await h.choose([{ name: 'one.png' }, { name: 'two.png' }]);
  await h.choose([{ name: 'sound.mp3' }]);
  h.close();
  assert.equal(h.closes(), 1);
  assert.equal(h.uploads.length, 0);
  assert.equal(h.history.length, 0);
  assert.deepEqual(h.projectRef.current, before);
});
