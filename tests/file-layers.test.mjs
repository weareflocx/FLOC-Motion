import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, validateProject, fileLayer, patchLayer, layerAlpha, duplicateLayer, assertLocksRespected, linkFormats, switchFormat } from '../src/project.js';
import { stageMarkup } from '../src/scene.js';
import { createTools } from '../src/webmcp.js';
import { validateSvg, validateGlb } from '../server/asset-validation.mjs';
import { DEFAULT_MODEL_STYLE, MODEL_STYLE_RANGES } from '../src/model-style.js';
import { parseProjectFile } from '../src/editor/project-import.js';
const asset = ext => ({ src: `/assets/12345678-1234-1234-1234-123456789012.${ext}`, name: `Example.${ext}` });

test('independent file layers support SVG, video, audio and GLB timing and duplication', () => {
  for (const ext of ['png', 'svg', 'mp4', 'gif', 'mp3', 'glb']) {
    const layer = fileLayer(asset(ext), 12, 'file');
    let p = validateProject({ ...demoProject(), layers: [layer] });
    p = patchLayer(p, 'file', { start: 2, end: 5 });
    assert.equal(layerAlpha(p.layers[0], 1), 0);
    assert.equal(layerAlpha(p.layers[0], 3), 1);
    assert.equal(layerAlpha(p.layers[0], 5), 0);
    const copy = duplicateLayer(p, 'file', 'copy');
    assert.equal(copy.layers[1].src, layer.src);
    assert.equal(copy.layers[1].start, 2);
    const markup = stageMarkup(p);
    assert.match(markup, ext === 'glb' ? /<canvas.*model-file/ : ext === 'mp3' ? /<audio/ : ['mp4', 'gif'].includes(ext) ? /<video/ : /<img/);
    if (ext === 'gif') assert.match(markup, /\.webm/);
  }
  assert.deepEqual(validateProject({ ...demoProject(), layers: [] }).layers, []);
});
test('visual layer fades fit trimmed spans and reject wrong asset kinds', () => {
  const layer = fileLayer(asset('glb'), 12, 'model');
  const p = patchLayer({ ...demoProject(), layers: [layer] }, 'model', { start: 2, end: 4, fadeIn: 2, fadeOut: 2 });
  assert.equal(layerAlpha(p.layers[0], 2.5), 0.5);
  assert.throws(() => patchLayer(p, 'model', { src: asset('svg').src }), /asset type/);
  assert.throws(() => validateProject({ ...demoProject(), images: [{ id: 'x', ...asset('glb') }] }), /Carousel/);
});
test('SVG accepts static local artwork and rejects active and external content', () => {
  validateSvg(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path fill="#fff" d="M0 0h10v10z"/></svg>'));
  for (const content of ['<script>alert(1)</script>', '<image href="https://example.com/a.png"/>', '<foreignObject/>', '<path onload="x"/>', '<style>@import "x";</style>', '<path style="fill:url(https://example.com/a)"/>']) assert.throws(() => validateSvg(Buffer.from(`<svg>${content}</svg>`)));
});
function glb(json) {
  const chunk = Buffer.from(JSON.stringify(json).padEnd(Math.ceil(JSON.stringify(json).length / 4) * 4));
  const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + chunk.length, 8); header.writeUInt32LE(chunk.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, chunk]);
}
test('GLB upload rejects external buffers, textures, malformed files and decoder dependencies', () => {
  validateGlb(glb({ asset: { version: '2.0' }, buffers: [{ byteLength: 0 }] }));
  assert.throws(() => validateGlb(Buffer.from('not a model')));
  for (const field of ['buffers', 'images']) assert.throws(() => validateGlb(glb({ [field]: [{ uri: 'https://example.com/asset' }] })), /embedded/);
  assert.throws(() => validateGlb(glb({ extensionsRequired: ['KHR_draco_mesh_compression'] })), /uncompressed/);
});

test('agent carousel edits explain missing carousel after deletion', async () => {
  const tools = createTools({ get: () => ({ ...demoProject(), layers: [] }), audit() {} });
  await assert.rejects(() => tools.find(tool => tool.name === 'floc_set_carousel').execute({ speed: 10 }), /Add a carousel layer/);
});

