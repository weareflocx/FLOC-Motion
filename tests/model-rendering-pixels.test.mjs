import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserCandidates } from '../scripts/renderer-runtime.mjs';

const executablePath = [process.env.HYPERFRAMES_BROWSER_PATH, ...browserCandidates()].find(file => file && existsSync(file));

test('shared model renderer produces real material, reflection, shader and deterministic animation pixels', { skip: !executablePath && 'Chrome or Edge is required for model pixel verification', timeout: 120000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import * as THREE from 'three';
    import { createModelRenderingFixture } from '../tests/fixtures/model-rendering-fixture.js';
    import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
    import { clone } from 'three/addons/utils/SkeletonUtils.js';
    import { createModelScene } from './model-scene.js';
    import { modelCanvasGeometry } from './model-canvas.js';
    import { createResourceCache } from './scene-resources.js';
    import { DEFAULT_MODEL_STYLE, MODEL_LIGHTING_PRESETS, MODEL_MATERIAL_PRESETS, applyLightingPreset, applyModelPreset } from './model-style.js';
    import { getModelMetadata } from './model-metadata.js';
    const CLASSIC_LIGHTING = MODEL_LIGHTING_PRESETS.find(preset => preset.id === 'classic').settings;
    // Every model shares one renderer, so captures are keyed by the layer being drawn.
    const captures = new Map();
    let drawing;
    const beforeRender = THREE.Scene.prototype.onBeforeRender;
    THREE.Scene.prototype.onBeforeRender = function(renderer, scene, camera, ...rest) {
      if (drawing && this.children.some(child => child.isHemisphereLight)) captures.set(drawing, { scene: this, renderer, camera });
      return beforeRender?.call(this, renderer, scene, camera, ...rest);
    };
    const disposal = { materials: [], textures: [], geometry: [], targets: [] };
    for (const [kind, Type] of [['materials', THREE.Material], ['textures', THREE.Texture], ['geometry', THREE.BufferGeometry], ['targets', THREE.WebGLRenderTarget]]) {
      const original = Type.prototype.dispose;
      Type.prototype.dispose = function() { disposal[kind].push(kind === 'targets' ? this.texture.uuid : this.uuid); original.call(this); };
    }
    const resources = createResourceCache(), layers = new Map(), scenes = new Map(), urls = [];
    const errors = [];
    function canvas(id) { let node = document.getElementById(id); if (!node) { node = document.createElement('canvas'); node.id = id; document.body.append(node); } return node; }
    function pixels(id) {
      const node = canvas(id), copy = document.createElement('canvas'); copy.width = node.width; copy.height = node.height;
      const context = copy.getContext('2d'); context.drawImage(node, 0, 0); return context.getImageData(0, 0, copy.width, copy.height).data;
    }
    function difference(a, b) { let changed = 0, total = 0; for (let i = 0; i < a.length; i += 4) { let d = 0; for (let j = 0; j < 4; j++) d += Math.abs(a[i + j] - b[i + j]); if (d > 0) changed++; total += d; } return { changed, total }; }
    function opaque(p) { let count = 0; for (let i = 3; i < p.length; i += 4) if (p[i] > 127) count++; return count; }
    function mesh(id) { let result; captures.get(id).scene.traverse(node => { if (node.isMesh && !result) result = node; }); return result; }
    async function fixture(unlit = false, options = {}) {
      const buffer = await createModelRenderingFixture({ unlit, ...options });
      const url = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' })); urls.push(url);
      return url;
    }
    // Material and motion checks use the pre-v11 camera, pre-v12 Euler motion and pre-v13 classic light; framing, axes and light are checked separately.
    async function mount(id, src, modelStyle = undefined, { size = 100, compositionWidth = 192, framing = 'fixed' } = {}) {
      scenes.get(id)?.dispose();
      const layer = { id, name: id, src, start: 0, offset: 0, loop: true, size, tilt: 13, yaw: 22, roll: 0, modelStyle: { ...DEFAULT_MODEL_STYLE, ...CLASSIC_LIGHTING, motionSpace: 'euler', ...modelStyle, framing } };
      const instance = await createModelScene(canvas(id), layer, { compositionWidth, resources, renderMode: true, onError: error => errors.push(error.message) });
      layers.set(id, layer); scenes.set(id, instance); drawing = id; instance.draw(0); return instance;
    }
    function style(id, patch) { const layer = { ...layers.get(id), modelStyle: { ...DEFAULT_MODEL_STYLE, ...layers.get(id).modelStyle, ...patch } }; scenes.get(id).updateLayer(layer); layers.set(id, layer); }
    function frame(id, time = 0, draft) { drawing = id; scenes.get(id).draw(time, draft); return pixels(id); }
    // Opaque pixels on the outermost ring: geometry cropped by the layer edge.
    function border(p, size) { let count = 0; for (let i = 0; i < size; i++) for (const [x, y] of [[i, 0], [i, size - 1], [0, i], [size - 1, i]]) if (p[(y * size + x) * 4 + 3] > 0) count++; return count; }
    function opaqueBox(p, size) { let left = size, top = size, right = -1, bottom = -1; for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (p[(y * size + x) * 4 + 3] > 0) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); } return { left, top, right: right + 1, bottom: bottom + 1 }; }
    async function legacy(src) {
      const renderer = new THREE.WebGLRenderer({ canvas: canvas('legacy'), alpha: true, antialias: true, preserveDrawingBuffer: true }); renderer.setSize(192, 192, false); renderer.outputColorSpace = THREE.SRGBColorSpace;
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, .01, 100); camera.position.z = 4.5;
      scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 3)); const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(3, 4, 5); scene.add(light);
      const group = new THREE.Group(); scene.add(group);
      const gltf = await new GLTFLoader().loadAsync(src), model = clone(gltf.scene), box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
      const normalizer = new THREE.Group(); model.position.sub(box.getCenter(new THREE.Vector3())); normalizer.add(model); normalizer.scale.setScalar(2 / Math.max(size.x, size.y, size.z)); group.add(normalizer);
      const mixer = new THREE.AnimationMixer(model), clip = gltf.animations[0], action = mixer.clipAction(clip); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true;
      return { frame(time, style = DEFAULT_MODEL_STYLE) {
        action.reset().play(); mixer.setTime(time % clip.duration);
        const phase = Math.max(0, time) * style.motionSpeed / style.motionDuration % 1, wave = Math.sin(phase * Math.PI * 2);
        group.rotation.set(THREE.MathUtils.degToRad(13), THREE.MathUtils.degToRad(22) + (style.motion === 'spin' ? phase * Math.PI * 2 : 0), style.motion === 'rock' ? wave * style.motionAmplitude * Math.PI / 9 : 0);
        group.position.y = style.motion === 'float' ? wave * style.motionAmplitude * .2 : 0;
        group.scale.setScalar(style.motion === 'pulse' ? 1 + wave * style.motionAmplitude * .12 : 1);
        drawing = undefined; renderer.render(scene, camera); return pixels('legacy');
      }, dispose() { mixer.stopAllAction(); scene.traverse(node => { node.geometry?.dispose(); node.material?.map?.dispose(); node.material?.dispose(); }); renderer.dispose(); renderer.forceContextLoss(); } };
    }
    window.exerciseModels = async () => {
      const result = {}, src = await fixture(), unlitSrc = await fixture(true);
      await mount('a', src); const baseline = await legacy(src);
      result.parity = [0, .4, 1.75, .4].map(time => difference(frame('a', time), baseline.frame(time)).total);
      result.v9MotionParity = [];
      for (const motion of ['spin', 'rock', 'float', 'pulse']) for (const speed of [-1.5, 0, 1.5]) {
        style('a', { motion, motionSpeed: speed });
        for (const time of [0, .4, 1.75, .4]) result.v9MotionParity.push(difference(frame('a', time), baseline.frame(time, layers.get('a').modelStyle)).total);
      }
      style('a', { motion: 'none', motionSpeed: 1 }); baseline.dispose();
      const original = frame('a', .4), originalMaterial = mesh('a').material, sourceMap = originalMaterial.map;
      await mount('b', src, { ...DEFAULT_MODEL_STYLE, mode: 'replace', color: '#ff3322' }); const neighbor = frame('b', .4);
      result.sharedGeometry = mesh('a').geometry === mesh('b').geometry;
      result.sharedMaterial = mesh('a').material === mesh('b').material;
      style('a', { mode: 'tint', color: '#44ff88' }); const tinted = frame('a', .4);
      result.tint = difference(original, tinted); result.tintMapPreserved = mesh('a').material.map === sourceMap;
      result.neighbor = difference(neighbor, frame('b', .4)).total;
      style('a', { mode: 'replace', color: '#44ff88' }); const replaced = frame('a', .4);
      result.replace = difference(tinted, replaced); result.replaceMapDropped = mesh('a').material.map === null;
      result.presets = [];
      for (const preset of MODEL_MATERIAL_PRESETS.filter(item => item.id !== 'original')) {
        style('a', applyModelPreset(layers.get('a').modelStyle, preset.id));
        result.presets.push({ id: preset.id, pixels: Array.from(frame('a', .4)), visible: opaque(frame('a', .4)) });
      }
      style('a', applyLightingPreset(applyModelPreset(layers.get('a').modelStyle, 'chrome'), 'classic-reflections')); const studio = frame('a', .4);
      const environment = captures.get('a').scene.environment;
      style('a', { environmentRotation: 90 }); result.environmentRotation = difference(studio, frame('a', .4));
      style('a', { environmentIntensity: 0 }); result.environmentIntensity = difference(studio, frame('a', .4));
      style('a', { environment: 'none', ambientIntensity: 0, keyIntensity: 1, fillIntensity: 0, rimIntensity: 0 }); const keyOnly = frame('a', .4);
      style('a', { fillIntensity: 3, rimIntensity: 2, lightRotation: 70 }); result.lightRig = difference(keyOnly, frame('a', .4));
      // Tone mapping rolls bright light off instead of clipping it; exposure, every environment and light color change real pixels.
      const white = p => { let count = 0; for (let i = 0; i < p.length; i += 4) if (p[i] >= 250 && p[i + 1] >= 250 && p[i + 2] >= 250 && p[i + 3] >= 250) count++; return count; };
      style('a', { ...CLASSIC_LIGHTING, mode: 'replace', color: '#ffffff', roughness: .3, metalness: 0, clearcoat: .7, shader: 'standard' }); const clipped = frame('a', .4);
      style('a', { toneMapping: 'neutral' }); const neutral = frame('a', .4);
      style('a', { toneMapping: 'agx' }); const agx = frame('a', .4);
      result.toneMapping = { clippedWhite: white(clipped), neutralWhite: white(neutral), agxWhite: white(agx), neutral: difference(clipped, neutral), agx: difference(neutral, agx) };
      style('a', { toneMapping: 'neutral', exposure: 2 }); result.exposure = difference(neutral, frame('a', .4));
      style('a', { exposure: 1, color: '#e0e0e0', roughness: .05, metalness: 1, clearcoat: 0 });
      result.environments = ['studio', 'softbox', 'stage', 'sunset', 'neon'].map(environment => { style('a', { environment }); return { environment, pixels: frame('a', .4) }; });
      result.environmentContrast = result.environments.slice(1).map((item, i) => difference(result.environments[i].pixels, item.pixels));
      result.environments = result.environments.map(({ environment, pixels }) => ({ environment, visible: opaque(pixels) }));
      style('a', { environment: 'none', metalness: 0, roughness: .5 }); const whiteKey = frame('a', .4);
      style('a', { keyColor: '#ff0000' }); const redKey = frame('a', .4);
      let redder = 0; for (let i = 0; i < redKey.length; i += 4) if (redKey[i + 3] > 250 && redKey[i] - redKey[i + 2] > whiteKey[i] - whiteKey[i + 2] + 20) redder++;
      result.keyColor = { delta: difference(whiteKey, redKey), redder };
      // Replacement-surface details each change real pixels under the Studio light.
      const surfaceBase = { environment: 'softbox', toneMapping: 'neutral', keyColor: '#ffffff', mode: 'replace', shader: 'standard', color: '#c4c5c4', roughness: .3, metalness: 1, clearcoat: 0 };
      style('a', surfaceBase); const unbrushed = frame('a', .4);
      style('a', { anisotropy: .9 }); result.brushed = difference(unbrushed, frame('a', .4));
      style('a', { anisotropy: 0, color: '#f2efe8', metalness: 0, clearcoat: 1, clearcoatRoughness: 0 }); const sharpCoat = frame('a', .4);
      style('a', { clearcoatRoughness: .7 }); result.coatRoughness = difference(sharpCoat, frame('a', .4));
      style('a', { clearcoat: 0, clearcoatRoughness: 0, color: '#5c0f2e', roughness: .85 }); const bare = frame('a', .4);
      style('a', { sheen: 1, sheenColor: '#ff8fbd', sheenRoughness: .45 }); result.sheen = difference(bare, frame('a', .4));
      style('a', { sheen: 0, color: '#9aa0aa', roughness: .05, metalness: 1, iridescence: 1 }); const film = frame('a', .4);
      style('a', { iridescenceIOR: 1.5, iridescenceThicknessMin: 300, iridescenceThicknessMax: 600 }); const filmRange = frame('a', .4); result.film = difference(film, filmRange);
      // A thickness range varies the film across the surface; equal bounds keep one thickness.
      style('a', { iridescenceThicknessMin: 600 }); result.filmVaries = difference(frame('a', .4), filmRange);
      style('a', { iridescence: 0, iridescenceIOR: 1.3, iridescenceThicknessMin: 400, iridescenceThicknessMax: 400 });
      style('a', CLASSIC_LIGHTING);
      style('a', { mode: 'replace', color: '#888888', roughness: .8, metalness: 0, clearcoat: 0, iridescence: 0, ambientIntensity: .1, keyIntensity: 1, fillIntensity: 0, rimIntensity: 0, lightRotation: 0, shader: 'standard' }); const standard = frame('a', .4);
      result.shaders = [];
      for (const shader of ['toon', 'fresnel', 'wireframe']) {
        style('a', { shader, fresnelColor: '#ff0000', fresnelIntensity: 2 }); const output = frame('a', .4);
        result.shaders.push({ shader, delta: difference(standard, output), coverage: opaque(output) });
      }
      result.standardCoverage = opaque(standard);
      style('a', { shader: 'toon', toonSteps: 2 }); const twoSteps = frame('a', .4); style('a', { toonSteps: 8 }); result.toonSteps = difference(twoSteps, frame('a', .4));
      style('a', { shader: 'fresnel', fresnelIntensity: 0 }); const noRim = frame('a', .4); style('a', { fresnelIntensity: 2 }); const rim = frame('a', .4);
      result.fresnel = difference(noRim, rim);
      let edgeGain = 0, centerGain = 0, edgeCount = 0, centerCount = 0;
      for (let y = 60; y < 125; y++) for (let x = 35; x < 140; x++) {
        const i = (y * 192 + x) * 4; if (noRim[i + 3] < 250) continue;
        const gain = rim[i] - noRim[i];
        if (x < 49 || x > 119) { edgeGain += gain; edgeCount++; } else if (x > 70 && x < 95) { centerGain += gain; centerCount++; }
      }
      result.fresnelAngle = { edge: edgeGain / Math.max(1, edgeCount), center: centerGain / Math.max(1, centerCount) };
      style('a', { mode: 'original', shader: 'standard', environment: 'none', ambientIntensity: 3, keyIntensity: 3, fillIntensity: 0, rimIntensity: 0, lightRotation: 0 });
      result.restoration = difference(original, frame('a', .4)).total;
      result.originalMaterialRestored = mesh('a').material === originalMaterial;
      result.originalMapIntact = sourceMap === mesh('a').material.map && !disposal.textures.includes(sourceMap.uuid);
      result.loop = difference(frame('a', .25), frame('a', 2.25)).total;
      const forward = frame('a', .7); frame('a', 1.8); result.reverseSeek = difference(forward, frame('a', .7)).total;
      layers.set('a', { ...layers.get('a'), loop: false }); scenes.get('a').updateLayer(layers.get('a'));
      result.clamp = difference(frame('a', 2), frame('a', 9)).total;
      frame('a', 9); result.clampReverse = difference(forward, frame('a', .7)).total;
      layers.set('a', { ...layers.get('a'), loop: true }); scenes.get('a').updateLayer(layers.get('a'));
      result.clipSwitch = difference(frame('a', 1), (() => { style('a', { animationClip: 1 }); return frame('a', 1); })());
      const stretch = frame('a', 1); style('a', { animationSpeed: 2 }); result.clipSpeed = difference(stretch, frame('a', .5)).total;
      style('a', { animationSpeed: 0 }); result.clipFreeze = difference(frame('a', .3), frame('a', 1.5)).total;
      style('a', { animationClip: -1 }); const staticFrame = frame('a', 1);
      result.clipDisabled = difference(staticFrame, frame('a', .2)).total;
      result.motions = [];
      for (const motion of ['spin', 'rock', 'float', 'pulse']) {
        style('a', { motion, motionDuration: 2, motionSpeed: 1, motionAmplitude: 1 }); const moving = frame('a', .5);
        const repeated = frame('a', 2.5); frame('a', 1.4); const reversedSeek = frame('a', .5);
        style('a', { motionSpeed: -1 }); const reverse = frame('a', 1.5);
        style('a', { motionSpeed: 0 }); const frozen = difference(frame('a', .5), frame('a', 1.5)).total;
        result.motions.push({ motion, visible: difference(staticFrame, moving), loop: difference(moving, repeated).total, seek: difference(moving, reversedSeek).total, reverse: difference(moving, reverse).total, frozen });
      }
      style('a', { motion: 'rock', motionSpeed: 1 }); const additive = frame('a', .5, { tilt: 5, yaw: 35, roll: 7 });
      style('a', { motion: 'none' }); result.additivePose = difference(additive, frame('a', .5, { tilt: 5, yaw: 35, roll: 27 })).total;
      style('a', { motion: 'rock', motionAmplitude: 0 }); result.zeroAmplitude = difference(staticFrame, frame('a', .5)).total;
      result.axes = [];
      for (const motion of ['spin', 'rock', 'float', 'pulse']) {
        const frames = [];
        for (const motionAxis of ['x', 'y', 'z']) {
          style('a', { motion, motionAxis, motionDuration: 4, motionAmplitude: 1, motionSpeed: 1 });
          frames.push(frame('a', 1));
        }
        result.axes.push({ motion, xy: difference(frames[0], frames[1]), yz: difference(frames[1], frames[2]), zx: difference(frames[2], frames[0]) });
      }
      style('a', { motion: 'spin', motionAxis: 'x', motionSteps: 4, motionTiming: { mode: 'steps', action: .5, pause: .75, curve: 'linear', intensity: .5 } });
      const endpoint = frame('a', .5);
      result.actionHold = [.6, 1, 1.249, 1.25].map(time => difference(endpoint, frame('a', time)).total);
      const expectedQuarter = frame('a', 1.25, { tilt: 5, yaw: 35, roll: 7 });
      style('a', { motion: 'none' }); result.axisAdditivePose = difference(expectedQuarter, frame('a', 1.25, { tilt: 95, yaw: 35, roll: 7 })).total;
      // A held quarter turn equals the static pose turned about the screen (premultiplied) or the model's own axis (postmultiplied).
      const quarterPose = { tilt: 30, yaw: 20, roll: 10 };
      const composed = (space, axis) => {
        const pose = new THREE.Quaternion().setFromEuler(new THREE.Euler(...[30, 20, 10].map(THREE.MathUtils.degToRad), 'XYZ')), turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis), Math.PI / 2);
        if (space === 'screen') pose.premultiply(turn); else pose.multiply(turn);
        const euler = new THREE.Euler().setFromQuaternion(pose, 'XYZ');
        return { tilt: THREE.MathUtils.radToDeg(euler.x), yaw: THREE.MathUtils.radToDeg(euler.y), roll: THREE.MathUtils.radToDeg(euler.z) };
      };
      result.spaces = []; const turned = {};
      for (const motionSpace of ['screen', 'object']) for (const [motionAxis, axis] of [['x', [1, 0, 0]], ['y', [0, 1, 0]], ['z', [0, 0, 1]]]) {
        style('a', { motion: 'spin', motionAxis, motionSpace });
        const moving = turned[motionSpace + motionAxis] = frame('a', 1.25, quarterPose);
        style('a', { motion: 'none' });
        result.spaces.push({ motionSpace, motionAxis, delta: difference(moving, frame('a', 1.25, composed(motionSpace, axis))).total });
      }
      result.spaceContrast = ['x', 'y', 'z'].map(axis => difference(turned['screen' + axis], turned['object' + axis]));
      style('a', { motionSpace: 'euler', motionAxis: 'x' });
      style('a', { motion: 'spin' });
      const linearAction = frame('a', .15);
      style('a', { motionTiming: { mode: 'steps', action: .5, pause: .75, curve: 'spring', intensity: 1 } }); result.actionCurve = difference(linearAction, frame('a', .15));
      const springEndpoint = frame('a', .5); result.springHold = difference(springEndpoint, frame('a', 1)).total;
      style('a', { motion: 'none', motionAxis: 'auto', motionDuration: 2, motionTiming: DEFAULT_MODEL_STYLE.motionTiming }); result.axisReset = difference(staticFrame, frame('a', .5)).total;
      const stableRenderer = captures.get('a').renderer, programCount = stableRenderer.info.programs.length, materialVersion = mesh('a').material.version;
      for (const time of [.2, 1.9, .2, 2.4, .6]) frame('a', time);
      result.stablePrograms = stableRenderer.info.programs.length === programCount && mesh('a').material.version === materialVersion;
      style('a', { motionAmplitude: 1 });
      style('a', { motion: 'float', motionSpeed: 1, animationClip: 1, animationSpeed: 1 }); frame('a', .75); const movingScale = mesh('a').scale.toArray();
      style('a', { motion: 'none' }); frame('a', .75); result.motionClipIndependent = JSON.stringify(movingScale) === JSON.stringify(mesh('a').scale.toArray());
      style('a', { motion: 'float', animationClip: 0, animationSpeed: 3 }); frame('a', .75); const floatPose = captures.get('a').scene.children.find(child => child.isGroup && child.children.some(node => node.isGroup)).position.y;
      style('a', { animationClip: 1, animationSpeed: .5 }); frame('a', .75); result.clipMotionIndependent = floatPose === captures.get('a').scene.children.find(child => child.isGroup && child.children.some(node => node.isGroup)).position.y;
      style('a', { motion: 'spin', motionAxis: 'z', animationClip: 1, animationSpeed: 1, motionTiming: { mode: 'steps', action: .5, pause: 1, curve: 'bounce', intensity: 1 } });
      const holdA = frame('a', .6), clipA = mesh('a').scale.toArray();
      const automaticGroup = captures.get('a').scene.children.find(child => child.isGroup && child.children.some(node => node.isGroup));
      const groupA = automaticGroup.rotation.toArray();
      const holdB = frame('a', 1.1), clipB = mesh('a').scale.toArray();
      result.clipDuringActionHold = difference(holdA, holdB);
      result.actionGroupHeld = JSON.stringify(groupA) === JSON.stringify(automaticGroup.rotation.toArray());
      result.clipAdvancedDuringHold = JSON.stringify(clipA) !== JSON.stringify(clipB);
      style('a', { motionAxis: 'x', motionTiming: { mode: 'continuous', action: 1, pause: 0, curve: 'spring', intensity: 1 } }); frame('a', 1.1);
      result.timingClipIndependent = JSON.stringify(clipB) === JSON.stringify(mesh('a').scale.toArray());
      try { style('a', { animationClip: 7 }); } catch (error) { result.invalidClip = error.message; }
      result.metadata = getModelMetadata(src);
      style('a', { animationClip: -1, motion: 'none', environment: 'studio', environmentIntensity: 1, mode: 'replace', shader: 'standard' }); const beforeRestore = frame('a', 0);
      const shared = captures.get('a').renderer, gl = shared.getContext(), extension = gl.getExtension('WEBGL_lose_context');
      if (!extension) throw new Error('Browser does not expose WEBGL_lose_context for recovery verification.');
      const lost = new Promise(resolve => shared.domElement.addEventListener('webglcontextlost', resolve, { once: true })); extension.loseContext(); await lost;
      const restored = new Promise(resolve => shared.domElement.addEventListener('webglcontextrestored', () => requestAnimationFrame(resolve), { once: true })); await new Promise(resolve => setTimeout(resolve, 100)); extension.restoreContext(); await restored;
      result.contextRestore = difference(beforeRestore, frame('a', 0)).total;
      result.environmentRecovered = captures.get('a').scene.environment !== environment;
      const held = resources.acquire('model\\n' + src, () => { throw new Error('Shared decoded source must not reload.'); }); const source = await held.value;
      let sourceMaterial; source.scene.traverse(node => { if (node.isMesh && !sourceMaterial) sourceMaterial = node.material; });
      const ownedMaterial = mesh('a').material, targetTexture = captures.get('a').scene.environment;
      scenes.get('a').dispose(); scenes.delete('a');
      result.ownedDisposed = disposal.materials.includes(ownedMaterial.uuid) && disposal.targets.includes(targetTexture.uuid);
      result.sourceSurvives = !disposal.materials.includes(sourceMaterial.uuid) && !disposal.textures.includes(sourceMap.uuid);
      result.neighborAfterDispose = difference(neighbor, frame('b', .4)).total;
      scenes.get('b').dispose(); scenes.delete('b'); held.release(); await Promise.resolve();
      result.metadataReleased = getModelMetadata(src) === null;
      const coloredSrc = await fixture(false, { vertexColors: true, opacity: .35 });
      await mount('colored', coloredSrc); const coloredOriginal = frame('colored', .4);
      style('colored', { mode: 'replace', color: '#ff0000' }); const solidRed = frame('colored', .4);
      let redPixels = 0;
      for (let i = 0; i < solidRed.length; i += 4) if (solidRed[i] > 200 && solidRed[i + 1] < 50 && solidRed[i + 2] < 50 && solidRed[i + 3] > 250) redPixels++;
      result.uniformReplacementPixels = redPixels;
      style('colored', { mode: 'original' }); result.coloredRestoration = difference(coloredOriginal, frame('colored', .4)).total;
      await mount('unlit', unlitSrc); result.unlitMetadata = getModelMetadata(unlitSrc).unlit;
      const unlit = frame('unlit', .4); style('unlit', { shader: 'fresnel', fresnelIntensity: 2 }); result.unlitSurface = difference(unlit, frame('unlit', .4));
      // Editor geometry: the reported silhouette contains the drawn pixels and hit-tests geometry only.
      const posed = frame('unlit', .4), drawnBox = opaqueBox(posed, 192), geometry = modelCanvasGeometry(canvas('unlit')), bounds = geometry.bounds();
      result.silhouette = { drawn: drawnBox, bounds: { left: bounds.x * 192, top: bounds.y * 192, right: (bounds.x + bounds.width) * 192, bottom: (bounds.y + bounds.height) * 192 } };
      result.hitCenter = geometry.hitTest((drawnBox.left + drawnBox.right) / 384, (drawnBox.top + drawnBox.bottom) / 384);
      result.hitCorner = geometry.hitTest(.01, .01);
      // The canvas holds the largest keyframed size at the composition width, capped.
      const sized = layers.get('unlit'), resolution = [canvas('unlit').width];
      scenes.get('unlit').updateLayer({ ...sized, size: 50 }); resolution.push(canvas('unlit').width);
      scenes.get('unlit').updateLayer({ ...sized, size: 50, choreography: [{ id: 'grow', time: 1, easing: 'linear', values: { size: 150 } }] }); resolution.push(canvas('unlit').width);
      scenes.get('unlit').setCompositionWidth(4000); resolution.push(canvas('unlit').width);
      result.resolution = resolution;
      // A unit cube's diagonal reaches past the fixed camera; fit framing keeps every pose and motion inside.
      const cubeSrc = await fixture(false, { cube: true }), diagonal = { tilt: 90, yaw: 45, roll: 0 };
      await mount('fixedCube', cubeSrc); result.fixedCrop = border(frame('fixedCube', 0, diagonal), 192);
      await mount('fitCube', cubeSrc, undefined, { framing: 'fit' }); result.fitCrop = 0;
      for (const motion of ['none', 'spin', 'rock', 'float', 'pulse']) for (const motionAxis of ['x', 'y', 'z']) {
        style('fitCube', { motion, motionAxis, motionDuration: 4, motionAmplitude: 1 });
        for (const time of [0, .5, 1, 1.5, 2, 2.5, 3, 3.5]) for (const draft of [diagonal, { tilt: 35.26, yaw: 45, roll: 0 }, { tilt: 0, yaw: 0, roll: 45 }]) result.fitCrop = Math.max(result.fitCrop, border(frame('fitCube', time, draft), 192));
      }
      // Grow reaches 1.8× mid-clip, so its rest pose frames smaller than without the clip.
      style('fitCube', { motion: 'none' }); const withClip = opaque(frame('fitCube', 0, { tilt: 20, yaw: 30, roll: 0 }));
      style('fitCube', { animationClip: -1 }); result.clipEnvelope = [withClip, opaque(frame('fitCube', 0, { tilt: 20, yaw: 30, roll: 0 }))];
      // Without the clip the cube fills its envelope; wider fields of view only distort depth.
      const coverage = perspective => { style('fitCube', { perspective }); return opaque(frame('fitCube', 0, { tilt: 20, yaw: 30, roll: 0 })); };
      result.perspectiveCoverage = [coverage(20), coverage(38), coverage(70)];
      style('fitCube', { perspective: 38, zoom: 1.25 }); result.zoomCoverage = opaque(frame('fitCube', 0, { tilt: 20, yaw: 30, roll: 0 }));
      // Brushing needs UVs: on a mesh without them it is ignored instead of drawing NaN tangents.
      const flatSrc = await fixture(false, { cube: true, uv: false }), flatPose = { tilt: 25, yaw: 35, roll: 0 };
      await mount('flatCube', flatSrc, { ...surfaceBase, animationClip: -1 }); const flatPlain = frame('flatCube', 0, flatPose);
      style('flatCube', { anisotropy: .9 }); const flatBrushed = frame('flatCube', 0, flatPose);
      result.unbrushedWithoutUv = { delta: difference(flatPlain, flatBrushed).total, visible: opaque(flatBrushed) };
      // More models than the browser's live-context limit share one renderer and all stay visible.
      const many = [];
      for (let i = 0; i < 20; i++) { await mount('many-' + i, src, undefined, { compositionWidth: 96 }); many.push(opaque(frame('many-' + i, .4))); }
      result.manyVisible = Math.min(...many); result.manyFirstAfter = opaque(frame('many-0', .4));
      result.sharedRenderers = new Set(many.map((_, i) => captures.get('many-' + i).renderer)).size;
      for (const instance of scenes.values()) instance.dispose(); await Promise.resolve(); urls.forEach(url => URL.revokeObjectURL(url));
      result.errors = errors; result.resourcesReleased = resources.size === 0;
      return result;
    };
  ` }, bundle: true, write: false, format: 'iife' });
  const angle = process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d11' : 'gl-egl';
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', `--use-angle=${angle}`, '--force-color-profile=srgb'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
  await page.setRequestInterception(true);
  page.on('request', request => { if (/^https?:/.test(request.url())) { failures.push(`Unexpected external request: ${request.url()}`); request.abort(); } else request.continue(); });
  await page.setContent('<!doctype html><body></body>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(() => window.exerciseModels());
  const visible = (delta, label) => assert.ok(delta.changed > 30 && delta.total > 500, `${label} must visibly affect actual geometry pixels: ${JSON.stringify(delta)}`);
  assert.deepEqual(failures, [], 'no shader compilation errors or external assets');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.parity, [0, 0, 0, 0], 'default mode must match the pre-controls renderer exactly');
  assert.ok(result.v9MotionParity.every(delta => delta === 0), 'native continuous auto must preserve every v9 motion pixel');
  assert.equal(result.sharedGeometry, true); assert.equal(result.sharedMaterial, false);
  visible(result.tint, 'Tint'); visible(result.replace, 'Replacement');
  assert.equal(result.tintMapPreserved, true); assert.equal(result.replaceMapDropped, true);
  assert.equal(result.neighbor, 0); assert.equal(result.neighborAfterDispose, 0);
  for (const preset of result.presets) assert.ok(preset.visible > 1000, `${preset.id} must draw actual geometry`);
  for (let i = 1; i < result.presets.length; i++) assert.notDeepEqual(result.presets[i].pixels, result.presets[i - 1].pixels, 'adjacent presets must have distinct visible surfaces');
  visible(result.environmentRotation, 'Environment rotation'); visible(result.environmentIntensity, 'Environment intensity'); visible(result.lightRig, 'Lighting rig');
  for (const shader of result.shaders) visible(shader.delta, shader.shader);
  assert.ok(result.shaders.find(item => item.shader === 'wireframe').coverage < result.standardCoverage * .8, 'wireframe shows triangle edges, not a recolored filled surface');
  visible(result.toonSteps, 'Toon steps'); visible(result.fresnel, 'Fresnel intensity');
  assert.ok(result.fresnelAngle.edge > result.fresnelAngle.center, `rim depends on view angle: ${JSON.stringify(result.fresnelAngle)}`);
  assert.equal(result.restoration, 0); assert.equal(result.originalMaterialRestored, true); assert.equal(result.originalMapIntact, true);
  assert.equal(result.loop, 0); assert.equal(result.reverseSeek, 0); visible(result.clipSwitch, 'Clip selection');
  assert.equal(result.clipSpeed, 0); assert.equal(result.clipFreeze, 0); assert.equal(result.clipDisabled, 0);
  assert.equal(result.clamp, 0); assert.equal(result.clampReverse, 0);
  for (const motion of result.motions) { visible(motion.visible, motion.motion); for (const key of ['loop', 'seek', 'reverse', 'frozen']) assert.equal(motion[key], 0, `${motion.motion} ${key} must be deterministic`); }
  assert.ok(result.additivePose < 20, 'automatic motion adds to draft/authored pose instead of replacing it'); assert.equal(result.zeroAmplitude, 0); assert.equal(result.stablePrograms, true);
  for (const axis of result.axes) for (const pair of ['xy', 'yz', 'zx']) visible(axis[pair], axis.motion + ' axes ' + pair);
  assert.deepEqual(result.actionHold, [0, 0, 0, 0], 'Actions holds the completed X quarter turn');
  assert.ok(result.axisAdditivePose < 20, 'X motion adds to draft tilt');
  visible(result.actionCurve, 'Spring character in Actions');
  assert.equal(result.springHold, 0); assert.equal(result.axisReset, 0);
  assert.equal(result.motionClipIndependent, true); assert.equal(result.clipMotionIndependent, true); assert.match(result.invalidClip, /clip 7 does not exist/);
  visible(result.clipDuringActionHold, 'Embedded clip during automatic action hold');
  assert.equal(result.actionGroupHeld, true); assert.equal(result.clipAdvancedDuringHold, true); assert.equal(result.timingClipIndependent, true);
  assert.deepEqual(result.metadata.clips.map(clip => clip.name), ['Turn', 'Stretch']); assert.equal(result.metadata.unlit, false); assert.equal(result.unlitMetadata, true); visible(result.unlitSurface, 'Adapted unlit surface');
  assert.equal(result.contextRestore, 0); assert.equal(result.environmentRecovered, true); assert.equal(result.ownedDisposed, true); assert.equal(result.sourceSurvives, true);
  assert.ok(result.uniformReplacementPixels > 1500, 'Replace produces an opaque chosen color instead of multiplying imported vertex colors/alpha');
  assert.equal(result.coloredRestoration, 0, 'Original restores imported vertex color and transparency');
  assert.equal(result.metadataReleased, true); assert.equal(result.resourcesReleased, true);
  const { drawn, bounds } = result.silhouette;
  assert.ok(bounds.left <= drawn.left + 1 && bounds.top <= drawn.top + 1 && bounds.right >= drawn.right - 1 && bounds.bottom >= drawn.bottom - 1, `silhouette bounds contain every drawn pixel: ${JSON.stringify(result.silhouette)}`);
  assert.ok(bounds.right - bounds.left < 192 * .9 && (bounds.right - bounds.left) <= (drawn.right - drawn.left) * 1.5, `silhouette bounds stay close to the drawn model, not its canvas: ${JSON.stringify(result.silhouette)}`);
  assert.equal(result.hitCenter, true); assert.equal(result.hitCorner, false, 'transparent canvas pixels do not hit the model');
  assert.ok(result.toneMapping.clippedWhite > 300 && result.toneMapping.neutralWhite < result.toneMapping.clippedWhite * .5 && result.toneMapping.agxWhite < result.toneMapping.clippedWhite * .5, `tone mapping keeps highlights from clipping to flat white: ${JSON.stringify(result.toneMapping)}`);
  visible(result.toneMapping.neutral, 'Neutral tone mapping'); visible(result.toneMapping.agx, 'AgX differs from Neutral'); visible(result.exposure, 'Exposure');
  for (const environment of result.environments) assert.ok(environment.visible > 1000, `${environment.environment} reflects on metal`);
  for (const contrast of result.environmentContrast) visible(contrast, 'Distinct environments');
  visible(result.keyColor.delta, 'Key light color'); assert.ok(result.keyColor.redder > 300, `a red key light tints lit pixels: ${result.keyColor.redder}`);
  visible(result.brushed, 'Brushed anisotropy'); visible(result.coatRoughness, 'Clearcoat roughness'); visible(result.sheen, 'Sheen'); visible(result.film, 'Iridescent film index and thickness'); visible(result.filmVaries, 'Film thickness range varying over the surface');
  assert.deepEqual(result.unbrushedWithoutUv.delta, 0, 'brushing is ignored on meshes without UVs'); assert.ok(result.unbrushedWithoutUv.visible > 1000);
  assert.deepEqual(result.resolution, [192, 96, 288, 4096], 'canvas follows layer size, keyframed size and composition width, capped');
  assert.ok(result.fixedCrop > 0, 'fixed framing crops a rotated cube diagonal, as before');
  assert.equal(result.fitCrop, 0, 'fit framing keeps every rotation and automatic motion inside the layer');
  const [narrow, normal, wide] = result.perspectiveCoverage;
  assert.ok(Math.max(narrow, normal, wide) / Math.min(narrow, normal, wide) < 1.35, `perspective changes distortion, not framed size: ${result.perspectiveCoverage}`);
  assert.ok(result.zoomCoverage > normal * 1.4 && result.zoomCoverage < 192 * 192, `zoom 125% magnifies the framed model by about 1.56× in area: ${result.zoomCoverage} vs ${normal}`);
  assert.ok(result.clipEnvelope[0] < result.clipEnvelope[1] * .5, `fit framing reserves room for the embedded clip: ${result.clipEnvelope}`);
  assert.ok(result.manyVisible > 500 && result.manyFirstAfter > 500, `twenty models stay visible together: ${result.manyVisible}, ${result.manyFirstAfter}`);
  for (const space of result.spaces) assert.ok(space.delta < 20, `${space.motionSpace} ${space.motionAxis} spin turns about the ${space.motionSpace === 'screen' ? 'view' : 'model'} axis: ${space.delta}`);
  for (const contrast of result.spaceContrast) visible(contrast, 'Screen and Object axes on a posed model');
  assert.equal(result.sharedRenderers, 1);
});
