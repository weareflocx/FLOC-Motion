import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { FORMATS, FORMAT_LABELS } from '../src/project.js';

const source = fs.readFileSync(new URL('../src/editor/components/NewCompositionDialog.jsx', import.meta.url), 'utf8');
const compiled = (await transform(source.replace(/^import .*;\n/gm, '').replace('export function', 'function'), { loader: 'jsx' })).code;
function dialog({ upload = async files => files.map(file => ({ name: file.name, src: '/demo/poster-1.svg' })), create = async () => {}, open = async () => true } = {}) {
  const slots = [], uploads = [], submissions = [], opened = [];
  let cursor = 0, closes = 0;
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    Modal() {}, IconButton() {}, SavedTemplates() {}, UploadSimple() {}, X() {}, FORMATS, FORMAT_LABELS,
    useId: () => 'new-composition',
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) { const i = cursor++; slots[i] ??= { value }; return [slots[i].value, next => { slots[i].value = next; }]; },
    async uploadAssets(files) { uploads.push(files); return upload(files); }
  };
  vm.createContext(context);
  vm.runInContext(compiled + '\nthis.component = NewCompositionDialog;', context);
  const nodes = node => [node, ...(node?.children || []).flat(Infinity).flatMap(child => child && typeof child === 'object' ? nodes(child) : [])];
  const text = node => (node.children || []).flat(Infinity).map(child => typeof child === 'object' ? text(child) : child ?? '').join('');
  const render = () => { cursor = 0; return context.component({ onClose() { closes++; }, async onOpen(entry) { opened.push(entry); return open(entry); }, async onCreate(name, options) { submissions.push({ name, options }); return create(name, options); } }); };
  const find = predicate => nodes(render()).find(predicate);
  const button = label => find(node => node.type === 'button' && text(node) === label || node.props.label === label);
  const choose = files => find(node => node.type === 'input' && node.props.type === 'file').props.onChange({ target: { files, value: 'chosen' } });
  const submit = () => find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  const switchTab = value => find(node => node.props.type === 'radio' && node.props.value === value).props.onChange();
  const select = entry => find(node => node.type.name === 'SavedTemplates').props.onSelect(entry);
  return { render, find, button, choose, submit, switchTab, select, uploads, submissions, opened, closes: () => closes };
}

test('format and file selection stay local until creation; removing a file controls the upload', async () => {
  const h = dialog();
  h.find(node => node.props.type === 'radio' && node.props.value === 'portrait').props.onChange();
  h.choose([{ name: 'image.png', size: 10 }, { name: 'music.wav', size: 10 }]);
  assert.equal(h.uploads.length, 0);
  assert.equal(h.submissions.length, 0);
  h.button('Remove file 1: image.png').props.onClick();
  await h.submit();
  assert.equal(h.uploads.length, 1);
  assert.equal(h.uploads[0][0].name, 'music.wav');
  assert.equal(h.submissions[0].options.format, 'portrait');
  assert.equal(h.submissions[0].options.assets.length, 1);
  assert.equal(h.closes(), 1);
});

test('empty creation uses square and cancel sends no upload or creation request', async () => {
  const h = dialog();
  await h.submit();
  assert.equal(h.submissions[0].options.format, 'square');
  assert.equal(h.submissions[0].options.assets.length, 0);
  const cancelled = dialog();
  cancelled.choose([{ name: 'clip.mp4', size: 20 }]);
  cancelled.button('Cancel').props.onClick();
  assert.equal(cancelled.closes(), 1);
  assert.equal(cancelled.uploads.length, 0);
  assert.equal(cancelled.submissions.length, 0);
});

