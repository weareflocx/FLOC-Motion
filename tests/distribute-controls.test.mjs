import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as distributeOps from '../src/editor/distribute.js';
import * as selectionOps from '../src/editor/selection.js';
import { demoProject, validateProject } from '../src/project.js';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const compile = async paths => (await Promise.all(paths.map(path => transform(source(path), { loader: 'jsx' })))).map(result => result.code).join('\n');

// A small hook runtime: state slots, refs, and effects that run after each render
// with dependency comparison and cleanup, like React's.
function runtime(hook) {
  const slots = []; let cursor = 0, pending = [];
  const hooks = {
    useState(init) { const i = cursor++; if (!(i in slots)) slots[i] = typeof init === 'function' ? init() : init; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(init) { const i = cursor++; return slots[i] ??= { current: init }; },
    useCallback: fn => fn, useMemo: fn => fn(),
    useEffect(fn, deps) {
      const i = cursor++, previous = slots[i];
      if (previous && deps && deps.every((dep, k) => Object.is(dep, previous.deps[k]))) return;
      pending.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
    }
  };
  return {
    hooks,
    render(props) { cursor = 0; const value = hook(props); const effects = pending; pending = []; effects.forEach(run => run()); return value; },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); }
  };
}

async function distribution() {
  const code = await compile(['../src/editor/useDistribution.js']);
  const listeners = new Map(), clockListeners = new Set();
  const window = { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); } };
  let playing = false;
  const clock = { get: () => ({ time: 1, playing }), subscribe(fn) { clockListeners.add(fn); return () => clockListeners.delete(fn); } };
  const context = { ...distributeOps, ...selectionOps, window, document: {} };
  let hookRuntime;
  context.useState = (...args) => hookRuntime.hooks.useState(...args);
  for (const name of ['useRef', 'useCallback', 'useMemo', 'useEffect']) context[name] = (...args) => hookRuntime.hooks[name](...args);
  vm.createContext(context);
  vm.runInContext(`${code}\nthis.useDistribution = useDistribution;`, context);
  hookRuntime = runtime(context.useDistribution);
  const project = validateProject(demoProject());
  const state = { project, projectRef: { current: project }, selection: ['headline', 'signature', 'logo'], preview: null, previews: [], calls: [], commits: [] };
  const distributeLayers = (settings, ids, time, root, options = {}) => {
    state.calls.push({ settings: structuredClone(settings), ids, time, root, options });
    const snapshot = options.snapshot ?? { project: state.projectRef.current, time, measured: state.calls.length };
    const plan = { layout: settings.layout, fits: true, center: { x: 40, y: 45 }, radius: settings.layout === 'circle' ? settings.circle.radius ?? 18 : null, targets: [], moves: [], excluded: [], snapshot, preview: { layers: { headline: { x: state.calls.length, y: 0 } }, distribution: { layout: settings.layout, center: { x: 40, y: 45 } } } };
    if (options.commit) state.commits.push({ settings: structuredClone(settings), snapshot });
    return plan;
  };
  const render = () => hookRuntime.render({ project: state.projectRef.current, projectRef: state.projectRef, clock, time: 1, selection: state.selection, positionPreview: state.preview,
    previewPosition: value => { state.preview = value; state.previews.push(value); }, distributeLayers, root: () => 'stage-root' });
  return { state, render, listeners, clockListeners, setPlaying(value) { playing = value; clockListeners.forEach(fn => fn()); }, unmount: () => hookRuntime.unmount() };
}

test('picking a layout previews without committing; later edits reuse the first measurement', async () => {
  const h = await distribution();
  let d = h.render();
  assert.equal(d.available, true);
  assert.equal(d.active, false);
  d.change({ layout: 'circle' }); d = h.render();
  assert.equal(d.active, true);
  assert.equal(h.state.preview.distribution.layout, 'circle');
  assert.equal(h.state.calls[0].options.commit, undefined);
  assert.equal(h.state.calls[0].root, 'stage-root');
  d.change({ circle: { radius: 30 } }); d = h.render();
  d.change({ center: { x: 20, y: 70 } }); d = h.render();
  assert.equal(h.state.calls.length, 3);
  assert.equal(h.state.calls[1].options.snapshot, h.state.calls[2].options.snapshot);
  assert.equal(h.state.calls[2].options.snapshot.measured, 1, 'the selection is measured once per preview');
  assert.deepEqual([d.settings.circle.radius, d.settings.center], [30, { x: 20, y: 70 }]);
  assert.equal(d.settings.circle.startAngle, -90, 'layout options merge');
  assert.equal(h.state.commits.length, 0, 'previewing never commits');
});

