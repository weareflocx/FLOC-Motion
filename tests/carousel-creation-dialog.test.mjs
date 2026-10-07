import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { blankProject, demoProject, patchLayer, validateProject, TEMPLATES } from '../src/project.js';
import { CATALOG } from '../src/catalog.js';
import { DEFAULT_MOTION, motionBaseline } from '../src/motion-timing.js';

async function compile(path) {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  return (await transform(source.replace(/^import .*;\n/gm, '').replace(/export function/g, 'function'), { loader: 'jsx' })).code;
}
const compiled = await compile('../src/editor/components/CarouselCreationDialog.jsx');
const browserCompiled = await compile('../src/editor/components/PresetBrowser.jsx');
const addCompiled = await compile('../src/editor/components/AddLayerDialog.jsx');
const actionsCompiled = await compile('../src/editor/useCompositionActions.js');
const nodes = node => [node, ...(node?.children || []).flat(Infinity).flatMap(child => child && typeof child === 'object' ? nodes(child) : [])];
const text = node => (node.children || []).flat(Infinity).map(child => typeof child === 'object' ? text(child) : child ?? '').join('');

function harness({ upload = async files => files.map(file => ({ id: file.name, name: file.name, src: '/demo/poster-1.svg' })), create = async () => true, project = blankProject() } = {}) {
  const slots = [], uploads = [], creations = [];
  let cursor = 0, closes = 0;
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    ArrowLeft() {}, ArrowRight() {}, Trash() {}, UploadSimple() {}, X() {}, Modal() {}, IconButton() {}, MotionPreview() {}, PresetBrowser() {},
    blankProject, demoProject, patchLayer, validateProject,
    useId: () => 'carousel-creation', useEffect() {},
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) { const i = cursor++; slots[i] ??= { value: typeof value === 'function' ? value() : value }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; },
    async uploadAssets(files) { uploads.push(files); return upload(files); }
  };
  vm.createContext(context);
  vm.runInContext(compiled + '\nthis.component = CarouselCreationDialog;', context);
  const render = () => { cursor = 0; return context.component({ project, onClose() { closes++; }, async onCreate(layer) { creations.push(layer); return create(layer); } }); };
  const find = predicate => nodes(render()).find(predicate);
  const button = label => find(node => node.type === 'button' && text(node) === label || node.props.label === label);
  const library = () => find(node => node.type.name === 'PresetBrowser');
  const select = (id = 'horizontal') => {
    const item = { ...TEMPLATES.find(item => item.id === id), collection: 'templates' };
    library().props.onSelect({ template: id, ...item.defaults }, item);
  };
  const choose = files => find(node => node.type === 'input' && node.props.type === 'file').props.onChange({ target: { files, value: 'chosen' } });
  const submit = () => find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  const fileNames = () => nodes(render()).filter(node => node.type.name === 'FilePreview').map(node => node.props.file.name);
  return { project, render, find, button, library, select, choose, submit, fileNames, uploads, creations, closes: () => closes };
}
const file = (name, size = 100) => ({ name, size });

test('carousel selection, photo order and removal stay private until one validated creation', async () => {
  const h = harness({ project: validateProject(demoProject()) });
  const original = structuredClone(h.project);
  assert(h.library());
  h.select('depth');
  assert.equal(h.button('Create carousel').props.disabled, true);
  await h.submit();
  assert.equal(h.creations.length, 0);
  h.choose([file('one.PNG'), file('two.svg'), file('three.mp4')]);
  h.button('Move photo 1 later').props.onClick();
  h.button('Remove photo 3: three.mp4').props.onClick();
  assert.deepEqual(h.fileNames(), ['two.svg', 'one.PNG']);
  assert.equal(h.uploads.length, 0);
  assert.equal(h.creations.length, 0);
  assert.deepEqual(h.project, original);
  await h.submit();
  assert.equal(h.creations.length, 1);
  assert.equal(h.creations[0].template, 'depth');
  assert.deepEqual(Array.from(h.creations[0].images, image => image.name), ['two.svg', 'one.PNG']);
  assert.equal(h.closes(), 1);
  assert.deepEqual(h.project, original);
});