test('unsupported, oversized and excessive selections are rejected without replacing valid files', () => {
  const h = dialog();
  h.choose([{ name: 'good.PNG', size: 75e6 }]);
  for (const files of [[{ name: 'bad.pdf', size: 10 }], [{ name: 'large.mp4', size: 75e6 + 1 }], Array(20).fill({ name: 'extra.png', size: 10 })]) {
    h.choose(files);
    assert(h.find(node => node.props.role === 'alert'));
    assert(h.button('Remove file 1: good.PNG'));
    assert.equal(h.uploads.length, 0);
  }
});

test('upload blocks dismissal and duplicate submission, and a failed creation reuses uploaded assets', async () => {
  let finish, attempts = 0;
  const h = dialog({ upload: () => new Promise(resolve => { finish = resolve; }), create: async () => { if (++attempts === 1) throw new Error('Save conflict'); } });
  h.choose([{ name: 'card.svg', size: 10 }]);
  const pending = h.submit();
  assert.equal(h.button('Cancel').props.disabled, true);
  h.button('Cancel').props.onClick();
  h.render().props.onClose();
  await h.submit();
  assert.equal(h.closes(), 0);
  assert.equal(h.submissions.length, 0);
  finish([{ name: 'card.svg', src: '/demo/poster-1.svg' }]);
  await pending;
  assert.equal(h.find(node => node.props.role === 'alert').children[0], 'Save conflict');
  assert.equal(h.button('Cancel').props.disabled, false);
  await h.submit();
  assert.equal(h.uploads.length, 1);
  assert.equal(h.submissions.length, 2);
  assert.equal(h.closes(), 1);
});

test('failed upload retains the dialog and files, and never creates a composition', async () => {
  const h = dialog({ upload: async () => { throw new Error('Invalid image file.'); } });
  h.choose([{ name: 'broken.png', size: 10 }]);
  await h.submit();
  assert.equal(h.find(node => node.props.role === 'alert').children[0], 'Invalid image file.');
  assert(h.button('Remove file 1: broken.png'));
  assert.equal(h.submissions.length, 0);
  assert.equal(h.closes(), 0);
});

test('switching tabs preserves the new composition draft and only opens an explicitly selected composition', async () => {
  const h = dialog();
  h.find(node => node.type === 'input' && node.props.maxLength === 100).props.onChange({ target: { value: 'My new composition' } });
  h.find(node => node.props.type === 'radio' && node.props.value === 'landscape').props.onChange();
  h.choose([{ name: 'clip.mp4', size: 20 }]);
  h.switchTab('compositions');
  assert.equal(h.button('Open composition').props.disabled, true);
  await h.submit();
  assert.equal(h.opened.length, 0);
  const entry = { id: 'saved', name: 'Saved composition' };
  h.select(entry);
  assert.equal(h.opened.length, 0);
  h.switchTab('aspect');
  assert.equal(h.find(node => node.type === 'input' && node.props.maxLength === 100).props.value, 'My new composition');
  assert.equal(h.find(node => node.props.type === 'radio' && node.props.value === 'landscape').props.checked, true);
  assert(h.button('Remove file 1: clip.mp4'));
  h.switchTab('compositions');
  await h.submit();
  assert.equal(h.opened[0], entry);
  assert.equal(h.submissions.length, 0);
  assert.equal(h.uploads.length, 0);
  assert.equal(h.closes(), 1);
});

test('opening blocks tab changes and dismissal, and a failure retains the selection for retry', async () => {
  let fail;
  const h = dialog({ open: () => new Promise((resolve, reject) => { fail = reject; }) });
  h.switchTab('compositions');
  h.select({ id: 'saved' });
  const pending = h.submit();
  h.switchTab('aspect');
  assert.equal(h.button('Opening…').props.disabled, true);
  h.button('Cancel').props.onClick();
  h.render().props.onClose();
  await h.submit();
  assert.equal(h.opened.length, 1);
  assert.equal(h.closes(), 0);
  fail(new Error('Save conflict'));
  await pending;
  assert.equal(h.find(node => node.props.role === 'alert').children[0], 'Save conflict');
  assert.equal(h.button('Open composition').props.disabled, false);
});
