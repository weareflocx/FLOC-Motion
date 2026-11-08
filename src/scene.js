import { createModelScene } from './model-scene.js';
import { createDataFlowScene } from './data-flow-scene.js';
import { cardMediaKind, cardVideoSource, cardMediaTime, cardFrameIndex, videoFrameIndex, videoFrameSource, waitForVideo, seekCardVideo, playMedia, pauseMedia } from './card-media.js';
import { carouselCard, motionVariant, elasticState, cardMetrics, ringRadius, kineticMosaicCellProgress } from './carousel-motion.js';
import * as THREE from 'three';
import { fontFamily, fontStack } from './fonts.js';
import { FORMATS, escapeHtml, layerAlpha, audioTime, demoProject, carouselImages } from './project.js';
import { constrainPlacement, fitsSafeArea, rotatedTextBounds, safeArea } from './layout.js';
import { animatedFields, evaluateChoreography } from './choreography.js';
import { drawProceduralBackground } from './backgrounds.js';
import { textTypography } from './text-style.js';
import { textMotionAt, textMotionStyle } from './text-motion.js';
import { createEffects } from './effects.js';
import { createResourceCache } from './scene-resources.js';
import { sceneUpdatePlan } from './scene-update.js';
import { createSceneCapture } from './scene-capture.js';
import { createSceneRenderer } from './scene-renderer.js';
import { createSceneCameras, sceneDimensions, projectedObjectBounds, SCENE_VIEW_HEIGHT } from './scene-camera.js';
import { createScenePass, SCENE_PASS, SCENE_PASS_PARS, SCENE_PASS_FRAGMENT, setSceneMaterialPass } from './scene-pass.js';
import { createSceneWorld } from './scene-world.js';
import { elementMotionAt } from './element-motion.js';
import { hasElementTransform } from './element-motion-render.js';

export function stageMarkup(p, path = src => src, { videoFrames = {} } = {}) {
  const [w, h] = FORMATS[p.format];
  const esc = escapeHtml;
  return p.layers.map((l, i) => {
    const timing = `data-start="${l.start}" data-duration="${l.end - l.start}" data-track-index="${i}"`;
    const common = `data-floc-layer="${esc(l.id)}" style="position:absolute;z-index:${i};opacity:${l.visible ? 1 : 0};`;
    if (l.type === 'effect') return `<canvas ${timing} ${common}inset:0;width:${w}px;height:${h}px;pointer-events:none" width="${w}" height="${h}"></canvas>`;
    if (l.type === 'background') {
      if (l.mode === 'procedural') return `<canvas id="background-${esc(l.id)}" ${timing} ${common}inset:0;width:${w}px;height:${h}px" width="${w}" height="${h}"></canvas>`;
      if (l.mode === 'color' || !l.src) return `<div ${timing} ${common}inset:0;background:${l.color}"></div>`;
      const fill = `<div style="position:absolute;inset:0;background:${l.color}"></div>`;
      const style = `data-floc-layer="${esc(l.id)}" data-floc-background-content style="position:absolute;inset:0;width:100%;height:100%;object-fit:${l.fit}">`;
      const frames = videoFrames[l.src];
      const content = l.mode === 'video'
        ? frames
          ? `<canvas id="media-${esc(l.id)}" ${timing} data-floc-video-source="${esc(l.src)}" width="${frames.width}" height="${frames.height}" ${style}</canvas>`
          : `<video id="media-${esc(l.id)}" ${timing} data-media-start="${l.offset}" ${l.loop ? 'loop data-loop="true"' : ''} muted playsinline preload="auto" src="${esc(path(l.src))}" ${style}</video>`
        : `<img alt="" src="${esc(path(l.src))}" ${style}`;
      return `<div ${timing} ${common}inset:0">` + fill + content + '</div>';
    }
    if (l.type === 'carousel') return `<canvas id="carousel-${esc(l.id)}" class="clip" ${timing} ${common}inset:0;width:${w}px;height:${h}px" width="${w}" height="${h}"></canvas>`;
    if (l.type === 'text') {
      const typography = textTypography(l);
      return `<div ${common}left:${l.x}%;top:${l.y}%;width:${l.width}%;font-size:${l.size * w / 1080}px;line-height:${typography.lineHeight};letter-spacing:${typography.letterSpacing};text-align:${typography.textAlign};font-family:${esc(fontStack(l.font))};font-weight:${l.weight};white-space:pre-wrap;overflow-wrap:anywhere;color:${l.color}">${esc(l.text)}</div>`;
    }
    if (l.type === 'logo' && l.src) return `<img alt="Studio mark" src="${esc(path(l.src))}" ${common}left:${l.x}%;top:${l.y}%;width:${l.size}%;height:auto">`;
    if (l.type === 'model') return `<canvas id="model-${esc(l.id)}" class="clip" ${timing} ${common}left:${l.x}%;top:${l.y}%;width:${l.size}%;aspect-ratio:1" width="${w}" height="${w}"></canvas>`;
    if (l.type === 'dataflow') return `<canvas id="dataflow-${esc(l.id)}" class="clip" ${timing} ${common}left:${l.x}%;top:${l.y}%;width:${l.size}%;height:${l.size * h / 100}px" width="${w}" height="${h}"></canvas>`;
    if (l.type === 'media') {
      const style = `${common}left:${l.x}%;top:${l.y}%;width:${l.size}%;height:auto">`;
      if (cardMediaKind(l.src) === 'image') return `<img alt="${esc(l.name)}" src="${esc(path(l.src))}" ${style}`;
      const frames = videoFrames[l.src];
      return frames
        ? `<canvas id="media-${esc(l.id)}" class="clip" ${timing} data-floc-video-source="${esc(l.src)}" width="${frames.width}" height="${frames.height}" ${style}</canvas>`
        : `<video id="media-${esc(l.id)}" class="clip" ${timing} data-media-start="${l.offset}" ${l.loop ? 'loop data-loop="true"' : ''} muted playsinline preload="auto" src="${esc(path(cardVideoSource(l.src)))}" ${style}</video>`;
    }
    if (l.type === 'music' && l.src) return `<audio id="media-${esc(l.id)}" data-floc-layer="${esc(l.id)}" preload="auto" src="${esc(path(l.src))}"></audio>`;
    return '';
  }).join('');
}
// Edge stretch needs denser geometry, and its wings leave the CPU-side bounds.
const stretched = layer => layer.stretch > 0 || animatedFields(layer).includes('stretch');
const vertex = `varying vec2 vUv; uniform float uTorsion; uniform float uElastic; uniform float uSide; uniform float uCardSize;
void main(){vUv=uv;vec3 p=position; if(uElastic>0.0){float edge=pow(clamp(0.5+(uv.x-0.5)*uSide,0.0,1.0),3.0);p.x+=uSide*uElastic*uCardSize*3.5*edge;p.y*=1.0+uElastic*3.0*edge;}float a=p.y*uTorsion; p.xz=mat2(cos(a),-sin(a),sin(a),cos(a))*p.xz;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`;
const fragment = `${SCENE_PASS_PARS}\nvarying vec2 vUv; uniform sampler2D uMap; uniform float uDepth; uniform vec2 uCrop; uniform vec4 uClip; uniform vec2 uWindow; uniform vec2 uCanvasPixels; uniform vec4 uPush; uniform float uImageAspect; uniform float uOpacity; uniform float uCorner; uniform float uAspect; uniform float uShape; uniform float uElastic; uniform float uSide;
uniform float uMosaic; uniform sampler2D uMosaicMap; uniform vec2 uMosaicGrid; uniform vec2 uMosaicCrop; uniform float uMosaicZoom; uniform vec4 uMosaicCells[36];
void main(){
if(vUv.x<uClip.x||vUv.y<uClip.y||vUv.x>uClip.z||vUv.y>uClip.w)discard;
float mask=1.0;
if(uCorner>0.0){
  vec2 halfSize=vec2(uAspect,1.0)*0.5;
  float radius=uCorner*min(uAspect,1.0)*0.5;
  vec2 q=abs((vUv-0.5)*vec2(uAspect,1.0))-halfSize+radius;
  vec2 outside=max(q,0.0);
  float edge=uShape==1.0 ? pow(pow(outside.x,4.0)+pow(outside.y,4.0),0.25) : length(outside);
  float distance=edge+min(max(q.x,q.y),0.0)-radius;
  float aa=max(fwidth(distance),0.00001);
  mask=1.0-smoothstep(-aa,aa,distance);
  if(mask<0.001)discard;
}
vec2 imageUv=vUv;
vec2 crop=uCrop;
if(uWindow.x>0.0){
  vec2 zone=vec2(1.0);
  if(all(lessThan(abs(vUv-0.5),uWindow*0.5))){zone=uWindow;imageUv=(vUv-0.5)/zone+0.5;}
  imageUv-=uPush.xy*(vec2(1.0)+uPush.w/(uCanvasPixels*zone));
  if(any(lessThan(imageUv,vec2(0.0)))||any(greaterThan(imageUv,vec2(1.0))))discard;
  float aspect=uAspect*zone.x/zone.y;
  crop=uImageAspect>aspect ? vec2(aspect/uImageAspect,1.0) : vec2(1.0,uImageAspect/aspect);
}
vec2 uv=(imageUv-0.5)*crop/uPush.z+0.5;
if(uElastic>0.0){float edge=pow(clamp(0.5+(vUv.x-0.5)*uSide,0.0,1.0),2.0);float anchor=uSide>0.0?0.12:0.88;uv.x=mix(uv.x,(anchor-0.5)*uCrop.x+0.5,uElastic*edge*0.85);}
vec4 c=texture2D(uMap,uv);
if(uMosaic>0.0){
  vec2 cell=min(floor(vUv*uMosaicGrid),uMosaicGrid-1.0);
  int index=int(cell.x)+int(cell.y)*int(uMosaicGrid.x);
  float progress=uMosaicCells[index/4][index-index/4*4];
  vec2 tileUv=vUv*uMosaicGrid-cell;
  vec2 assembledUv=mix(tileUv,vUv,1.0-(1.0-progress)*uMosaicZoom);
  vec4 incoming=texture2D(uMosaicMap,(assembledUv-0.5)*uMosaicCrop+0.5);
  // Crossfade premultiplied samples before compositing the layer, so transparent
  // incoming pixels replace (rather than permanently expose) the outgoing image.
  float alpha=mix(c.a,incoming.a,progress);
  vec3 premultiplied=mix(c.rgb*c.a,incoming.rgb*incoming.a,progress);
  c=vec4(alpha>0.0?premultiplied/alpha:vec3(0.0),alpha);
}
if(!gl_FrontFacing)c.rgb*=0.28;c.rgb*=uDepth;gl_FragColor=vec4(c.rgb,c.a*uOpacity*mask);
#include <tonemapping_fragment>
#include <colorspace_fragment>
${SCENE_PASS_FRAGMENT}
}`;

