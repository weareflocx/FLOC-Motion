import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserCandidates } from '../scripts/renderer-runtime.mjs';
import { prepareModelImports } from '../src/editor/model-import.js';

const executablePath = [process.env.HYPERFRAMES_BROWSER_PATH, ...browserCandidates()].find(file => file && existsSync(file));
const triangle = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';

function binaryDocument(buffer) {
  const view = new DataView(buffer);
  assert.equal(view.getUint32(0, true), 0x46546c67, 'real GLB magic');
  assert.equal(view.getUint32(4, true), 2);
  assert.equal(view.getUint32(8, true), buffer.byteLength);
  assert.equal(view.getUint32(16, true), 0x4e4f534a);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
  const binaryOffset = 20 + jsonLength + 8;
  assert.equal(view.getUint32(binaryOffset - 4, true), 0x004e4942);
  return { json, binaryOffset, buffer };
}

function accessorValues(document, index) {
  const accessor = document.json.accessors[index], view = document.json.bufferViews[accessor.bufferView];
  const count = accessor.count * ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type]);
  const Constructor = ({ 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array })[accessor.componentType];
  return [...new Constructor(document.buffer, document.binaryOffset + (view.byteOffset || 0) + (accessor.byteOffset || 0), count)];
}

// This is the browser FileReader contract, not a fake exporter or loader.
class BlobFileReader {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }); }
}

async function withFileReader(callback) {
  const previous = globalThis.FileReader;
  globalThis.FileReader = BlobFileReader;
  try { return await callback(); } finally { if (previous) globalThis.FileReader = previous; else delete globalThis.FileReader; }
}


