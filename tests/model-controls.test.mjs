import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as modelStyle from '../src/model-style.js';
import * as modelMetadata from '../src/model-metadata.js';
import * as motionTiming from '../src/motion-timing.js';
import * as easing from '../src/easing.js';
import { MORPHING_SPHERE_SRC, LIQUID_RIBBONS_SRC, MAGICAL_OCTAHEDRON_SRC } from '../src/model-shapes.js';

async function compile(file, name) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  return (await transform(source.replace(/^import .*;\n/gm, '').replaceAll('export function', 'function'), { loader: 'jsx' })).code + `\nthis.component = ${name};`;
}
const controls = (await Promise.all([
  compile('../src/editor/components/MotionTimingControls.jsx', 'CharacterControls'),
  compile('../src/editor/components/ModelMotionControls.jsx', 'ModelMotionControls'),
  compile('../src/editor/components/ModelControls.jsx', 'ModelControls')
])).join('\n');
const carouselControls = await compile('../src/editor/components/MotionControls.jsx', 'MotionControls');

function inspector(initial = {}, component = 'model') {
  let layer = { id: 'model', type: 'model', src: 'controls.glb', x: 0, y: 0, size: 100, offset: 0, loop: true, ...initial };
  const patches = [];
  let rightTab = component === 'animation' || component === 'carousel' ? 'animation' : 'composition';
  const context = {
    ...modelStyle, ...modelMetadata, ...motionTiming, ...easing,
    MORPHING_SPHERE_SRC, LIQUID_RIBBONS_SRC, MAGICAL_OCTAHEDRON_SRC,
    React: { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) },
    useCallback: callback => callback,
    useSyncExternalStore: (subscribe, snapshot) => snapshot(),
    UploadSimple: 'icon', SpatialControls: 'spatial-controls', OrientationControl: 'orientation', Color: 'color', Field: 'field', NumberField: 'number', Range: 'range', Section: 'section'
  };
  vm.createContext(context); vm.runInContext(controls + (component === 'carousel' ? carouselControls : ''), context);
  function nodes(node, disabled = false) {
    if (Array.isArray(node)) return node.flatMap(child => nodes(child, disabled));
    if (!node || typeof node !== 'object') return [];
    if (typeof node.type === 'function') return nodes(node.type({ ...node.props, children: node.children }), disabled);
    const blocked = disabled || node.props.disabled === true;
    return [{ ...node, blocked }, ...nodes(node.children, blocked)];
  }
  const render = () => nodes(context.component({ layer, count: 6, rightTab, onPick() {}, onPatch(id, patch) { assert.equal(id, layer.id); patches.push(patch); layer = { ...layer, ...patch }; } }));
  const find = label => render().find(node => node.props['aria-label'] === label || node.props.ariaLabel === label || node.props.label === label && ['range', 'color', 'number'].includes(node.type));
  const text = node => (node.children || []).flat(Infinity).map(child => typeof child === 'object' && child !== null ? text(child) : child ?? '').join('');
  const button = label => render().find(node => node.type === 'button' && text(node) === label);
  return {
    find, render, patches, button, text,
    click(label) { const node = button(label); assert.ok(node, label); assert.equal(node.blocked, false, label); node.props.onClick(); },
    get layer() { return layer; },
    setLayer(patch) { layer = { ...layer, ...patch }; },
    showTab(value) { rightTab = value; },
    change(label, value) { const node = find(label); assert.ok(node, label); assert.equal(node.blocked, false, label); node.props.onChange(node.type === 'select' ? { target: { value: String(value) } } : value); }
  };
}

test('octahedron controls retain shape and motion while switching volume and ordinary materials', () => {
  const h = inspector({ src: MAGICAL_OCTAHEDRON_SRC });
  assert.equal(h.render().find(node => node.type === 'section' && node.props.title === 'Shape').props.defaultOpen, true);
  assert.equal(h.find('Lighting preset'), undefined);
  assert.equal(h.find('Edge glow'), undefined);
  const edits = [
    ['Octahedron radius', 'octaRadius', 2.8], ['Octahedron height', 'octaHeight', .7],
    ['Volume steps', 'octaSteps', 96], ['Interior scale', 'octaScale', 83.2],
    ['Sample path', 'octaPath', .087], ['Interior density', 'octaDensity', 12.3],
    ['Optical density', 'octaOpacity', .4], ['Orb intensity', 'octaOrb', 34],
    ['Front edge', 'octaEdge', 4.125], ['Back edge', 'octaBackEdge', 1.3],
    ['Interior tint', 'octaTint', '#abcd12'], ['Front edge color', 'octaFrontColor', '#123456'],
    ['Back edge color', 'octaBackColor', '#654321']
  ];
  for (const [label, key, value] of edits) {
    h.change(label, value);
    assert.equal(h.layer.modelStyle[key], value);
  }
  assert.equal(h.find('Volume steps').props.step, 1);
  h.change('Base surface', 'tinted');
  assert.ok(h.find('Interior density'));
  for (const preset of ['chrome', 'holographic-glass']) {
    h.change('Material preset', preset);
    assert.ok(h.find('Octahedron radius'));
    assert.ok(h.find('Lighting preset'));
    assert.equal(h.find('Interior density'), undefined);
    assert.equal(h.find('Volume steps'), undefined);
    for (const [, key, value] of edits) assert.equal(h.layer.modelStyle[key], value);
  }
  h.change('Material preset', 'original');
  h.showTab('animation');
  for (const [label, key, value] of [['Overall speed', 'octaSpeed', -2], ['Shape rotation', 'octaRotation', 0], ['Interior evolution', 'octaEvolution', -1.5], ['Color speed', 'octaColorSpeed', 0]]) {
    h.change(label, value);
    assert.equal(h.layer.modelStyle[key], value);
  }
  h.change('Automatic motion', 'spin');
  h.click('Reset motion');
  assert.equal(h.layer.modelStyle.octaSpeed, -2);
  assert.equal(h.layer.modelStyle.octaEvolution, -1.5);
  h.showTab('composition');
  for (const [label, , value] of edits) assert.equal(h.find(label).props.value, value);
  h.setLayer({ src: 'replacement.glb' });
  assert.equal(h.find('Octahedron radius'), undefined);
  assert.ok(h.find('Lighting preset'));
});