// Values that differ per card. Cards share one material, and cards of equal size
// share one geometry; each card copies these into the material just before it is drawn.
function cardUniforms(texture, imageAspect) {
  return { uMap: { value: texture }, uImageAspect: { value: imageAspect }, uAspect: { value: 1 }, uCrop: { value: new THREE.Vector2(1, 1) }, uCorner: { value: 0 }, uElastic: { value: 0 }, uSide: { value: 0 },
    uClip: { value: new THREE.Vector4(0, 0, 1, 1) }, uPush: { value: new THREE.Vector4(0, 0, 1, 0) }, uDepth: { value: 1 }, uOpacity: { value: 1 }, uTorsion: { value: 0 },
    uMosaic: { value: 0 }, uMosaicMap: { value: texture }, uMosaicGrid: { value: new THREE.Vector2(1, 1) }, uMosaicCrop: { value: new THREE.Vector2(1, 1) }, uMosaicZoom: { value: 0 }, uMosaicCells: { value: new Float32Array(144) } };
}
function resetMosaicUniforms(card) {
  card.uMosaic.value = 0;
  card.uMosaicMap.value = card.uMap.value;
  card.uMosaicGrid.value.set(1, 1);
  card.uMosaicCrop.value.set(1, 1);
  card.uMosaicZoom.value = 0;
  card.uMosaicCells.value.fill(0);
}
function unloadVideo(video) { pauseMedia(video); video.removeAttribute('src'); video.load(); }
async function loadCardVideo(src) {
  const video = document.createElement('video');
  // Load the first frame without eagerly buffering every carousel video while paused.
  video.muted = true; video.playsInline = true; video.preload = 'metadata';
  try {
    await waitForVideo(video, 'loadeddata', () => { video.src = cardVideoSource(src); video.load(); }, () => video.readyState >= 2);
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('Carousel videos must have a finite duration.');
  } catch (error) { unloadVideo(video); throw error; }
  return video;
}

