import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserCandidates } from '../scripts/renderer-runtime.mjs';

const executablePath = [process.env.HYPERFRAMES_BROWSER_PATH, ...browserCandidates()].find(file => file && existsSync(file));

test('Magical Octahedron renders deterministic native Flat/Spatial volume pixels, geometry depth and picking', { skip: !executablePath && 'Chrome or Edge is required for octahedron pixel verification', timeout: 120000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import * as THREE from 'three';
    import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
    import { createScene, stageMarkup } from './scene.js';
    import { blankProject, fileLayer, patchLayer, validateProject } from './project.js';
    import { DEFAULT_MODEL_STYLE } from './model-style.js';
    import { createMagicalOctahedron } from './model-octahedron.js';
    import { createModelMaterials } from './model-materials.js';
    import { SCENE_PASS } from './scene-pass.js';
    const src = '/shapes/magical-octahedron.glb';
    const planeSrc = '/assets/00000000-0000-4000-8000-000000000002.svg';
    const root = document.getElementById('stage'), errors = [];
    let engine, project, url;
    const planeUrl = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#0000ff"/></svg>');
    function transport(p) {
      return { ...p, layers: p.layers.map(layer => layer.type === 'model' ? { ...layer, src: url, modelShape: 'magical-octahedron' } : layer.src === planeSrc ? { ...layer, src: planeUrl } : layer) };
    }
    function make(space = 'spatial', projection = 'orthographic', plane = false) {
      const p = blankProject('Magical Octahedron native pixels');
      p.layers = [];
      p.scene.camera.projection = projection;
      p.layers.push({ ...fileLayer({ name: 'Magical Octahedron', src }, 12, 'octa'), space, x: 20, y: 20, size: 60, tilt: 10, yaw: 16, roll: 0,
        modelStyle: { ...DEFAULT_MODEL_STYLE, base: 'imported', look: 'physical', glass: 'none', motion: 'none', animationClip: -1, framing: 'fixed', environment: 'none' } });
      if (plane) p.layers.push({ ...fileLayer({ name: 'Blue plane', src: planeSrc }, 12, 'plane'), space: 'spatial', x: 15, y: 15, size: 70, z: -60 });
      return validateProject(p);
    }
    async function mount(p) {
      engine?.dispose(); project = p;
      root.innerHTML = stageMarkup(transport(project));
      engine = await createScene(root, transport(project), { renderMode: true, onMediaError: error => errors.push(error.message) });
      engine.setResolution(160, 160); return frame(1.5);
    }
    async function frame(time = 1.5) {
      await engine.seek(time);
      const canvas = root.querySelector('[data-floc-scene-output]');
      return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    }
    async function patch(value, time = 1.5, id = 'octa') {
      project = patchLayer(project, id, value);
      if (!engine.update(transport(project))) throw new Error('An octahedron edit unexpectedly rebuilt the native scene');
      return frame(time);
    }
    const style = (value, time = 1.5) => patch({ modelStyle: { ...project.layers.find(layer => layer.id === 'octa').modelStyle, ...value } }, time);
    function difference(a, b) { let changed = 0, total = 0; for (let i = 0; i < a.length; i += 4) { let d = 0; for (let k = 0; k < 4; k++) d += Math.abs(a[i+k] - b[i+k]); if (d) changed++; total += d; } return { changed, total }; }
    const center = pixels => Array.from(pixels.slice((80 * 160 + 80) * 4, (80 * 160 + 80) * 4 + 4));
    function coverage(pixels) { let opaque = 0, empty = 0, lit = 0; for (let i = 0; i < pixels.length; i += 4) { if (pixels[i+3] === 255) opaque++; if (pixels[i+3] === 0) empty++; if (pixels[i+3] > 0 && pixels[i]+pixels[i+1]+pixels[i+2] > 40) lit++; } return { opaque, empty, lit }; }
    function packedDepth() {
      // Same real controller/material/pass pipeline, with a readable target to
      // compare packed depth against an actual CPU intersection of its 8 faces.
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
      renderer.setSize(65, 65, false);
      const scene = new THREE.Scene(), mesh = new THREE.Mesh(new THREE.OctahedronGeometry(2.06, 0).scale(1, 1.16, 1), new THREE.MeshStandardMaterial());
      scene.add(mesh);
      const originalGeometry = mesh.geometry, originalMaterial = mesh.material;
      const controller = createMagicalOctahedron(mesh);
      controller.setStyle({ ...DEFAULT_MODEL_STYLE, octaSpeed: 0 }); controller.update(0);
      const materials = createModelMaterials(mesh, { spatial: true, originalSurface: controller.originalSurface });
      materials.update({ ...DEFAULT_MODEL_STYLE, base: 'imported', look: 'physical', glass: 'none' });
      const target = new THREE.WebGLRenderTarget(65, 65), data = new Uint8Array(65 * 65 * 4), samples = [];
      for (const projection of ['orthographic', 'perspective']) {
        const camera = projection === 'orthographic' ? new THREE.OrthographicCamera(-3, 3, 3, -3, .1, 30) : new THREE.PerspectiveCamera(42, 1, .1, 30);
        camera.position.set(.6, .4, 8); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true); scene.updateMatrixWorld(true);
        renderer.setRenderTarget(target); renderer.setClearColor(0, 0); renderer.clear();
        materials.setScenePass(SCENE_PASS.packedDepth); renderer.render(scene, camera); renderer.readRenderTargetPixels(target, 0, 0, 65, 65, data);
        const index = (32 * 65 + 32) * 4, packed = data[index] / 255 + data[index+1] / (255 * 255) + data[index+2] / (255 * 65025);
        const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(0, 0), camera);
        const hit = ray.intersectObject(mesh)[0];
        const expected = hit.point.clone().project(camera).z * .5 + .5;
        materials.setScenePass(SCENE_PASS.pick, 1, 197121); renderer.clear(); renderer.render(scene, camera); renderer.readRenderTargetPixels(target, 0, 0, 65, 65, data);
        samples.push({ projection, packed, expected, pick: Array.from(data.slice(index, index+4)) });
      }
      materials.dispose(); controller.dispose(); originalGeometry.dispose(); originalMaterial.dispose(); target.dispose(); renderer.dispose(); renderer.forceContextLoss();
      return samples;
    }
    window.exerciseOctahedron = async () => {
      const sourceMesh = new THREE.Mesh(new THREE.OctahedronGeometry(2.06, 0).scale(1, 1.16, 1), new THREE.MeshStandardMaterial({ color: '#ffffff' }));
      const buffer = await new GLTFExporter().parseAsync(sourceMesh, { binary: true });
      sourceMesh.geometry.dispose(); sourceMesh.material.dispose();
      url = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }));
      const result = { views: [], parameters: [], clocks: {} };
      for (const space of ['flat', 'spatial']) for (const projection of ['orthographic', 'perspective']) {
        const first = await mount(make(space, projection));
        const later = await frame(2.75);
        result.views.push({ space, projection, ...coverage(first), temporal: difference(first, later), seek: difference(first, await frame(1.5)).total, pick: engine.pick(.5, .5), margin: engine.pick(.21, .21), bounds: engine.projectedBounds('octa') });
        const posed = await patch({ tilt: 38, yaw: -30, roll: 18 });
        result.views.at(-1).pose = difference(first, posed);
        const rotatedCamera = structuredClone(project); rotatedCamera.scene.camera.yaw = 23; rotatedCamera.scene.camera.pitch = 14;
        if (!engine.update(transport(rotatedCamera))) throw new Error('Camera edit unexpectedly rebuilt native scene');
        project = rotatedCamera;
        result.views.at(-1).camera = difference(posed, await frame());
      }
      await mount(make());
      const baseStyle = { ...project.layers[0].modelStyle }, baseline = await frame();
      for (const [key, value] of Object.entries({ octaRadius: .9, octaHeight: .5, octaScale: 20, octaPath: .12, octaDensity: 1, octaOpacity: .1, octaOrb: 0, octaEdge: 0, octaBackEdge: 0, octaSteps: 16, octaTint: '#ff4444', octaFrontColor: '#ff0000', octaBackColor: '#ff0000' })) {
        const changed = await patch({ modelStyle: { ...baseStyle, [key]: value } });
        result.parameters.push({ key, ...difference(baseline, changed) });
      }
      await patch({ modelStyle: baseStyle });
      result.clocks.moving = difference(await frame(.5), await frame(2.5));
      await style({ octaSpeed: 0 }); const frozen = await frame(.5); result.clocks.zero = difference(frozen, await frame(2.5)).total;
      await style({ octaSpeed: -1 }); const reverse = await frame(2); result.clocks.reverse = difference(baseline, reverse); result.clocks.reverseSeek = difference(reverse, await frame(2)).total;
      await style({ octaSpeed: -2 }); result.clocks.reverseRate = difference(reverse, await frame(1)).total;
      await style({ octaSpeed: 1, octaRotation: 0, octaEvolution: 0, octaColorSpeed: 0 }); const fullyFrozen = await frame(.5); result.clocks.componentsZero = difference(fullyFrozen, await frame(2.5)).total;
      await style({ octaEvolution: 1 }); result.clocks.evolution = difference(await frame(.5), await frame(2.5));
      await style({ octaEvolution: 0, octaColorSpeed: .24 }); result.clocks.color = difference(await frame(.5), await frame(2.5));
      await style({ octaColorSpeed: 0, octaRotation: .18 }); result.clocks.rotation = difference(await frame(.5), await frame(2.5));
      await patch({ modelStyle: baseStyle, start: 2 }, 3.5); result.clocks.layerLocal = difference(baseline, await frame(3.5)).total;
      await patch({ start: 0, modelStyle: { ...baseStyle, octaOpacity: 0 } }); result.internalOpacity = center(await frame());
      await patch({ modelStyle: baseStyle, opacity: .35 }); result.layerOpacity = center(await frame());
      for (const patchStyle of [{ base: 'tinted', color: '#ff5555' }, { base: 'custom', color: '#ff0000', roughness: .9 }, { base: 'custom', metalness: 1, roughness: .05, environment: 'studio' }, { glass: 'environment', environment: 'studio' }]) {
        result.parameters.push({ key: JSON.stringify(patchStyle), ...difference(baseline, await patch({ opacity: 1, modelStyle: { ...baseStyle, ...patchStyle } })) });
      }
      await mount(make('spatial', 'orthographic', true));
      const behind = await frame(); result.occlusion = { behind: center(behind), behindPick: engine.pick(.5, .5) };
      const front = await patch({ z: 60 }, 1.5, 'plane'); result.occlusion.front = center(front); result.occlusion.frontPick = engine.pick(.5, .5);
      const order = { ...project, layers: [...project.layers].reverse() }; await mount(order);
      result.occlusion.order = difference(front, await frame()).total;
      engine.dispose(); URL.revokeObjectURL(url);
      result.depth = packedDepth(); result.errors = errors; return result;
    };
  ` }, bundle: true, write: false, format: 'iife' });
  const angle = process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d11' : 'gl-egl';
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', `--use-angle=${angle}`, '--force-color-profile=srgb'] });
  t.after(() => browser.close());
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setRequestInterception(true);
  page.on('request', request => /^https?:/.test(request.url()) ? (errors.push('Unexpected external request'), request.abort()) : request.continue());
  await page.setContent('<style>body{margin:0}#stage{position:relative;width:1080px;height:1080px;overflow:hidden;transform:scale(.1481481481481481);transform-origin:0 0}canvas,img,video{display:block}</style><div id="stage"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(() => window.exerciseOctahedron());
  assert.deepEqual(errors, []);
  assert.deepEqual(result.errors, []);
  for (const view of result.views) {
    const label = `${view.space}/${view.projection}`;
    assert.ok(view.opaque > 300 && view.lit > 300, `${label} shows real opaque interior pixels: ${JSON.stringify(view)}`);
    assert.ok(view.empty > 1000, `${label} preserves transparent empty space outside the octahedron`);
    assert.ok(view.temporal.changed > 100, `${label} evolves visibly`);
    assert.equal(view.seek, 0, `${label} seeks deterministically`);
    assert.equal(view.pick, 'octa', `${label} native picking reaches actual geometry`);
    assert.equal(view.margin, null, `${label} transparent corners cannot be picked`);
    assert.ok(view.bounds?.width > 10 && view.bounds?.height > 10, `${label} has native bounds`);
    assert.ok(view.pose.changed > 100 && view.camera.changed > 100, `${label} uses object pose and the output camera`);
  }
  for (const parameter of result.parameters) assert.ok(parameter.changed > 0, `${parameter.key} changes actual pixels`);
  assert.ok(result.clocks.moving.changed > 100);
  for (const key of ['zero', 'reverseSeek', 'reverseRate', 'componentsZero', 'layerLocal']) assert.equal(result.clocks[key], 0, `${key} respects deterministic layer-local clocks`);
  for (const key of ['reverse', 'evolution', 'color', 'rotation']) assert.ok(result.clocks[key].changed > 100, `${key} changes real pixels`);
  assert.equal(result.internalOpacity[3], 255, 'zero internal optical density does not expose lower scene layers');
  assert.ok(result.layerOpacity[3] > 60 && result.layerOpacity[3] < 120, 'global layer opacity still applies through the shared scene');
  assert.notDeepEqual(result.occlusion.behind, [0, 0, 255, 255]);
  assert.equal(result.occlusion.behindPick, 'octa');
  assert.deepEqual(result.occlusion.front, [0, 0, 255, 255]);
  assert.equal(result.occlusion.frontPick, 'plane');
  assert.equal(result.occlusion.order, 0, 'spatial occlusion is geometric, not layer order');
  for (const sample of result.depth) {
    assert.ok(Math.abs(sample.packed - sample.expected) < 2e-5, `${sample.projection} packed depth matches actual 8-face intersection: ${JSON.stringify(sample)}`);
    assert.deepEqual(sample.pick, [1, 2, 3, 255], `${sample.projection} ID pass uses native geometry without volume lighting`);
  }
});