test('Apply commits once with the previewed measurement and ends the preview', async () => {
  const h = await distribution();
  let d = h.render();
  d.change({ layout: 'line' }); d = h.render();
  d.change({ line: { angle: 45 } }); d = h.render();
  d.apply(); d = h.render();
  assert.equal(h.state.commits.length, 1);
  assert.equal(h.state.commits[0].settings.line.angle, 45);
  assert.equal(h.state.commits[0].snapshot.measured, 1);
  assert.equal(h.state.preview, null);
  assert.equal(d.active, false);
  assert.equal(d.settings.line.angle, 45, 'layout choices persist for the next placement');
  assert.equal(d.settings.center, null, 'the center returns to the selection');
});

test('Cancel restores the canvas and resets the placement center and radius', async () => {
  const h = await distribution();
  let d = h.render();
  d.change({ layout: 'circle' }); d = h.render();
  d.change({ circle: { radius: 40 }, center: { x: 10, y: 10 } }); d = h.render();
  d.cancel(); d = h.render();
  assert.equal(h.state.preview, null);
  assert.equal(d.active, false);
  assert.equal(h.state.commits.length, 0);
  assert.deepEqual([d.settings.center, d.settings.circle.radius, d.settings.layout], [null, null, 'circle']);
});

test('Escape, selection changes, playback and project changes end the preview without committing', async () => {
  const start = async () => { const h = await distribution(); let d = h.render(); d.change({ layout: 'grid' }); d = h.render(); assert.equal(d.active, true); return h; };

  let h = await start();
  let prevented = false;
  h.listeners.get('keydown')({ key: 'Escape', defaultPrevented: true, preventDefault() {} });
  assert.equal(h.render().active, true, 'an Escape a field already handled is ignored');
  h.listeners.get('keydown')({ key: 'Escape', defaultPrevented: false, preventDefault() { prevented = true; } });
  assert.equal(h.render().active, false);
  assert.equal(prevented, true);
  assert.equal(h.state.preview, null);
  assert.equal(h.listeners.has('keydown'), false, 'the Escape listener is removed with the preview');

  h = await start();
  h.state.selection = ['headline', 'logo'];
  h.render();
  assert.equal(h.render().active, false);
  assert.equal(h.state.preview, null);

  h = await start();
  h.setPlaying(true);
  assert.equal(h.render().active, false);
  assert.equal(h.state.preview, null);

  h = await start();
  h.state.projectRef.current = validateProject({ ...h.state.projectRef.current, name: 'Edited elsewhere' });
  h.render();
  assert.equal(h.render().active, false);
  assert.equal(h.state.preview, null);

  h = await start();
  const previews = h.state.previews.length;
  h.state.preview = { id: 'logo', x: 10, y: 10 };
  h.render();
  assert.equal(h.render().active, false, 'another canvas preview replaces the distribution');
  assert.equal(h.state.previews.length, previews, 'the replacing preview is left alone');

  h = await start();
  h.unmount();
  assert.equal(h.state.preview, null, 'unmounting ends the preview');
  for (const run of [h]) assert.equal(run.state.commits.length, 0);
});

test('availability and exclusions follow locked, hidden and off-playhead members', async () => {
  const h = await distribution();
  const layers = h.state.projectRef.current.layers.map(layer => layer.id === 'logo' ? { ...layer, locked: true } : layer.id === 'signature' ? { ...layer, visible: false } : layer);
  h.state.projectRef.current = validateProject({ ...h.state.projectRef.current, layers });
  const d = h.render();
  assert.equal(d.available, false);
  assert.deepEqual(d.excluded.map(item => [item.name, item.reason]), [['Signature', 'hidden'], ['Studio mark', 'locked']]);
});

async function controls() {
  const code = await compile(['../src/editor/controls.jsx', '../src/editor/components/DistributeControls.jsx', '../src/editor/components/SelectionSummary.jsx']);
  const context = {
    ...distributeOps, groupFlagValue: selectionOps.groupFlagValue,
    React: { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) },
    createContext: value => ({ value, Provider: 'provider' }), useContext: value => value.value,
    useState: value => [value, () => {}], useRef: value => ({ current: value }), useEffect() {},
    useSyncExternalStore: (subscribe, snapshot) => snapshot(), ArrangeControls: () => null,
    Copy: 'i', Eye: 'i', EyeSlash: 'i', LockSimple: 'i', LockSimpleOpen: 'i', Trash: 'i'
  };
  vm.createContext(context);
  vm.runInContext(`${code}\nthis.DistributeControls = DistributeControls; this.SelectionSummary = SelectionSummary;`, context);
  const nodes = node => {
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (!node || typeof node !== 'object') return [];
    if (typeof node.type === 'function') return nodes(node.type({ ...node.props, children: node.children }));
    return [node, ...nodes(node.children)];
  };
  const text = node => (Array.isArray(node) ? node : node.children ?? []).flat(Infinity).map(child => child && typeof child === 'object' ? text(child) : child === false || child == null ? '' : String(child)).join('');
  const calls = [];
  const state = (overrides = {}) => ({ available: true, movable: 3, excluded: [], settings: distributeOps.defaultDistribution(), active: false, plan: null,
    change: patch => calls.push(['change', patch]), apply: () => calls.push(['apply']), cancel: () => calls.push(['cancel']), ...overrides });
  const render = overrides => nodes(context.DistributeControls({ distribution: state(overrides) }));
  const labels = tree => tree.filter(node => ['input', 'select'].includes(node.type)).map(node => node.props['aria-label']).filter(label => !label?.endsWith(' value'));
  return { context, nodes, text, calls, state, render, labels };
}

