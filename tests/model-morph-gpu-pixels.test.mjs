import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import * as THREE from 'three';
import { browserCandidates } from '../scripts/renderer-runtime.mjs';
import { createMorphingSphere } from '../src/model-morph.js';
import { DEFAULT_MODEL_STYLE } from '../src/model-style.js';
import { morphOracle } from './fixtures/morph-oracle.js';

const executablePath = [process.env.HYPERFRAMES_BROWSER_PATH, ...browserCandidates()].find(file => file && existsSync(file));
const SEGMENTS = { widthSegments: 96, heightSegments: 72 };
const WIDTH = 128;
// Allowed multiple of the oracle's variation under a ~2-ulp input perturbation: up to 16
// warp iterations each inject float32 rounding that propagates like such a perturbation
// (measured worst on Metal: 42x for positions/colors, 14x for normals).
const TOLERANCE = 128;
// Signed field clocks: elapsed * morphSpeed. Frequency 10 with falloff 1.6 warps at up to
// 1.6^25 cycles per unit: below vertex and float32 direction resolution, so normals there
// are chaotic on any float32 path and are only required to stay finite, unit and outward.
const CASES = [
  { name: 'default', style: {}, elapsed: .375 },
  { name: 'default later', style: {}, elapsed: 2.25 },
  { name: 'detail 1, max amplitude, low contrast', style: { morphDetail: 1, morphAmplitude: .75, morphContrast: .2 }, elapsed: 1.1 },
  { name: 'detail 16, max amplitude, high contrast, max warp', style: { morphDetail: 16, morphAmplitude: .75, morphContrast: 2, morphWarp: 1.5 }, elapsed: 3.5 },
  { name: 'detail 16, max amplitude, max frequency and falloff', style: { morphDetail: 16, morphAmplitude: .75, morphContrast: 2, morphWarp: 1.5, morphFrequency: 10, morphFalloff: 1.6 }, elapsed: 3.5, aliased: true },
  { name: 'detail 16, zero amplitude, reverse', style: { morphDetail: 16, morphAmplitude: 0, morphWarp: 1.5, morphFrequency: 1, morphFalloff: 1, morphContrast: .2, morphSpeed: -4 }, elapsed: .8 },
  { name: 'no warp, high contrast', style: { morphWarp: 0, morphAmplitude: .75, morphContrast: 2 }, elapsed: 7.3 },
  { name: 'tinted palette, late clock', style: { base: 'tinted', morphColor1: '#ff0000', morphColor2: '#00ff00', morphColor3: '#ffffff', morphColor4: '#ff8800' }, elapsed: 1000.25 },
  { name: 'custom base', style: { base: 'custom', morphAmplitude: .6 }, elapsed: 1.7 }
];