test('liquid shape and reusable material controls preserve independent settings', () => {
  const h = inspector({ src: LIQUID_RIBBONS_SRC, modelStyle: { motion: 'spin', motionSpeed: -2, animationClip: -1 } });
  const edits = [
    ['Outer radius', 'liquidRadius', 1.4, 1], ['Inner radius', 'liquidInnerRadius', .8, 1],
    ['Sheet thickness', 'liquidThickness', .173, 1], ['Fold strength', 'liquidWarp', .7, 100],
    ['Fold frequency', 'liquidFrequency', 2.3, 1], ['Open width', 'liquidOpen', .8, 1],
    ['Closed width', 'liquidClosed', .2, 1], ['Mesh resolution', 'liquidDetail', 64, 1]
  ];
  for (const [label, key, value, scale] of edits) {
    assert.equal(h.find(label).props.scale, scale);
    h.change(label, value);
    assert.equal(h.layer.modelStyle[key], value);
  }
  assert.equal(h.find('Sheet thickness').props.decimals, 3);
  assert.equal(h.find('Mesh resolution').props.step, 1);
  assert.equal(h.render().find(node => node.type === 'section' && node.props.title === 'Material').props.defaultOpen, false);
  h.change('Material preset', 'liquid-chrome');
  for (const base of ['imported', 'tinted', 'custom']) {
    h.change('Base surface', base);
    for (const label of ['Roughness', 'Liquid tint', 'Reflectance', 'Transmission spread', 'Dispersion']) assert.ok(h.find(label), label);
    for (const label of ['Metalness', 'Emissive color', 'Crystal intensity']) assert.equal(h.find(label), undefined);
  }
  h.change('Liquid tint', '#abcdef');
  h.change('Reflectance', 2.8);
  const beforeLighting = { ...h.layer.modelStyle };
  h.click('Use liquid lighting');
  for (const key of Object.keys(beforeLighting).filter(key => !Object.hasOwn(modelStyle.MODEL_LIGHTING_PRESETS.find(preset => preset.id === 'liquid-studio').settings, key))) assert.deepEqual(h.layer.modelStyle[key], beforeLighting[key], key);
  h.showTab('animation');
  for (const [label, key, value] of [['Liquid cycle', 'liquidDuration', 15.25], ['Liquid ease', 'liquidEase', .12], ['Liquid speed', 'liquidSpeed', -2.35]]) {
    h.change(label, value);
    assert.equal(h.layer.modelStyle[key], value);
  }
  h.click('Reset motion');
  assert.equal(h.layer.modelStyle.liquidSpeed, -2.35);
  h.showTab('composition');
  for (const preset of ['original', 'chrome', 'quantum-crystal', 'liquid-chrome']) {
    h.change('Material preset', preset);
    for (const [, key, value] of edits) assert.equal(h.layer.modelStyle[key], value);
  }
  h.setLayer({ src: 'replacement.glb' });
  assert.equal(h.find('Outer radius'), undefined);
  assert.ok(h.find('Liquid tint'), 'Liquid chrome is available on arbitrary models');
  h.change('Look', 'toon');
  assert.equal(h.layer.modelStyle.glass, 'none');
  assert.equal(h.find('Liquid tint'), undefined);
});