test('model styles normalize partial edits without mutating input and survive saved-file import and duplication', async () => {
  const model = fileLayer(asset('glb'), 12, 'model');
  assert.deepEqual(model.modelStyle, DEFAULT_MODEL_STYLE);
  assert.equal(Object.hasOwn(fileLayer(asset('png'), 12, 'image'), 'modelStyle'), false);
  const legacy = { ...model }; delete legacy.modelStyle;
  const raw = { ...demoProject(), layers: [legacy] }, before = structuredClone(raw);
  const style = { mode: 'replace', color: '#225588', roughness: 0.18, metalness: 0.8, shader: 'fresnel', environment: 'studio', keyIntensity: 5, fillIntensity: 2, motion: 'rock', motionSpeed: -2, animationClip: -1, animationSpeed: 0.5 };
  const patch = { modelStyle: style }, patchBefore = structuredClone(patch);
  const edited = patchLayer(raw, 'model', patch);
  assert.deepEqual(edited.layers[0].modelStyle, { ...DEFAULT_MODEL_STYLE, ...style });
  assert.deepEqual(raw, before);
  assert.deepEqual(patch, patchBefore);
  const serialized = JSON.stringify(edited);
  const imported = await parseProjectFile({ size: Buffer.byteLength(serialized), async text() { return serialized; } });
  assert.deepEqual(imported, edited);
  const invalid = JSON.stringify({ ...edited, layers: [{ ...edited.layers[0], modelStyle: { shader: 'void main() {}' } }] });
  await assert.rejects(parseProjectFile({ size: Buffer.byteLength(invalid), async text() { return invalid; } }), /3D/);
  const copied = duplicateLayer(imported, 'model', 'copy');
  assert.deepEqual(copied.layers[1].modelStyle, edited.layers[0].modelStyle);
  assert.notEqual(copied.layers[1].modelStyle, copied.layers[0].modelStyle);
  assert.notEqual(copied.layers[1].modelStyle.motionTiming, copied.layers[0].modelStyle.motionTiming);
  copied.layers[1].modelStyle.motionTiming.pause = 2;
  assert.equal(copied.layers[0].modelStyle.motionTiming.pause, 0);
  copied.layers[1].modelStyle.color = '#ffffff';
  assert.equal(copied.layers[0].modelStyle.color, '#225588');
});

test('model settings reject malformed nested values, uninstalled shaders and remote resources at the project boundary', () => {
  const project = validateProject({ ...demoProject(), layers: [fileLayer(asset('glb'), 12, 'model')] });
  const before = structuredClone(project);
  const badStyles = [
    null, [], true, 'chrome', { mode: 'chrome' }, { shader: 'custom' }, { shader: 'void main() {}' },
    new Date(0), new Map(), Object.create({ mode: 'replace' }), { [Symbol('shader')]: 'custom' },
    { motion: 'eval' }, { environment: 'https://example.com/studio.hdr' },
    { environmentUrl: 'https://example.com/studio.hdr' }, { fragmentShader: 'void main() {}' },
    { material: { roughness: 0.5 } }, { color: { value: '#ffffff' } }, { color: '#fff' },
    { emissive: 'url(https://example.com/a)' }, { fresnelColor: '#zzzzzz' },
    { toonSteps: 3.5 }, { animationClip: 0.5 }, { animationSpeed: -1 },
    { motionAxis: 'xy' }, { motionSteps: 2.5 }, { motionTiming: null }, { motionTiming: [] },
    { motionTiming: Object.create({ curve: 'spring' }) }, { motionTiming: Object.create(Object.create(null)) },
    { motionTiming: { [Symbol('curve')]: 'spring' } }, { motionTiming: new Date(0) }, { motionTiming: new Map() },
    { motionTiming: { action: 0 } }, { motionTiming: { pause: -1 } }, { motionTiming: { intensity: 2 } },
    { motionTiming: { curve: 'custom' } }, { motionTiming: JSON.parse('{"__proto__":{"curve":"back"}}') },
    JSON.parse('{"__proto__":{"shader":"custom"}}'),
    { iridescenceThicknessMin: 500, iridescenceThicknessMax: 400 }
  ];
  // Each film bound is checked with the other at its widest so the range stays ordered.
  const companion = { iridescenceThicknessMin: { iridescenceThicknessMax: 1200 }, iridescenceThicknessMax: { iridescenceThicknessMin: 0 } };
  for (const [key, [min, max]] of Object.entries(MODEL_STYLE_RANGES)) {
    badStyles.push({ [key]: min - 0.01 }, { [key]: max + 0.01 }, { [key]: NaN }, { [key]: Infinity }, { [key]: '1' }, { [key]: null }, { [key]: {} });
    for (const value of [min, max]) assert.equal(patchLayer(project, 'model', { modelStyle: { ...companion[key], [key]: value } }).layers[0].modelStyle[key], value);
  }
  for (const modelStyle of badStyles) {
    assert.throws(() => patchLayer(project, 'model', { modelStyle }), /3D/);
    assert.throws(() => validateProject({ ...project, layers: [{ ...project.layers[0], modelStyle }] }), /3D/);
  }
  assert.deepEqual(project, before);
  for (const entry of demoProject().layers) {
    assert.throws(() => patchLayer({ ...demoProject(), layers: [entry] }, entry.id, { modelStyle: {} }), /Unknown layer property/);
    assert.throws(() => validateProject({ ...demoProject(), layers: [{ ...entry, modelStyle: {} }] }), /Only model layers/);
  }
});

