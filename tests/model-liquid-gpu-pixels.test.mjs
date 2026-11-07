import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserCandidates } from '../scripts/renderer-runtime.mjs';
import { DEFAULT_MODEL_STYLE } from '../src/model-style.js';
import { createLiquidEvaluator, liquidPhase, liquidRadius, liquidRotation, projectLiquid } from './fixtures/liquid-oracle.mjs';

const executablePath = [process.env.HYPERFRAMES_BROWSER_PATH, ...browserCandidates()].find(file => file && existsSync(file));
const settings = overrides => ({ ...DEFAULT_MODEL_STYLE, ...overrides });

// One controller per style replays its times in order, so later frames read
// back through the partial (active-range) uploads of the same buffers.
const CASES = [
  { name: 'default', style: settings(), times: [0, 1.25, 7.5] },
  { name: 'zero warp', style: settings({ liquidDetail: 32, liquidWarp: 0, liquidRadius: 1.4, liquidInnerRadius: .55, liquidThickness: .1, liquidOpen: 0 }), times: [0, 3] },
  { name: 'strong thin folds', style: settings({ liquidDetail: 40, liquidWarp: 1.2, liquidFrequency: 4, liquidThickness: .04 }), times: [2, .4] },
  { name: 'maximum thick folds', style: settings({ liquidDetail: 40, liquidRadius: 2, liquidInnerRadius: 1.5, liquidThickness: .5, liquidWarp: 1.2, liquidFrequency: 4, liquidOpen: 1.2, liquidClosed: 1.2 }), times: [0, 1.25] },
  { name: 'minimum radii', style: settings({ liquidDetail: 40, liquidRadius: .3, liquidInnerRadius: .1, liquidThickness: .04, liquidWarp: 0, liquidFrequency: .2, liquidOpen: 0, liquidClosed: 0 }), times: [1.25] },
  { name: 'fine reversed eased', style: settings({ liquidDetail: 72, liquidSpeed: -2.5, liquidEase: .15 }), times: [3.3] }
];