test('morph shape controls preserve unrelated settings through material, motion and source transitions', () => {
  const h = inspector({ src: MORPHING_SPHERE_SRC, modelStyle: { motion: 'spin', motionSpeed: -2, animationClip: -1, environment: 'neon', quantumSpeed: .4 } });
  const edits = [
    ['Deformation', 'morphAmplitude', .52, 100], ['Warp strength', 'morphWarp', 1.25, 100],
    ['Warp frequency', 'morphFrequency', 8.12, 1], ['Warp falloff', 'morphFalloff', 1.45, 1],
    ['Warp detail', 'morphDetail', 14, 1], ['Noise contrast', 'morphContrast', 1.32, 1],
    ['Shape color 1', 'morphColor1', '#112233'], ['Shape color 2', 'morphColor2', '#445566'],
    ['Shape color 3', 'morphColor3', '#778899'], ['Shape color 4', 'morphColor4', '#aabbcc']
  ];
  for (const [label, key, value, scale] of edits) {
    const before = modelStyle.normalizeModelStyle(h.layer.modelStyle);
    if (scale) assert.equal(h.find(label).props.scale, scale);
    h.change(label, value);
    for (const [otherKey, otherValue] of Object.entries(before)) if (otherKey !== key) assert.deepEqual(h.layer.modelStyle[otherKey], otherValue, otherKey);
  }
  assert.equal(h.find('Warp detail').props.step, 1);
  assert.equal(h.find('Morph speed'), undefined);
  h.change('Base surface', 'tinted');
  for (const [label, , value] of edits) assert.equal(h.find(label).props.value, value);
  for (const preset of ['chrome', 'holographic-glass', 'quantum-crystal']) {
    h.change('Material preset', preset);
    assert.ok(h.find('Deformation'));
    assert.equal(h.find('Shape color 1'), undefined);
    for (const [, key, value] of edits) assert.equal(h.layer.modelStyle[key], value);
  }
  h.change('Lighting preset', 'sunset');
  h.change('Material preset', 'original');
  for (const [label, , value] of edits) assert.equal(h.find(label).props.value, value);
  h.showTab('animation');
  assert.equal(h.find('Deformation'), undefined);
  assert.equal(h.find('Morph speed').props.scale, 1);
  for (const speed of [0, -2.35]) {
    h.change('Morph speed', speed);
    assert.equal(h.layer.modelStyle.motionSpeed, -2);
    assert.equal(h.layer.modelStyle.animationClip, -1);
    assert.equal(h.layer.modelStyle.morphSpeed, speed);
  }
  h.click('Reset motion');
  assert.equal(h.layer.modelStyle.morphSpeed, -2.35);
  for (const [, key, value] of edits) assert.equal(h.layer.modelStyle[key], value);
  h.setLayer({ src: 'replacement.glb' });
  assert.equal(h.find('Morph speed'), undefined);
  h.showTab('composition');
  for (const [label, key, value] of edits) {
    assert.equal(h.find(label), undefined);
    assert.equal(h.layer.modelStyle[key], value);
  }
  h.setLayer({ src: MORPHING_SPHERE_SRC });
  for (const [label, , value] of edits) assert.equal(h.find(label).props.value, value);
});

test('material base and look transitions hide inapplicable overrides without erasing preserved settings', () => {
  const h = inspector({ modelStyle: { color: '#445566', metalness: .7, motion: 'float', animationClip: -1 } });
  assert.equal(h.find('Material color'), undefined);
  assert.equal(h.find('Metalness'), undefined);
  h.change('Base surface', 'tinted');
  assert.equal(h.find('Material color').blocked, false);
  assert.equal(h.find('Metalness'), undefined);
  h.change('Base surface', 'custom'); h.change('Look', 'toon');
  assert.equal(h.find('Glass'), undefined, 'glass needs the Physical look');
  assert.equal(h.find('Edge glow'), undefined);
  assert.equal(h.find('Metalness'), undefined);
  assert.equal(h.find('Emissive intensity').blocked, false);
  h.change('Toon steps', 6);
  h.change('Look', 'wireframe');
  assert.equal(h.find('Emissive intensity'), undefined);
  assert.equal(h.find('Key intensity'), undefined);
  h.change('Look', 'physical');
  assert.equal(h.find('Metalness').blocked, false);
  assert.equal(h.find('Edge glow power'), undefined, 'edge glow details appear only once it glows');
  h.change('Edge glow', .8);
  h.change('Edge glow power', 5);
  assert.equal(h.layer.modelStyle.metalness, .7);
  assert.equal(h.layer.modelStyle.motion, 'float');
  assert.equal(h.layer.modelStyle.animationClip, -1);
  assert.deepEqual([h.layer.modelStyle.fresnelIntensity, h.layer.modelStyle.fresnelPower], [.8, 5]);
  h.change('Glass', 'see-through');
  assert.equal(h.layer.modelStyle.fresnelIntensity, 0, 'glass turns edge glow off');
  assert.equal(h.find('Edge glow'), undefined);
  h.change('Look', 'toon');
  assert.equal(h.layer.modelStyle.glass, 'none', 'leaving Physical turns glass off');
  assert.equal(Object.keys(h.patches.at(-1).modelStyle).length, Object.keys(modelStyle.DEFAULT_MODEL_STYLE).length);
});