async function createLayerScene(root, p, { renderMode = false, rendering, onMediaError = () => {}, videoFrames = {}, resources } = {}) {
  const [width, height] = FORMATS[p.format];
  const carousel = p.layers.find(l => l.type === 'carousel');
  let layer = carousel || { ...demoProject().layers.find(l => l.type === 'carousel'), visible: false };
  const canvas = (carousel ? root.querySelector(`[id="carousel-${CSS.escape(carousel.id)}"]`) : null) || document.createElement('canvas');
  const renderer = rendering.renderer;
  canvas.width = width; canvas.height = height;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(layer.perspective ?? 38, width / height, 0.1, 100);
  const carouselMotion = {}, carouselProjection = new THREE.Matrix4();
  let transformedProjection = false;
  function updateCamera() {
    camera.position.z = 8 * Math.tan(THREE.MathUtils.degToRad(19)) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    if (layer.template === 'wheel') {
      const sizes = cardSizes(layer);
      const radius = ringRadius(layer, layer.cardCount || p.images.length, sizes, 2.2);
      const largest = sizes.perCard && sizes.widths.length ? Math.max(...sizes.widths.map((w, i) => Math.max(w, w / sizes.aspects[i]))) : Math.max(layer.size, layer.size / layer.cardAspect);
      const extent = radius + largest * 0.6;
      camera.position.z = Math.max(camera.position.z, extent * 1.12 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, width / height)));
    }
  }
  const group = new THREE.Group(); scene.add(group);
  let disposed = false, initialized = false;
  let orientation = null;
  // Editor-only previews: `{ id, ...fields }` for one layer or `{ layers: { [id]: fields } }` for a group move.
  let placement = null;
  const placementFor = id => placement?.id === id ? placement : placement?.layers?.[id] ?? null;
  const layerNodes = [...root.querySelectorAll('[data-floc-layer]')].filter(node => p.layers.some(l => l.id === node.dataset.flocLayer));
  const mediaNodes = layerNodes.filter(node => ['AUDIO', 'VIDEO'].includes(node.tagName));
  const opacityNodes = layerNodes.filter(node => !node.hasAttribute('data-floc-background-content'));
  const mediaErrors = renderMode ? [] : mediaNodes.map(media => {
    let reported = false;
    const failed = () => {
      if (disposed || reported) return;
      reported = true;
      onMediaError(new Error(`${p.layers.find(l => l.id === media.dataset.flocLayer).name} could not be loaded or decoded.`));
    };
    media.addEventListener('error', failed, { once: true });
    const loaded = () => { if (!disposed) draw(requestedTime, requestedPlaying); };
    if (media.tagName === 'AUDIO') media.addEventListener('loadedmetadata', loaded, { once: true });
    if (media.error) queueMicrotask(failed);
    return () => { media.removeEventListener('error', failed); media.removeEventListener('loadedmetadata', loaded); };
  });
  const unwatchContext = rendering.watch({
    restored() { if (!disposed) try { draw(requestedTime, requestedPlaying); } catch (error) { onMediaError(error); } }
  });
  const context = { get lost() { return rendering.lost; }, dispose: unwatchContext };
  const imageNodes = layerNodes.filter(node => node.tagName === 'IMG');
  const models = [];
  const dataFlows = [];
  const meshes = [];
  const textures = [];
  const handles = [];
  const cardVideos = [];
  const frameCards = [];
  const preparedVideos = [];
  let seekEpoch = 0;
  const imageLoader = new THREE.ImageLoader();
  const placementBounds = new Map();
  const cardBox = new THREE.Box3();
  // Last animated typography and color written to each text node.
  const textStyles = new Map(), textMotion = {};
  // Last animated base color written to each solid or media background fill.
  const backgroundFills = new Map();
  const scenePass = createScenePass();
  const material = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, transparent: true,
    uniforms: { ...scenePass.uniforms, flocSceneOpaque: { value: false }, ...cardUniforms(null, 1), uCardSize: { value: layer.size }, uShape: { value: 0 }, uWindow: { value: new THREE.Vector2() }, uCanvasPixels: { value: new THREE.Vector2(width, height) } } });
  // Media aspect (width / height) of each card, known once its media has loaded.
  let mediaAspects = [];
  let sizesKey = '', sizes = null;
  // One geometry per card shape, each card's geometry, and the inputs they were shaped for.
  let geometries = new Map();
  let cardGeometries = [];
  let geometryKey = '';
  function cardSizes(sampled) {
    const key = `${sampled.template}:${sampled.size}:${sampled.cardAspect}:${sampled.cardFit}`;
    if (key !== sizesKey) { sizes = cardMetrics(sampled, mediaAspects); sizesKey = key; }
    return sizes;
  }
  let requestedTime = 0;
  let requestedPlaying = false;
  function placeLayers(time) {
    const frame = p.layout?.enabled ? (carousel ? canvas : root).getBoundingClientRect() : null;
    for (const l of p.layers.filter(l => ['text', 'logo', 'media', 'model', 'dataflow', 'background'].includes(l.type))) {
      const el = layerNodes.find(node => node.dataset.flocLayer === l.id); if (!el) continue;
      const evaluated = evaluateChoreography(l, time);
      const placed = placementFor(l.id);
      const pos = placed ? { ...evaluated, ...placed } : evaluated;
      if (l.type === 'background') {
        for (const node of opacityNodes.filter(node => node.dataset.flocLayer === l.id)) {
          node.style.transform = `translate(${pos.x ?? 0}%,${pos.y ?? 0}%) rotate(${pos.roll ?? 0}deg)`;
        }
        // Procedural backgrounds draw their animated base color in the shader.
        const fill = l.mode === 'procedural' ? null : l.mode === 'color' || !l.src ? el : el.firstElementChild;
        if (fill && backgroundFills.get(fill) !== pos.color) { fill.style.background = pos.color; backgroundFills.set(fill, pos.color); }
        continue;
      }
      const sizeProperty = l.type === 'text' ? 'fontSize' : 'width';
      const sizeValue = l.type === 'text' ? `${pos.size * width / 1080}px` : `${pos.size}%`;
      if (el.style[sizeProperty] !== sizeValue) el.style[sizeProperty] = sizeValue;
      if (l.type === 'model') el.style.height = `${pos.size * width / 100}px`;
      if (l.type === 'dataflow') el.style.height = `${pos.size * height / 100}px`;
      let typography = '';
      if (l.type === 'text') {
        // Animated typography and color; the markup holds the layer's own values.
        const { letterSpacing, lineHeight } = textTypography(pos);
        typography = `${letterSpacing}:${lineHeight}`;
        if (textStyles.get(el) !== `${typography}:${pos.color}`) {
          el.style.letterSpacing = letterSpacing; el.style.lineHeight = lineHeight; el.style.color = pos.color;
          textStyles.set(el, `${typography}:${pos.color}`);
        }
      }
      let position = pos;
      // Raw legacy callers can omit space; only explicit Spatial text bypasses Flat layout.
      if (p.layout?.enabled && l.type === 'text' && l.space !== 'spatial') {
        if (frame.width && frame.height) {
          const key = `${sizeValue}:${typography}:${frame.width}:${frame.height}:${pos.roll ?? 0}`;
          let bounds = placementBounds.get(el);
          if (bounds?.key !== key) {
            bounds = { key, ...rotatedTextBounds(el.offsetWidth, el.offsetHeight, pos.roll, width, height) };
            placementBounds.set(el, bounds);
          }
          if (renderMode && layerAlpha(l, time) > 0 && !fitsSafeArea(bounds, p.layout)) throw new Error(`${l.name} exceeds the safe area. Reduce its width or size before exporting.`);
          const constrained = constrainPlacement(pos.x + bounds.x, pos.y + bounds.y, bounds.width, bounds.height, p.layout);
          position = { x: constrained.x - bounds.x, y: constrained.y - bounds.y };
        }
      }
      el.style.left = `${position.x}%`; el.style.top = `${position.y}%`;
      // Entry/exit travel follows the text's own axes and may leave the safe area;
      // only the resting pose is constrained above.
      const sample = l.type === 'text' ? textMotionAt(l, time, textMotion) : null;
      const motion = sample && textMotionStyle(sample, sample.reveal ? el.offsetWidth : 0, sample.reveal ? el.offsetHeight : 0, Math.min(width, height));
      el.style.transform = `${['text', 'logo', 'media'].includes(l.type) ? `rotate(${pos.roll ?? 0}deg) ` : ''}${motion?.transform ?? ''}`.trim();
      if (motion) el.style.clipPath = motion.clipPath;
    }
  }
  // A `size` × `size / aspect` card; a wrapped ring bends it around its radius.
  function reshapeCardGeometry(geometry, sampled, size, aspect, radius) {
    const positions = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    const wrapped = sampled.template === 'circular' && ['wrapped', undefined].includes(motionVariant(sampled));
    for (let i = 0; i < positions.count; i++) {
      const x = (uv.getX(i) - 0.5) * size;
      const angle = x / radius;
      positions.setXYZ(i, wrapped ? x * (1 - sampled.curve) + Math.sin(angle) * radius * sampled.curve : x,
        (uv.getY(i) - 0.5) * size / aspect, wrapped ? (Math.cos(angle) - 1) * radius * sampled.curve : 0);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
  }
  // Cards of equal size share a geometry; reshape them when a size changes.
  // Returns the per-card sizes.
  function shapeCards(sampled) {
    const segments = stretched(layer) ? 64 : 32;
    const cards = cardSizes(sampled);
    const radius = ringRadius(sampled, sampled.cardCount || p.images.length, cards);
    const key = JSON.stringify([sizesKey, radius, sampled.curve, motionVariant(sampled), segments]);
    if (key === geometryKey) return cards;
    const windowPush = sampled.template === 'window-push';
    const shapes = new Map();
    const cardShapes = cards.widths.map((size, i) => {
      const dimensions = windowPush ? [1, width / height] : [size, cards.aspects[i]];
      const shape = dimensions.join(':');
      shapes.set(shape, dimensions);
      return shape;
    });
    const previous = geometries;
    const spare = [...previous].filter(([shape, geometry]) => !shapes.has(shape) && geometry.parameters.widthSegments === segments).map(([, geometry]) => geometry);
    geometries = new Map([...shapes.keys()].map(shape => {
      const kept = previous.get(shape);
      return [shape, kept?.parameters.widthSegments === segments ? kept : spare.pop() ?? new THREE.PlaneGeometry(1, 1, segments, 16)];
    }));
    const used = new Set(geometries.values());
    previous.forEach(geometry => { if (!used.has(geometry)) geometry.dispose(); });
    geometries.forEach((geometry, shape) => reshapeCardGeometry(geometry, sampled, ...shapes.get(shape), radius));
    cardGeometries = cardShapes.map(shape => geometries.get(shape));
    meshes.forEach((mesh, i) => { mesh.geometry = cardGeometries[i]; });
    material.uniforms.uCardSize.value = sampled.size;
    geometryKey = key;
    return cards;
  }
  // Carousel-wide values; rerun after in-place edits.
  function applySettings() {
    camera.fov = layer.perspective ?? 38;
    camera.updateProjectionMatrix();
    updateCamera();
    const uniforms = material.uniforms;
    uniforms.uShape.value = layer.cardShape === 'squircle' ? 1 : 0;
    const side = layer.backface === 'hide' ? THREE.FrontSide : layer.frontface === 'hide' ? THREE.BackSide : THREE.DoubleSide;
    if (material.side !== side) { material.side = side; material.needsUpdate = true; }
    const cards = shapeCards(layer);
    // Window Push fills the canvas with each card and crops its window in the shader.
    const windowAspect = layer.template === 'window-push' ? width / height : 0;
    meshes.forEach((mesh, i) => {
      const card = mesh.userData.uniforms;
      resetMosaicUniforms(card);
      const imageRatio = card.uImageAspect.value, cardRatio = cards.aspects[i];
      if (imageRatio > cardRatio) card.uCrop.value.set(cardRatio / imageRatio, 1); else card.uCrop.value.set(1, imageRatio / cardRatio);
      card.uAspect.value = windowAspect || cardRatio;
      card.uCorner.value = layer.cornerRadius / 100;
      // Vertex wings extend beyond the CPU-side geometry bounds.
      mesh.frustumCulled = !stretched(layer);
    });
  }
  async function loadVideoFrame(frames, index) {
    const src = videoFrameSource(frames, index);
    const handle = resources.acquire(`image\n${src}`, () => imageLoader.loadAsync(src));
    try {
      const image = await handle.value;
      if (!image.naturalWidth || !image.naturalHeight) throw new Error(`A prepared video frame could not be decoded: ${src}`);
      return image;
    } finally { handle.release(); }
  }
  // Background and standalone video frames decode off the main thread from their file,
  // one frame ahead, so decoding overlaps the current frame's scene work. Drawing an
  // <img> instead decodes synchronously when the capture first rasterizes it.
  function decodeVideoFrame(frames, index) {
    const src = videoFrameSource(frames, index);
    return fetch(src).then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.blob();
    }).then(blob => createImageBitmap(blob)).catch(error => { throw new Error(`A prepared video frame could not be decoded: ${src}`, { cause: error }); });
  }
  async function cardTexture(src) {
    if (cardMediaKind(src) === 'image') {
      const handle = resources.acquire(`image\n${src}`, () => imageLoader.loadAsync(src));
      handles.push(handle);
      const texture = new THREE.Texture(await handle.value);
      texture.needsUpdate = true;
      return texture;
    }
    if (renderMode) {
      const frames = videoFrames[src];
      if (!frames) throw new Error(`Prepared video frames are missing: ${src}`);
      const texture = new THREE.Texture(await loadVideoFrame(frames, 0));
      texture.needsUpdate = true;
      frameCards.push({ texture, frames, index: 0 });
      return texture;
    }
    // Each carousel seeks its own decoder; rebuilds of the same layer reuse it.
    const handle = resources.acquire(`video\n${layer.id}\n${src}`, () => loadCardVideo(src), unloadVideo);
    handles.push(handle);
    const video = await handle.value;
    const texture = new THREE.VideoTexture(video);
    cardVideos.push({ video, texture });
    texture.needsUpdate = true;
    return texture;
  }
  try {
    if (renderMode) {
      for (const l of p.layers.filter(l => l.type === 'media' && cardMediaKind(l.src) !== 'image' || l.type === 'background' && l.mode === 'video' && l.src)) {
        const frames = videoFrames[l.src];
        if (!frames) throw new Error(`Prepared video frames are missing: ${l.src}`);
        const node = root.querySelector(`[id="media-${CSS.escape(l.id)}"]`);
        if (node?.tagName !== 'CANVAS' || node.dataset.flocVideoSource !== l.src) throw new Error(`Prepared video canvas is missing: ${l.src}`);
        const context = node.getContext('2d');
        if (!context) throw new Error(`A prepared video canvas could not be initialized: ${l.src}`);
        preparedVideos.push({ id: l.id, node, context, frames, index: -1 });
      }
    }
    await Promise.all(p.layers.filter(l => l.type === 'text').map(l => document.fonts.load(`${l.weight} ${l.size * width / 1080}px "${fontFamily(l.font)}"`)));
    await document.fonts.ready;
    for (const model of p.layers.filter(l => l.type === 'model')) models.push(await createModelScene(root.querySelector(`[id="model-${CSS.escape(model.id)}"]`), model, { compositionWidth: width, resources, renderMode, deferRefraction: true, rendering, onError: onMediaError }));
    for (const flow of p.layers.filter(l => l.type === 'dataflow')) dataFlows.push(createDataFlowScene(root.querySelector(`[id="dataflow-${CSS.escape(flow.id)}"]`), flow, { compositionWidth: width, compositionHeight: height, rendering, renderMode }));
    const sources = [...new Set((carousel ? p.images : []).map(img => img.src))];
    const results = await Promise.allSettled(sources.map(cardTexture));
    textures.push(...results.filter(result => result.status === 'fulfilled').map(result => result.value));
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    const loaded = p.images.map(img => textures[sources.indexOf(img.src)]);
    const cardTextures = Array.from({ length: loaded.length ? layer.cardCount || loaded.length : 0 }, (_, i) => loaded[i % loaded.length]);
    // Per-image card sizes come from the loaded media, so the first frame is already right.
    mediaAspects = cardTextures.map(texture => (texture.image.videoWidth || texture.image.width) / (texture.image.videoHeight || texture.image.height));
    shapeCards(layer);
    cardTextures.forEach((texture, i) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const card = cardUniforms(texture, mediaAspects[i]);
      const mesh = new THREE.Mesh(cardGeometries[i], material);
      mesh.userData.uniforms = card;
      mesh.onBeforeRender = (renderer, scene, camera, geometry, shared) => {
        for (const key in card) shared.uniforms[key].value = card[key].value;
        shared.uniformsNeedUpdate = true;
      };
      group.add(mesh); meshes.push(mesh);
    });
    applySettings();
    await Promise.all(imageNodes.map(img => img.decode().catch(() => { throw new Error('An image could not be decoded.'); })));
    placeLayers(0);
    initialized = true;
  } catch (error) { dispose(); throw error; }
  function dispose() {
    if (disposed) return;
    disposed = true;
    seekEpoch++;
    mediaErrors.forEach(remove => remove());
    context.dispose();
    models.forEach(model => model.dispose());
    dataFlows.forEach(flow => flow.dispose());
    preparedVideos.forEach(video => video.ahead?.bitmap.then(bitmap => bitmap.close(), () => {}));
    mediaNodes.forEach(m => { pauseMedia(m); m.removeAttribute('src'); m.load(); });
    preparedVideos.forEach(({ node }) => { node.width = 0; node.height = 0; });
    preparedVideos.length = 0;
    geometries.forEach(geometry => geometry.dispose()); material.dispose();
    textures.forEach(t => t.dispose());
    // Shared decoders keep playing for the scene that replaces this one.
    handles.forEach(handle => handle.release());
  }
  function draw(time, playing = false) {
    // Metadata/context events can arrive before card media and geometry exist.
    if (disposed || !initialized) return;
    if (context.lost && renderMode) throw new Error('The graphics context was lost while rendering.');
    placeLayers(time);
    models.forEach(model => model.draw(time, placementFor(model.id) ?? undefined));
    dataFlows.forEach(flow => flow.draw(time, placementFor(flow.id) ?? undefined));
    const placed = placementFor(layer.id);
    // A group placement (e.g. a distribution preview) may turn the carousel; a
    // single-carousel orientation preview already carries the same roll.
    const sampled = { ...evaluateChoreography(layer, time), ...orientation, ...(Number.isFinite(placed?.roll) ? { roll: placed.roll } : {}) };
    const cards = shapeCards(sampled);
    group.rotation.set(THREE.MathUtils.degToRad(sampled.tilt), THREE.MathUtils.degToRad(sampled.yaw ?? 0), THREE.MathUtils.degToRad(sampled.roll));
    group.scale.setScalar(1);
    const viewHeight = layer.space === 'spatial' ? sceneDimensions(p.format).height : 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const position = placed ? { ...sampled, ...placed } : sampled;
    if (layer.space !== 'spatial') {
      elementMotionAt(layer, time, carouselMotion);
      const transformed = hasElementTransform(carouselMotion);
      if (transformedProjection || transformed) camera.updateProjectionMatrix();
      if (transformed) {
        // Post-project the entire carousel image before clipping/rasterization:
        // uniform pulse preserves card perspective and reveals moved-in cards.
        const angle = THREE.MathUtils.degToRad(carouselMotion.rotation);
        const c = Math.cos(angle) * carouselMotion.scale, s = Math.sin(angle) * carouselMotion.scale;
        const x = position.x / 50 - 1, y = 1 - position.y / 50, shortSide = Math.min(width, height);
        const xy = -s * height / width, yx = s * width / height;
        carouselProjection.set(
          c, xy, 0, x + carouselMotion.offsetX / 50 * shortSide / width - c * x - xy * y,
          yx, c, 0, y - carouselMotion.offsetY / 50 * shortSide / height - yx * x - c * y,
          0, 0, 1, 0,
          0, 0, 0, 1);
        camera.projectionMatrix.premultiply(carouselProjection);
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      }
      transformedProjection = transformed;
    }
    group.position.set((position.x / 100 - 0.5) * viewHeight * width / height, (0.5 - position.y / 100) * viewHeight, layer.space === 'spatial' ? (position.z ?? 0) / 100 * viewHeight : 0);
    // Planar carousels size their largest card as a fraction of the canvas.
    const planar = ['zoom-through', 'sweep-reveal', 'kinetic-mosaic'].includes(layer.template);
    const shuffle = layer.template === 'stack-shuffle';
    const windowPush = layer.template === 'window-push';
    const canvasSize = windowPush ? viewHeight * width / height : planar ? Math.min(viewHeight * width / height, viewHeight * sampled.cardAspect) : shuffle ? viewHeight : 1;
    const windowHeight = Math.min(0.72 * sampled.size, 0.96, 0.96 * width / height / sampled.cardAspect);
    const uniforms = material.uniforms;
    uniforms.uWindow.value.set(windowPush ? windowHeight * sampled.cardAspect * height / width : 0, windowPush ? windowHeight : 0);
    material.depthTest = !(planar || shuffle || windowPush);
    material.depthWrite = !(planar || shuffle || windowPush);
    meshes.forEach((mesh, i) => {
      const card = mesh.userData.uniforms;
      const state = carouselCard(sampled, i, meshes.length, time, cards);
      const optical = elasticState(sampled, state);
      card.uElastic.value = optical.strength;
      card.uSide.value = optical.side;
      mesh.position.set(...state.position);
      if (planar || shuffle || windowPush) mesh.position.multiplyScalar(canvasSize);
      if (state.positionPixels) {
        mesh.position.x += state.positionPixels[0] * viewHeight / height;
        mesh.position.y += state.positionPixels[1] * viewHeight / height;
      }
      mesh.rotation.set(...state.rotation);
      mesh.scale.setScalar(state.scale * canvasSize);
      mesh.renderOrder = state.renderOrder ?? 0;
      card.uClip.value.set(...(state.clip ?? [0, 0, 1, 1]));
      card.uPush.value.set(...(state.push ?? [0, 0, 1, 0]));
      if (state.mosaic) {
        const aspect = cards.aspects[i], imageAspect = card.uImageAspect.value;
        card.uAspect.value = aspect;
        card.uCrop.value.set(imageAspect > aspect ? aspect / imageAspect : 1, imageAspect > aspect ? 1 : imageAspect / aspect);
      }
      if (state.mosaic && state.opacity > 0 && meshes.length > 1) {
        const incoming = meshes[state.incoming].userData.uniforms;
        const columns = sampled.mosaicColumns ?? 5, rows = sampled.mosaicRows ?? 5;
        const aspect = cards.aspects[i], imageAspect = incoming.uImageAspect.value;
        card.uMosaic.value = 1;
        card.uMosaicMap.value = incoming.uMap.value;
        card.uMosaicGrid.value.set(columns, rows);
        card.uMosaicCrop.value.set(imageAspect > aspect ? aspect / imageAspect : 1, imageAspect > aspect ? 1 : imageAspect / aspect);
        card.uMosaicZoom.value = sampled.mosaicZoom ?? 0.8;
        for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
          card.uMosaicCells.value[row * columns + column] = kineticMosaicCellProgress(sampled, column, row, state.progress);
        }
      } else if (card.uMosaic.value) resetMosaicUniforms(card);
      if (shuffle) {
        const side = cards.perCard ? Math.min(cards.widths[i], cards.widths[i] / cards.aspects[i]) * height : sampled.size * height * Math.min(1, 1 / sampled.cardAspect);
        card.uCorner.value = Math.min(1, 2 * (sampled.shuffleCorner ?? 15) / (side * state.scale));
      }
      mesh.visible = !(layer.frontface === 'hide' && layer.backface === 'hide') && layerAlpha(layer, time) > 0 && state.opacity > 0.001;
      card.uDepth.value = state.depth;
      card.uOpacity.value = state.opacity;
      card.uTorsion.value = state.torsion;
    });
    cardVideos.forEach(({ video, texture }) => { if (video.readyState >= 2) texture.needsUpdate = true; });
    scenePass.set(SCENE_PASS.source);
    if (carousel && layer.space !== 'spatial') rendering.draw(scene, camera, canvas);
    p.layers.forEach(l => {
      const alpha = layerAlpha(l, time);
      opacityNodes.forEach(el => { if (el.dataset.flocLayer === l.id && !['AUDIO', 'VIDEO'].includes(el.tagName)) el.style.opacity = alpha; });
      const media = mediaNodes.find(el => el.dataset.flocLayer === l.id);
      if (!media) return;
      if (media.tagName === 'VIDEO' && l.type !== 'background') media.style.opacity = alpha;
      if (renderMode || !Number.isFinite(media.duration)) return;
      const desired = audioTime(l, time, media.duration);
      const active = alpha > 0 && (l.loop || desired < media.duration - 0.02);
      if (Math.abs(media.currentTime - desired) > (playing ? 0.2 : 0.025)) media.currentTime = desired;
      if (l.type === 'music') media.volume = l.volume * (l.fade ? Math.max(0, Math.min(1, (time - l.start) / l.fade, (l.end - time) / l.fade)) : 1);
      if (playing && active) { if (media.paused) playMedia(media, error => { if (!disposed) onMediaError(error); }); } else pauseMedia(media);
    });
  }
  function seek(time, playing = false) {
    if (disposed) return Promise.resolve();
    const epoch = ++seekEpoch;
    requestedTime = time;
    requestedPlaying = playing;
    if (playing && !renderMode) {
      for (const { video } of cardVideos) {
        const desired = cardMediaTime(time, layer.start, video.duration);
        if (Math.abs(video.currentTime - desired) > 0.2) video.currentTime = desired;
        video.loop = true;
        if (layerAlpha(layer, time) > 0) { if (video.paused) playMedia(video, error => { if (!disposed) onMediaError(error); }); }
        else pauseMedia(video);
      }
      draw(time, playing);
      return Promise.resolve();
    }
    const standalone = renderMode ? [] : mediaNodes.filter(video => video.tagName === 'VIDEO').map(async video => {
      const l = p.layers.find(l => l.id === video.dataset.flocLayer);
      if (video.readyState < 2) await waitForVideo(video, 'loadeddata', () => video.load(), () => video.readyState >= 2);
      pauseMedia(video);
      await seekCardVideo(video, audioTime(l, time, video.duration));
    });
    const frames = cardVideos.map(({ video }) => {
      pauseMedia(video);
      return seekCardVideo(video, cardMediaTime(time, layer.start, video.duration));
    });
    frames.push(...frameCards.map(async card => {
      const index = cardFrameIndex(card.frames, time, layer.start);
      if (card.index === index) return;
      const image = await loadVideoFrame(card.frames, index);
      if (!disposed && epoch === seekEpoch) {
        card.texture.image = image;
        card.texture.needsUpdate = true;
        card.index = index;
      }
    }));
    frames.push(...preparedVideos.map(async video => {
      const l = p.layers.find(l => l.id === video.id);
      const index = videoFrameIndex(video.frames, audioTime(l, time, video.frames.duration));
      if (video.index === index) return;
      const pending = video.ahead?.index === index ? video.ahead.bitmap : decodeVideoFrame(video.frames, index);
      if (video.ahead && video.ahead.index !== index) video.ahead.bitmap.then(bitmap => bitmap.close(), () => {});
      const next = (index + 1) % video.frames.count;
      video.ahead = next === index ? null : { index: next, bitmap: decodeVideoFrame(video.frames, next) };
      video.ahead?.bitmap.catch(() => {});
      const bitmap = await pending;
      try {
        if (disposed || epoch !== seekEpoch) return;
        // Decoded pixels own the dimensions: FFmpeg may have autorotated the stream.
        if (video.node.width !== bitmap.width) video.node.width = bitmap.width;
        if (video.node.height !== bitmap.height) video.node.height = bitmap.height;
        video.context.clearRect(0, 0, video.node.width, video.node.height);
        video.context.drawImage(bitmap, 0, 0);
        video.index = index;
      } finally { bitmap.close(); }
    }));
    frames.push(...standalone);
    if (!frames.length) { draw(time, playing); return Promise.resolve(); }
    const ready = Promise.all(frames).then(() => { if (!disposed && epoch === seekEpoch) draw(time, playing); });
    if (renderMode) return ready;
    return ready.catch(error => { if (!disposed) onMediaError(error); });
  }
  try { await seek(0); } catch (error) { dispose(); throw error; }
  // Takes the engine's slice of a project that sceneUpdatePlan accepted.
  function update(next) {
    seekEpoch++;
    p = next;
    if (carousel) {
      layer = p.layers.find(l => l.id === carousel.id);
      applySettings();
    }
    models.forEach(model => model.updateLayer(p.layers.find(l => l.id === model.id)));
    dataFlows.forEach(flow => flow.updateLayer(p.layers.find(l => l.id === flow.id)));
    placementBounds.clear();
    textStyles.clear();
  }
  function drawRefraction(id, backdrop, rect) {
    const model = models.find(model => model.id === id);
    if (!model) throw new Error('Refractive model layer not found.');
    return model.drawRefraction(backdrop, rect, requestedTime, placementFor(id) ?? undefined);
  }
  return {
    update, seek, drawRefraction,
    models,
    dataFlows,
    carousel: carousel ? {
      id: carousel.id,
      root: group,
      scene,
      camera,
      render(outputCamera, pass, opacity, id, options = {}) {
        scenePass.set(pass, opacity, id); setSceneMaterialPass(material, pass, options);
        renderer.toneMapping = THREE.NoToneMapping; renderer.toneMappingExposure = 1;
        renderer.render(scene, outputCamera);
      },
      bounds(outputCamera) { return projectedObjectBounds(group, outputCamera, { padding: stretched(layer) ? layer.size * 4 : 0 }); },
      // World-space Z extent of each drawn card, in Depth percent of the common view height.
      depthPieces(target) {
        group.updateWorldMatrix(true, true);
        meshes.forEach((mesh, index) => {
          if (!mesh.visible || !mesh.geometry.boundingBox) return;
          cardBox.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
          target.push({ min: cardBox.min.z / SCENE_VIEW_HEIGHT * 100, max: cardBox.max.z / SCENE_VIEW_HEIGHT * 100, card: index });
        });
        return target;
      }
    } : null,
    setResolution(w, h, outputWidth = w, outputHeight = h) {
      if (disposed) return;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      if (layer.space === 'spatial') material.uniforms.uCanvasPixels.value.set(outputWidth, outputHeight);
      models.forEach(model => model.setCompositionWidth(w));
      dataFlows.forEach(flow => flow.setResolution(w, h, outputWidth, outputHeight));
    },
    setOrientation(value) { orientation = value; },
    setPlacement(value) { placement = value; },
    dispose
  };
}

