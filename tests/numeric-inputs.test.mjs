import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { DEFAULT_NUDGE, loadNudge, saveNudge, nudgeAmount } from '../src/editor/nudge.js';
import { nudgePlacement } from '../src/editor-controls.js';

const source = readFileSync(new URL('../src/editor/controls.jsx', import.meta.url), 'utf8');
const compiled = (await transform(source.replace(/^import .*;\n/gm, '').replaceAll('export function', 'function'), { loader: 'jsx' })).code;

function control(props) {
  const slots = [], changes = [];
  let cursor = 0;
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: initial }; return [slots[index].value, value => { slots[index].value = value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; }, useEffect() {}
  };
  vm.createContext(context);
  vm.runInContext(compiled + '\nthis.input = IntegerInput; this.range = Range;', context);
  const render = () => { cursor = 0; return context.input({ ariaLabel: 'Value', value: 8, min: -100, max: 100, ...props, onChange(value) { changes.push(value); props = { ...props, value }; } }); };
  const input = () => render().children.find(node => node?.type === 'input');
  const edit = value => input().props.onChange({ target: { value } });
  const key = key => input().props.onKeyDown({ key, currentTarget: { value: input().props.value }, preventDefault() {}, stopPropagation() {} });
  const blur = () => input().props.onBlur({ currentTarget: { value: input().props.value } });
  return { input, edit, key, blur, changes, context };
}

test('manual integer edits keep incomplete drafts private and commit once on Enter or blur', () => {
  const h = control({});
  h.edit(''); h.blur();
  assert.deepEqual(h.changes, []);
  assert.equal(h.input().props['aria-invalid'], true);
  h.edit('-'); assert.deepEqual(h.changes, []);
  h.edit('-12'); h.key('Enter'); h.blur();
  assert.deepEqual(h.changes, [-12]);
  h.edit('19'); h.blur();
  assert.deepEqual(h.changes, [-12, 19]);
  h.edit('32'); h.key('Escape'); h.blur();
  assert.equal(h.input().props.value, '19');
  assert.deepEqual(h.changes, [-12, 19]);
});

test('decimals, out of range values and nonfinite text never reach the project', () => {
  const h = control({ min: 2, max: 500 });
  for (const text of ['0', '-0', '501', '2.5', '2,5', 'Infinity', '1e2']) {
    h.edit(text); h.key('Enter');
    assert.equal(h.input().props['aria-invalid'], true);
  }
  assert.deepEqual(h.changes, []);
  h.edit('125'); h.key('Enter');
  assert.deepEqual(h.changes, [125]);
});

test('integer milliseconds and percentages preserve precision until an intentional edit', () => {
  const time = control({ value: 0.349999994, min: 0, max: 30, scale: 1000, suffix: 'ms' });
  assert.equal(time.input().props.value, '350');
  time.blur(); assert.deepEqual(time.changes, []);
  time.edit('275'); time.key('Enter');
  assert.deepEqual(time.changes, [0.275]);
  const percent = control({ value: 1.25, min: .5, max: 2.5, scale: 100 });
  assert.equal(percent.input().props.value, '125');
  percent.edit('175'); percent.blur();
  assert.deepEqual(percent.changes, [1.75]);
});

test('negative values close to zero display as zero and explicit negative zero is normalized', () => {
  const h = control({ value: -0.1 });
  assert.equal(h.input().props.value, '0');
  h.edit('-0'); h.key('Enter');
  assert.equal(h.changes[0], 0);
  assert.equal(Object.is(h.changes[0], -0), false);
});

test('sliders use the same integer units as manual entry', () => {
  const h = control({});
  const changes = [];
  const tree = h.context.range({ label: 'Scale', value: 1.25, min: .5, max: 2.5, step: .05, onChange: value => changes.push(value) });
  const slider = tree.children.find(node => node?.type === 'input');
  assert.equal(slider.props.value, 125);
  assert.equal(slider.props.step, 1);
  slider.props.onChange({ target: { value: '150' } });
  assert.deepEqual(changes, [1.5]);
});

test('nudge settings persist valid integers and control movement in canvas pixels', () => {
  const prior = globalThis.localStorage;
  let saved = null;
  globalThis.localStorage = { getItem: () => saved, setItem: (key, value) => { saved = value; } };
  try {
    assert.deepEqual(loadNudge(), DEFAULT_NUDGE);
    saveNudge({ small: 3, big: 12 });
    const settings = loadNudge();
    assert.equal(nudgeAmount(settings), 3);
    assert.equal(nudgeAmount(settings, true), 12);
    const position = nudgePlacement({ x: 20, y: 20 }, 1, 0, [1000, 1000], { width: 10, height: 10 }, nudgeAmount(settings, true));
    assert.equal(position.x, 21.2);
    saveNudge({ small: 0.5, big: 12 });
    assert.deepEqual(loadNudge(), settings);
    saved = '{"small":0,"big":8}';
    assert.deepEqual(loadNudge(), DEFAULT_NUDGE);
    saved = 'broken JSON';
    assert.deepEqual(loadNudge(), DEFAULT_NUDGE);
  } finally {
    if (prior === undefined) delete globalThis.localStorage; else globalThis.localStorage = prior;
  }
});