test('vertex-shader Newton projection reproduces the float64 CPU refinement on the real material path', { skip: !executablePath && 'Chrome or Edge is required', timeout: 180000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import * as THREE from 'three';
    import { createLiquidRibbons } from './model-liquid.js';
    import { bindSurfaceDisplacement, bindSurfaceNormals } from './model-surface-normals.js';
    const WIDTH = 512;
    // The production binding, then each vertex writes its displaced object
    // position, its object normal, or the per-fragment normal evaluated at that
    // displaced position into its own float pixel.
    function probe(controller, output) {
      const material = new THREE.MeshStandardMaterial();
      bindSurfaceDisplacement(material, controller.surfaceDisplacement);
      const compile = material.onBeforeCompile, key = material.customProgramCacheKey;
      material.onBeforeCompile = (program, renderer) => {
        compile.call(material, program, renderer);
        program.vertexShader = 'varying vec3 flocProbe;\\nuniform vec2 flocProbeSize;\\n' + program.vertexShader.replace(/}\\s*$/, \`
          flocProbe = \${output === 'surface' ? 'transformed' : output};
          vec2 flocCell = vec2(float(gl_VertexID % \${WIDTH}), float(gl_VertexID / \${WIDTH})) + .5;
          gl_Position = vec4(flocCell / flocProbeSize * 2.0 - 1.0, 0.0, 1.0);
          gl_PointSize = 1.0;
        }\`);
        program.fragmentShader = 'varying vec3 flocProbe;\\n' + (output === 'surface'
          ? controller.surfaceNormals.pars + 'void main() { gl_FragColor = vec4(flocSurfaceNormal(flocProbe), 1.0); }'
          : 'void main() { gl_FragColor = vec4(flocProbe, 1.0); }');
        program.uniforms.flocProbeSize = size;
      };
      material.customProgramCacheKey = () => key.call(material) + '/probe-' + output;
      return material;
    }
    const size = { value: new THREE.Vector2() };
    window.projectOnGpu = cases => {
      const renderer = new THREE.WebGLRenderer({ antialias: false });
      renderer.setSize(1, 1, false);
      const camera = new THREE.Camera(), results = [];
      for (const { style, times } of cases) {
        const source = new THREE.BoxGeometry(), mesh = new THREE.Mesh(source, new THREE.MeshStandardMaterial());
        const controller = createLiquidRibbons(mesh);
        controller.setStyle(style);
        const materials = ['transformed', 'objectNormal', 'surface'].map(output => probe(controller, output));
        for (const elapsed of times) {
          controller.update(elapsed);
          const geometry = mesh.geometry, drawn = geometry.drawRange.count, index = geometry.index.array;
          let count = 0;
          for (let i = 0; i < drawn; i++) count = Math.max(count, index[i] + 1);
          const height = Math.max(1, Math.ceil(count / WIDTH));
          size.value.set(WIDTH, height);
          const points = new THREE.Points(new THREE.BufferGeometry(), materials[0]), scene = new THREE.Scene();
          points.geometry.setAttribute('position', geometry.attributes.position);
          points.geometry.setDrawRange(0, count);
          points.frustumCulled = false;
          scene.add(points);
          const target = new THREE.WebGLRenderTarget(WIDTH, height, { type: THREE.FloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
          const read = material => {
            points.material = material;
            renderer.setRenderTarget(target);
            renderer.setClearColor(0, 0);
            renderer.clear();
            renderer.render(scene, camera);
            const pixels = new Float32Array(WIDTH * height * 4);
            renderer.readRenderTargetPixels(target, 0, 0, WIDTH, height, pixels);
            return pixels;
          };
          const positions = read(materials[0]), normals = read(materials[1]), surface = read(materials[2]);
          const result = { elapsed, count, local: [], gpuPositions: [], gpuNormals: [], fragmentNormals: [], written: 0,
            box: [...geometry.boundingBox.min.toArray(), ...geometry.boundingBox.max.toArray()], sphere: geometry.boundingSphere.radius };
          for (let i = 0; i < count; i++) {
            if (positions[i * 4 + 3] === 1 && normals[i * 4 + 3] === 1 && surface[i * 4 + 3] === 1) result.written++;
            for (let k = 0; k < 3; k++) {
              result.local.push(geometry.attributes.position.array[i * 3 + k]);
              result.gpuPositions.push(positions[i * 4 + k]);
              result.gpuNormals.push(normals[i * 4 + k]);
              result.fragmentNormals.push(surface[i * 4 + k]);
            }
          }
          results.push(result);
          renderer.setRenderTarget(null);
          target.dispose(); points.geometry.dispose();
        }
        materials.forEach(material => material.dispose());
        controller.dispose(); source.dispose(); mesh.material.dispose();
      }
      renderer.dispose(); renderer.forceContextLoss();
      return results;
    };
    // Production binds displacement (vertex) and normals (fragment) together:
    // every material family must link the shared uniforms across both stages.
    window.renderVariants = () => {
      const renderer = new THREE.WebGLRenderer({ antialias: false }), target = new THREE.WebGLRenderTarget(64, 64);
      const source = new THREE.BoxGeometry(), mesh = new THREE.Mesh(source), controller = createLiquidRibbons(mesh), scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(35, 1, .1, 50), pixels = new Uint8Array(64 * 64 * 4), covered = [];
      camera.position.set(0, 0, 12); scene.add(mesh, new THREE.DirectionalLight(0xffffff, 2));
      controller.update(1);
      for (const material of [new THREE.MeshStandardMaterial(), new THREE.MeshPhysicalMaterial({ clearcoat: 1, iridescence: 1 }), new THREE.MeshToonMaterial(), new THREE.MeshBasicMaterial({ wireframe: true })]) {
        bindSurfaceDisplacement(material, controller.surfaceDisplacement);
        bindSurfaceNormals(material, controller.surfaceNormals);
        mesh.material = material;
        renderer.setRenderTarget(target); renderer.setClearColor(0, 0); renderer.clear(); renderer.render(scene, camera);
        renderer.readRenderTargetPixels(target, 0, 0, 64, 64, pixels);
        let count = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) count++;
        covered.push(count); material.dispose();
      }
      controller.dispose(); source.dispose(); target.dispose(); renderer.dispose(); renderer.forceContextLoss();
      return covered;
    };
  ` }, bundle: true, write: false, format: 'iife' });
  const angle = process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d11' : 'gl-egl';
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', `--use-angle=${angle}`] });
  t.after(() => browser.close());
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text()); });
  await page.setContent('<!doctype html><title>Liquid GPU projection</title>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const results = await page.evaluate(cases => window.projectOnGpu(cases), CASES), covered = await page.evaluate(() => window.renderVariants());
  assert.deepEqual(errors, [], 'no GLSL compilation or WebGL errors');
  for (const count of covered) assert.ok(count > 200, `every material family draws the displaced ribbons: ${covered}`);
  // float32 versus float64: every vertex the oracle converges agrees to 1e-5 of
  // the bound. Where strong, high-frequency folds stretch the field, three
  // bounded steps reach the zero set in neither precision, so rounding may
  // steer the remaining steps differently or pick the other side of a true
  // min/cut crease; those vertices must still obey every algorithmic invariant.
  const start = new Float64Array(5), end = new Float64Array(5);
  let frame = 0;
  for (const { name, style, times } of CASES) for (const elapsed of times) {
    const result = results[frame++], label = `${name} at ${elapsed}s`;
    assert.equal(result.elapsed, elapsed);
    assert.ok(result.count > 50, `${label}: nonempty surface`);
    assert.equal(result.written, result.count, `${label}: every vertex wrote both probes`);
    const oracle = projectLiquid(result.local, result.count, style, elapsed);
    const phase = liquidPhase(style, elapsed), evaluate = createLiquidEvaluator(style, phase), m = liquidRotation(phase);
    const field = (source, k, out) => {
      const x = source[k], y = source[k + 1], z = source[k + 2];
      evaluate(m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z, out);
      return Math.abs(out[0]);
    };
    const close = 1e-5 * liquidRadius(style), tolerance = Math.max(1e-8, style.liquidThickness * 1e-5), [minX, minY, minZ, maxX, maxY, maxZ] = result.box;
    let far = 0, maxClose = 0, creases = 0, deviation = 0, gpuResidual = 0, oracleResidual = 0, worse = 0, outside = 0, moved = 0, fragmentSplits = 0, fragmentDeviation = 0;
    for (let i = 0; i < result.count; i++) {
      const k = i * 3, x = result.gpuPositions[k], y = result.gpuPositions[k + 1], z = result.gpuPositions[k + 2];
      const error = Math.hypot(x - oracle.positions[k], y - oracle.positions[k + 1], z - oracle.positions[k + 2]);
      const residual = field(result.gpuPositions, k, end), initial = field(result.local, k, start);
      gpuResidual += residual; oracleResidual += oracle.residuals[i];
      if (residual > initial * (1 + 1e-4) + 1e-5) worse++;
      moved = Math.max(moved, Math.hypot(x - result.local[k], y - result.local[k + 1], z - result.local[k + 2]) / oracle.trust);
      if (x < minX || y < minY || z < minZ || x > maxX || y > maxY || z > maxZ || Math.hypot(x, y, z) > result.sphere) outside++;
      // Fragments re-evaluate the shared field at the displaced point.
      const shading = result.fragmentNormals[k] * result.gpuNormals[k] + result.fragmentNormals[k + 1] * result.gpuNormals[k + 1] + result.fragmentNormals[k + 2] * result.gpuNormals[k + 2];
      if (shading < .9999) fragmentSplits++;
      else fragmentDeviation += 1 - shading;
      if (error > close) {
        far++;
        assert.ok(oracle.residuals[i] > tolerance, `${label}: vertex ${i} converged in float64 but differs by ${error}`);
        continue;
      }
      maxClose = Math.max(maxClose, error);
      const dot = result.gpuNormals[k] * oracle.normals[k] + result.gpuNormals[k + 1] * oracle.normals[k + 1] + result.gpuNormals[k + 2] * oracle.normals[k + 2];
      if (dot >= .9999) { deviation += 1 - dot; continue; }
      // A different normal at the same point is only legitimate on a min/cut
      // crease: the exact field must take the GPU's normal right beside it.
      creases++;
      let nearby = -1;
      for (const radius of [1e-6, 1e-5]) for (let d = 0; d < 27; d++) {
        const offset = [d % 3 - 1, Math.floor(d / 3) % 3 - 1, Math.floor(d / 9) - 1].map(c => c * radius * liquidRadius(style));
        const px = x + offset[0], py = y + offset[1], pz = z + offset[2];
        evaluate(m[0] * px + m[1] * py + m[2] * pz, m[3] * px + m[4] * py + m[5] * pz, m[6] * px + m[7] * py + m[8] * pz, end);
        const length = Math.hypot(end[1], end[2], end[3]);
        const nx = (m[0] * end[1] + m[3] * end[2] + m[6] * end[3]) / length, ny = (m[1] * end[1] + m[4] * end[2] + m[7] * end[3]) / length, nz = (m[2] * end[1] + m[5] * end[2] + m[8] * end[3]) / length;
        nearby = Math.max(nearby, nx * result.gpuNormals[k] + ny * result.gpuNormals[k + 1] + nz * result.gpuNormals[k + 2]);
      }
      assert.ok(nearby > .9999, `${label}: vertex ${i} normal ${dot} is not an adjacent crease side (${nearby})`);
    }
    gpuResidual /= result.count; oracleResidual /= result.count; deviation /= result.count - far - creases;
    if (process.env.LIQUID_GPU_REPORT) console.log({ label, count: result.count, far, maxClose, creases, deviation, fragmentSplits, gpuResidual, oracleResidual, moved });
    assert.equal(outside, 0, `${label}: CPU bounds contain every GPU-projected vertex`);
    assert.ok(moved <= 1 + 1e-4, `${label}: projection stays inside the trust radius (${moved})`);
    assert.equal(worse, 0, `${label}: accepted steps never increase the field residual`);
    assert.ok(far <= result.count * .02, `${label}: ${far} of ${result.count} unconverged vertices took another float32 path`);
    assert.ok(creases <= Math.max(2, result.count * .02), `${label}: ${creases} matching vertices took the other side of a crease`);
    assert.ok(deviation < 1e-6, `${label}: mean analytic normal deviation ${deviation}`);
    assert.ok(fragmentSplits <= Math.max(2, result.count * .002) && fragmentDeviation / result.count < 1e-6, `${label}: fragment normals match vertex normals (${fragmentSplits} crease splits)`);
    assert.ok(gpuResidual <= oracleResidual * 1.1 + 1e-6, `${label}: mean residual ${gpuResidual} versus oracle ${oracleResidual}`);
  }
});
