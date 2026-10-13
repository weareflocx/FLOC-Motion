import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { PROJECT_LIMITS, carouselImages, demoProject, patchTemplateContent, validateProject } from '../src/project.js';
import { contentFields, contentIssues } from '../src/template-content.js';

const source = fs.readFileSync(new URL('../src/editor/components/TemplateContentDialog.jsx', import.meta.url), 'utf8');
const compiled = (await transform(source.replace(/^import .*;\n/gm, '').replace('export function', 'function'), { loader: 'jsx' })).code;

function dialog({ copy = false, upload = async () => [], submit = async () => {}, headline = {} } = {}) {
  const project = validateProject(demoProject());
  for (const [id, label] of [['headline', 'Headline'], ['carousel', 'Gallery'], ['logo', 'Logo'], ['music', 'Soundtrack']]) project.layers.find(layer => layer.id === id).contentField = { id, label, required: false, ...(id === 'headline' ? headline : {}) };
  project.layers.find(layer => layer.id === 'headline').locked = true;
  project.layers.find(layer => layer.id === 'carousel').locked = true;
  const slots = [], submissions = [], uploads = [];
  let cursor = 0, closes = 0;
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    ArrowLeft() {}, ArrowRight() {}, Trash() {}, UploadSimple() {}, X() {}, Modal() {}, IconButton() {}, TemplatePreview() {},
    carouselImages, patchTemplateContent, validateProject, contentFields, contentIssues, PROJECT_LIMITS,
    useId: () => 'dialog-title',
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useState(value) { const index = cursor++; slots[index] ??= { value: typeof value === 'function' ? value() : value }; return [slots[index].value, next => { slots[index].value = next; }]; },
    async uploadAssets(files) { uploads.push(files); return upload(files); }
  };
  vm.createContext(context);
  vm.runInContext(compiled + '\nthis.component = TemplateContentDialog;', context);
  const nodes = node => [node, ...(node?.children || []).flat(Infinity).flatMap(child => child && typeof child === 'object' ? nodes(child) : [])];
  const text = node => (node.children || []).flat(Infinity).map(child => typeof child === 'object' ? text(child) : child ?? '').join('');
  const render = () => {
    cursor = 0;
    const tree = context.component({ project, copy, name: 'My copy', onClose() { closes++; }, async onSubmit(draft, name) { submissions.push({ draft, name }); return submit(draft, name); } });
    for (const node of nodes(tree)) if (node.type === 'input' && node.props.type === 'file') node.props.ref.current = { click() {}, accept: '', multiple: false };
    return tree;
  };
  const find = predicate => nodes(render()).find(predicate);
  const button = label => find(node => node.type === 'button' && text(node) === label || node.props.label === label);
  const fileInput = () => find(node => node.type === 'input' && node.props.type === 'file');
  const form = () => find(node => node.type === 'form');
  return { project, render, find, button, fileInput, form, submissions, uploads, closes: () => closes };
}

test('content edits remain a private draft until a single validated submit', async () => {
  const h = dialog({ copy: true });
  const original = structuredClone(h.project);
  h.find(node => node.type === 'textarea').props.onChange({ target: { value: 'A new headline' } });
  assert.equal(h.find(node => node.type === 'textarea').props.value, 'A new headline');
  assert.deepEqual(h.project, original);
  assert.equal(h.submissions.length, 0);
  await h.form().props.onSubmit({ preventDefault() {} });
  assert.equal(h.submissions.length, 1);
  assert.equal(h.submissions[0].name, 'My copy');
  assert.equal(h.submissions[0].draft.layers.find(layer => layer.id === 'headline').text, 'A new headline');
  assert.equal(h.submissions[0].draft.layers.find(layer => layer.id === 'headline').locked, true);
  assert.deepEqual(h.project, original);
  assert.equal(h.closes(), 1);
});