test('material presets change only the surface; lighting presets change only the environment and rig', () => {
  const h = inspector({ modelStyle: { motion: 'rock', motionSpeed: -2, animationClip: 2, animationSpeed: .5, fillIntensity: 5, environment: 'studio', environmentIntensity: 2 } });
  assert.equal(h.find('Lighting preset').props.value, 'custom');
  h.change('Material preset', 'chrome');
  assert.equal(h.layer.modelStyle.metalness, 1);
  assert.equal(h.layer.modelStyle.fillIntensity, 5, 'material presets keep custom lights');
  assert.equal(h.layer.modelStyle.environmentIntensity, 2);
  assert.equal(h.layer.modelStyle.motionSpeed, -2);
  assert.equal(h.layer.modelStyle.animationClip, 2);
  h.change('Material preset', 'original');
  assert.equal(h.layer.modelStyle.base, 'imported');
  assert.equal(h.layer.modelStyle.fillIntensity, 5);
  h.change('Lighting preset', 'classic');
  assert.equal(h.layer.modelStyle.environment, 'none');
  assert.equal(h.layer.modelStyle.toneMapping, 'none');
  assert.equal(h.layer.modelStyle.fillIntensity, 0);
  assert.equal(h.layer.modelStyle.base, 'imported', 'lighting presets keep the surface');
  assert.equal(h.find('Lighting preset').props.value, 'classic');
  h.change('Material preset', 'chrome');
  assert.ok(h.render().some(node => node.type === 'p' && h.text(node).includes('Metal needs a Lighting environment')), 'metal without an environment explains how to see reflections');
  h.change('Lighting preset', 'studio');
  assert.deepEqual([h.layer.modelStyle.environment, h.layer.modelStyle.toneMapping], ['softbox', 'neutral']);
  assert.equal(h.layer.modelStyle.metalness, 1);
  assert.ok(!h.render().some(node => node.type === 'p' && h.text(node).includes('Metal needs a Lighting environment')));
  assert.equal(h.layer.modelStyle.animationSpeed, .5);
});

test('material presets are grouped by family and the film thickness range stays ordered', () => {
  const h = inspector();
  const groups = h.find('Material preset').children.flat().filter(node => node.type === 'optgroup');
  assert.deepEqual(groups.map(group => group.props.label), ['Basics', 'Metals', 'Iridescent', 'Fabric', 'See-through glass', 'Refractive glass', 'Environment glass']);
  assert.ok(groups.find(group => group.props.label === 'Metals').children.flat().some(option => option.props.value === 'brushed-aluminium'));
  h.change('Material preset', 'brushed-aluminium');
  assert.equal(h.find('Material preset').props.value, 'brushed-aluminium');
  assert.equal(h.layer.modelStyle.anisotropy, .9);
  assert.ok(h.render().some(node => node.type === 'summary' && h.text(node).includes('Brushed')));
  h.change('Material preset', 'pearl');
  h.change('Film thinnest', 900);
  assert.deepEqual([h.layer.modelStyle.iridescenceThicknessMin, h.layer.modelStyle.iridescenceThicknessMax], [900, 900]);
  h.change('Film thickest', 200);
  assert.deepEqual([h.layer.modelStyle.iridescenceThicknessMin, h.layer.modelStyle.iridescenceThicknessMax], [200, 200]);
  assert.equal(h.find('Material preset').props.value, 'custom');
});

test('glass presets show the controls of their glass and switching glass leaves the preset', () => {
  const h = inspector();
  h.change('Material preset', 'tinted-glass');
  assert.equal(h.layer.modelStyle.glass, 'see-through');
  assert.equal(h.find('Glass body').props.value, .35);
  assert.equal(h.find('Dispersion'), undefined);
  assert.equal(h.find('Roughness').blocked, false);
  h.change('Material preset', 'diamond');
  assert.deepEqual([h.layer.modelStyle.glass, h.layer.modelStyle.ior, h.layer.modelStyle.dispersion], ['environment', 2.42, 1]);
  assert.equal(h.find('Glass body'), undefined);
  h.change('Dispersion', .3);
  assert.equal(h.find('Material preset').props.value, 'custom');
  h.change('Material preset', 'diamond');
  h.change('Glass', 'none');
  assert.equal(h.find('Material preset').props.value, 'custom', 'a preset includes its glass');
  assert.equal(h.find('Refractive index ×100'), undefined);
});

test('refractive controls edit canonical quality and roughness on every base without inactive surface overrides', () => {
  const h = inspector({ modelStyle: { motion: 'spin', zoom: 1.7, keyIntensity: 4 } });
  const optionValues = label => h.find(label).children.flat().map(option => option.props.value);
  assert.ok(optionValues('Glass').includes('refractive'));
  h.change('Material preset', 'refractive-frosted');
  assert.equal(h.layer.modelStyle.glass, 'refractive');
  assert.equal(h.layer.modelStyle.base, 'custom');
  assert.equal(h.find('Material preset').props.value, 'refractive-frosted');
  assert.deepEqual(optionValues('Refraction samples'), [4, 8, 16]);
  assert.deepEqual(optionValues('Refraction resolution'), [256, 512, 1024, 2048]);
  for (const mode of ['imported', 'tinted', 'custom']) {
    h.change('Base surface', mode);
    for (const label of ['Roughness', 'Refractive index ×100', 'Dispersion', 'Thickness', 'Refraction samples', 'Refraction resolution']) assert.equal(h.find(label).blocked, false, `${mode}: ${label}`);
    for (const label of ['Glass body', 'Metalness', 'Clearcoat', 'Iridescence', 'Sheen', 'Brushed', 'Emissive intensity']) assert.equal(h.find(label), undefined, `${mode}: ${label}`);
    h.change('Roughness', .37);
    assert.equal(h.layer.modelStyle.roughness, .37);
  }
  h.change('Thickness', 1.25);
  h.change('Refraction samples', 16);
  h.change('Refraction resolution', 512);
  assert.deepEqual([h.layer.modelStyle.refractionThickness, h.layer.modelStyle.refractionSamples, h.layer.modelStyle.refractionResolution], [1.25, 16, 512]);
  assert.equal(h.find('Thickness').props.scale, 100);
  assert.equal(h.find('Thickness').props.suffix, '%');
  assert.deepEqual([h.layer.modelStyle.motion, h.layer.modelStyle.zoom, h.layer.modelStyle.keyIntensity], ['spin', 1.7, 4]);
  h.change('Glass', 'see-through');
  for (const label of ['Thickness', 'Refraction samples', 'Refraction resolution', 'Dispersion']) assert.equal(h.find(label), undefined);
  assert.equal(h.find('Glass body').blocked, false);
});