test('plain OBJ exports actual binary positions and normals with a PBR default material', async () => withFileReader(async () => {
  const obj = new File([triangle], 'plain.OBJ');
  const prepared = await prepareModelImports([obj]);
  assert.equal(prepared[0].name, 'plain.OBJ');
  assert.equal(prepared[0].file.name, 'plain.glb');
  assert.equal(prepared[0].file.type, 'model/gltf-binary');
  const document = binaryDocument(await prepared[0].file.arrayBuffer());
  const primitive = document.json.meshes[0].primitives[0];
  assert.deepEqual(accessorValues(document, primitive.attributes.POSITION), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.deepEqual(accessorValues(document, primitive.attributes.NORMAL), [0, 0, 1, 0, 0, 1, 0, 0, 1]);
  assert.equal(document.json.materials[0].pbrMetallicRoughness.metallicFactor, 0);
  assert.ok(document.json.buffers.every(buffer => !buffer.uri));
}));

test('geometry and declared resource failures occur during preparation', async () => {
  const cases = [
    ['empty.obj', '# no geometry', [], /no faces, lines or points/],
    ['bad.obj', triangle.replace('v 1 0 0', 'v NaN 0 0'), [], /non-finite/],
    ['bad.obj', triangle.replace('v 1 0 0', 'v 1e40 0 0'), [], /non-finite/],
    ['bad.obj', triangle.replace('f 1 2 3', 'f 1 2 9'), [], /missing vertex/],
    ['bad.obj', triangle.replace('f 1 2 3', 'f 0 2 3'), [], /missing vertex/],
    ['bad.obj', triangle.replace('f 1 2 3', 'f 1 2'), [], /incomplete/],
    ['bad.obj', triangle.replace('v 0 1 0', 'v 2 0 0'), [], /degenerate/],
    ['missing.obj', `mtllib missing.mtl\n${triangle}`, [], /Missing.*missing\.mtl/],
    ['remote.obj', `mtllib https://example.invalid/material.mtl\n${triangle}`, [], /selected local resources/],
    ['remote.obj', `mtllib //example.invalid/material.mtl\n${triangle}`, [], /selected local resources/],
    ['missing.obj', `usemtl absent\n${triangle}`, [], /Missing declared material "absent"/],
    ['ambiguous.obj', `mtllib duplicate.mtl\n${triangle}`, [new File(['newmtl first'], 'duplicate.mtl'), new File(['newmtl second'], 'duplicate.mtl')], /Ambiguous.*duplicate\.mtl/],
    ['surface.obj', `${triangle}surf 0 1 0 1 1 2 3\n`, [], /not supported/],
  ];
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = () => { fetches++; throw new Error('Unexpected network access'); };
  try {
    for (const [name, source, companions, expected] of cases) await assert.rejects(prepareModelImports([new File([source], name), ...companions]), expected, name);
    await assert.rejects(prepareModelImports([new File(['newmtl orphan'], 'orphan.mtl')]), /not referenced.*OBJ/);
    await assert.rejects(prepareModelImports([new File([triangle], 'size.obj')], { maxBytes: 10 }), /0\.00001 MB/);
    assert.equal(fetches, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('converted byte limits reject after real binary export', async () => withFileReader(async () => {
  await assert.rejects(prepareModelImports([new File([triangle], 'size.obj')], { maxBytes: 300 }), /0\.0003 MB/);
}));

test('multiple OBJ files share local companions without reordering independent imports', async () => withFileReader(async () => {
  const material = new File(['NEWMTL matte\nKd .95 .95 .95\nKs 0 0 0'], 'palette one.mtl');
  const secondMaterial = new File(['newmtl other\nKd .2 .4 .8'], 'palette-two.mtl');
  const source = `mtllib \"palette one.mtl\" palette-two.mtl\nusemtl matte\n${triangle}`;
  const first = new File([source], 'first.obj'), second = new File([source], 'second.obj');
  const image = new File(['independent image'], 'unused.png');
  const prepared = await prepareModelImports([material, first, image, secondMaterial, second]);
  assert.deepEqual(prepared.map(item => item.name), ['first.obj', 'unused.png', 'second.obj']);
  for (const item of [prepared[0], prepared[2]]) {
    const document = binaryDocument(await item.file.arrayBuffer());
    assert.equal(document.json.materials[0].name, 'matte');
    assert.ok(document.json.materials[0].pbrMetallicRoughness.baseColorFactor[0] > .8);
  }
  await assert.rejects(prepareModelImports([first, new File(['NEWMTL matte\nnewmtl matte'], material.name), secondMaterial]), /Ambiguous/);
}));

test('unused MTL textures are not required or consumed by an OBJ', async () => withFileReader(async () => {
  const obj = new File([`mtllib palette.mtl\nusemtl red\n${triangle}`], 'model.obj');
  const mtl = new File(['newmtl red\nKd 1 0 0\nnewmtl unused\nmap_Kd absent.png\n'], 'palette.mtl');
  const prepared = await prepareModelImports([obj, mtl]);
  const document = binaryDocument(await prepared[0].file.arrayBuffer());
  assert.equal(document.json.materials[0].name, 'red');
  assert.deepEqual(document.json.materials[0].pbrMetallicRoughness.baseColorFactor, [1, 0, 0, 1]);
  assert.equal(document.json.images, undefined);
}));

test('local MTL and textures embed geometry, groups and channel semantics and release conversion resources', { skip: !executablePath && 'Chrome or Edge is required for OBJ texture conversion', timeout: 60000 }, async t => {
  const obj = await readFile(new URL('./fixtures/model-import/material-groups.obj', import.meta.url), 'utf8');
  const mtl = await readFile(new URL('./fixtures/model-import/material-groups.mtl', import.meta.url), 'utf8');
  const bundle = await build({ stdin: { resolveDir: path.resolve('src/editor'), contents: `
    import { prepareModelImports } from './model-import.js';
    import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
    import { BufferGeometry, Material, Texture } from 'three';
    window.prepareModelImports = prepareModelImports;
    window.GLTFLoader = GLTFLoader;
    window.disposal = { geometry: [], material: [], texture: [], created: [], revoked: [] };
    for (const [type, Constructor] of [['geometry', BufferGeometry], ['material', Material], ['texture', Texture]]) {
      const dispose = Constructor.prototype.dispose;
      Constructor.prototype.dispose = function () { window.disposal[type].push(this.uuid); return dispose.call(this); };
    }
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); window.disposal.created.push(url); return url; };
    URL.revokeObjectURL = url => { window.disposal.revoked.push(url); return revoke(url); };
  ` }, bundle: true, write: false, format: 'iife' });
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const externalRequests = [];
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (/^https?:/.test(request.url())) { externalRequests.push(request.url()); request.abort(); }
    else request.continue();
  });
  await page.setContent('<!doctype html><body></body>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async (obj, mtl, triangle) => {
    const imageFile = async (name, color, width = 2, height = 2, patterned = false) => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, width, height);
      if (patterned) { context.fillStyle = '#00ff00'; context.fillRect(0, 0, 1, 1); }
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      return new File([blob], name, { type: 'image/png' });
    };
    const textures = await Promise.all([
      ['color.png', 'rgb(200,100,50)'], ['alpha.png', 'rgb(0,128,0)'], ['normal.png', 'rgb(128,128,255)'],
      ['height.png', 'rgb(64,64,64)'], ['emission.png', 'rgb(10,20,30)'], ['specular.png', 'rgb(80,160,240)']
    ].map(([name, color]) => imageFile(name, color)));
    const original = new File([obj], 'material-groups.obj'), material = new File([mtl], 'material-groups.mtl');
    const unrelated = new File(['ordinary audio'], 'track.wav'), glb = new File(['ordinary GLB'], 'animated.glb');
    const inputs = [textures[0], unrelated, original, material, glb, ...textures.slice(1)];
    const prepared = await window.prepareModelImports(inputs);
    const cleanup = structuredClone(window.disposal);
    const binary = await prepared[1].file.arrayBuffer();
    const view = new DataView(binary), jsonLength = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(binary, 20, jsonLength)));
    const binaryOffset = 20 + jsonLength + 8;
    const imagePixels = [];
    for (const image of json.images) {
      const bufferView = json.bufferViews[image.bufferView];
      const blob = new Blob([new Uint8Array(binary, binaryOffset + (bufferView.byteOffset || 0), bufferView.byteLength)], { type: image.mimeType });
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0);
      imagePixels.push([...context.getImageData(0, 0, 1, 1).data]); bitmap.close();
    }
    const loaded = await new window.GLTFLoader().parseAsync(binary, '');
    const loadedMeshes = [];
    loaded.scene.traverse(child => {
      if (!child.isMesh) return;
      loadedMeshes.push({ position: [...child.geometry.attributes.position.array], normal: [...child.geometry.attributes.normal.array], uv: [...child.geometry.attributes.uv.array], color: [...child.geometry.attributes.color.array], material: child.material.name, opacity: child.material.opacity, map: !!child.material.map, bumpMap: !!child.material.bumpMap, normalMap: !!child.material.normalMap, specularMap: !!child.material.specularIntensityMap });
    });
    const imageIndex = textureIndex => json.textures[textureIndex].source;
    const paint = json.materials.find(material => material.name === 'paint');
    const pixels = {
      color: imagePixels[imageIndex(paint.pbrMetallicRoughness.baseColorTexture.index)],
      specular: imagePixels[imageIndex(paint.extensions.KHR_materials_specular.specularTexture.index)],
      bump: imagePixels[imageIndex(paint.extensions.EXT_materials_bump.bumpTexture.index)]
    };
    // Failure after textures and actual geometry have been created must release both.
    window.disposal = { geometry: [], material: [], texture: [], created: [], revoked: [] };
    let failure;
    try { await window.prepareModelImports([new File([obj.replace('v 1 -1 0 0 1 0', 'v -1 -1 0 0 1 0').replace('v 1 1 0 0 0 1', 'v -1 -1 0 0 0 1').replace('v -1 1 0 1 1 1', 'v -1 -1 0 1 1 1')], original.name), material, ...textures]); }
    catch (error) { failure = error.message; }
    const failureCleanup = structuredClone(window.disposal);
    const errors = [];
    const checkFailure = async (files, pattern) => {
      try { await window.prepareModelImports(files); errors.push({ pattern, error: null }); }
      catch (error) { errors.push({ pattern, error: error.message }); }
    };
    const materialObj = new File([`mtllib local.mtl\nusemtl paint\n${triangle}`], 'local.obj');
    const localMtl = content => new File([`newmtl paint\n${content}`], 'local.mtl');
    await checkFailure([materialObj, localMtl('map_Kd missing.png')], 'Missing.*missing.png');
    await checkFailure([materialObj, localMtl('map_Kd color.png'), textures[0], new File([textures[0]], 'color.png')], 'Ambiguous.*color.png');
    await checkFailure([materialObj, localMtl('map_Kd https://example.invalid/a.png')], 'selected local resources');
    await checkFailure([materialObj, localMtl('map_Kd data:image/png;base64,abc')], 'selected local resources');
    await checkFailure([materialObj, localMtl('map_Kd color.png'), new File(['not an image'], 'color.png')], 'Cannot decode.*color.png');
    await checkFailure([materialObj, localMtl('map_Kd large.png'), await imageFile('large.png', '#fff', 4097, 1)], '4096 px');
    await checkFailure([materialObj, localMtl('disp color.png'), textures[0]], 'unsupported disp');
    await checkFailure([materialObj, localMtl('map_Kd -clamp on color.png'), textures[0]], 'unsupported texture options');
    await checkFailure([materialObj, localMtl('Kd NaN 0 0')], 'invalid kd');
    await checkFailure([materialObj, localMtl('map_Kd -s 2 2 1 color.png\nmap_d variable.png'), textures[0], await imageFile('variable.png', '#000', 2, 2, true)], 'matching UV scale and offset');
    const alphaOnly = await window.prepareModelImports([materialObj, localMtl('map_d -s 2 2 1 alpha.png'), textures[1]]);
    const alphaScene = await new window.GLTFLoader().parseAsync(await alphaOnly[0].file.arrayBuffer(), '');
    let alphaImage;
    alphaScene.scene.traverse(child => { if (child.isMesh && child.material.map) alphaImage = child.material.map.image; });
    const alphaCanvas = document.createElement('canvas'); alphaCanvas.width = alphaImage.width; alphaCanvas.height = alphaImage.height;
    const alphaContext = alphaCanvas.getContext('2d'); alphaContext.drawImage(alphaImage, 0, 0);
    const alphaOnlyPixels = [...alphaContext.getImageData(0, 0, 1, 1).data];
    const relativeObj = new File([`mtllib ../materials/local.mtl\nusemtl paint\n${triangle}`], 'local.obj');
    const relativeMtl = localMtl('map_Kd ../textures/color.png');
    const duplicateTexture = new File([textures[0]], 'color.png');
    Object.defineProperty(relativeObj, 'webkitRelativePath', { value: 'models/local.obj' });
    Object.defineProperty(relativeMtl, 'webkitRelativePath', { value: 'materials/local.mtl' });
    Object.defineProperty(textures[0], 'webkitRelativePath', { value: 'textures/color.png' });
    Object.defineProperty(duplicateTexture, 'webkitRelativePath', { value: 'unrelated/color.png' });
    const relative = await window.prepareModelImports([relativeObj, relativeMtl, textures[0], duplicateTexture]);
    const relativeResolution = relative.length === 2 && relative[0].file.name === 'local.glb' && relative[1].file === duplicateTexture;
    let bundleLimit;
    try { await window.prepareModelImports([original, material, ...textures], { maxBytes: original.size + material.size + textures.reduce((sum, file) => sum + file.size, 0) - 1 }); }
    catch (error) { bundleLimit = error.message; }
    return { names: prepared.map(item => item.name), json, pixels, loadedMeshes, cleanup, failure, failureCleanup, errors, bundleLimit, alphaOnlyPixels, relativeResolution };
  }, obj, mtl, triangle);
  assert.deepEqual(result.names, ['track.wav', 'material-groups.obj', 'animated.glb']);
  assert.equal(result.json.meshes[0].primitives.length, 2);
  for (const primitive of result.json.meshes[0].primitives) assert.deepEqual(Object.keys(primitive.attributes).sort(), ['COLOR_0', 'NORMAL', 'POSITION', 'TEXCOORD_0']);
  assert.ok(result.json.buffers.every(buffer => !buffer.uri));
  assert.ok(result.json.images.every(image => Number.isInteger(image.bufferView) && !image.uri));
  const paint = result.json.materials.find(material => material.name === 'paint');
  const glass = result.json.materials.find(material => material.name === 'glass');
  assert.equal(paint.alphaMode, 'BLEND');
  assert.equal(paint.pbrMetallicRoughness.baseColorFactor[3], .6);
  assert.equal(glass.pbrMetallicRoughness.baseColorFactor[3], .75);
  assert.ok(Math.abs(paint.pbrMetallicRoughness.baseColorFactor[0] - .6038273388553378) < 1e-6, 'MTL sRGB colors converted to linear factors');
  assert.ok(Math.abs(paint.pbrMetallicRoughness.roughnessFactor - Math.sqrt(2 / 66)) < 1e-6);
  assert.deepEqual(paint.pbrMetallicRoughness.baseColorTexture.extensions.KHR_texture_transform, { offset: [.25, .5], scale: [2, 2] });
  assert.ok(paint.emissiveTexture);
  assert.ok(paint.normalTexture);
  assert.equal(paint.extensions.EXT_materials_bump.bumpFactor, .4);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(result.pixels.color[i] - [200, 100, 50][i]) <= 1, 'embedded diffuse color survives canvas premultiplication');
  assert.equal(result.pixels.color[3], 128);
  assert.deepEqual(result.alphaOnlyPixels, [255, 255, 255, 128]);
  assert.equal(result.relativeResolution, true, 'relative local paths disambiguate only among selected files');
  assert.equal(result.pixels.specular[3], 80, 'Phong red-channel specular strength becomes glTF alpha-channel intensity');
  assert.deepEqual(result.pixels.bump, [64, 64, 64, 255]);
  assert.equal(result.loadedMeshes.length, 2);
  const loadedPaint = result.loadedMeshes.find(mesh => mesh.material === 'paint');
  assert.ok(loadedPaint.map && loadedPaint.bumpMap && loadedPaint.normalMap && loadedPaint.specularMap);
  assert.equal(loadedPaint.opacity, .6);
  assert.deepEqual(loadedPaint.normal.slice(0, 3), [0, 0, 1]);
  assert.deepEqual(loadedPaint.uv.slice(0, 6), [0, 0, 1, 0, 1, 1]);
  assert.deepEqual(loadedPaint.color.slice(0, 9), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  for (const cleanup of [result.cleanup, result.failureCleanup]) {
    assert.equal(cleanup.created.length, 6);
    assert.deepEqual([...cleanup.revoked].sort(), [...cleanup.created].sort());
    assert.equal(cleanup.geometry.length, 1);
    assert.ok(cleanup.material.length >= 2);
    assert.ok(cleanup.texture.length >= (cleanup === result.cleanup ? 9 : 6));
    for (const type of ['geometry', 'material', 'texture']) assert.equal(new Set(cleanup[type]).size, cleanup[type].length, `${type} disposed exactly once`);
  }
  assert.match(result.failure, /degenerate/);
  for (const error of result.errors) assert.match(error.error || 'unexpected success', new RegExp(error.pattern));
  assert.match(result.bundleLimit, /local bundle/);
  assert.deepEqual(externalRequests, [], 'no remote resource requests');
});