// The first engine also owns every non-carousel layer; each further carousel
// gets its own renderer.
function engineProjects(project) {
  const carousels = project.layers.filter(layer => layer.type === 'carousel');
  const first = carousels[0];
  return [
    { id: first?.id, project: { ...project, images: carouselImages(project, first), layers: project.layers.filter(layer => layer.type !== 'carousel' || layer.id === first?.id) } },
    ...carousels.slice(1).map(layer => ({ id: layer.id, project: { ...project, images: carouselImages(project, layer), layers: [layer] } }))
  ];
}

// Copies attribute, inline style and text differences between the markup of
// two structurally equal projects onto the live layer nodes. Styles change per
// property so values written while drawing survive. Null means rebuild.
function markupPatch(root, previous, next, options) {
  const parse = project => { const template = document.createElement('template'); template.innerHTML = stageMarkup(project, undefined, options); return [...template.content.children]; };
  const before = parse(previous), after = parse(next);
  if (before.length !== after.length) return null;
  const live = new Map([...root.querySelectorAll('[data-floc-layer]:not([data-floc-background-content])')].map(node => [node.dataset.flocLayer, node]));
  const changes = [];
  const compare = (a, b, node) => {
    if (!node || a.tagName !== b.tagName || node.tagName !== b.tagName || a.children.length !== b.children.length || node.children.length !== b.children.length) return false;
    for (const { name, value } of b.attributes) {
      if (a.getAttribute(name) === value) continue;
      if (name === 'src') return false;
      changes.push(name === 'style' ? () => {
        for (const property of Array.from(b.style)) if (a.style.getPropertyValue(property) !== b.style.getPropertyValue(property)) node.style.setProperty(property, b.style.getPropertyValue(property));
        for (const property of Array.from(a.style)) if (!b.style.getPropertyValue(property)) node.style.removeProperty(property);
      } : () => node.setAttribute(name, value));
    }
    for (const { name } of a.attributes) if (!b.hasAttribute(name)) changes.push(() => node.removeAttribute(name));
    if (!b.children.length && a.textContent !== b.textContent) changes.push(() => { node.textContent = b.textContent; });
    return [...b.children].every((child, i) => compare(a.children[i], child, node.children[i]));
  };
  if (!after.every((node, i) => compare(before[i], node, live.get(node.dataset.flocLayer)))) return null;
  return () => changes.forEach(change => change());
}
// A new font face must load before text is measured; that is a rebuild.
const fontsLoaded = (previous, next) => next.layers.every((layer, i) => layer.type !== 'text' || (layer.font === previous.layers[i].font && layer.weight === previous.layers[i].weight)
  || document.fonts.check(`${layer.weight} 16px "${fontFamily(layer.font)}"`));