test('holographic glass exposes UV-free environment controls without inactive PBR details', () => {
  const h = inspector({ modelStyle: { motion: 'spin', animationClip: -1, keyIntensity: 4 } });
  h.change('Material preset', 'holographic-glass');
  assert.equal(h.find('Material preset').props.value, 'holographic-glass');
  assert.ok(h.find('Glass').children.flat().some(option => option.props.value === 'holographic'));
  const labels = ['Holographic intensity', 'Band density', 'Holographic speed', 'Light sweep'];
  for (const base of ['imported', 'tinted', 'custom']) {
    h.change('Base surface', base);
    for (const label of ['Roughness', 'Refractive index ×100', 'Dispersion', ...labels]) assert.equal(h.find(label).blocked, false, `${base}: ${label}`);
    for (const label of ['Metalness', 'Clearcoat', 'Iridescence', 'Sheen', 'Brushed', 'Emissive color', 'Emissive intensity', 'Thickness', 'Refraction samples', 'Refraction resolution', 'Glass body']) assert.equal(h.find(label), undefined, `${base}: ${label}`);
  }
  for (const [label, value] of [['Holographic intensity', .8], ['Band density', 3.2], ['Holographic speed', 0], ['Light sweep', 0]]) h.change(label, value);
  assert.deepEqual([h.layer.modelStyle.holographicIntensity, h.layer.modelStyle.holographicScale, h.layer.modelStyle.holographicSpeed, h.layer.modelStyle.holographicSweep], [.8, 3.2, 0, 0]);
  h.change('Lighting preset', 'sunset');
  assert.equal(h.layer.modelStyle.holographicScale, 3.2);
  h.change('Material preset', 'chrome');
  for (const label of labels) assert.equal(h.find(label), undefined);
  assert.deepEqual([h.layer.modelStyle.holographicIntensity, h.layer.modelStyle.holographicScale, h.layer.modelStyle.holographicSpeed, h.layer.modelStyle.holographicSweep], [.35, 1.4, .08, .6]);
  assert.deepEqual([h.layer.modelStyle.motion, h.layer.modelStyle.animationClip, h.layer.modelStyle.environment], ['spin', -1, 'sunset']);
  assert.equal(h.find('Metalness').blocked, false);
});
test('reference lighting action preserves customized material, palette and motion', () => {
  const original = modelStyle.normalizeModelStyle({
    ...modelStyle.applyModelPreset(undefined, 'holographic-glass'),
    color: '#aabbcc', roughness: .17, ior: 1.8, dispersion: .4,
    holographicIntensity: .7, holographicScale: 3.2, holographicSpeed: -.2, holographicSweep: 0,
    quantumColor1: '#112233', quantumColor2: '#445566', quantumColor3: '#778899',
    motion: 'rock', motionSpace: 'object', motionAxis: 'z', motionSpeed: -2,
    animationClip: 2, animationSpeed: .5, zoom: 1.7, perspective: 52,
    environment: 'neon', environmentIntensity: 3, environmentRotation: 70,
    toneMapping: 'agx', exposure: 2, ambientIntensity: 3, keyIntensity: 4,
    fillIntensity: 5, rimIntensity: 6, lightRotation: -40, keyColor: '#ff0000'
  });
  const h = inspector({ modelStyle: original, x: .2, offset: 4 });
  h.click('Use reference lighting');
  const lighting = modelStyle.MODEL_LIGHTING_PRESETS.find(preset => preset.id === 'holographic-studio').settings;
  for (const [key, value] of Object.entries(original)) {
    if (!Object.hasOwn(lighting, key)) assert.deepEqual(h.layer.modelStyle[key], value, key);
  }
  assert.equal(h.layer.x, .2);
  assert.equal(h.layer.offset, 4);
  assert.equal(h.find('Lighting preset').props.value, 'holographic-studio');
  assert.equal(h.find('Material preset').props.value, 'custom');
  assert.deepEqual(
    ['environment', 'environmentIntensity', 'environmentRotation', 'toneMapping', 'exposure', 'ambientIntensity', 'keyIntensity', 'fillIntensity', 'rimIntensity', 'lightRotation', 'keyColor'].map(key => h.layer.modelStyle[key]),
    ['holographic', 1, 0, 'aces', 1.2, 0, 1, 0, 0, 0, '#ffffff']
  );
  h.change('Material preset', 'chrome');
  assert.equal(h.button('Use reference lighting'), undefined);
});