test('the Distribute section shows only the controls of the active layout', async () => {
  const h = await controls();
  const idle = h.render();
  assert.deepEqual(idle.filter(node => node.type === 'button').map(node => [h.text(node), node.props['aria-pressed']]), [['Line', false], ['Grid', false], ['Circle', false], ['Arc', false]]);
  assert.ok(idle.some(node => node.type === 'p' && h.text(node).includes('Pick a layout')));
  assert.deepEqual(h.labels(idle), [], 'no settings before a preview starts');
  const plan = { fits: true, center: { x: 40, y: 45 }, radius: 18 };
  const with_layout = layout => { const settings = { ...distributeOps.defaultDistribution(), layout }; return h.render({ active: true, settings, plan }); };
  const common = ['Distribution order', 'Center X (%)', 'Center Y (%)', undefined];
  assert.deepEqual(h.labels(with_layout('line')), ['Angle', 'Spacing', ...common]);
  assert.deepEqual(h.labels(with_layout('grid')), ['Columns', 'Column gap (%)', 'Row gap (%)', ...common]);
  assert.deepEqual(h.labels(with_layout('circle')), ['Radius', 'First position', 'Distribution orientation', ...common]);
  assert.deepEqual(h.labels(with_layout('arc')), ['Radius', 'Start angle', 'End angle', 'Distribution orientation', ...common]);
  const circle = with_layout('circle');
  assert.equal(circle.find(node => node.props['aria-label'] === 'Radius').props.value, 18, 'the automatic radius is shown');
  assert.equal(circle.find(node => node.type === 'button' && h.text(node) === 'Circle').props['aria-pressed'], true);
  assert.ok(circle.find(node => node.type === 'input' && node.props.type === 'checkbox').props.checked, 'Keep inside safe area is on by default');
  assert.deepEqual(circle.filter(node => node.type === 'button').map(node => h.text(node)).slice(-2), ['Apply', 'Cancel']);
});

test('controls send setting patches; Apply and Cancel call through; notices are listed', async () => {
  const h = await controls();
  const tree = h.render({ active: true, plan: { fits: false, center: { x: 40, y: 45 }, radius: null }, excluded: [{ id: 'logo', name: 'Studio mark', reason: 'locked' }] });
  tree.find(node => node.type === 'button' && h.text(node) === 'Grid').props.onClick();
  tree.find(node => node.props['aria-label'] === 'Angle').props.onChange({ target: { value: '30' } });
  tree.find(node => node.props['aria-label'] === 'Distribution order').props.onChange({ target: { value: 'position' } });
  tree.find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: false } });
  tree.find(node => node.type === 'button' && h.text(node) === 'Apply').props.onClick();
  tree.find(node => node.type === 'button' && h.text(node) === 'Cancel').props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [['change', { layout: 'grid' }], ['change', { line: { angle: 30 } }], ['change', { order: 'position' }], ['change', { safeArea: false }], ['apply'], ['cancel']]);
  const notes = tree.filter(node => node.type === 'p').map(node => h.text(node));
  assert.ok(notes.includes('Larger than the safe area; kept centered in it.'));
  assert.ok(notes.includes('Left in place: Studio mark (locked).'));
  const unavailable = h.render({ available: false, excluded: [{ id: 'logo', name: 'Studio mark', reason: 'hidden' }] });
  assert.deepEqual(unavailable.filter(node => node.type === 'p').map(node => h.text(node)), ['Distribute needs two or more unlocked layers on the canvas.', 'Left in place: Studio mark (hidden).']);
  assert.equal(unavailable.some(node => node.type === 'button'), false);
});

test('the multi-selection summary adds Distribute after Arrange', async () => {
  const h = await controls();
  const layers = validateProject(demoProject()).layers.filter(layer => ['headline', 'logo'].includes(layer.id));
  const tree = h.nodes(h.context.SelectionSummary({ layers, canAlign: true, canDistribute: false, canDuplicate: true, onArrange() {}, distribution: h.state() }));
  assert.deepEqual(tree.filter(node => node.type === 'h3').map(node => h.text(node)), ['Arrange', 'Distribute', 'Selection']);
});
