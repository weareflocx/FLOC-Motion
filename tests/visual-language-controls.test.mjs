import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { DEFAULT_PROCEDURAL_BACKGROUND, PROCEDURAL_BACKGROUNDS, drawProceduralBackground } from '../src/backgrounds.js';
import { DEFAULT_TEXT_STYLE, TEXT_REVEALS } from '../src/text-style.js';

async function compile(path) {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  return (await transform(source.replace(/^import .*;\n/gm, '').replaceAll('export function', 'function'), { loader: 'jsx' })).code;
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
    UploadSimple() {}, DEFAULT_PROCEDURAL_BACKGROUND, PROCEDURAL_BACKGROUNDS, drawProceduralBackground, DEFAULT_TEXT_STYLE, TEXT_REVEALS,
    useState: value => [value, () => {}],
    useRef: value => ({ current: value }), useEffect: effect => effects.push(effect)
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
  assert.ok(h.input('Video source offset'));
  assert.equal(h.input('Background fit').props.value, 'cover');
});

test('pattern selection and bounded controls keep other background settings intact', () => {
  const h = controls('background', { ...background, mode: 'procedural' });
  assert.equal(h.button('Grid background').props['aria-pressed'], true);
  h.button('Geometry background').props.onClick();
  assert.equal(h.layer().pattern, 'geometry');
  assert.equal(h.layer().color, background.color);
  assert.equal(h.layer().src, background.src);
  for (const [label, value, field] of [['Pattern scale', 2.25, 'patternScale'], ['Pattern intensity', 0.7, 'patternIntensity'], ['Pattern speed', -0.5, 'patternSpeed']]) {
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

test('preview cards draw their selected pattern through the real supplied-time renderer', () => {
  const h = controls('background', { ...background, mode: 'procedural', patternSpeed: -0.25, patternSeed: 19 });
  const operations = [];
  const context = new Proxy({}, { get: (target, key) => target[key] ?? ((...args) => operations.push([key, ...args])) });
  const canvas = { width: 144, height: 81, getContext: type => { assert.equal(type, '2d'); return context; } };
  h.context.useRef = () => ({ current: canvas });
  const original = structuredClone(h.layer());
  for (const pattern of PROCEDURAL_BACKGROUNDS) {
    const preview = h.context.preview({ layer: h.layer(), pattern });
    assert.equal(preview.props.width, 144);
    assert.equal(preview.props.height, 81);
    assert.equal(preview.props['aria-hidden'], 'true');
    h.effects.pop()();
    const expected = [];
    const expectedContext = new Proxy({}, { get: (target, key) => target[key] ?? ((...args) => expected.push([key, ...args])) });
    drawProceduralBackground({ ...canvas, getContext: () => expectedContext }, { ...DEFAULT_PROCEDURAL_BACKGROUND, ...h.layer(), pattern: pattern.id }, 1);
    assert.deepEqual(operations.splice(0), expected);
  }
  assert.deepEqual(h.layer(), original);
  assert.equal(h.changes.length, 0);
});

test('typography preserves precise spacing and reveal duration when a reveal is disabled', () => {
  const h = controls('typography', textLayer);
  assert.equal(h.input('Tracking (1/1000 em)').props.value, '-35');
  assert.equal(h.input('Tracking (1/1000 em)').props.inputMode, 'numeric');
  assert.equal(h.input('Reveal duration'), undefined);
  h.editInput('Tracking (1/1000 em)', '25');
  assert.equal(h.layer().letterSpacing, 0.025);
  const changes = h.changes.length;
  for (const value of ['-151', '501']) h.editInput('Tracking (1/1000 em)', value);
  assert.equal(h.changes.length, changes);
  h.button('center').props.onClick();
  assert.equal(h.layer().textAlign, 'center');
  assert.equal(h.button('center').props['aria-pressed'], true);
  h.input('Text reveal').props.onChange({ target: { value: 'up' } });
  assert.equal(h.input('Reveal duration').props.value, '600');
  h.editInput('Reveal duration', '1250');
  h.input('Text reveal').props.onChange({ target: { value: 'none' } });
  assert.equal(h.input('Reveal duration'), undefined);
  h.input('Text reveal').props.onChange({ target: { value: 'right' } });
  assert.equal(h.input('Reveal duration').props.value, '1250');
  assert.equal(h.layer().letterSpacing, 0.025);
  assert.equal(h.layer().text, textLayer.text);
});