test('quantum controls roundtrip crystal edits and follow material visibility transitions', () => {
  const h = inspector({ modelStyle: { motion: 'spin', animationClip: -1 } });
  h.change('Material preset', 'quantum-crystal');
  assert.equal(h.find('Material preset').props.value, 'quantum-crystal');
  const edits = [
    ['Crystal intensity', 'quantumIntensity', 1.7], ['Crystal complexity', 'quantumScale', 2.47],
    ['Crystal depth', 'quantumDepth', 1.3], ['Crystal speed', 'quantumSpeed', 0],
    ['Crystal morph speed', 'quantumMorphSpeed', 2.35], ['Crystal rim', 'quantumRim', .42],
    ['Crystal color 1', 'quantumColor1', '#112233'], ['Crystal color 2', 'quantumColor2', '#445566'],
    ['Crystal color 3', 'quantumColor3', '#aabbcc']
  ];
  for (const base of ['imported', 'tinted', 'custom']) {
    h.change('Base surface', base);
    for (const label of ['Roughness', 'Refractive index ×100', 'Dispersion', ...edits.map(([label]) => label)]) assert.equal(h.find(label).blocked, false, `${base}: ${label}`);
    for (const label of ['Metalness', 'Clearcoat', 'Iridescence', 'Sheen', 'Brushed', 'Emissive color', 'Emissive intensity', 'Thickness', 'Refraction samples', 'Glass body', 'Holographic intensity']) assert.equal(h.find(label), undefined, `${base}: ${label}`);
  }
  for (const [label, key, value] of edits) {
    h.change(label, value);
    assert.equal(h.layer.modelStyle[key], value);
    assert.equal(h.find(label).props.value, value);
  }
  h.change('Lighting preset', 'sunset');
  for (const [, key, value] of edits) assert.equal(h.layer.modelStyle[key], value);
  h.change('Glass', 'holographic');
  for (const [label] of edits) assert.equal(h.find(label), undefined);
  assert.equal(h.find('Holographic intensity').blocked, false);
  h.change('Glass', 'quantum');
  for (const [label, , value] of edits) assert.equal(h.find(label).props.value, value);
  h.change('Look', 'toon');
  assert.equal(h.layer.modelStyle.glass, 'none');
  for (const [label] of edits) assert.equal(h.find(label), undefined);
  h.change('Material preset', 'chrome');
  for (const [, key] of edits) assert.equal(h.layer.modelStyle[key], modelStyle.DEFAULT_MODEL_STYLE[key]);
  assert.equal(h.find('Metalness').blocked, false);
  assert.deepEqual([h.layer.modelStyle.motion, h.layer.modelStyle.animationClip, h.layer.modelStyle.environment], ['spin', -1, 'sunset']);
});

test('motion axis space offers Screen and Object, and Legacy only to projects that use it', () => {
  const h = inspector({ modelStyle: { motion: 'spin' } }, 'animation');
  const spaces = () => h.find('Motion axis space').children.flat().map(option => option.props.value);
  assert.deepEqual(spaces(), ['screen', 'object']);
  h.change('Motion axis space', 'object');
  assert.equal(h.layer.modelStyle.motionSpace, 'object');
  const legacy = inspector({ modelStyle: { motion: 'spin', motionSpace: 'euler' } }, 'animation');
  assert.deepEqual(legacy.find('Motion axis space').children.flat().map(option => option.props.value), ['screen', 'object', 'euler']);
  legacy.change('Motion axis space', 'screen');
  assert.deepEqual(legacy.find('Motion axis space').children.flat().map(option => option.props.value), ['screen', 'object']);
});

test('metadata distinguishes loading, static, missing clips and source changes without silently selecting a clip', () => {
  const h = inspector({ src: 'metadata-a.glb', modelStyle: { animationClip: 4 } }, 'animation');
  const releaseA = modelMetadata.registerModelMetadata('metadata-a.glb', { clips: [{ index: 0, name: '<untrusted clip>', duration: 2 }], unlit: true });
  const releaseB = modelMetadata.registerModelMetadata('metadata-b.glb', { clips: [], unlit: false });
  try {
    assert.equal(h.find('Embedded clip').blocked, false);
    assert.ok(h.render().some(node => node.props.role === 'alert'));
    assert.equal(h.layer.modelStyle.animationClip, 4);
    h.change('Embedded clip', 0);
    assert.equal(h.find('Embedded clip speed').blocked, false);
    h.setLayer({ src: 'metadata-b.glb' });
    assert.equal(h.find('Embedded clip').blocked, true);
    assert.equal(h.find('Embedded clip speed'), undefined);
    assert.equal(h.render().some(node => node.props.role === 'alert'), false);
    h.setLayer({ modelStyle: { ...h.layer.modelStyle, animationClip: 3 } });
    assert.equal(h.find('Embedded clip').blocked, false);
    assert.ok(h.render().some(node => node.props.role === 'alert'));
    h.change('Embedded clip', -1);
    assert.equal(h.render().some(node => node.props.role === 'alert'), false);
  } finally { releaseA(); releaseB(); }
});

test('an unavailable clip list still permits disabling an invalid embedded selection', () => {
  const h = inspector({ src: 'failed-selection.glb', modelStyle: { animationClip: 7, motion: 'float' } }, 'animation');
  h.change('Embedded clip', -1);
  assert.equal(h.layer.modelStyle.animationClip, -1);
  assert.equal(h.layer.modelStyle.motion, 'float');
  assert.equal(h.find('Embedded clip speed'), undefined);
});