test('required and over-long fields show markers and counters and block Apply until fixed', async () => {
  const h = dialog({ headline: { required: true, maxLength: 12 } });
  const headlineLabel = () => h.find(node => node.type?.name === 'FieldLabel' && node.props.layer.id === 'headline');
  const issue = () => h.find(node => node.props.className === 'template-content-issue');
  const type = value => h.find(node => node.type === 'textarea').props.onChange({ target: { value } });
  assert.equal(headlineLabel().props.layer.contentField.required, true, 'the label receives the required declaration');
  type('');
  assert.equal(h.button('Apply content').props.disabled, true);
  assert.equal(issue().children[0], 'Headline is required.');
  await h.form().props.onSubmit({ preventDefault() {} });
  assert.equal(h.submissions.length, 0, 'submitting anyway is refused');
  assert.equal(h.find(node => node.props.role === 'alert').children[0], 'Headline is required.');
  type('Thirteen char');
  assert.equal(headlineLabel().props.layer.text.length, 13);
  assert.equal(issue().children[0], 'Headline is longer than 12 characters.');
  assert.equal(h.button('Apply content').props.disabled, true);
  type('Twelve chars');
  assert.equal(issue(), undefined);
  assert.equal(h.button('Apply content').props.disabled, false);
  await h.form().props.onSubmit({ preventDefault() {} });
  assert.equal(h.submissions.length, 1);
  assert.equal(h.submissions[0].draft.layers.find(layer => layer.id === 'headline').text, 'Twelve chars');
});

test('cancel discards content and carousel reorder materializes only that layer', () => {
  const h = dialog();
  h.button('Move card 1 later').props.onClick();
  const preview = h.find(node => node.type.name === 'TemplatePreview');
  const layer = preview.props.project.layers.find(item => item.id === 'carousel');
  assert.equal(layer.images[0].id, h.project.images[1].id);
  assert.equal(layer.images[1].id, h.project.images[0].id);
  assert.deepEqual(preview.props.project.images, h.project.images);
  assert.equal(h.project.layers.find(item => item.id === 'carousel').images, undefined);
  h.button('Cancel').props.onClick();
  assert.equal(h.closes(), 1);
  assert.equal(h.submissions.length, 0);
});

test('carousel upload rejects an oversized selection before sending any file', async () => {
  const h = dialog();
  h.button('Replace cards').props.onClick();
  await h.fileInput().props.onChange({ target: { files: Array.from({ length: PROJECT_LIMITS.maxImages + 1 }, () => ({ name: 'card.png' })), value: 'chosen' } });
  assert.equal(h.uploads.length, 0);
  assert.equal(h.find(node => node.props.role === 'alert').children[0], `Use up to ${PROJECT_LIMITS.maxImages} carousel assets.`);
  assert.equal(h.button('Cancel').props.disabled, false);
});

test('upload gates dismissal and submit, then applies validated replacement cards to the draft', async () => {
  let finish;
  const h = dialog({ upload: () => new Promise(resolve => { finish = resolve; }) });
  h.button('Replace cards').props.onClick();
  const pending = h.fileInput().props.onChange({ target: { files: [{ name: 'new.png' }], value: 'chosen' } });
  h.button('Close content').props.onClick();
  h.render().props.onClose();
  await h.form().props.onSubmit({ preventDefault() {} });
  assert.equal(h.closes(), 0);
  assert.equal(h.submissions.length, 0);
  assert.equal(h.button('Cancel').props.disabled, true);
  finish([{ id: 'new-card', src: '/demo/poster-2.svg', name: 'New card' }]);
  await pending;
  const preview = h.find(node => node.type.name === 'TemplatePreview');
  assert.equal(preview.props.project.layers.find(layer => layer.id === 'carousel').images.length, 1);
  assert.equal(h.project.layers.find(layer => layer.id === 'carousel').images, undefined);
  assert.equal(h.button('Cancel').props.disabled, false);
});

test('submission failure retains draft and error, and submission itself gates dismissal', async () => {
  let finish;
  const h = dialog({ submit: () => new Promise(resolve => { finish = resolve; }) });
  h.find(node => node.type === 'textarea').props.onChange({ target: { value: 'Retained content' } });
  const pending = h.form().props.onSubmit({ preventDefault() {} });
  h.button('Cancel').props.onClick();
  h.button('Close content').props.onClick();
  assert.equal(h.closes(), 0);
  assert.equal(h.button('Applying…').props.disabled, true);
  finish(false);
  await pending;
  assert.equal(h.find(node => node.type === 'textarea').props.value, 'Retained content');
  assert.equal(h.find(node => node.props.role === 'alert').children[0], 'Unable to apply content.');
  assert.equal(h.button('Cancel').props.disabled, false);
});
