import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = fs.readFileSync(new URL('../src/editor/components/VisualAlternativesDialog.jsx', import.meta.url), 'utf8');
const compiled = (await transform(source.replace(/^import .*;\n/gm, '').replace('export function', 'function'), { loader: 'jsx' })).code;

const project = (id, duration = 6) => ({ id, name: id, format: 'square', duration, fps: 30, layers: [] });
const proposal = {
  base: project('base'),
  alternatives: [
    { name: 'Editorial', project: project('editorial') },
    { name: 'Bold', project: project('bold') },
    { name: 'Experimental', project: project('experimental') }
  ]
};

function dialog({ stale = false, apply = async () => true } = {}) {
  const slots = [];
  const previews = [];
  const applications = [];
  const playback = { time: 0.65, playing: false, calls: 0 };
  let cursor = 0;
  let closes = 0;
  const same = (a = [], b = []) => a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    Pause() {}, Play() {}, X() {}, IconButton() {}, Modal() {}, Stage() {},
    FORMAT_LABELS: { square: '1:1' },
    visualAlternativePreview(value) { previews.push(value.id); return { ...value, preview: true }; },
    useId: () => 'visual-alternatives-title',
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useState(value) {
      const index = cursor++;
      slots[index] ??= { value: typeof value === 'function' ? value() : value };
      return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }];
    },
    useMemo(factory, deps) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: factory(), deps };
      return slots[index].value;
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: callback, deps };
      return slots[index].value;
    },
    useEffect() { cursor++; },
    usePlayback() {
      playback.calls++;
      return {
        time: playback.time,
        playing: playback.playing,
        setTime(value) { playback.time = typeof value === 'function' ? value(playback.time) : value; },
        setPlaying(value) { playback.playing = typeof value === 'function' ? value(playback.playing) : value; }
      };
    }
  };
  vm.createContext(context);
  vm.runInContext(compiled + '\nthis.component = VisualAlternativesDialog;', context);
  const nodes = node => [node, ...(node?.children || []).flat(Infinity).flatMap(child => child && typeof child === 'object' ? nodes(child) : [])];
  const text = node => (node.children || []).flat(Infinity).map(child => typeof child === 'object' ? text(child) : child ?? '').join('');
  const render = () => {
    cursor = 0;
    return context.component({ proposal, stale, onClose() { closes++; }, async onApply(index) { applications.push(index); return apply(index); } });
  };
  const find = predicate => nodes(render()).find(predicate);
  const findAll = predicate => nodes(render()).filter(predicate);
  const button = label => find(node => node.type === 'button' && text(node) === label || node.props.label === label);
  const form = () => find(node => node.type === 'form');
  const stage = () => find(node => node.type === context.Stage);
  return { applications, button, closes: () => closes, context, find, findAll, form, playback, previews, render, stage };
}

test('one live stage previews the selected direction, original, and a shared playback clock', async () => {
  const h = dialog();
  assert.equal(h.findAll(node => node.type === h.context.Stage).length, 1);
  assert.equal(h.stage().props.project.id, 'editorial');
  assert.equal(h.stage().props.project.preview, true);
  assert.equal(h.stage().props.time, 0.65);

  h.stage().props.onReady(true);
  h.button('Play preview').props.onClick();
  assert.equal(h.playback.playing, true);
  const before = h.previews.length;
  assert.equal(h.stage().props.time, 0.65);
  assert.equal(h.previews.length, before);

  h.find(node => node.type === 'input' && node.props.type === 'radio' && node.props.value === 2).props.onChange();
  assert.equal(h.stage().props.project.id, 'experimental');
  assert.equal(h.stage().props.time, 0.65);
  assert.equal(h.button('Apply Experimental').props.disabled, true);
  h.stage().props.onReady(true);
  assert.equal(h.button('Apply Experimental').props.disabled, false);

  h.button('Original').props.onClick();
  assert.equal(h.stage().props.project.id, 'base');
  h.stage().props.onReady(true);
  assert.equal(h.button('Apply Experimental').props.disabled, true);
  assert.equal(h.button('Pause preview').props.disabled, false);
  h.button('Original').props.onClick();
  assert.equal(h.button('Pause preview').props.disabled, false);
  await h.form().props.onSubmit({ preventDefault() {} });
  assert.equal(h.applications.length, 0);
});

test('selection, playback, seeking, and cancel never apply a proposal', () => {
  const h = dialog();
  h.find(node => node.type === 'input' && node.props.type === 'radio' && node.props.value === 1).props.onChange();
  h.stage().props.onReady(true);
  h.button('Play preview').props.onClick();
  h.find(node => node.type === 'input' && node.props['aria-label'] === 'Preview playhead').props.onChange({ target: { value: '2.4' } });
  assert.equal(h.playback.playing, false);
  assert.equal(h.playback.time, 2.4);
  h.button('Cancel').props.onClick();
  assert.deepEqual(h.applications, []);
  assert.equal(h.closes(), 1);
});

test('apply is gated by readiness and remains a single atomic action while pending', async () => {
  let finish;
  const h = dialog({ apply: () => new Promise(resolve => { finish = resolve; }) });
  assert.equal(h.button('Apply Editorial').props.disabled, true);
  h.stage().props.onReady(true);
  const pending = h.form().props.onSubmit({ preventDefault() {} });
  await h.form().props.onSubmit({ preventDefault() {} });
  h.button('Cancel').props.onClick();
  h.button('Close visual alternatives').props.onClick();
  assert.deepEqual(h.applications, [0]);
  assert.equal(h.closes(), 0);
  assert.equal(h.button('Applying…').props.disabled, true);
  finish(true);
  await pending;
  assert.equal(h.closes(), 1);
});

test('failed apply stays open with an alert, while stale proposals cannot apply', async () => {
  const failed = dialog({ apply: async () => { throw new Error('Proposal is no longer available.'); } });
  failed.stage().props.onReady(true);
  await failed.form().props.onSubmit({ preventDefault() {} });
  assert.equal(failed.closes(), 0);
  assert.equal(failed.find(node => node.props.role === 'alert').children[0], 'Proposal is no longer available.');
  assert.equal(failed.button('Apply Editorial').props.disabled, true);

  const stale = dialog({ stale: true });
  stale.stage().props.onReady(true);
  assert.equal(stale.button('Apply Editorial').props.disabled, true);
  await stale.form().props.onSubmit({ preventDefault() {} });
  assert.deepEqual(stale.applications, []);
  assert.equal(stale.find(node => node.props.role === 'alert').children[0], 'The composition changed. Generate new alternatives.');
});