test('automatic motion and embedded playback dependencies remain independent', () => {
  const release = modelMetadata.registerModelMetadata('motion-controls.glb', { clips: [{ index: 0, name: 'Loop', duration: 3 }], unlit: false });
  try {
    const h = inspector({ src: 'motion-controls.glb' }, 'animation');
    assert.equal(h.find('Motion cycle duration'), undefined);
    h.change('Automatic motion', 'spin');
    assert.equal(h.find('Motion cycle duration').blocked, false);
    assert.equal(h.find('Motion amplitude'), undefined);
    h.change('Speed multiplier', 2);
    h.change('Motion direction', -1);
    h.change('Embedded clip', -1);
    assert.equal(h.find('Embedded clip speed'), undefined);
    assert.equal(h.layer.modelStyle.motion, 'spin');
    h.change('Automatic motion', 'pulse');
    assert.equal(h.find('Motion amplitude').blocked, false);
    assert.equal(h.layer.modelStyle.animationClip, -1);
    assert.equal(h.layer.modelStyle.motionSpeed, -2);
  } finally { release(); }
});

test('environment controls preserve reflection settings while incompatible looks hide them', () => {
  const h = inspector({ modelStyle: { environment: 'none' } });
  assert.equal(h.find('Environment intensity'), undefined);
  h.change('Reflection environment', 'sunset');
  h.change('Environment intensity', 1.7);
  h.change('Environment rotation', -35);
  h.change('Look', 'toon');
  assert.equal(h.find('Environment intensity'), undefined);
  assert.ok(h.render().some(node => node.type === 'p' && h.text(node).includes('ignore the environment')));
  h.change('Look', 'physical');
  assert.equal(h.find('Environment intensity').blocked, false);
  assert.equal(h.layer.modelStyle.environmentIntensity, 1.7);
  assert.equal(h.layer.modelStyle.environmentRotation, -35);
});

test('Actions uses signed direction without a hidden rate and preserves continuous duration and curve choices', () => {
  for (const speed of [-2.75, 3.5, 0]) {
    const h = inspector({ modelStyle: { motion: 'spin', motionSpeed: speed, motionDuration: 12, motionAxis: 'x', motionTiming: { curve: 'bounce', intensity: .8 } } }, 'animation');
    h.click('Actions');
    assert.equal(h.layer.modelStyle.motionSpeed, Math.sign(speed));
    assert.equal(h.find('Speed multiplier'), undefined);
    assert.equal(h.find('Motion cycle duration'), undefined);
    h.change('Action', .75);
    h.change('Pause', 1.25);
    h.change('Steps per turn', 8);
    const summary = h.render().find(node => node.type === 'p' && node.children.join('').includes('45° per action'));
    assert.ok(summary);
    assert.equal(h.layer.modelStyle.motionSteps, 8);
    h.change('Motion direction', -1);
    assert.equal(h.layer.modelStyle.motionSpeed, -1);
    h.click('Continuous');
    assert.equal(h.find('Action'), undefined);
    assert.equal(h.find('Steps per turn'), undefined);
    assert.equal(h.find('Motion cycle duration').props.value, 12);
    assert.equal(h.find('Speed multiplier').props.value, 1);
    assert.equal(h.layer.modelStyle.motionTiming.curve, 'bounce');
    assert.equal(h.layer.modelStyle.motionTiming.intensity, .8);
    assert.equal(h.layer.modelStyle.motionAxis, 'x');
    assert.equal(h.layer.modelStyle.motionTiming.pause, 1.25);
  }
});

test('type, axis and disabled-motion transitions retain rhythm while exposing only effective dependencies', () => {
  const h = inspector({ modelStyle: { motion: 'spin', motionAxis: 'z', motionTiming: { mode: 'steps', action: .5, pause: 2, curve: 'spring', intensity: .7 } } }, 'animation');
  assert.ok(h.find('Steps per turn'));
  h.change('Automatic motion', 'float');
  assert.equal(h.find('Steps per turn'), undefined);
  assert.equal(h.find('Motion amplitude').blocked, false);
  h.change('Motion amplitude', .6);
  h.change('Motion axis', 'y');
  h.change('Automatic motion', 'none');
  assert.equal(h.find('Motion axis'), undefined);
  assert.equal(h.find('Action'), undefined);
  assert.equal(h.button('Spring'), undefined);
  h.change('Automatic motion', 'pulse');
  assert.equal(h.find('Motion axis').props.value, 'y');
  assert.equal(h.find('Action').props.value, .5);
  assert.equal(h.button('Actions').props['aria-pressed'], true);
  assert.equal(h.button('Spring').props['aria-pressed'], true);
  assert.equal(h.layer.modelStyle.motionAmplitude, .6);
  assert.equal(h.layer.modelStyle.motionTiming.pause, 2);
});

