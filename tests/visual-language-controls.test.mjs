import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { PROCEDURAL_BACKGROUNDS, proceduralDefaults } from '../src/backgrounds.js';
import { PATTERN_SCALE } from '../src/project-limits.js';
import { DEFAULT_TEXT_STYLE } from '../src/text-style.js';
import { textureLayout, TEXTURE_LAYOUT_LIMITS } from '../src/texture-layout.js';
import { blankProject, patchLayer } from '../src/project.js';
import { evaluateChoreography } from '../src/choreography.js';
import { choreographyPatch } from '../src/editor/choreography-edit.js';

async function compile(path) {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  return (await transform(source.replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), { loader: 'jsx' })).code;
}
const [primitives, backgrounds, typography] = await Promise.all([
  compile('../src/editor/controls.jsx'),
  compile('../src/editor/components/BackgroundControls.jsx'),
  compile('../src/editor/components/TypographyControls.jsx')
]);

function controls(component, initial) {
  let layer = structuredClone(initial);
  const changes = [], uploads = [], effects = [];
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    UploadSimple() {}, PATTERN_SCALE, PROCEDURAL_BACKGROUNDS, proceduralDefaults, textureLayout, TEXTURE_LAYOUT_LIMITS, drawBackgroundPreview() {}, DEFAULT_TEXT_STYLE,
    useState: value => [value, () => {}],
    useRef: value => ({ current: value }), useEffect: effect => effects.push(effect),
    createContext: value => ({ value }), useContext: context => context.value, useSyncExternalStore: (subscribe, snapshot) => snapshot()
  };
  vm.createContext(context);
  vm.runInContext(primitives + backgrounds + typography + '\nthis.background = BackgroundControls; this.typography = TypographyControls; this.preview = BackgroundPreview;', context);
  function nodes(node) {
    if (!node || typeof node !== 'object') return [];
    if (typeof node.type === 'function' && node.type.name !== 'BackgroundPreview') {
      return nodes(node.type({ ...node.props, children: node.children }));
    }
    return [node, ...(node.children || []).flat(Infinity).flatMap(nodes)];
  }
  const render = () => context[component]({ layer, uploading: false, onPatch(id, patch) { assert.equal(id, layer.id); changes.push({ ...patch }); layer = { ...layer, ...patch }; }, onPick(...args) { uploads.push(args); } });
  const find = predicate => nodes(render()).find(predicate);
  const text = node => (node.children || []).flat(Infinity).map(child => typeof child === 'object' ? text(child) : child ?? '').join('');
  const button = label => find(node => node.type === 'button' && (node.props['aria-label'] === label || text(node) === label));
  const input = label => find(node => ['input', 'select'].includes(node.type) && node.props['aria-label'] === label);
  const editInput = (label, value) => { const node = input(label); node.props.onChange({ target: { value } }); node.props.onBlur({ currentTarget: { value } }); };
  return { editInput, context, effects, changes, uploads, layer: () => layer, find, button, input, render };
}

const background = { id: 'background', type: 'background', mode: 'image', color: '#080808', src: '/demo/poster-1.svg', fit: 'cover', offset: 0, loop: true };
const textLayer = { id: 'headline', type: 'text', text: 'Studio', color: '#ffffff' };

test('procedural and solid sources keep inactive media, while incompatible media sources clear it', () => {
  const h = controls('background', background);
  assert.equal(h.button('Image').props['aria-pressed'], true);
  h.button('Procedural').props.onClick();
  assert.equal(h.layer().src, background.src);
  assert.equal(h.button('Procedural').props['aria-pressed'], true);
  assert.equal(h.button('Replace media'), undefined);
  assert.equal(h.input('Background fit'), undefined);
  h.button('Solid').props.onClick();
  assert.equal(h.layer().src, background.src);
  h.button('Image').props.onClick();
  assert.equal(h.layer().src, background.src);
  h.button('Replace media').props.onClick();
  assert.deepEqual(h.uploads[0], [background.id, 'image/png,image/jpeg,image/webp,image/avif']);
  h.button('Video').props.onClick();
  assert.equal(h.layer().src, '');
  h.button('Upload video').props.onClick();
  assert.deepEqual(h.uploads[1], [background.id, 'video/mp4,video/webm']);
  assert.ok(h.input('Source offset'));
  assert.equal(h.input('Background fit').props.value, 'cover');
});

test('pattern selection and bounded controls keep other background settings intact', () => {
  const h = controls('background', { ...background, mode: 'procedural' });
  assert.equal(h.button('Grid background').props['aria-pressed'], true);
  h.button('Geometry background').props.onClick();
  assert.equal(h.layer().pattern, 'geometry');
  assert.equal(h.layer().color, background.color);
  assert.equal(h.layer().src, background.src);
  for (const [label, value, field] of [['Pattern scale', 2.25, 'patternScale'], ['Pattern intensity', 0.7, 'patternIntensity'], ['Pattern speed', -0.5, 'patternSpeed'], ['Vignette', 0.4, 'patternVignette'], ['Grain overlay', 0.25, 'patternGrain']]) {
    h.input(label).props.onChange({ target: { value: value * 100 } });
    assert.equal(h.layer()[field], value);
  }
  const changes = h.changes.length;
  for (const value of [-1, 65536, 2.5]) h.editInput('Pattern seed', String(value));
  assert.equal(h.changes.length, changes);
  h.editInput('Pattern seed', '42');
  assert.equal(h.layer().patternSeed, 42);
  h.input('Pattern color').props.onChange({ target: { value: '#ff0000' } });
  assert.equal(h.layer().patternColor, '#ff0000');
});