test('returning to the library keeps photos and order while starting the next preset from its defaults', async () => {
  const h = harness();
  h.select('stack-shuffle');
  h.choose([file('a.png'), file('b.png')]);
  h.button('Move photo 1 later').props.onClick();
  h.button('Change carousel').props.onClick();
  h.select('horizontal');
  assert.deepEqual(h.fileNames(), ['b.png', 'a.png']);
  await h.submit();
  assert.equal(h.creations[0].template, 'horizontal');
  assert.equal(h.creations[0].cardCount, 0);
  assert.equal(h.creations[0].size, demoProject().layers.find(layer => layer.type === 'carousel').size);
});

test('cancelling either step creates no layer and uploads no files', () => {
  const first = harness();
  first.library().props.onClose();
  const second = harness();
  second.select();
  second.choose([file('a.png')]);
  second.button('Cancel').props.onClick();
  for (const h of [first, second]) {
    assert.equal(h.closes(), 1);
    assert.equal(h.uploads.length, 0);
    assert.equal(h.creations.length, 0);
    assert.equal(h.project.layers.length, 0);
  }
});

test('invalid, oversized and excessive files preserve the valid photo selection', () => {
  const h = harness(); h.select(); h.choose([file('good.png')]);
  for (const invalid of [[file('audio.mp3')], [file('large.mp4', 75e6 + 1)], Array(24).fill(file('extra.png'))]) {
    h.choose(invalid);
    assert(h.find(node => node.props.role === 'alert'));
    assert.deepEqual(h.fileNames(), ['good.png']);
  }
  assert.equal(h.uploads.length, 0);
  assert.equal(h.creations.length, 0);
});

test('pending creation blocks duplicate submission, back navigation, removal and dismissal', async () => {
  let finish;
  const h = harness({ upload: () => new Promise(resolve => { finish = resolve; }) });
  h.select(); h.choose([file('a.png')]);
  const pending = h.submit();
  h.button('Cancel').props.onClick();
  h.button('Cancel carousel creation').props.onClick();
  h.render().props.onClose();
  h.button('Change carousel').props.onClick();
  h.button('Remove photo 1: a.png').props.onClick();
  await h.submit();
  assert.equal(h.closes(), 0);
  assert.equal(h.uploads.length, 1);
  assert.equal(h.creations.length, 0);
  assert.deepEqual(h.fileNames(), ['a.png']);
  assert.equal(h.button('Creating…').props.disabled, true);
  finish([{ id: 'a', name: 'a.png', src: '/demo/poster-1.svg' }]);
  await pending;
  assert.equal(h.creations.length, 1);
  assert.equal(h.closes(), 1);
});

test('upload failure retains photos; retry reuses successful uploads after reordering', async () => {
  let attempts = 0;
  const h = harness({ upload: async files => {
    if (++attempts === 2) throw new Error('Invalid image file.');
    return [{ id: files[0].name, name: files[0].name, src: '/demo/poster-1.svg' }];
  } });
  h.select(); h.choose([file('a.png'), file('b.png')]);
  await h.submit();
  assert.equal(h.creations.length, 0);
  assert.equal(h.closes(), 0);
  assert.equal(h.find(node => node.props.role === 'alert').children[0], 'Invalid image file.');
  h.button('Move photo 1 later').props.onClick();
  await h.submit();
  assert.equal(h.uploads.length, 3);
  assert.deepEqual(Array.from(h.creations[0].images, image => image.name), ['b.png', 'a.png']);
});

test('failed creation keeps the draft and uploaded assets for retry', async () => {
  let attempts = 0;
  const h = harness({ create: async () => ++attempts > 1 });
  h.select(); h.choose([file('a.png')]);
  await h.submit();
  assert.equal(h.closes(), 0);
  assert(h.find(node => node.props.role === 'alert'));
  await h.submit();
  assert.equal(h.uploads.length, 1);
  assert.equal(h.closes(), 1);
});

