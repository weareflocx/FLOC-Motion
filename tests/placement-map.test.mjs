import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { demoProject, FORMATS, patchLayer } from '../src/project.js';
import { GRID_POINTS, freePlacement, gridPlacement, nearestGridPoint, nudgePlacement, stepGridPoint } from '../src/editor-controls.js';
import { alignmentPlacement, DEFAULT_LAYOUT, fitsSafeArea, safeArea } from '../src/layout.js';
import { canvasMediaPlacement } from '../src/editor/canvas-resize.js';
import { nudgeAmount } from '../src/editor/nudge.js';
import { fontDefinition } from '../src/fonts.js';
import { textTypography } from '../src/text-style.js';

const source = readFileSync(new URL('../src/placement-map.jsx', import.meta.url), 'utf8');
const compiled = (await transform(source.replace(/^import .*;\n/gm, '').replace('export function', 'function'), { loader: 'jsx' })).code;

function map(project, id, nudge = { small: 3, big: 12 }) {
  const layer = project.layers.find(item => item.id === id), changes = [];
  const frame = { clientWidth: 200, clientHeight: 200 }, element = { offsetHeight: 40 };
  const context = {
    FORMATS, GRID_POINTS, freePlacement, gridPlacement, nearestGridPoint, nudgePlacement, stepGridPoint,
    alignmentPlacement, DEFAULT_LAYOUT, fitsSafeArea, safeArea, canvasMediaPlacement, nudgeAmount, fontDefinition, textTypography,
    NumberField() {}, PlacementGuides() {},
    useState: value => [value, () => {}], useRef: value => ({ current: value }), useEffect() {},
    React: { createElement(type, props, ...children) {
      if (props?.ref && props.className === 'placement-map') props.ref.current = frame;
      if (props?.ref && props['data-map-layer'] === id) props.ref.current = element;
      return { type, props: props || {}, children };
    } }
  };
  vm.createContext(context); vm.runInContext(compiled + '\nthis.component = PlacementMap;', context);
  const tree = context.component({ project, layer, nudge, onPreview() {}, onCommit(patch) {
    assert.doesNotThrow(() => patchLayer(project, id, patch)); changes.push({ ...patch });
  } });
  const nodes = node => [node, ...(node.children || []).flat(Infinity).filter(child => child && typeof child === 'object').flatMap(nodes)];
  const selected = nodes(tree).find(node => node.props['data-map-layer'] === id);
  return { changes, press(key, shiftKey = false) { selected.props.onKeyDown({ key, shiftKey, target: { closest: () => null }, preventDefault() {} }); } };
}

test('logo map nudges preserve off-canvas and oversized placement in every format', () => {
  for (const format of Object.keys(FORMATS)) for (const position of [{ x: -20, y: -30, size: 12 }, { x: 95, y: 120, size: 150 }]) {
    const project = patchLayer({ ...demoProject(), format, layout: { ...DEFAULT_LAYOUT, enabled: true } }, 'logo', position);
    for (const shift of [false, true]) for (const [key, dx, dy] of [['ArrowRight', 1, 0], ['ArrowLeft', -1, 0], ['ArrowDown', 0, 1], ['ArrowUp', 0, -1]]) {
      const h = map(project, 'logo'), [width, height] = FORMATS[format], step = shift ? 12 : 3;
      h.press(key, shift);
      assert.equal(h.changes.length, 1);
      assert(Math.abs(h.changes[0].x - position.x - dx * step / width * 100) < 1e-8);
      assert(Math.abs(h.changes[0].y - position.y - dy * step / height * 100) < 1e-8);
    }
  }
});

test('logo map nudges keep validation bounds and text keeps safe-area constraints', () => {
  const logo = map(patchLayer(demoProject(), 'logo', { x: 1000, y: -1000 }), 'logo');
  logo.press('ArrowLeft'); assert(logo.changes[0].x < 1000); assert.equal(logo.changes[0].y, -1000);
  const text = map(patchLayer(demoProject(), 'headline', { x: 0, y: 0 }), 'headline');
  text.press('ArrowLeft'); assert.deepEqual(text.changes, []);
});
