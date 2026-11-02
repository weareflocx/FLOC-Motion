import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as elementMotion from '../src/element-motion.js';

const compiled = (await Promise.all([
  '../src/editor/controls.jsx',
  '../src/editor/components/ElementMotionControls.jsx',
  '../src/editor/components/InspectorPanel.jsx'
].map(async file => {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  return (await transform(source.replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), { loader: 'jsx' })).code;
}))).join('\n');
const plain = value => JSON.parse(JSON.stringify(value));

function inspector(initial = {}) {
  let layer = { id: 'subject', type: 'text', x: 24, y: 36, size: 80, roll: 17, start: 2, modelStyle: { motion: 'spin', motionSpeed: -2 }, flowStyle: { speed: 3 }, ...initial };
  const patches = [];
  const context = {
    ...elementMotion, TEMPLATES: [], carouselImages: () => [], Images: 'icon',
    React: { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) },
    createContext: value => ({ value, Provider: 'provider' }), useContext: value => value.value,
    useState: value => [value, () => {}], useRef: value => ({ current: value }), useEffect() {},
    useSyncExternalStore: (subscribe, snapshot) => snapshot()
  };
  for (const name of ['LayerHeader', 'MotionControls', 'TextEntryControls', 'TextExitControls', 'ModelControls', 'DataFlowControls', 'LayerFadeControls']) context[name] = () => null;
  vm.createContext(context);
  vm.runInContext(compiled + '\nthis.inspector = InspectorPanel;', context);
  function nodes(node, blocked = false) {
    if (Array.isArray(node)) return node.flatMap(child => nodes(child, blocked));
    if (!node || typeof node !== 'object') return [];
    if (typeof node.type === 'function') return nodes(node.type({ ...node.props, children: node.children }), blocked);
    const disabled = blocked || node.props.disabled === true;
    return [{ ...node, blocked: disabled }, ...nodes(node.children, disabled)];
  }
  const render = () => nodes(context.inspector({
    layer, project: { layers: [layer] }, rightTab: 'animation',
    onPatch(id, patch) { assert.equal(id, layer.id); patches.push(plain(patch)); layer = { ...layer, ...plain(patch) }; }
  }));
  const input = label => render().find(node => ['input', 'select'].includes(node.type) && node.props['aria-label'] === label);
  return {
    render, input, patches,
    get layer() { return layer; },
    change(label, value) {
      const node = input(label);
      assert.ok(node, label);
      assert.equal(node.blocked, false, label);
      node.props.onChange({ target: { value: String(value), checked: value } });
      if (node.props.type === 'text') node.props.onBlur({ currentTarget: { value: String(value) } });
    }
  };
}

test('whole-element operators combine without rewriting authored pose or internal motion', () => {
  for (const type of ['text', 'logo', 'media', 'model', 'dataflow', 'carousel']) {
    const h = inspector({ type });
    const before = plain(h.layer);
    for (const label of ['Float', 'Spin Z', 'Pulse']) h.change(`Enable ${label}`, true);
    h.change('Float axis', 'x');
    h.change('Float distance value', '12.5');
    h.change('Spin Z direction', -1);
    h.change('Pulse amplitude value', 25);
    assert.equal(h.layer.elementMotion.float.amplitude, 12.5);
    assert.equal(h.layer.elementMotion.float.axis, 'x');
    assert.equal(h.layer.elementMotion.spin.direction, -1);
    assert.equal(h.layer.elementMotion.pulse.amplitude, 0.25);
    assert.ok(Object.values(h.layer.elementMotion).every(block => block.enabled));
    const active = plain(h.layer.elementMotion);
    h.change('Enable Float', false);
    assert.deepEqual(h.layer.elementMotion.float, { ...active.float, enabled: false });
    assert.deepEqual(h.layer.elementMotion.spin, active.spin);
    assert.deepEqual(h.layer.elementMotion.pulse, active.pulse);
    assert.equal(h.input('Float distance'), undefined);
    h.change('Enable Float', true);
    assert.deepEqual(h.layer.elementMotion, active);
    assert.deepEqual(Object.fromEntries(Object.entries(h.layer).filter(([key]) => key !== 'elementMotion')), before);
  }
});

test('motion controls map display units and enforce bounds through numeric entry', () => {
  const h = inspector();
  assert.equal(h.patches.length, 0, 'reading defaults never writes a layer setting');
  assert.equal(h.input('Float distance'), undefined);
  for (const label of ['Float', 'Spin Z', 'Pulse']) {
    assert.equal(h.input(`Enable ${label}`).blocked, false);
    h.change(`Enable ${label}`, true);
    h.change(`${label} period value`, 12345);
    h.change(`${label} phase value`, 75);
    h.change(`${label} direction`, 0);
    const block = h.layer.elementMotion[label === 'Spin Z' ? 'spin' : label.toLowerCase()];
    assert.equal(block.duration, 12.345);
    assert.equal(block.phase, 0.75);
    assert.equal(block.direction, 0);
    const count = h.patches.length;
    h.change(`${label} period value`, 99);
    h.change(`${label} phase value`, 101);
    assert.equal(h.patches.length, count, 'out-of-range entries do not emit patches');
  }
  const count = h.patches.length;
  h.change('Float distance value', 25.1);
  h.change('Pulse amplitude value', 51);
  assert.equal(h.patches.length, count);
});

test('unsupported layers expose no element controls and parent locks disable every operator', () => {
  for (const type of ['background', 'effect', 'music']) {
    const h = inspector({ type });
    assert.equal(h.input('Enable Float'), undefined);
    assert.equal(h.render().some(node => node.type === 'h3' && node.children.includes('Continuous')), false);
  }
  const h = inspector({ locked: true });
  for (const label of ['Float', 'Spin Z', 'Pulse']) assert.equal(h.input(`Enable ${label}`).blocked, true);
  assert.equal(h.patches.length, 0);
});
