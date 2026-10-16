import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as projectApi from '../src/project.js';
import * as sceneSettings from '../src/scene-settings.js';
import * as modelStyle from '../src/model-style.js';
import * as modelMetadata from '../src/model-metadata.js';
import { MOTION_VARIANTS } from '../src/carousel-motion.js';
import { DEFAULT_LAYOUT } from '../src/layout.js';

const files = [
  '../src/editor/controls.jsx',
  '../src/editor/OrientationControl.jsx',
  '../src/editor/components/SpatialControls.jsx',
  '../src/editor/components/ProjectControls.jsx',
  '../src/editor/components/ModelControls.jsx',
  '../src/editor/components/InspectorPanel.jsx'
];
const compiled = (await Promise.all(files.map(async file => {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  return (await transform(source.replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), { loader: 'jsx' })).code;
}))).join('\n');
const plain = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const project = projectApi.demoProject();
  project.layers.push(projectApi.fileLayer({ name: 'Photo', src: '/demo/poster-1.svg' }, project.duration, 'photo'));
  project.layers.push(projectApi.fileLayer({ name: 'Model', src: '/assets/12345678-1234-1234-1234-123456789012.glb' }, project.duration, 'model'));
  return projectApi.validateProject(project);
}

function inspector(initial, selected = null) {
  let project = initial;
  const changes = [];
  const context = {
    ...projectApi, ...sceneSettings, ...modelStyle, ...modelMetadata, MOTION_VARIANTS, DEFAULT_LAYOUT,
    // Preserve the real validation boundary across the harness's VM realm.
    patchScene: (value, patch) => projectApi.patchScene(value, plain(patch)),
    React: { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) },
    createContext: value => ({ value, Provider: 'provider' }), useContext: value => value.value,
    useState: value => [value, () => {}], useRef: value => ({ current: value }), useEffect() {},
    useCallback: callback => callback, useSyncExternalStore: (subscribe, snapshot) => snapshot(),
    Images: 'icon',
    EffectControls: ({ children }) => children
  };
  for (const name of ['FontControls', 'PresetBrowser', 'MotionControls', 'LayerFadeControls', 'TemplateFieldControls', 'BackgroundControls', 'TextRevealControls', 'TypographyControls', 'SelectionSummary', 'LayerHeader', 'CardList', 'ModelMotionControls', 'FormatVersionsControls', 'LayoutControls']) context[name] = () => null;
  vm.createContext(context);
  vm.runInContext(compiled + '\nthis.inspector = InspectorPanel;', context);
  function nodes(node, blocked = false, section = null) {
    if (Array.isArray(node)) return node.flatMap(child => nodes(child, blocked, section));
    if (!node || typeof node !== 'object') return [];
    if (typeof node.type === 'function') return nodes(node.type({ ...node.props, children: node.children }), blocked, node.type.name === 'Section' ? node.props.title : section);
    const disabled = blocked || node.props.disabled === true;
    return [{ ...node, blocked: disabled, section }, ...nodes(node.children, disabled, section)];
  }
  const onChangeProject = next => { changes.push(next); project = next; };
  const render = () => nodes(context.inspector({
    project, layer: selected ? project.layers.find(layer => layer.id === selected) : null, rightTab: 'composition',
    settings: { project, onChangeProject, onChangeDuration() {}, onChangeFps() {} },
    onPatch(id, patch) { onChangeProject(projectApi.patchLayer(project, id, plain(patch))); },
    cards: { onMove() {}, onRemove() {}, onAddAsset() {} }, onPick() {}, onRemoveText() {}, onSetRightTab() {}
  }));
  const input = label => render().find(node => ['input', 'select'].includes(node.type) && node.props['aria-label'] === label);
  return {
    render, input, changes,
    get project() { return project; },
    get layer() { return project.layers.find(layer => layer.id === selected); },
    change(label, value) {
      const node = input(label);
      assert.ok(node, label);
      assert.equal(node.blocked, false, `${label} is editable`);
      node.props.onChange({ target: { value: String(value) } });
      if (node.props.type === 'text') node.props.onBlur({ currentTarget: { value: String(value) } });
    },
    click(label) {
      const text = node => (node.children ?? []).flat(Infinity).map(child => child && typeof child === 'object' ? text(child) : child ?? '').join('');
      const node = render().find(node => node.type === 'button' && text(node) === label);
      assert.ok(node, label);
      assert.equal(node.blocked, false);
      node.props.onClick();
    }
  };
}

test('the no-selection inspector persists the output camera through canonical project edits', () => {
  const before = fixture();
  const h = inspector(before);
  assert.equal(h.input('Projection').props.value, 'orthographic');
  assert.equal(h.input('Perspective'), undefined);
  h.change('Projection', 'perspective');
  h.change('Perspective', 52);
  h.change('Camera zoom', 175);
  h.change('Camera yaw', -35);
  h.change('Camera pitch', 20);
  h.change('Camera roll', 12);
  h.change('Target X', '42.5');
  h.change('Target Y', '61.2');
  h.change('Target Z', '-30.5');
  const camera = { projection: 'perspective', perspective: 52, zoom: 1.75, yaw: -35, pitch: 20, roll: 12, targetX: 42.5, targetY: 61.2, targetZ: -30.5 };
  assert.deepEqual(projectApi.validateProject(plain(h.project)).scene.camera, camera);
  assert.deepEqual(h.project.layers, before.layers, 'output camera edits do not rewrite layer framing');
  h.change('Projection', 'orthographic');
  assert.equal(h.input('Perspective'), undefined);
  assert.equal(h.project.scene.camera.perspective, 52, 'orthographic keeps the perspective lens for switching back');
  h.change('Projection', 'perspective');
  assert.equal(h.input('Perspective').props.value, 52);
  assert.throws(() => h.change('Projection', 'invalid'), /projection/i);
  assert.equal(h.project.scene.camera.projection, 'perspective');
});