test('the shared library selects for creation and still applies existing presets without changing their photos', () => {
  const layer = validateProject(demoProject()).layers.find(layer => layer.type === 'carousel');
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    X() {}, Modal() {}, IconButton() {}, MotionPreview() {}, TEMPLATES, CATALOG, DEFAULT_MOTION, motionBaseline,
    useId: () => 'library', useEffect() {}, useMemo: fn => fn(),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}]
  };
  vm.createContext(context); vm.runInContext(browserCompiled + '\nthis.component = PresetBrowser;', context);
  for (const selecting of [false, true]) {
    let closes = 0, patch, chosen;
    const props = { layer, onClose() { closes++; }, onApply(value) { patch = value; } };
    if (selecting) props.onSelect = (value, item) => { patch = value; chosen = item; };
    const tree = context.component(props);
    const button = nodes(tree).find(node => node.props['aria-label'] === `${selecting ? 'Select carousel' : 'Apply preset'}: Window Push (Window Push)`);
    button.props.onClick();
    assert.equal(patch.template, 'window-push');
    assert.equal(closes, selecting ? 0 : 1);
    if (selecting) assert.equal(chosen.id, 'window-push');
    const project = validateProject(demoProject());
    const changed = patchLayer(project, layer.id, patch);
    assert.deepEqual(changed.images, project.images);
  }
});

test('Add layer enters carousel selection without calling the creation action', () => {
  const slots = []; let cursor = 0, adds = 0, closes = 0;
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    DotsNine() {}, ImageSquare() {}, Images() {}, Plus() {}, Sparkle() {}, TextT() {}, UploadSimple() {}, X() {}, Modal() {}, IconButton() {}, CarouselCreationDialog() {},
    useState(initial) { const i = cursor++; slots[i] ??= initial; return [slots[i], next => { slots[i] = next; }]; }
  };
  vm.createContext(context); vm.runInContext(addCompiled + '\nthis.component = AddLayerDialog;', context);
  const render = () => { cursor = 0; return context.component({ project: blankProject(), onClose() { closes++; }, onAddLayer() { adds++; } }); };
  nodes(render()).find(node => node.props['aria-label'] === 'Add carousel').props.onClick();
  assert.equal(render().type.name, 'CarouselCreationDialog');
  assert.equal(adds, 0);
  assert.equal(closes, 0);
});

test('confirmed carousel is appended with its preset and photos as one edit using the latest project', () => {
  const projectRef = { current: validateProject(demoProject()) };
  const original = structuredClone(projectRef.current);
  let selected, tab, edits = 0;
  const context = { useCallback: fn => fn, crypto: { randomUUID: () => 'new-carousel' }, demoProject };
  vm.createContext(context); vm.runInContext(actionsCompiled + '\nthis.actions = useCompositionActions;', context);
  const actions = context.actions({ project: original, projectRef, change(next) { projectRef.current = validateProject(next); edits++; return projectRef.current; }, setSelected(id) { selected = id; }, setLeftTab(value) { tab = value; } });
  const chosen = { ...original.layers.find(layer => layer.type === 'carousel'), template: 'depth', images: [original.images[1], original.images[0]], id: 'carousel-draft' };
  assert.equal(actions.addLayer('carousel', chosen), true);
  const added = projectRef.current.layers.at(-1);
  assert.equal(edits, 1);
  assert.equal(selected, 'new-carousel'); assert.equal(tab, 'layers');
  assert.equal(added.template, 'depth');
  assert.deepEqual(added.images, chosen.images);
  assert.deepEqual(projectRef.current.layers.slice(0, -1), original.layers);
  projectRef.current.layers = Array(20).fill(original.layers[0]);
  assert.equal(actions.addLayer('carousel', chosen), false);
  assert.equal(edits, 1);
});
