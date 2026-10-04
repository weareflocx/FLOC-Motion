import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { FORMATS, FORMAT_LABELS, demoProject, linkFormats, patchLayer, resetFormat, switchFormat, unlinkFormats, validateProject } from '../src/project.js';

const source = fs.readFileSync(new URL('../src/editor/components/FormatVersionsControls.jsx', import.meta.url), 'utf8');
const compiled = (await transform(source.replace(/^import .*;\n/gm, '').replace('export function', 'function'), { loader: 'jsx' })).code;

function controls() {
  let project = validateProject(demoProject());
  const changes = [];
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    Field() {}, FORMATS, FORMAT_LABELS, linkFormats, resetFormat, switchFormat, unlinkFormats
  };
  vm.createContext(context);
  vm.runInContext(compiled + '\nthis.component = FormatVersionsControls;', context);
  const nodes = node => [node, ...(node?.children || []).flat(Infinity).flatMap(child => child && typeof child === 'object' ? nodes(child) : [])];
  const text = node => (node.children || []).flat(Infinity).map(child => typeof child === 'object' ? text(child) : child ?? '').join('');
  const render = () => context.component({ project, onChangeProject(next) { changes.push(next); project = validateProject(next); } });
  const find = predicate => nodes(render()).find(predicate);
  const button = label => find(node => node.type === 'button' && text(node) === label);
  const checkbox = () => find(node => node.type === 'input' && node.props.type === 'checkbox');
  return {
    find, button, checkbox, changes,
    project: () => project,
    select(format) { button(FORMAT_LABELS[format]).props.onClick(); },
    edit(patch) { project = patchLayer(project, 'headline', patch); }
  };
}

test('all five aspect ratios expose selected state and preserve the legacy canvas on switching', () => {
  const h = controls();
  const original = structuredClone(h.project());
  assert.equal(h.find(node => node.props.role === 'group').props['aria-label'], 'Aspect ratio');
  for (const format of Object.keys(FORMATS)) {
    assert.equal(h.button(FORMAT_LABELS[format]).props['aria-pressed'], original.format === format);
  }
  h.select('landscape43');
  assert.equal(h.changes.length, 1);
  assert.deepEqual(h.project(), { ...original, format: 'landscape43' });
  assert.equal(h.button(FORMAT_LABELS.landscape43).props['aria-pressed'], true);
  assert.equal(h.checkbox().props.checked, false);
  assert.equal(h.button('Reset from master'), undefined);
});

test('linked controls preserve a format edit while switching and reset it in one change', () => {
  const h = controls();
  const master = h.project().format;
  h.checkbox().props.onChange({ target: { checked: true } });
  assert.equal(h.changes.length, 1);
  assert.equal(h.project().linkedFormats.master, master);
  assert.equal(h.checkbox().props.checked, true);
  assert.equal(h.find(node => node.type === 'span' && node.children[0] === 'Master · ').children.join(''), `Master · ${FORMAT_LABELS[master]}`);
  assert.equal(h.button('Reset from master').props.disabled, true);
  h.select('landscape');
  const initialX = h.project().layers.find(layer => layer.id === 'headline').x;
  assert.equal(h.button('Reset from master').props.disabled, false);
  h.edit({ x: 73 });
  h.select(master);
  h.edit({ text: 'Shared headline' });
  h.select('landscape');
  assert.equal(h.project().layers.find(layer => layer.id === 'headline').x, 73);
  const beforeReset = h.changes.length;
  h.button('Reset from master').props.onClick();
  assert.equal(h.changes.length, beforeReset + 1);
  assert.equal(h.project().layers.find(layer => layer.id === 'headline').x, initialX);
  assert.equal(h.project().layers.find(layer => layer.id === 'headline').text, 'Shared headline');
});

test('unlink commits the current canvas once and removes version controls', () => {
  const h = controls();
  h.checkbox().props.onChange({ target: { checked: true } });
  h.select('portrait34');
  h.edit({ x: 67 });
  const active = structuredClone(h.project());
  const beforeUnlink = h.changes.length;
  h.checkbox().props.onChange({ target: { checked: false } });
  assert.equal(h.changes.length, beforeUnlink + 1);
  assert.equal(h.project().linkedFormats, undefined);
  assert.equal(h.project().format, active.format);
  assert.deepEqual(h.project().layers, active.layers);
  assert.deepEqual(h.project().layout, active.layout);
  assert.equal(h.checkbox().props.checked, false);
  assert.equal(h.button('Reset from master'), undefined);
});
