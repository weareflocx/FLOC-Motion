import * as THREE from 'three';
import { normalizeDataFlowStyle } from './data-flow-style.js';
import { createDataFlowLayout, dataFlowTime, dataFlowPosition, dataFlowParticlePosition, DATA_FLOW_LENGTH, DATA_FLOW_START, DATA_FLOW_VISIBLE_MIN, DATA_FLOW_VISIBLE_MAX } from './data-flow.js';
import { evaluateChoreography } from './choreography.js';
import { sceneDimensions, scenePosition, projectedObjectBounds } from './scene-camera.js';
import { createScenePass, SCENE_PASS, SCENE_PASS_PARS, SCENE_PASS_FRAGMENT, setSceneMaterialPass } from './scene-pass.js';

const CENTER = (DATA_FLOW_VISIBLE_MIN + DATA_FLOW_VISIBLE_MAX) / 2;
const EXTENT = DATA_FLOW_VISIBLE_MAX - DATA_FLOW_VISIBLE_MIN;
const VERTEX = `
attribute vec3 flowStart; attribute vec3 flowEnd;
uniform vec2 uResolution; uniform float uPixelScale; uniform float uWidth;
varying vec2 vShape; varying float vX; varying float vDistance;
void main(){
  vec4 start=modelViewMatrix*vec4(flowStart,1.0);
  vec4 end=modelViewMatrix*vec4(flowEnd,1.0);
  float width=max(uWidth*uPixelScale,1.0);
  #ifdef FLOW_LINE
    // Trim screen ribbons at the near plane before their perspective divide.
    if(start.z>-.01&&end.z<=-.01)start=mix(start,end,(-.01-start.z)/(end.z-start.z));
    if(end.z>-.01&&start.z<=-.01)end=mix(end,start,(-.01-end.z)/(start.z-end.z));
    vec4 a=projectionMatrix*start, b=projectionMatrix*end;
    vec2 direction=(b.xy/max(b.w,.00001)-a.xy/max(a.w,.00001))*uResolution;
    vec2 normal=vec2(-direction.y,direction.x)/max(length(direction),.00001);
    float along=position.x*.5+.5;
    vec4 clip=mix(a,b,along);
    clip.xy+=normal*position.y*width/uResolution*clip.w;
    gl_Position=clip;
    vX=mix(flowStart.x,flowEnd.x,along);
    vDistance=length(mix(flowStart,flowEnd,along)-vec3(0.0,0.0,150.0));
  #else
    vec4 clip=projectionMatrix*start;
    clip.xy+=position.xy*width/uResolution*clip.w;
    gl_Position=clip;
    vX=flowStart.x; vDistance=length(flowStart-vec3(0.0,0.0,150.0));
  #endif
  vShape=position.xy;
}`;
const FRAGMENT = `${SCENE_PASS_PARS}
uniform vec3 uColor; uniform float uAlpha; uniform float uFog; uniform float uTime;
uniform float uWidth; uniform float uPixelScale;
uniform float uNodeDistance; uniform float uSharpness; uniform float uFlowSpeed; uniform float uTravelSpeed;
varying vec2 vShape; varying float vX; varying float vDistance;
void main(){
  float fade=smoothstep(-30.0,50.0,vX)*(1.0-smoothstep(150.0,350.0,vX));
  float radius;
  #ifdef FLOW_LINE
    radius=abs(vShape.y);
  #else
    radius=length(vShape);
  #endif
  if(radius>=1.0||fade<=0.0)discard;
  float alpha;
  #ifdef FLOW_HALO
    alpha=(exp(-radius*radius*5.0)-exp(-5.0))/(1.0-exp(-5.0));
    #ifdef FLOW_LINE
      float phase=(vX-60.0+uTime*(uTravelSpeed-uFlowSpeed))/uNodeDistance;
      float pinch=pow(.5+.5*cos(phase*6.28318530718),uSharpness);
      alpha*=.035+.14*(1.0-pinch);
    #else
      alpha*=.28;
    #endif
  #else
    alpha=1.0-smoothstep(.7,1.0,radius);
  #endif
  // Rasterize subpixel cores at one pixel, preserving their integrated coverage
  // rather than letting a tiny quad miss every sample in a low-resolution view.
  float coverage=min(uWidth*uPixelScale,1.0);
  #ifndef FLOW_LINE
    coverage*=coverage;
  #endif
  alpha*=coverage;
  alpha*=uAlpha*fade*exp(-uFog*uFog*vDistance*vDistance);
  if(alpha<=.00001)discard;
  gl_FragColor=vec4(uColor,clamp(alpha,0.0,1.0));
  #include <colorspace_fragment>
  #include <premultiplied_alpha_fragment>
  ${SCENE_PASS_FRAGMENT}
}`;

