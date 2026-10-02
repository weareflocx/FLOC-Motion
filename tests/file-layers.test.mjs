import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, validateProject, fileLayer, patchLayer, layerAlpha, duplicateLayer } from '../src/project.js';
import { stageMarkup } from '../src/scene.js';
import { createTools } from '../src/webmcp.js';
import { validateSvg, validateGlb } from '../server/asset-validation.mjs';
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
