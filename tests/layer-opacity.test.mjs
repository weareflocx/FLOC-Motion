import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { demoProject, validateProject, patchLayer, fileLayer, duplicateLayer, layerAlpha, linkFormats, switchFormat } from '../src/project.js';
import { effectLayer } from '../src/effects.js';
import { stageMarkup } from '../src/scene.js';

test('every visual layer has independent, bounded opacity that survives saving and duplication', () => {
  const raw = demoProject();
  raw.layers.push(fileLayer({ name: 'Image', src: '/demo/poster-1.svg' }, 12, 'image'));
  raw.layers.push(fileLayer({ name: 'Video', src: '/assets/00000000-0000-4000-8000-000000000001.mp4' }, 12, 'video'));
  raw.layers.push(fileLayer({ name: 'Model', src: '/assets/00000000-0000-4000-8000-000000000002.glb' }, 12, 'model'));
  raw.layers.push(effectLayer('noise', 12));
  const project = validateProject(raw);
  for (const layer of project.layers.filter(item => item.type !== 'music')) {
    assert.equal(layer.opacity, 1);
    for (const opacity of [0, .37, 1]) {
      const next = patchLayer(project, layer.id, { opacity });
      const changed = next.layers.find(item => item.id === layer.id);
      assert.equal(changed.opacity, opacity);
      assert.equal(layerAlpha({ ...changed, fadeIn: 0, fadeOut: 0 }, 2), opacity);
      assert.deepEqual(next.layers.filter(item => item.id !== layer.id), project.layers.filter(item => item.id !== layer.id));
      assert.deepEqual(validateProject(JSON.parse(JSON.stringify(next))), next);
      assert.equal(duplicateLayer(next, layer.id, 'copy').layers.find(item => item.id === 'copy').opacity, opacity);
    }
    for (const opacity of [-.01, 1.01, NaN, Infinity, '50']) assert.throws(() => patchLayer(project, layer.id, { opacity }), /Opacity/);
    assert.throws(() => patchLayer(patchLayer(project, layer.id, { locked: true }), layer.id, { opacity: .5 }), /Unlock/);
  }
  assert.throws(() => patchLayer(project, 'music', { opacity: .5 }));
});

test('background opacity is shared across linked formats without adding animation or fades', () => {
  const project = patchLayer(linkFormats(demoProject()), 'background', { opacity: .35 });
  const portrait = switchFormat(project, 'portrait');
  const background = portrait.layers.find(layer => layer.id === 'background');
  assert.equal(background.opacity, .35);
  assert.equal(Object.hasOwn(background, 'choreography'), false);
  assert.equal(Object.hasOwn(background, 'fadeIn'), false);
  assert.equal(layerAlpha(background, -1), 0);
  assert.equal(layerAlpha(background, portrait.duration), 0);
  assert.equal(layerAlpha({ ...background, visible: false }, 2), 0);
});

test('image and video backgrounds group the fill and media so layer opacity is applied once', () => {
  for (const [mode, src, tag] of [['image', '/demo/poster-1.svg', 'img'], ['video', '/assets/00000000-0000-4000-8000-000000000001.mp4', 'video']]) {
    const project = patchLayer(demoProject(), 'background', { mode, src, opacity: .5 });
    const markup = stageMarkup({ ...project, layers: [project.layers[0]] });
    assert.match(markup, /^<div[^>]*data-floc-layer="background"[^>]*><div[^>]*background:/);
    assert.match(markup, new RegExp(`<${tag}[^>]*data-floc-background-content`));
    assert.equal((markup.match(/opacity:/g) || []).length, 1);
    assert.match(markup, /<\/div>$/);
  }
});

const source = fs.readFileSync(new URL('../src/editor/components/InspectorPanel.jsx', import.meta.url), 'utf8');
const compiled = (await transform(source.replace(/^import .*;\n/gm, '').replace('export function', 'function'), { loader: 'jsx' })).code;

test('the inspector edits the selected visual layer opacity, respects locks and excludes audio', () => {
  const context = { React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    useState: () => [false, () => {}], useRef: () => ({ current: null }), carouselImages: () => [], TEMPLATES: [], MOTION_VARIANTS: { circular: [] },
    FONTS: [], FONT_WEIGHTS: {}, fontDefinition: () => ({ weights: [600] }), SHADERS: [] };
  for (const name of ['Section', 'Range', 'Field', 'NumberField', 'Color', 'Images', 'MusicNotes', 'UploadSimple', 'PlacementMap', 'TypographyControls', 'BackgroundControls', 'MotionControls', 'OrientationControl', 'CarouselEffectControls', 'EffectControls', 'LayerFadeControls', 'TemplateFieldControls']) context[name] = function() {};
  vm.createContext(context);
  vm.runInContext(compiled + '\nthis.render = InspectorPanel;', context);
  const nodes = node => node && typeof node === 'object' ? [node, ...(node.children || []).flat(Infinity).flatMap(nodes)] : [];
  for (const type of ['background', 'carousel', 'text', 'logo', 'media', 'model', 'effect', 'music']) {
    const layer = { ...validateProject(demoProject()).layers.find(item => item.type === 'text'), type, id: 'selected', template: 'circular', locked: true, opacity: .37 };
    const patches = [];
    const tree = nodes(context.render({ project: demoProject(), layer, rightTab: 'composition', onPatch: (...args) => patches.push(args) }));
    const control = tree.find(node => node.type === context.Range && node.props.ariaLabel === 'Layer opacity');
    assert.equal(Boolean(control), type !== 'music');
    if (!control) continue;
    assert.equal(control.props.value, 37);
    assert.equal(control.props.max, 100);
    assert.equal(tree.find(node => node.type === 'fieldset').props.disabled, true);
    control.props.onChange(50);
    assert.equal(patches[0][0], 'selected');
    assert.equal(patches[0][1].opacity, .5);
  }
});