function ribbons(starts, ends) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1,-1,0, 1,-1,0, 1,1,0, -1,1,0], 3));
  geometry.setIndex([0,1,2, 0,2,3]);
  geometry.setAttribute('flowStart', starts); geometry.setAttribute('flowEnd', ends);
  geometry.instanceCount = starts.count;
  return geometry;
}
function attribute(count) { return new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage); }

// A native leaf, not a model or an offscreen WebGL context. Lines and pulses use
// instanced screen-space quads so width works on every WebGL2 implementation.
export function createDataFlowScene(canvas, layer, { compositionWidth = canvas.width, compositionHeight = canvas.height, rendering, renderMode = false } = {}) {
  if (!rendering) throw new Error('Data flow requires the shared scene renderer.');
  // Export reads these transparent pixels repeatedly. Fix its backing store
  // before the first draw; Chromium's adaptive GPU→CPU readback otherwise
  // changes RGB alpha-rounding on an identical seek.
  canvas.getContext('2d', { willReadFrequently: renderMode });
  let style = normalizeDataFlowStyle(layer.flowStyle), layout, lineGeometry, pulseGeometry, lineStart, lineEnd, pulsePosition;
  let firstSample = 0, segmentCount = 0, width = compositionWidth, height = compositionHeight;
  let sampled = layer, lastDraft, spatialScale = 1, spatialRadius = 1, disposed = false;
  const scene = new THREE.Scene(), root = new THREE.Group(), content = new THREE.Group();
  scene.add(root); root.add(content);
  const camera = new THREE.PerspectiveCamera(style.perspective, width / height, .1, 2500);
  const pass = createScenePass(), materials = [], meshes = [];
  const viewport = new THREE.Vector4(), sample = new Float32Array(3), previous = new Float32Array(3);
  function material(line, halo) {
    const value = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT,
      defines: { ...(line ? { FLOW_LINE: 1 } : {}), ...(halo ? { FLOW_HALO: 1 } : {}) },
      transparent: true, premultipliedAlpha: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
      uniforms: { ...pass.uniforms, flocSceneOpaque: { value: false }, uResolution: { value: new THREE.Vector2() },
        uPixelScale: { value: 1 }, uWidth: { value: 1 }, uColor: { value: new THREE.Color() }, uAlpha: { value: 1 },
        uFog: { value: 0 }, uTime: { value: 0 }, uNodeDistance: { value: 1 }, uSharpness: { value: 1 }, uFlowSpeed: { value: 0 }, uTravelSpeed: { value: 0 } }
    });
    materials.push(value); return value;
  }
  const lineHalo = material(true, true), pulseHalo = material(false, true), lineCore = material(true, false), pulseCore = material(false, false);
  function rebuild() {
    layout = createDataFlowLayout(style);
    const step = DATA_FLOW_LENGTH / (style.samples - 1);
    firstSample = Math.max(0, Math.floor((DATA_FLOW_VISIBLE_MIN - DATA_FLOW_START) / step));
    const lastSample = Math.min(style.samples - 1, Math.ceil((DATA_FLOW_VISIBLE_MAX - DATA_FLOW_START) / step));
    segmentCount = lastSample - firstSample;
    lineStart = attribute(style.fiberCount * segmentCount); lineEnd = attribute(style.fiberCount * segmentCount);
    pulsePosition = attribute(style.particleCount);
    lineGeometry?.dispose(); pulseGeometry?.dispose();
    lineGeometry = ribbons(lineStart, lineEnd); pulseGeometry = ribbons(pulsePosition, pulsePosition);
    const envelope = style.spread + style.noise;
    for (const geometry of [lineGeometry, pulseGeometry]) {
      geometry.boundingBox = new THREE.Box3(new THREE.Vector3(DATA_FLOW_VISIBLE_MIN, -envelope, -envelope), new THREE.Vector3(DATA_FLOW_VISIBLE_MAX, envelope, envelope));
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(CENTER, 0, 0), Math.hypot(EXTENT / 2, envelope, envelope));
    }
    if (!meshes.length) {
      for (const [geometry, value] of [[lineGeometry,lineHalo], [pulseGeometry,pulseHalo], [lineGeometry,lineCore], [pulseGeometry,pulseCore]]) {
        const mesh = new THREE.Mesh(geometry, value); mesh.frustumCulled = false; mesh.renderOrder = meshes.length;
        meshes.push(mesh); content.add(mesh);
      }
    } else meshes.forEach((mesh, index) => { mesh.geometry = index % 2 ? pulseGeometry : lineGeometry; });
  }
  function applyStyle() {
    for (const value of materials) {
      const u = value.uniforms;
      u.uFog.value = style.fog; u.uNodeDistance.value = style.nodeDistance; u.uSharpness.value = style.pinchSharpness;
      u.uFlowSpeed.value = style.flowSpeed; u.uTravelSpeed.value = style.travelSpeed;
    }
    lineCore.uniforms.uColor.value.set(style.lineColor); lineCore.uniforms.uAlpha.value = style.lineOpacity; lineCore.uniforms.uWidth.value = style.lineWidth;
    pulseCore.uniforms.uColor.value.set(style.particleColor); pulseCore.uniforms.uWidth.value = style.particleSize;
    lineHalo.uniforms.uColor.value.set(style.particleColor); lineHalo.uniforms.uAlpha.value = style.glowStrength * style.lineOpacity;
    lineHalo.uniforms.uWidth.value = style.lineWidth + style.glowRadius * 50;
    pulseHalo.uniforms.uColor.value.set(style.particleColor); pulseHalo.uniforms.uAlpha.value = style.glowStrength;
    pulseHalo.uniforms.uWidth.value = style.particleSize * (2 + style.glowRadius * 16);
    meshes[0].visible = meshes[1].visible = style.glowStrength > 0 && style.glowRadius > 0;
    meshes[2].visible = style.lineOpacity > 0; meshes[3].visible = style.particleCount > 0;
    camera.fov = style.perspective; camera.updateProjectionMatrix();
  }
  function resize() {
    const scale = Math.min(1, rendering.maxSide / Math.max(width, height) / Math.max(layer.size / 100, .01));
    canvas.width = Math.max(1, Math.round(width * layer.size / 100 * scale));
    canvas.height = Math.max(1, Math.round(canvas.width * height / width));
    camera.aspect = width / height; camera.updateProjectionMatrix();
  }
  function configurePixels(w, h, pixelScale = w / 1080) {
    for (const value of materials) {
      value.uniforms.uResolution.value.set(w, h); value.uniforms.uPixelScale.value = pixelScale;
    }
  }
  function draw(time, draft) {
    if (disposed) return;
    lastDraft = draft; sampled = evaluateChoreography(layer, time);
    const clock = dataFlowTime(style, time - layer.start), step = DATA_FLOW_LENGTH / (style.samples - 1);
    const fibers = layout.fibers, starts = lineStart.array, ends = lineEnd.array;
    for (let fiber = 0; fiber < style.fiberCount; fiber++) {
      const k = fiber * 3;
      dataFlowPosition(style, fibers[k], fibers[k + 1], fibers[k + 2], DATA_FLOW_START + firstSample * step, clock, previous);
      for (let segment = 0; segment < segmentCount; segment++) {
        const offset = (fiber * segmentCount + segment) * 3;
        dataFlowPosition(style, fibers[k], fibers[k + 1], fibers[k + 2], DATA_FLOW_START + (firstSample + segment + 1) * step, clock, sample);
        for (let axis = 0; axis < 3; axis++) { starts[offset + axis] = previous[axis]; ends[offset + axis] = sample[axis]; previous[axis] = sample[axis]; }
      }
    }
    for (let i = 0; i < style.particleCount; i++) dataFlowParticlePosition(style, layout, i, clock, pulsePosition.array, i * 3);
    lineStart.needsUpdate = lineEnd.needsUpdate = pulsePosition.needsUpdate = true;
    for (const value of materials) value.uniforms.uTime.value = clock;
    if (layer.space === 'spatial') return;
    root.position.set(CENTER, 0, 0); root.scale.setScalar(1); content.position.x = -CENTER;
    root.rotation.set(THREE.MathUtils.degToRad(draft?.tilt ?? sampled.tilt ?? 0), THREE.MathUtils.degToRad(draft?.yaw ?? sampled.yaw ?? 0), THREE.MathUtils.degToRad(draft?.roll ?? sampled.roll ?? 0));
    camera.position.set(0, Math.sin(clock * .2) * 8, 140 + Math.cos(clock * .15) * 10); camera.lookAt(100, 0, 0); camera.updateMatrixWorld(true);
    configurePixels(canvas.width, canvas.height); setPass(SCENE_PASS.source);
    if (rendering.lost) { if (renderMode) throw new Error('The shared graphics context was lost while rendering Data flow.'); return; }
    rendering.draw(scene, camera, canvas);
  }
  function prepareSpatial(format) {
    const value = lastDraft ? { ...sampled, ...lastDraft } : sampled, frame = sceneDimensions(format);
    const side = frame.width * value.size / 100;
    spatialScale = side / EXTENT;
    spatialRadius = Math.hypot(EXTENT / 2, style.spread + style.noise, style.spread + style.noise) * spatialScale;
    root.scale.setScalar(spatialScale); content.position.x = -CENTER;
    scenePosition(format, value.x, value.y, value.z, root.position);
    root.position.x += side / 2; root.position.y -= frame.height * value.size / 200;
    root.rotation.set(THREE.MathUtils.degToRad(value.tilt ?? 0), THREE.MathUtils.degToRad(value.yaw ?? 0), THREE.MathUtils.degToRad(value.roll ?? 0));
    scene.updateMatrixWorld(true); return root;
  }
  function setPass(value, opacity = 1, id = 0, options = {}) {
    // A flow is a transparent leaf, including alpha-one pulse cores. Sending
    // those cores through the transparent-only cutoff would silently lose them.
    const effective = value === SCENE_PASS.transparent ? SCENE_PASS.all : value;
    pass.set(effective, opacity, id);
    for (const material of materials) setSceneMaterialPass(material, effective, options);
  }
  rebuild(); applyStyle(); resize();
  return {
    id: layer.id, draw, prepareSpatial,
    updateLayer(value) {
      const next = normalizeDataFlowStyle(value.flowStyle);
      const topology = ['seed', 'fiberCount', 'particleCount', 'samples', 'spread', 'noise'].some(key => next[key] !== style[key]);
      layer = value; style = next; if (topology) rebuild(); applyStyle(); resize();
    },
    renderSpatial(outputCamera, value, opacity = 1, id = 0, options = {}) {
      if (disposed || value === SCENE_PASS.opaque || value === SCENE_PASS.opaqueDepth) return;
      rendering.renderer.getViewport(viewport);
      configurePixels(viewport.z, viewport.w, viewport.z / 1080 * (lastDraft?.size ?? sampled.size) / 100);
      setPass(value, opacity, id, options);
      rendering.renderer.toneMapping = THREE.NoToneMapping; rendering.renderer.toneMappingExposure = 1;
      rendering.renderer.render(scene, outputCamera);
    },
    get spatialRoot() { return root; }, get spatialRadius() { return spatialRadius; }, get sourceScene() { return scene; },
    projectedBounds(outputCamera) { return projectedObjectBounds(root, outputCamera); },
    sourceBounds() {
      const bounds = projectedObjectBounds(root, camera);
      return bounds ? { x: bounds.x / 100, y: bounds.y / 100, width: bounds.width / 100, height: bounds.height / 100 } : null;
    },
    setResolution(w, h) { width = w; height = h; resize(); },
    dispose() { if (disposed) return; disposed = true; lineGeometry.dispose(); pulseGeometry.dispose(); materials.forEach(value => value.dispose()); content.clear(); scene.clear(); canvas.width = canvas.height = 1; }
  };
}