test('curve selection and strength update the real progress graph, with overshoot left visible', () => {
  const h = inspector({ modelStyle: { motion: 'rock' } }, 'animation');
  const graph = () => h.render().find(node => node.type === 'path' && node.props.className === 'motion-curve-path').props.d;
  const native = graph();
  h.click('Spring');
  assert.equal(h.button('Spring').props['aria-pressed'], true);
  assert.notEqual(graph(), native);
  const spring = graph();
  h.change('Curve springiness', 95);
  assert.notEqual(graph(), spring);
  assert.equal(h.layer.modelStyle.motionTiming.intensity, .95);
  const coordinates = [...graph().matchAll(/[ML]([\d.-]+),([\d.-]+)/g)].map(match => [Number(match[1]), Number(match[2])]);
  assert.ok(coordinates.some(([, y]) => y < 24), 'Spring overshoot must not be clipped');
  assert.ok(Math.abs(coordinates[37][1] - (110 - motionTiming.motionEase(.37, h.layer.modelStyle.motionTiming) * 86)) < 1e-9);
  h.click('Linear');
  assert.equal(h.find('Curve springiness'), undefined);
  assert.equal(h.layer.modelStyle.motionTiming.intensity, .95);
  h.click('Bounce');
  assert.equal(h.find('Curve bounciness').props.value, 95);
});

test('Reset motion preserves model appearance, authored pose, embedded playback and selected motion', () => {
  const initial = {
    x: 18, y: -8, size: 84, tilt: 31, yaw: -25, roll: 9, offset: 2.5, loop: false,
    modelStyle: { base: 'custom', look: 'physical', fresnelIntensity: .5, color: '#123456', keyIntensity: 5, environment: 'studio', animationClip: 3, animationSpeed: .65, motion: 'pulse', motionAxis: 'z', motionSteps: 12, motionDuration: 24, motionSpeed: -3, motionAmplitude: .2, motionTiming: { mode: 'steps', action: .25, pause: 4, curve: 'back', intensity: .9 } }
  };
  const h = inspector(initial, 'animation');
  h.click('Reset motion');
  assert.equal(h.layer.modelStyle.motion, 'pulse');
  assert.equal(h.layer.modelStyle.motionDuration, 6);
  assert.equal(h.layer.modelStyle.motionSpeed, 1);
  assert.equal(h.layer.modelStyle.motionAmplitude, 1);
  assert.equal(h.layer.modelStyle.motionAxis, 'auto');
  assert.equal(h.layer.modelStyle.motionSteps, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(h.layer.modelStyle.motionTiming)), motionTiming.DEFAULT_MOTION);
  for (const key of ['base', 'look', 'fresnelIntensity', 'color', 'keyIntensity', 'environment', 'animationClip', 'animationSpeed']) assert.equal(h.layer.modelStyle[key], initial.modelStyle[key], key);
  for (const key of ['x', 'y', 'size', 'tilt', 'yaw', 'roll', 'offset', 'loop']) assert.equal(h.layer[key], initial[key], key);
  assert.deepEqual(Object.keys(h.patches.at(-1)), ['modelStyle']);
  assert.equal(h.find('Action'), undefined);
  assert.equal(h.button('Original').props['aria-pressed'], true);
});

test('shared controls preserve carousel-native graph families and action rhythm reset baseline', () => {
  const baseline = { motion: { mode: 'steps', action: .8, pause: .6, curve: 'bounce', intensity: .75 }, speed: -24, loopDuration: 9 };
  for (const template of ['flip', 'window-push', 'sweep-reveal']) {
    const h = inspector({ template, speed: 18, loopDuration: 6, motion: { ...motionTiming.DEFAULT_MOTION }, motionBaseline: baseline, transitionTurn: 90 }, 'carousel');
    const points = () => h.render().find(node => node.type === 'path' && node.props.className === 'motion-curve-path').props.d;
    const sampleY = () => Number([...points().matchAll(/[ML]([\d.-]+),([\d.-]+)/g)][25][2]);
    const expected = template === 'flip' ? easing.smoothProgress(.25) : template === 'window-push' ? 1 - .75 ** 3 : motionTiming.sweepProgress(.25);
    assert.ok(Math.abs(sampleY() - (110 - expected * 86)) < 1e-9, template);
    h.click('Actions');
    assert.equal(h.layer.speed, 18, 'carousel Actions must retain its own speed behavior');
    h.change('Action', 1.5);
    h.change('Pause', .25);
    h.change('Motion direction', -1);
    assert.equal(h.layer.speed, -18);
    if (template === 'flip') assert.ok(Math.abs(sampleY() - (110 - .25 * 86)) < 1e-9, 'flip Actions uses linear native progress');
    h.click('Spring');
    h.change('Curve springiness', 90);
    h.click('Reset motion');
    assert.deepEqual(JSON.parse(JSON.stringify(h.layer.motion)), baseline.motion);
    assert.equal(h.layer.speed, baseline.speed);
    assert.equal(h.layer.loopDuration, baseline.loopDuration);
    assert.equal(h.button('Actions').props['aria-pressed'], true);
    assert.equal(h.find('Action').props.value, .8);
    assert.equal(h.button('Bounce').props['aria-pressed'], true);
  }
});

test('model tabs separate appearance and animation without losing movement settings', () => {
  const h = inspector();
  assert.ok(h.find('Material preset'));
  assert.equal(h.find('Automatic motion'), undefined);
  h.showTab('animation');
  assert.equal(h.find('Material preset'), undefined);
  h.change('Automatic motion', 'spin');
  h.change('Motion axis', 'x');
  h.click('Actions');
  h.showTab('composition');
  assert.ok(h.find('Material preset'));
  assert.ok(h.find('Position X'));
  h.showTab('animation');
  assert.equal(h.find('Motion axis').props.value, 'x');
  assert.equal(h.button('Actions').props['aria-pressed'], true);
});