test('every visual type changes presentation and fractional depth inside Transform without changing authored placement', () => {
  const project = fixture();
  for (const type of sceneSettings.SPATIAL_LAYER_TYPES) {
    const layer = project.layers.find(layer => layer.type === type);
    const h = inspector(projectApi.patchLayer(project, layer.id, { space: 'flat' }), layer.id);
    const before = structuredClone(h.layer);
    assert.equal(h.input('Presentation').section, 'Transform');
    assert.equal(h.input('Depth').section, 'Transform');
    assert.equal(h.input('Presentation').props.value, 'flat');
    h.change('Presentation', 'spatial');
    h.change('Depth', '-42.5');
    assert.equal(h.layer.space, 'spatial', type);
    assert.equal(h.layer.z, -42.5, type);
    assert.deepEqual([h.layer.x, h.layer.y, h.layer.size], [before.x, before.y, before.size], type);
    const count = h.changes.length;
    h.change('Depth', '1000.1');
    assert.equal(h.changes.length, count, 'out-of-range depth is not committed');
    h.change('Depth', '125.5');
    h.change('Presentation', 'flat');
    assert.equal(h.layer.z, 125.5, 'switching presentation retains authored depth');
    assert.equal(h.layer.space, 'flat');
  }
});

test('graphic planes expose tilt and yaw only in Spatial and retain them when Flat rotation resets', () => {
  const project = fixture();
  for (const type of ['text', 'logo', 'media']) {
    const layer = project.layers.find(layer => layer.type === type);
    const h = inspector(projectApi.patchLayer(project, layer.id, { space: 'flat' }), layer.id);
    assert.equal(h.input('Orientation X (°)'), undefined);
    assert.equal(h.input('Orientation Y (°)'), undefined);
    h.change('Presentation', 'spatial');
    h.change('Orientation X (°)', '35');
    h.change('Orientation Y (°)', '-48');
    h.change('Orientation Z (°)', '19');
    h.change('Presentation', 'flat');
    assert.equal(h.input('Orientation X (°)'), undefined);
    assert.equal(h.input('Orientation Y (°)'), undefined);
    h.click('Reset rotation');
    assert.deepEqual([h.layer.tilt, h.layer.yaw, h.layer.roll], [35, -48, 0]);
    h.change('Presentation', 'spatial');
    assert.equal(h.input('Orientation X (°)').props.value, '35');
    assert.equal(h.input('Orientation Y (°)').props.value, '-48');
  }
});

test('model Object framing and zoom stay usable in both presentations while local lenses are Flat-only', () => {
  const project = fixture();
  const h = inspector(projectApi.patchLayer(project, 'model', { space: 'flat', modelStyle: { framing: 'fixed', zoom: 1.4, perspective: 57, motion: 'rock' } }), 'model');
  assert.equal(h.input('Framing').section, 'Object framing');
  assert.equal(h.input('Zoom').section, 'Object framing');
  assert.equal(h.input('Perspective').props.value, 57);
  h.change('Presentation', 'spatial');
  assert.equal(h.input('Perspective'), undefined);
  h.change('Framing', 'fit');
  h.change('Zoom', 180);
  assert.deepEqual([h.layer.modelStyle.framing, h.layer.modelStyle.zoom, h.layer.modelStyle.perspective, h.layer.modelStyle.motion], ['fit', 1.8, 57, 'rock']);
  h.change('Presentation', 'flat');
  assert.equal(h.input('Perspective').props.value, 57);
  h.change('Perspective', 43);
  assert.equal(h.layer.modelStyle.perspective, 43);
  const carousel = inspector(projectApi.patchLayer(project, 'carousel', { space: 'flat', perspective: 61 }), 'carousel');
  carousel.change('Presentation', 'spatial');
  assert.equal(carousel.input('Perspective'), undefined);
  carousel.change('Presentation', 'flat');
  assert.equal(carousel.input('Perspective').props.value, 61);
});

test('spatial controls inherit layer locks and fixed backgrounds and audio have no presentation controls', () => {
  const project = fixture();
  for (const type of sceneSettings.SPATIAL_LAYER_TYPES) {
    const layer = project.layers.find(layer => layer.type === type);
    const h = inspector(projectApi.patchLayer(project, layer.id, { locked: true }), layer.id);
    assert.equal(h.input('Presentation').blocked, true, type);
    assert.equal(h.input('Depth').blocked, true, type);
    assert.throws(() => h.input('Presentation').props.onChange({ target: { value: 'flat' } }), /Unlock/);
  }
  for (const id of ['background', 'music']) {
    const h = inspector(project, id);
    assert.equal(h.input('Presentation'), undefined);
    assert.equal(h.input('Depth'), undefined);
  }
});