test('MIT texture selection stays visible on a white background and preserves authored colors and media', () => {
  const h = controls('background', { ...background, mode: 'procedural', color: '#ffffff', patternColor: '#ffffff', patternSeed: 42 });
  h.button('Magnet background').props.onClick();
  assert.equal(h.layer().pattern, 'magnet');
  assert.equal(h.layer().color, '#ffffff');
  assert.equal(h.layer().patternColor, '#171919');
  assert.equal(h.layer().src, background.src);
  assert.equal(h.layer().patternSeed, 42);
  h.editInput('Texture zoom value', '175');
  assert.equal(h.layer().patternScale, 1.75);
  h.input('Focus X').props.onChange({ target: { value: 20 } });
  assert.equal(h.layer().patternFocusX, 20);
  h.input('Pattern color').props.onChange({ target: { value: '#ff0000' } });
  h.button('Watch background').props.onClick();
  assert.equal(h.layer().patternColor, '#ff0000');
  assert.equal(h.layer().patternScale, 1.75);
  assert.equal(h.layer().patternFocusX, 20);
});

test('choosing a texture preserves animated color interpolation, including the state limit', () => {
  for (const count of [2, 32]) {
    const states = Array.from({ length: count }, (_, i) => ({ id: `color-${i}`, time: i / 4, easing: 'linear', values: { patternColor: i % 2 ? '#ff0000' : '#ffffff' } }));
    const project = patchLayer(blankProject(), 'background', { mode: 'procedural', color: '#080808', patternColor: '#ffffff', choreography: states });
    const at = .125, layer = project.layers[0], h = controls('background', evaluateChoreography(layer, at));
    h.button('Magnet background').props.onClick();
    const next = patchLayer(project, layer.id, choreographyPatch(layer, h.changes[0], at, project.fps));
    assert.deepEqual(next.layers[0].choreography, layer.choreography);
    assert.equal(evaluateChoreography(next.layers[0], .0625).patternColor, evaluateChoreography(layer, .0625).patternColor);
    assert.equal(next.layers[0].pattern, 'magnet');
  }
});

test('texture distribution switches without jumping counts and manual edits preserve other controls', () => {
  const h = controls('background', { ...background, mode: 'procedural', pattern: 'watch', textureLayout: 'adaptive' });
  h.input('Density').props.onChange({ target: { value: '150' } });
  const auto = textureLayout('watch', h.layer(), 1);
  h.input('Texture distribution').props.onChange({ target: { value: 'manual' } });
  assert.equal(h.layer().textureColumns, auto.columns);
  assert.equal(h.layer().textureRows, auto.rows);
  h.editInput('Columns', '8'); h.editInput('Rows', '12');
  h.input('Element size').props.onChange({ target: { value: '65' } });
  h.input('Texture layout').props.onChange({ target: { value: 'fit' } });
  h.input('Margin').props.onChange({ target: { value: '12' } });
  assert.deepEqual(textureLayout('watch', h.layer(), 16 / 9), { columns: 8, rows: 12, width: 8 * 26.08, height: 12 * 26.08, elementSize: .65 });
  assert.equal(h.layer().textureMargin, .12);
  assert.equal(h.layer().src, background.src);
  assert.equal(h.input('Texture zoom'), undefined);
  assert.equal(h.input('Density'), undefined);
});

test('direction and focus follow the pattern registry, and the loop toggles alone', () => {
  const h = controls('background', { ...background, mode: 'procedural', start: 0, end: 6 });
  assert.equal(h.input('Direction').props.value, 315, 'grid starts with its native drift');
  assert.equal(h.input('Focus X'), undefined);
  h.input('Direction').props.onChange({ target: { value: 90 } });
  h.button('Rings background').props.onClick();
  assert.equal(h.input('Direction'), undefined);
  h.input('Focus X').props.onChange({ target: { value: 20 } });
  h.input('Focus Y').props.onChange({ target: { value: 80 } });
  h.find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } });
  const { patternDirection, patternFocusX, patternFocusY, patternLoop, pattern } = h.layer();
  assert.deepEqual({ patternDirection, patternFocusX, patternFocusY, patternLoop, pattern }, { patternDirection: 90, patternFocusX: 20, patternFocusY: 80, patternLoop: true, pattern: 'rings' });
});

test('typography preserves precise spacing and alignment', () => {
  const h = controls('typography', textLayer);
  assert.equal(h.input('Tracking (1/1000 em)').props.value, '-35');
  assert.equal(h.input('Tracking (1/1000 em)').props.inputMode, 'numeric');
  h.editInput('Tracking (1/1000 em)', '25');
  assert.equal(h.layer().letterSpacing, 0.025);
  const changes = h.changes.length;
  for (const value of ['-151', '501']) h.editInput('Tracking (1/1000 em)', value);
  assert.equal(h.changes.length, changes);
  h.button('center').props.onClick();
  assert.equal(h.layer().textAlign, 'center');
  assert.equal(h.button('center').props['aria-pressed'], true);
  assert.equal(h.layer().text, textLayer.text);
});