export async function createScene(root, project, options = {}) {
  const [nativeWidth, nativeHeight] = FORMATS[project.format];
  root.style.width = `${nativeWidth}px`; root.style.height = `${nativeHeight}px`;
  const sources = document.createElement('div');
  sources.dataset.flocSceneSources = '';
  sources.style.cssText = `position:absolute;inset:0;width:${nativeWidth}px;height:${nativeHeight}px;opacity:0`;
  for (const node of [...root.children]) if (node.hasAttribute('data-floc-layer')) sources.append(node);
  root.append(sources);
  const rendering = createSceneRenderer(), cameras = createSceneCameras(project);
  options = { ...options, resources: options.resources ?? createResourceCache(), rendering };
  const capture = createSceneCapture(sources, { width: nativeWidth, height: nativeHeight });
  let currentProject = project, currentTime = 0, currentPlaying = false, disposed = false, seekEpoch = 0;
  let outputWidth = nativeWidth, outputHeight = nativeHeight, world, api;
  const engines = [];
  let effects = createEffects(sources, project, FORMATS, layerAlpha);
  const backgrounds = project.layers.filter(layer => layer.type === 'background' && layer.mode === 'procedural')
    .map(layer => ({ id: layer.id, canvas: sources.querySelector(`[id="background-${CSS.escape(layer.id)}"]`) })).filter(background => background.canvas);
  let reportedFailure = false;
  const report = error => { if (!disposed && !reportedFailure) { reportedFailure = true; options.onMediaError?.(error); } };
  const unwatch = rendering.watch({
    restored() { if (!disposed && api) void api.seek(currentTime, currentPlaying).catch(report); },
    failed() { report(new Error('The shared scene lost its graphics context and could not restore it. Reload the editor to continue.')); }
  });
  function dispose() {
    if (disposed) return;
    disposed = true; seekEpoch++; unwatch();
    world?.dispose(); effects.dispose(); capture.dispose();
    engines.forEach(engine => engine.scene.dispose()); rendering.dispose();
    sources.replaceWith(...sources.childNodes);
  }
  function sourceResolution() {
    const magnification = Math.max(1, cameras.output.zoom);
    const scale = Math.min(magnification, rendering.maxSide / Math.max(outputWidth, outputHeight));
    return [Math.max(1, Math.round(outputWidth * scale)), Math.max(1, Math.round(outputHeight * scale))];
  }
  function resizeSources() {
    const [width, height] = sourceResolution();
    engines.forEach(engine => engine.scene.setResolution(width, height, outputWidth, outputHeight));
    for (const node of sources.querySelectorAll('canvas[data-floc-layer]')) {
      if (currentProject.layers.some(layer => layer.id === node.dataset.flocLayer && layer.type === 'effect')) {
        if (node.width !== outputWidth) node.width = outputWidth;
        if (node.height !== outputHeight) node.height = outputHeight;
      }
    }
    backgrounds.forEach(({ canvas }) => { if (canvas.width !== width) canvas.width = width; if (canvas.height !== height) canvas.height = height; });
  }
  try {
    for (const { id, project: value } of engineProjects(project)) engines.push({ id, scene: await createLayerScene(sources, value, options) });
    world = createSceneWorld(root, sources, project, { rendering, capture, cameras, engines, renderMode: options.renderMode });
    resizeSources();
  } catch (error) { dispose(); throw error; }
  api = {
    update(next) {
      if (disposed) return false;
      const plan = sceneUpdatePlan(currentProject, next);
      if (!plan || !fontsLoaded(currentProject, next)) return false;
      const patch = markupPatch(sources, currentProject, next, options);
      if (!patch) return false;
      patch(); currentProject = next; seekEpoch++;
      const parts = engineProjects(next);
      engines.forEach((engine, index) => engine.scene.update(parts[index].project));
      if (plan.effects) { effects.dispose(); effects = createEffects(sources, next, FORMATS, layerAlpha); }
      else effects.updateLayers(next.layers);
      cameras.update(next); world.update(next); resizeSources();
      return true;
    },
    async seek(time, playing = false) {
      if (disposed) return;
      const epoch = ++seekEpoch; currentTime = time; currentPlaying = playing;
      await Promise.all(engines.map(engine => engine.scene.seek(time, playing)));
      if (disposed || epoch !== seekEpoch) return;
      for (const background of backgrounds) {
        const layer = currentProject.layers.find(value => value.id === background.id);
        const [formatWidth, formatHeight] = FORMATS[currentProject.format];
        if (!drawProceduralBackground(background.canvas, layer, Math.max(0, time - layer.start), currentProject.fps, rendering.renderer, formatWidth / formatHeight) && options.renderMode) throw new Error('The shared scene lost its graphics context during background export.');
      }
      world.pose(time);
      await effects.seek(time);
      if (disposed || epoch !== seekEpoch) return;
      world.draw();
    },
    setResolution(w, h) {
      if (disposed) return;
      outputWidth = Math.max(1, Math.round(w)); outputHeight = Math.max(1, Math.round(h));
      world.setResolution(outputWidth, outputHeight); resizeSources();
    },
    pick: (u, v) => world.pick(u, v),
    hitTest: (u, v, id) => world.pick(u, v) === id,
    projectedBounds: id => world.projectedBounds(id),
    projectPointer: (u, v, id) => world.projectPointer(u, v, id),
    depthInfo: () => world.depthInfo(),
    setOrientation: value => engines.forEach(engine => engine.scene.setOrientation(value?.id === engine.id ? value : null)),
    setPlacement(value) { engines.forEach(engine => engine.scene.setPlacement(value)); world.setPlacement(value); },
    dispose
  };
  return api;
}
