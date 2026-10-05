import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { carouselImages, demoProject, FORMAT_LABELS } from '../src/project.js';
import { contentFields } from '../src/template-content.js';

const source = fs.readFileSync(new URL('../src/editor/components/SavedTemplates.jsx', import.meta.url), 'utf8');
const compiled = (await transform(source.replace(/^import .*;\n/gm, '').replaceAll('export function', 'function'), { loader: 'jsx' })).code;
async function library({ entries = [], failure, picker = true } = {}) {
  const slots = [], requests = [], selections = [];
  let cursor = 0, pending;
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    Modal() {}, IconButton() {}, X() {}, carouselImages, FORMAT_LABELS, contentFields,
    useId: () => 'library',
    useState(value) { const i = cursor++; slots[i] ??= { value }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; },
    useEffect(fn) { const i = cursor++; if (!slots[i]) { slots[i] = {}; fn(); } },
    request(url, options) { requests.push({ url, options }); return pending = failure ? Promise.reject(new Error(failure)) : Promise.resolve({ templates: entries }); }
  };
  vm.createContext(context);
  vm.runInContext(compiled + '\nthis.component = SavedTemplates;', context);
  const nodes = node => [node, ...(node?.children || []).flat(Infinity).flatMap(child => child && typeof child === 'object' ? nodes(child) : [])];
  const render = (disabled = false) => { cursor = 0; return context.component({ project: demoProject(), picker, disabled, onSelect: entry => selections.push(entry) }); };
  const find = predicate => nodes(render()).find(predicate);
  render();
  await pending.catch(() => {});
  await new Promise(resolve => setImmediate(resolve));
  return { render, find, nodes, requests, selections };
}

test('the embedded library searches names and tags, selects without opening, and has no management actions', async () => {
  const entries = ['First', 'Second'].map((name, index) => ({ id: String(index), name, tags: index ? ['Campaign'] : [], project: demoProject() }));
  const h = await library({ entries });
  assert.equal(h.render().type, 'div');
  assert.equal(h.nodes(h.render()).some(node => node.type === 'form'), false);
  assert.equal(h.nodes(h.render()).filter(node => node.type === 'button').length, 2);
  const search = () => h.find(node => node.props.type === 'search');
  search().props.onChange({ target: { value: 'campaign' } });
  const tile = h.find(node => node.type === 'button');
  assert.equal(tile.props.type, 'button');
  assert.equal(tile.props.key, '1');
  tile.props.onClick();
  assert.equal(h.selections[0], entries[1]);
  assert.equal(h.find(node => node.type === 'button').props['aria-pressed'], true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].options, undefined);
  assert(h.nodes(h.render(true)).filter(node => node.type === 'button').every(node => node.props.disabled));
});

test('empty libraries and loading failures remain visible inside the picker', async () => {
  const empty = await library();
  assert(empty.find(node => node.type === 'h3' && node.children[0] === 'No saved compositions'));
  const failed = await library({ failure: 'Library unavailable' });
  assert.equal(failed.find(node => node.props.role === 'alert').children[0], 'Library unavailable');
});

test('the existing Compositions dialog still exposes its management view', async () => {
  const h = await library({ picker: false, entries: [{ id: 'saved', name: 'Saved', tags: [], project: demoProject() }] });
  assert.equal(h.render().type.name, 'Modal');
  h.find(node => node.props.className?.startsWith('preset-tile ')).props.onClick();
  assert(h.find(node => node.type === 'form'));
  assert(h.find(node => node.type === 'button' && node.children[0] === 'Delete template'));
  assert.equal(h.selections.length, 0);
});
