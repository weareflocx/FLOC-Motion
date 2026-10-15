import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { DEFAULT_PROCEDURAL_BACKGROUND, PROCEDURAL_BACKGROUNDS } from '../src/backgrounds.js';
import { DEFAULT_TEXT_STYLE, TEXT_REVEALS } from '../src/text-style.js';

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
    UploadSimple() {}, DEFAULT_PROCEDURAL_BACKGROUND, PROCEDURAL_BACKGROUNDS, drawBackgroundPreview() {}, DEFAULT_TEXT_STYLE, TEXT_REVEALS,
    useState: value => [value, () => {}],
    useRef: value => ({ current: value }), useEffect: effect => effects.push(effect),
    createContext: value => ({ value }), useContext: context => context.value, useSyncExternalStore: (subscribe, snapshot) => snapshot()
  };
  vm.createContext(context);
  vm.runInContext(primitives + backgrounds + typography + '\nthis.background = BackgroundControls; this.typography = TypographyControls; this.reveal = TextRevealControls; this.preview = BackgroundPreview;', context);
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

test('typography preserves precise spacing, and the reveal keeps its duration when disabled', () => {
  const h = controls('typography', textLayer);
  assert.equal(h.input('Tracking (1/1000 em)').props.value, '-35');
  assert.equal(h.input('Tracking (1/1000 em)').props.inputMode, 'numeric');
  assert.equal(h.input('Text reveal'), undefined, 'the reveal lives on Motion');
  h.editInput('Tracking (1/1000 em)', '25');
  assert.equal(h.layer().letterSpacing, 0.025);
  const changes = h.changes.length;
  for (const value of ['-151', '501']) h.editInput('Tracking (1/1000 em)', value);
  assert.equal(h.changes.length, changes);
  h.button('center').props.onClick();
  assert.equal(h.layer().textAlign, 'center');
  assert.equal(h.button('center').props['aria-pressed'], true);
  const r = controls('reveal', h.layer());
  assert.equal(r.input('Reveal duration'), undefined);
  r.input('Text reveal').props.onChange({ target: { value: 'up' } });
  assert.equal(r.input('Reveal duration').props.value, '600');
  r.editInput('Reveal duration', '1250');
  r.input('Text reveal').props.onChange({ target: { value: 'none' } });
  assert.equal(r.input('Reveal duration'), undefined);
  r.input('Text reveal').props.onChange({ target: { value: 'right' } });
  assert.equal(r.input('Reveal duration').props.value, '1250');
  assert.equal(r.layer().letterSpacing, 0.025);
  assert.equal(r.layer().text, textLayer.text);
});
