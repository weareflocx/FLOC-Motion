import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserCandidates } from '../scripts/renderer-runtime.mjs';
import { demoProject, validateProject } from '../src/project.js';
import { effectLayer } from '../src/effects.js';

const executablePath = [process.env.HYPERFRAMES_BROWSER_PATH, ...browserCandidates()].find(file => file && existsSync(file));

test('optical lens preserves detail, its untouched axis and a smooth contour at 4K', { skip: !executablePath && 'Chrome or Edge is required for optical verification', timeout: 120000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import { createEffects } from './effects.js';
    import { FORMATS, layerAlpha } from './project.js';
    window.mountWarp = async (project, axis, gpu = false) => {
      window.effects?.dispose();
      const root = document.getElementById('root');
      root.innerHTML = '<div data-floc-layer="background" style="position:absolute;inset:0"></div>';
      const source = root.firstChild, horizontal = axis === 'horizontal';
      const shape = document.createElement('div');
      shape.style.cssText = horizontal
        ? 'position:absolute;left:0;top:360px;width:1920px;height:360px;background:repeating-linear-gradient(90deg,white 0px 4px,#555 4px 16px)'
        : 'position:absolute;left:640px;top:0;width:640px;height:1080px;background:repeating-linear-gradient(0deg,white 0px 4px,#555 4px 16px)';
      source.append(shape);
      if (gpu) {
        const canvas = document.createElement('canvas'); canvas.width = 3840; canvas.height = 2160;
        canvas.dataset.flocLayer = 'background'; canvas.style.cssText = 'position:absolute;inset:0;width:1920px;height:1080px';
        source.replaceWith(canvas);
        const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
        const shader = (type, code) => { const shader = gl.createShader(type); gl.shaderSource(shader, code); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)); return shader; };
        const program = gl.createProgram();
        gl.attachShader(program, shader(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));
        gl.attachShader(program, shader(gl.FRAGMENT_SHADER, 'precision highp float;uniform vec2 size;uniform float horizontal;void main(){float a=horizontal==1.?gl_FragCoord.x:gl_FragCoord.y;float b=horizontal==1.?gl_FragCoord.y/size.y:gl_FragCoord.x/size.x;if(b<1./3.||b>2./3.)discard;float c=mod(a,32.)<8.?1.:1./3.;gl_FragColor=vec4(vec3(c),1.);}'));
        gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)); gl.useProgram(program);
        const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        gl.uniform2f(gl.getUniformLocation(program, 'size'), canvas.width, canvas.height); gl.uniform1f(gl.getUniformLocation(program, 'horizontal'), horizontal ? 1 : 0);
        gl.viewport(0,0,canvas.width,canvas.height); gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      }
      window.effects = createEffects(root, project, FORMATS, layerAlpha);
      await window.effects.seek(1);
    };
  ` }, bundle: true, write: false, format: 'iife' });
  const angle = process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d11' : 'gl-egl';
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', `--use-angle=${angle}`, '--force-color-profile=srgb'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
  await page.setContent('<style>html,body{margin:0;background:black}#root{position:relative;width:1920px;height:1080px;overflow:hidden}</style><div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  for (const gpu of [false, true]) for (const axis of ['horizontal', 'vertical']) {
    const demo = demoProject();
    const project = validateProject({ ...demo, format: 'landscape', layers: [{ ...demo.layers[0], effects: [{ type: 'optical-warp', axis, amount: 1, center: .64 }] }] });
    await page.evaluate((project, axis, gpu) => window.mountWarp(project, axis, gpu), project, axis, gpu);
    const shot = await page.screenshot({ type: 'png' });
    const metrics = await page.evaluate(async (src, axis) => {
      const image = new Image(); image.src = src; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const horizontal = axis === 'horizontal', along = horizontal ? canvas.width : canvas.height, across = horizontal ? canvas.height : canvas.width;
      const pixel = (a, b) => pixels[((horizontal ? b : a) * canvas.width + (horizontal ? a : b)) * 4];
      let contourError = 0, stripeError = 0;
      for (let a = 64; a < along - 64; a += 17) {
        const distance = (a + .5) / along - .64, edge = Math.min(1, Math.abs(distance) / (distance < 0 ? .64 : .36));
        const expected = across / 2 - across / 6 * (1 + 2 * edge ** 4);
        let first = 0; while (first < across && pixel(a, first) < 40) first++;
        contourError = Math.max(contourError, Math.abs(first - expected));
        const center = pixel(a, Math.floor(across / 2));
        for (const b of [.42, .48, .55, .58]) stripeError = Math.max(stripeError, Math.abs(pixel(a, Math.floor(across * b)) - center));
      }
      return { contourError, stripeError };
    }, 'data:image/png;base64,' + Buffer.from(shot).toString('base64'), axis);
    assert.ok(metrics.contourError < 2, `${axis}: contour jumps by ${metrics.contourError}px at 4K`);
    assert.ok(metrics.stripeError < 3, `${axis}: detail or untouched-axis alignment changed by ${metrics.stripeError}`);
  }
  // Adjustment strength changes the inverse displacement, not the source alpha.
  const demo = demoProject();
  const adjustment = { ...effectLayer('lens', 12), start: 2, end: 8, fadeIn: 1, fadeOut: 1, effects: [{ type: 'optical-warp', amount: 1, center: .64 }] };
  const project = validateProject({ ...demo, format: 'landscape', layers: [{ ...demo.layers[0], effects: [] }, adjustment] });
  await page.evaluate(project => window.mountWarp(project, 'horizontal'), project);
  const capture = async time => { await page.evaluate(time => window.effects.seek(time), time); return page.screenshot({ type: 'png' }); };
  const full = await capture(4), half = await capture(2.5), off = await capture(8);
  for (const [buffer, strength] of [[full, 1], [half, .5], [off, 0]]) {
    const error = await page.evaluate(async (src, strength) => {
      const image = new Image(); image.src = src; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      const x = Math.floor(image.width * .1), data = context.getImageData(x, 0, 1, image.height).data;
      let first = 0; while (first < image.height && data[first * 4] < 40) first++;
      const edge = Math.abs((x + .5) / image.width - .64) / .64, stretch = 1 + 2 * edge ** 4;
      const expected = image.height / 2 - image.height / 6 / (1 + strength * (1 / stretch - 1));
      return Math.abs(first - expected);
    }, 'data:image/png;base64,' + Buffer.from(buffer).toString('base64'), strength);
    assert.ok(error < 2, `adjustment strength ${strength}: contour error ${error}px`);
  }
  assert.deepEqual(await capture(4), full, 'reverse seek must restore the original lens pixels');
});