test('model source and pose bounds remain enforced beside styling, and replacing a source resets only clip selection', () => {
  const modelStyle = { ...DEFAULT_MODEL_STYLE, mode: 'tint', color: '#556677', motion: 'spin', motionAxis: 'z', motionSteps: 9, motionTiming: { mode: 'steps', action: .4, pause: .8, curve: 'spring', intensity: 1 }, animationClip: 7, animationSpeed: 0.4 };
  const project = validateProject({ ...demoProject(), layers: [{ ...fileLayer(asset('glb'), 12, 'model'), modelStyle }] });
  for (const src of ['https://example.com/model.glb', '/assets/../model.glb', `${asset('glb').src}?url=https://example.com`, asset('obj').src, asset('png').src, '']) {
    assert.throws(() => patchLayer(project, 'model', { src }));
  }
  for (const patch of [{ offset: -1 }, { offset: 3601 }, { x: 1001 }, { y: -1001 }, { size: 501 }, { size: 1 }, { yaw: 181 }, { tilt: -181 }, { roll: 181 }, { loop: 1 }]) assert.throws(() => patchLayer(project, 'model', patch));
  const same = patchLayer(project, 'model', { src: asset('glb').src });
  assert.equal(same.layers[0].modelStyle.animationClip, 7);
  const src = '/assets/87654321-4321-4321-4321-210987654321.glb';
  const replaced = patchLayer(project, 'model', { src });
  assert.equal(replaced.layers[0].src, src);
  assert.deepEqual(replaced.layers[0].modelStyle, { ...modelStyle, animationClip: 0 });
  assert.equal(project.layers[0].modelStyle.animationClip, 7);
  assert.throws(() => patchLayer(project, 'model', { src, modelStyle: { shader: 'void main() {}' } }), /3D/);
});

test('locked model styling cannot change through patches or composition-wide format exceptions', () => {
  let project = linkFormats(validateProject({ ...demoProject(), layers: [fileLayer(asset('glb'), 12, 'model')] }));
  project = patchLayer(project, 'model', { locked: true });
  assert.throws(() => patchLayer(project, 'model', { modelStyle: { mode: 'replace' } }), /Unlock/);
  assert.throws(() => patchLayer(project, 'model', { locked: false, modelStyle: { mode: 'replace' } }), /Unlock/);
  const portrait = switchFormat(project, 'portrait');
  assert.doesNotThrow(() => assertLocksRespected(project, portrait, { allow: ['format'] }));
  const changed = validateProject({ ...portrait, layers: portrait.layers.map(layer => ({ ...layer, modelStyle: { ...layer.modelStyle, keyIntensity: 8 } })) });
  for (const allow of [[], ['format'], ['timing'], ['content']]) assert.throws(() => assertLocksRespected(project, changed, { allow }), /Unlock/);
  const unlocked = patchLayer(project, 'model', { locked: false });
  assert.equal(patchLayer(unlocked, 'model', { modelStyle: { shader: 'wireframe' } }).layers[0].modelStyle.shader, 'wireframe');
});