test('vertex shader displaces positions, normals and palette colors like the double-precision surface within float32 sensitivity', { skip: !executablePath && 'Chrome or Edge is required for GPU vertex readback', timeout: 120000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import * as THREE from 'three';
    import { createMorphingSphere } from './model-morph.js';
    import { bindSurfaceDisplacement, bindSurfaceNormals } from './model-surface-normals.js';
    import { DEFAULT_MODEL_STYLE } from './model-style.js';
    window.readMorph = (cases, segments, width) => {
      const renderer = new THREE.WebGLRenderer({ antialias: false });
      const base = new THREE.MeshStandardMaterial({ vertexColors: true }), mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), base);
      const controller = createMorphingSphere(mesh, segments);
      const count = mesh.geometry.attributes.position.count, height = Math.ceil(count / width);
      // The production material path plus a probe: every vertex writes one float pixel.
      // Mode 3 evaluates the fragment surface normal at the interpolated displaced position.
      const material = new THREE.MeshStandardMaterial({ vertexColors: true, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
      bindSurfaceDisplacement(material, controller.surfaceDisplacement);
      bindSurfaceNormals(material, controller.surfaceNormals);
      const probe = { value: 0 }, compile = material.onBeforeCompile, key = material.customProgramCacheKey;
      material.onBeforeCompile = (program, renderer) => {
        compile.call(material, program, renderer);
        program.uniforms.flocProbe = probe;
        program.vertexShader = program.vertexShader
          .replace('#include <common>', '#include <common>\\nuniform int flocProbe;\\nout vec3 flocProbeValue;')
          .replace('#include <fog_vertex>', \`#include <fog_vertex>
            flocProbeValue = flocProbe == 0 ? transformed : flocProbe == 1 ? objectNormal : vColor.rgb;
            gl_Position = vec4((vec2(gl_VertexID % \${width}, gl_VertexID / \${width}) + 0.5) / vec2(\${width}.0, \${height}.0) * 2.0 - 1.0, 0.0, 1.0);
            gl_PointSize = 1.0;\`);
        program.fragmentShader = program.fragmentShader
          .replace('#include <common>', '#include <common>\\nuniform int flocProbe;\\nin vec3 flocProbeValue;')
          .replace('#include <dithering_fragment>', '#include <dithering_fragment>\\ngl_FragColor = vec4(flocProbe == 3 ? flocSurfaceNormal(flocLocalPosition) : flocProbeValue, 1.0);');
      };
      material.customProgramCacheKey = () => key.call(material) + '/probe';
      // Non-indexed points reach every owned vertex, including unreferenced pole duplicates.
      const cloud = new THREE.BufferGeometry();
      for (const name of ['position', 'normal']) cloud.setAttribute(name, mesh.geometry.attributes[name]);
      const points = new THREE.Points(cloud, material), scene = new THREE.Scene(), camera = new THREE.Camera();
      points.frustumCulled = false; scene.add(points);
      const target = new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType, depthBuffer: false });
      const pixels = new Float32Array(width * height * 4), results = [];
      const encode = array => { let text = ''; const bytes = new Uint8Array(array.buffer); for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(text); };
      renderer.setRenderTarget(target); renderer.setClearColor(0x000000, 0);
      for (const { style, elapsed } of cases) {
        controller.setStyle({ ...DEFAULT_MODEL_STYLE, ...style });
        controller.update(elapsed);
        const result = [];
        for (let mode = 0; mode < 4; mode++) {
          probe.value = mode;
          renderer.clear(); renderer.render(scene, camera);
          renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
          result.push(encode(pixels.slice(0, count * 4)));
        }
        results.push(result);
      }
      controller.dispose(); material.dispose(); base.dispose(); target.dispose(); renderer.dispose(); renderer.forceContextLoss();
      return results;
    };
  ` }, bundle: true, write: false, format: 'iife' });
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=metal'] });
  t.after(() => browser.close());
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setContent('<!doctype html><title>Morph vertex readback</title>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const results = await page.evaluate((cases, segments, width) => window.readMorph(cases, segments, width), CASES, SEGMENTS, WIDTH);
  assert.deepEqual(errors, [], 'no GLSL compilation or texture errors');

  // The CPU geometry supplies the same float32 unit directions the shader reads.
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6));
  const controller = createMorphingSphere(mesh, SEGMENTS), directions = mesh.geometry.attributes.position.array.slice();
  controller.dispose();
  const count = directions.length / 3, decode = text => new Float32Array(new Uint8Array(Buffer.from(text, 'base64')).buffer);
  // A float32 shader cannot resolve the field more finely than its input directions:
  // tolerances add the oracle's own variation when a direction moves by ~2 float32 ulps.
  const jittered = [], tangent = new THREE.Vector3(), bitangent = new THREE.Vector3(), direction = new THREE.Vector3();
  for (const [sign, frame] of [[1, 0], [-1, 0], [1, 1], [-1, 1]]) {
    const values = new Float64Array(directions.length);
    for (let i = 0; i < count; i++) {
      direction.fromArray(directions, i * 3).normalize();
      tangent.crossVectors(direction, Math.abs(direction.y) < .9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
      if (frame) tangent.crossVectors(direction, bitangent.copy(tangent));
      direction.addScaledVector(tangent, sign * 2 ** -22).toArray(values, i * 3);
    }
    jittered.push(values);
  }
  const angle = (a, i, b, j) => {
    const ax = a[i], ay = a[i + 1], az = a[i + 2], bx = b[j], by = b[j + 1], bz = b[j + 2];
    return Math.atan2(Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx), ax * bx + ay * by + az * bz);
  };
  const difference = (a, i, b, j) => Math.max(Math.abs(a[i] - b[j]), Math.abs(a[i + 1] - b[j + 1]), Math.abs(a[i + 2] - b[j + 2]));
  for (const [caseIndex, { name, style: patch, elapsed, aliased }] of CASES.entries()) {
    const style = { ...DEFAULT_MODEL_STYLE, ...patch }, palette = ['morphColor1', 'morphColor2', 'morphColor3', 'morphColor4'].map(key => new THREE.Color(style[key]));
    const time = elapsed * style.morphSpeed, expected = morphOracle(directions, style, time, palette);
    const neighbors = jittered.map(values => morphOracle(values, style, time, palette));
    const [positions, normals, colors, fragmentNormals] = results[caseIndex].map(decode);
    const worst = { position: 0, normal: 0, fragment: 0, color: 0 }, ratio = { position: 0, normal: 0, fragment: 0, color: 0 };
    let bands = 0;
    const check = (key, error, floor, sensitivity, i) => {
      worst[key] = Math.max(worst[key], error);
      ratio[key] = Math.max(ratio[key], Math.max(0, error - floor) / Math.max(sensitivity, 1e-30));
      assert.ok(error <= floor + TOLERANCE * sensitivity, `${name}: ${key} of vertex ${i} differs by ${error} (float32 sensitivity ${sensitivity})`);
    };
    for (let i = 0; i < count; i++) {
      const k = i * 3, g = i * 4;
      assert.equal(positions[g + 3], 1, `${name}: vertex ${i} was rasterized`);
      check('position', difference(positions, g, expected.positions, k), 1e-6, Math.max(...neighbors.map(n => difference(n.positions, k, expected.positions, k))), i);
      if (aliased) {
        for (const values of [normals, fragmentNormals]) {
          const length = Math.hypot(values[g], values[g + 1], values[g + 2]);
          assert.ok(Math.abs(length - 1) < 1e-5 && values[g] * positions[g] + values[g + 1] * positions[g + 1] + values[g + 2] * positions[g + 2] > 0, `${name}: finite outward unit normal ${i}`);
        }
      } else {
        const normalSensitivity = Math.max(...neighbors.map(n => angle(n.normals, k, expected.normals, k)));
        check('normal', angle(normals, g, expected.normals, k), 2e-4, normalSensitivity, i);
        check('fragment', angle(fragmentNormals, g, expected.normals, k), 2e-4, normalSensitivity, i);
      }
      if (style.base === 'custom') {
        // Painting is off: the attribute-less vertex color stays the GL default.
        for (let axis = 0; axis < 3; axis++) assert.equal(colors[g + axis], 0, `${name}: unpainted vertex ${i}`);
        continue;
      }
      // Palette bands are discontinuous at integer factors by design; float32 may land either side.
      if (Math.abs(expected.factors[i] - Math.round(expected.factors[i])) < 1e-3) { bands++; continue; }
      check('color', difference(colors, g, expected.colors, k), 1e-5, Math.max(...neighbors.map(n => difference(n.colors, k, expected.colors, k))), i);
    }
    t.diagnostic(`${name}: max |position| ${worst.position.toExponential(2)}, vertex/fragment normal angle ${worst.normal.toExponential(2)}/${worst.fragment.toExponential(2)} rad, |color| ${worst.color.toExponential(2)}; worst error/sensitivity ${ratio.position.toFixed(1)}, ${ratio.normal.toFixed(1)}/${ratio.fragment.toFixed(1)}, ${ratio.color.toFixed(1)}; band edges ${bands}/${count}`);
    assert.ok(bands < count * .005, `${name}: few band-edge vertices (${bands})`);
  }
});
