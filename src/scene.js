import { createModelScene } from './model-scene.js';
import { cardMediaKind, cardVideoSource, cardMediaTime, cardFrameIndex, cardFrameSource, waitForVideo, seekCardVideo, playMedia, pauseMedia } from './card-media.js';
import { carouselCard, motionVariant, elasticState } from './carousel-motion.js';
import * as THREE from 'three';
import { fontFamily, fontStack } from './fonts.js';
import { FORMATS, SHADERS, escapeHtml, layerAlpha, audioTime, demoProject, carouselImages } from './project.js';
import { constrainPlacement, fitsSafeArea, rotatedTextBounds, safeArea } from './layout.js';
import { createCarouselEffect } from './carousel-effects.js';
import { evaluateChoreography } from './choreography.js';
import { drawProceduralBackground } from './backgrounds.js';
import { textTypography, textRevealClip } from './text-style.js';
import { createEffects } from './effects.js';
import { createResourceCache, watchContextLoss } from './scene-resources.js';
import { sceneUpdatePlan } from './scene-update.js';

export function stageMarkup(p, path = src => src) {
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
      return `<div ${timing} ${common}inset:0">` + fill + (l.mode === 'video' ? `<video id="media-${esc(l.id)}" ${timing} data-media-start="${l.offset}" ${l.loop ? 'loop data-loop="true"' : ''} muted playsinline preload="auto" src="${esc(path(l.src))}" ${style}</video>` : `<img alt="" src="${esc(path(l.src))}" ${style}`) + '</div>';
    }
    if (l.type === 'carousel') return `<canvas id="carousel-${esc(l.id)}" class="clip" ${timing} ${common}inset:0;width:${w}px;height:${h}px" width="${w}" height="${h}"></canvas>`;
    if (l.type === 'text') {
      const typography = textTypography(l);
      return `<div ${common}left:${l.x}%;top:${l.y}%;width:${l.width}%;font-size:${l.size * w / 1080}px;line-height:${typography.lineHeight};letter-spacing:${typography.letterSpacing};text-align:${typography.textAlign};clip-path:${textRevealClip(l, 0)};font-family:${esc(fontStack(l.font))};font-weight:${l.weight};white-space:pre-wrap;overflow-wrap:anywhere;color:${l.color}">${esc(l.text)}</div>`;
    }
    if (l.type === 'logo' && l.src) return `<img alt="Studio mark" src="${esc(path(l.src))}" ${common}left:${l.x}%;top:${l.y}%;width:${l.size}%;height:auto">`;
    if (l.type === 'model') return `<canvas id="model-${esc(l.id)}" class="clip" ${timing} ${common}left:${l.x}%;top:${l.y}%;width:${l.size}%;aspect-ratio:1" width="${w}" height="${w}"></canvas>`;
    if (l.type === 'media') {
      const style = `${common}left:${l.x}%;top:${l.y}%;width:${l.size}%;height:auto">`;
      return cardMediaKind(l.src) === 'image' ? `<img alt="${esc(l.name)}" src="${esc(path(l.src))}" ${style}` : `<video id="media-${esc(l.id)}" class="clip" ${timing} data-media-start="${l.offset}" ${l.loop ? 'loop data-loop="true"' : ''} muted playsinline preload="auto" src="${esc(path(cardVideoSource(l.src)))}" ${style}</video>`;
    }
    if (l.type === 'music' && l.src) return `<audio id="media-${esc(l.id)}" data-floc-layer="${esc(l.id)}" preload="auto" src="${esc(path(l.src))}"></audio>`;
    return '';
  }).join('');
}
const vertex = `varying vec2 vUv; uniform float uTime; uniform float uStrength; uniform float uEffect; uniform float uTorsion; uniform float uElastic; uniform float uSide; uniform float uCardSize;
void main(){vUv=uv;vec3 p=position; if(uEffect==1.0){p.z+=sin(p.x*5.0+uTime*2.0)*cos(p.y*3.0-uTime)*uStrength*0.15;}if(uEffect==5.0){float edge=pow(clamp(0.5+(uv.x-0.5)*uSide,0.0,1.0),3.0);p.x+=uSide*uElastic*uCardSize*3.5*edge;p.y*=1.0+uElastic*3.0*edge;}float a=p.y*uTorsion; p.xz=mat2(cos(a),-sin(a),sin(a),cos(a))*p.xz;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`;
const fragment = `varying vec2 vUv; uniform sampler2D uMap; uniform float uTime; uniform float uStrength; uniform float uEffect; uniform float uDepth; uniform vec3 uTint; uniform vec2 uCrop; uniform vec4 uClip; uniform vec2 uWindow; uniform vec2 uCanvasPixels; uniform vec4 uPush; uniform float uImageAspect; uniform float uOpacity; uniform float uCorner; uniform float uAspect; uniform float uShape; uniform float uElastic; uniform float uSide;
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
vec2 uv=(imageUv-0.5)*crop/uPush.z+0.5; if(uEffect==1.0)uv.x+=sin(uv.y*14.0+uTime*2.0)*uStrength*0.015;
if(uEffect==5.0){float edge=pow(clamp(0.5+(vUv.x-0.5)*uSide,0.0,1.0),2.0);float anchor=uSide>0.0?0.12:0.88;uv.x=mix(uv.x,(anchor-0.5)*uCrop.x+0.5,uElastic*edge*0.85);}
vec4 c=texture2D(uMap,uv);float lum=dot(c.rgb,vec3(0.2126,0.7152,0.0722));
if(uEffect==2.0)c.rgb=mix(c.rgb,vec3(lum),uStrength);
if(uEffect==3.0)c.rgb=mix(c.rgb,mix(vec3(0.02),uTint,lum),uStrength);
if(uEffect==4.0){float s=uStrength*0.018*(0.5+0.5*sin(uTime*1.4));c.r=texture2D(uMap,uv+vec2(s,0.0)).r;c.b=texture2D(uMap,uv-vec2(s,0.0)).b;}
if(!gl_FrontFacing)c.rgb*=0.28;c.rgb*=uDepth;gl_FragColor=vec4(c.rgb,c.a*uOpacity*mask);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;

// Values that differ per card. Cards share one geometry and one material; each
// card copies these into the material just before it is drawn.
function cardUniforms(texture, imageAspect) {
  return { uMap: { value: texture }, uImageAspect: { value: imageAspect }, uCrop: { value: new THREE.Vector2(1, 1) }, uCorner: { value: 0 }, uElastic: { value: 0 }, uSide: { value: 0 },
    uClip: { value: new THREE.Vector4(0, 0, 1, 1) }, uPush: { value: new THREE.Vector4(0, 0, 1, 0) }, uDepth: { value: 1 }, uOpacity: { value: 1 }, uTorsion: { value: 0 } };
}
function unloadVideo(video) { pauseMedia(video); video.removeAttribute('src'); video.load(); }
async function loadCardVideo(src) {
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto';
  try {
    await waitForVideo(video, 'loadeddata', () => { video.src = cardVideoSource(src); video.load(); }, () => video.readyState >= 2);
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('Carousel videos must have a finite duration.');
  } catch (error) { unloadVideo(video); throw error; }
  return video;
}

async function createLayerScene(root, p, { renderMode = false, onMediaError = () => {}, cardFrames = {}, resources } = {}) {
  const [width, height] = FORMATS[p.format];
  const carousel = p.layers.find(l => l.type === 'carousel');
  let layer = carousel || { ...demoProject().layers.find(l => l.type === 'carousel'), visible: false };
  const canvas = (carousel ? root.querySelector(`[id="carousel-${CSS.escape(carousel.id)}"]`) : null) || document.createElement('canvas');
  // Export captures read the canvas after drawing; the preview only composites it.
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: renderMode });
  renderer.setPixelRatio(1); renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(layer.perspective ?? 38, width / height, 0.1, 100);
  function updateCamera() {
    camera.position.z = 8 * Math.tan(THREE.MathUtils.degToRad(19)) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    if (layer.template === 'wheel') {
      const count = layer.cardCount || p.images.length;
      const radius = layer.radius || Math.max(2.2, count * (layer.size + layer.gap) / (2 * Math.PI));
      const extent = radius + Math.max(layer.size, layer.size / layer.cardAspect) * 0.6;
      camera.position.z = Math.max(camera.position.z, extent * 1.12 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, width / height)));
    }
  }
  const group = new THREE.Group(); scene.add(group);
  let disposed = false;
  let carouselEffect = null;
  let effectMix = null;
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
  const context = watchContextLoss(canvas, {
    restored() { if (!disposed) try { draw(requestedTime, requestedPlaying); } catch (error) { onMediaError(error); } },
    failed() { if (!disposed) onMediaError(new Error('The preview lost its graphics context and could not restore it. Reload the editor to continue.')); }
  });
  const imageNodes = layerNodes.filter(node => node.tagName === 'IMG');
  const models = [];
  const meshes = [];
  const textures = [];
  const handles = [];
  const cardVideos = [];
  const frameCards = [];
  const frameLoader = new THREE.TextureLoader();
  const imageLoader = new THREE.ImageLoader();
  const placementBounds = new Map();
  // Last animated typography and color written to each text node.
  const textStyles = new Map();
  const material = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, transparent: true,
    uniforms: { ...cardUniforms(null, 1), uCardSize: { value: layer.size }, uAspect: { value: layer.cardAspect }, uShape: { value: 0 }, uTime: { value: 0 }, uStrength: { value: 0 }, uEffect: { value: 0 }, uTint: { value: new THREE.Color() }, uWindow: { value: new THREE.Vector2() }, uCanvasPixels: { value: new THREE.Vector2(width, height) } } });
  let geometry = null;
  let geometryKey = '';
  let requestedTime = 0;
  let requestedPlaying = false;
  function placeLayers(time) {
    const frame = p.layout?.enabled ? (carousel ? canvas : root).getBoundingClientRect() : null;
    for (const l of p.layers.filter(l => ['text', 'logo', 'media', 'model', 'background'].includes(l.type))) {
      const el = layerNodes.find(node => node.dataset.flocLayer === l.id); if (!el) continue;
      const evaluated = evaluateChoreography(l, time);
      const placed = placementFor(l.id);
      const pos = placed ? { ...evaluated, ...placed } : evaluated;
      if (l.type === 'background') {
        for (const node of opacityNodes.filter(node => node.dataset.flocLayer === l.id)) {
          node.style.transform = `translate(${pos.x ?? 0}%,${pos.y ?? 0}%) rotate(${pos.roll ?? 0}deg)`;
        }
        continue;
      }
      const sizeProperty = l.type === 'text' ? 'fontSize' : 'width';
      const sizeValue = l.type === 'text' ? `${pos.size * width / 1080}px` : `${pos.size}%`;
      if (el.style[sizeProperty] !== sizeValue) el.style[sizeProperty] = sizeValue;
      if (l.type === 'model') el.style.height = `${pos.size * width / 100}px`;
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
      let position = pos, rise = l.type === 'text' && l.rise ? (1 - layerAlpha({ ...l, opacity: 1, choreography: [] }, time)) * 24 : 0;
      if (p.layout?.enabled && l.type === 'text') {
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
          const area = safeArea(p.layout);
          rise = Math.min(rise, Math.max(0, (area.y + area.height - constrained.y - bounds.height) * height / 100));
        }
      }
      el.style.left = `${position.x}%`; el.style.top = `${position.y}%`;
      el.style.transform = `${rise ? `translateY(${rise}px) ` : ''}${['text', 'logo', 'media'].includes(l.type) ? `rotate(${pos.roll ?? 0}deg)` : ''}`;
      if (l.type === 'text') el.style.clipPath = textRevealClip(l, time);
    }
  }
  function reshapeCardGeometry(geometry, sampled) {
    const windowPush = sampled.template === 'window-push';
    const size = windowPush ? 1 : sampled.size;
    const aspect = windowPush ? width / height : sampled.cardAspect;
    const positions = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    const wrapped = sampled.template === 'circular' && ['wrapped', undefined].includes(motionVariant(sampled));
    const radius = sampled.radius || Math.max(1.45, ((sampled.cardCount || p.images.length) * (size + sampled.gap)) / (2 * Math.PI));
    for (let i = 0; i < positions.count; i++) {
      const x = (uv.getX(i) - 0.5) * size;
      const angle = x / radius;
      positions.setXYZ(i, wrapped ? x * (1 - sampled.curve) + Math.sin(angle) * radius * sampled.curve : x,
        (uv.getY(i) - 0.5) * size / aspect, wrapped ? (Math.cos(angle) - 1) * radius * sampled.curve : 0);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }
  // Every card has the same shape; reshape the shared geometry when it changes.
  function shapeCards(sampled) {
    const segments = layer.shader === 'elastic' ? 64 : 32;
    const key = JSON.stringify([sampled.template, sampled.size, sampled.cardAspect, sampled.radius, sampled.gap, sampled.curve, sampled.cardCount, motionVariant(sampled), segments]);
    if (key === geometryKey) return;
    if (geometry?.parameters.widthSegments !== segments) {
      const previous = geometry;
      geometry = new THREE.PlaneGeometry(1, 1, segments, 16);
      meshes.forEach(mesh => { mesh.geometry = geometry; });
      previous?.dispose();
    }
    reshapeCardGeometry(geometry, sampled);
    material.uniforms.uCardSize.value = sampled.size;
    geometryKey = key;
  }
  // Carousel-wide values; rerun after in-place edits.
  function applySettings() {
    camera.fov = layer.perspective ?? 38;
    camera.updateProjectionMatrix();
    updateCamera();
    const uniforms = material.uniforms;
    uniforms.uStrength.value = layer.intensity;
    uniforms.uEffect.value = SHADERS.find(s => s.id === layer.shader).mode;
    uniforms.uTint.value.set(layer.tint);
    uniforms.uShape.value = layer.cardShape === 'squircle' ? 1 : 0;
    uniforms.uAspect.value = layer.cardAspect;
    const side = layer.backface === 'hide' ? THREE.FrontSide : layer.frontface === 'hide' ? THREE.BackSide : THREE.DoubleSide;
    if (material.side !== side) { material.side = side; material.needsUpdate = true; }
    shapeCards(layer);
    for (const mesh of meshes) {
      const card = mesh.userData.uniforms;
      const imageRatio = card.uImageAspect.value, cardRatio = layer.cardAspect;
      if (imageRatio > cardRatio) card.uCrop.value.set(cardRatio / imageRatio, 1); else card.uCrop.value.set(1, imageRatio / cardRatio);
      card.uCorner.value = layer.cornerRadius / 100;
      // Vertex wings extend beyond the CPU-side geometry bounds.
      mesh.frustumCulled = layer.shader !== 'elastic';
    }
    syncCarouselEffect(layer);
  }
  // Reuses the passes unless the Paper effect or the active warps change, or
  // the Paper mix reaches zero.
  function syncCarouselEffect(settings) {
    if (!carouselEffect?.update(settings)) {
      carouselEffect?.dispose();
      carouselEffect = createCarouselEffect(renderer, canvas.width, canvas.height, settings);
    }
    effectMix = settings.layerEffectIntensity;
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
      const frames = cardFrames[src];
      if (!frames) throw new Error(`Prepared carousel frames are missing: ${src}`);
      const texture = await frameLoader.loadAsync(cardFrameSource(frames, 0));
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
    await Promise.all(p.layers.filter(l => l.type === 'text').map(l => document.fonts.load(`${l.weight} ${l.size * width / 1080}px "${fontFamily(l.font)}"`)));
    await document.fonts.ready;
    for (const model of p.layers.filter(l => l.type === 'model')) models.push(await createModelScene(root.querySelector(`[id="model-${CSS.escape(model.id)}"]`), model, width, width, { resources, renderMode, onError: onMediaError }));
    const sources = [...new Set((carousel ? p.images : []).map(img => img.src))];
    const results = await Promise.allSettled(sources.map(cardTexture));
    textures.push(...results.filter(result => result.status === 'fulfilled').map(result => result.value));
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    const loaded = p.images.map(img => textures[sources.indexOf(img.src)]);
    shapeCards(layer);
    Array.from({ length: loaded.length ? layer.cardCount || loaded.length : 0 }, (_, i) => loaded[i % loaded.length]).forEach(texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const card = cardUniforms(texture, (texture.image.videoWidth || texture.image.width) / (texture.image.videoHeight || texture.image.height));
      const mesh = new THREE.Mesh(geometry, material);
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
  } catch (error) { dispose(); throw error; }
  function dispose() {
    if (disposed) return;
    disposed = true;
    mediaErrors.forEach(remove => remove());
    context.dispose();
    carouselEffect?.dispose();
    models.forEach(model => model.dispose());
    mediaNodes.forEach(m => { pauseMedia(m); m.removeAttribute('src'); m.load(); });
    geometry?.dispose(); material.dispose();
    textures.forEach(t => t.dispose());
    // Shared decoders keep playing for the scene that replaces this one.
    handles.forEach(handle => handle.release());
    renderer.dispose(); renderer.forceContextLoss();
  }
  function draw(time, playing = false) {
    if (disposed) return;
    if (context.lost && renderMode) throw new Error('The graphics context was lost while rendering.');
    placeLayers(time);
    models.forEach(model => model.draw(time, placementFor(model.id) ?? undefined));
    const local = Math.max(0, time - layer.start);
    const sampled = { ...evaluateChoreography(layer, time), ...orientation };
    shapeCards(sampled);
    group.rotation.set(THREE.MathUtils.degToRad(sampled.tilt), THREE.MathUtils.degToRad(sampled.yaw ?? 0), THREE.MathUtils.degToRad(sampled.roll));
    const viewHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const placed = placementFor(layer.id);
    const position = placed ? { ...sampled, ...placed } : sampled;
    group.position.set((position.x / 100 - 0.5) * viewHeight * width / height, (0.5 - position.y / 100) * viewHeight, 0);
    // Planar carousels size their largest card as a fraction of the canvas.
    const planar = ['zoom-through', 'sweep-reveal'].includes(layer.template);
    const shuffle = layer.template === 'stack-shuffle';
    const windowPush = layer.template === 'window-push';
    const canvasSize = windowPush ? viewHeight * width / height : planar ? Math.min(viewHeight * width / height, viewHeight * sampled.cardAspect) : shuffle ? viewHeight : 1;
    const windowHeight = Math.min(0.72 * sampled.size, 0.96, 0.96 * width / height / sampled.cardAspect);
    const uniforms = material.uniforms;
    uniforms.uWindow.value.set(windowPush ? windowHeight * sampled.cardAspect * height / width : 0, windowPush ? windowHeight : 0);
    if (windowPush) uniforms.uAspect.value = width / height;
    uniforms.uTime.value = local;
    uniforms.uStrength.value = sampled.intensity;
    if (sampled.layerEffectIntensity !== effectMix) syncCarouselEffect(sampled);
    material.depthTest = !(planar || shuffle || windowPush);
    material.depthWrite = !(planar || shuffle || windowPush);
    meshes.forEach((mesh, i) => {
      const card = mesh.userData.uniforms;
      const state = carouselCard(sampled, i, meshes.length, time);
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
      if (shuffle) card.uCorner.value = Math.min(1, 2 * (sampled.shuffleCorner ?? 15) / (sampled.size * height * Math.min(1, 1 / sampled.cardAspect) * state.scale));
      mesh.visible = !(layer.frontface === 'hide' && layer.backface === 'hide') && layerAlpha(layer, time) > 0 && state.opacity > 0.001;
      card.uDepth.value = state.depth;
      card.uOpacity.value = state.opacity;
      card.uTorsion.value = state.torsion;
    });
    cardVideos.forEach(({ video, texture }) => { if (video.readyState >= 2) texture.needsUpdate = true; });
    if (carouselEffect) carouselEffect.render(scene, camera, sampled);
    else renderer.render(scene, camera);
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
      const loaded = await frameLoader.loadAsync(cardFrameSource(card.frames, index));
      if (!disposed && requestedTime === time) {
        card.texture.image = loaded.image;
        card.texture.needsUpdate = true;
        card.index = index;
      }
      loaded.dispose();
    }));
    frames.push(...standalone);
    if (!frames.length) { draw(time, playing); return Promise.resolve(); }
    const ready = Promise.all(frames).then(() => { if (!disposed && requestedTime === time) draw(time, playing); });
    if (renderMode) return ready;
    return ready.catch(error => { if (!disposed) onMediaError(error); });
  }
  try { await seek(0); } catch (error) { dispose(); throw error; }
  // Takes the engine's slice of a project that sceneUpdatePlan accepted.
  function update(next) {
    p = next;
    if (carousel) {
      layer = p.layers.find(l => l.id === carousel.id);
      applySettings();
    }
    models.forEach(model => model.updateLayer(p.layers.find(l => l.id === model.id)));
    placementBounds.clear();
    textStyles.clear();
  }
  return { update, seek, hitTest(x, y) { if (disposed) return false; scene.updateMatrixWorld(true); const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), camera); return ray.intersectObjects(meshes.filter(mesh => mesh.visible)).length > 0; }, setResolution(w, h) { if (!disposed && (canvas.width !== w || canvas.height !== h)) { renderer.setSize(w, h, false); carouselEffect?.setResolution(w, h); models.forEach(model => model.setResolution(w, w)); } }, setOrientation(value) { orientation = value; }, setPlacement(value) { placement = value; }, dispose };
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
function markupPatch(root, previous, next) {
  const parse = project => { const template = document.createElement('template'); template.innerHTML = stageMarkup(project); return [...template.content.children]; };
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
  // Preview sessions pass a shared cache so rebuilds reuse decoded media.
  options = { ...options, resources: options.resources ?? createResourceCache() };
  let currentProject = project;
  let currentTime = 0;
  let disposed = false;
  const engines = [];
  let effects = createEffects(root, project, FORMATS, layerAlpha);
  const backgrounds = project.layers.filter(layer => layer.type === 'background' && layer.mode === 'procedural').map(layer => ({ id: layer.id, canvas: root.querySelector(`[id="background-${CSS.escape(layer.id)}"]`) })).filter(background => background.canvas);
  function drawBackgrounds(time) {
    if (disposed) return;
    currentTime = time;
    backgrounds.forEach(background => {
      const layer = currentProject.layers.find(layer => layer.id === background.id);
      if (layer) drawProceduralBackground(background.canvas, layer, Math.max(0, time - layer.start));
    });
  }
  try {
    for (const { id, project: value } of engineProjects(project)) engines.push({ id, scene: await createLayerScene(root, value, options) });
  } catch (error) { engines.forEach(engine => engine.scene.dispose()); effects.dispose(); throw error; }
  drawBackgrounds(0);
  return {
    // Applies parameter edits to the live scene. Returns false, leaving the
    // scene untouched, when `next` needs a rebuild. Callers seek afterwards.
    update(next) {
      if (disposed) return false;
      const plan = sceneUpdatePlan(currentProject, next);
      if (!plan || !fontsLoaded(currentProject, next)) return false;
      const patch = markupPatch(root, currentProject, next);
      if (!patch) return false;
      patch();
      currentProject = next;
      const parts = engineProjects(next);
      engines.forEach((engine, i) => engine.scene.update(parts[i].project));
      if (plan.effects) { effects.dispose(); effects = createEffects(root, next, FORMATS, layerAlpha); }
      else effects.updateLayers(next.layers);
      return true;
    },
    seek: (time, playing) => { drawBackgrounds(time); return Promise.all([...engines.map(engine => engine.scene.seek(time, playing)), effects.seek(time)]); },
    hitTest: (x, y, id) => engines.find(engine => engine.id === id)?.scene.hitTest(x, y) ?? false,
    setResolution: (w, h) => {
      if (disposed) return;
      engines.forEach(engine => engine.scene.setResolution(w, h));
      root.querySelectorAll('canvas[data-floc-layer]').forEach(canvas => {
        if (currentProject.layers.some(layer => layer.id === canvas.dataset.flocLayer && layer.type === 'effect') && (canvas.width !== w || canvas.height !== h)) { canvas.width = w; canvas.height = h; }
      });
      backgrounds.forEach(({ canvas }) => { if (canvas.width !== w) canvas.width = w; if (canvas.height !== h) canvas.height = h; });
      drawBackgrounds(currentTime);
    },
    setOrientation: value => engines.forEach(engine => engine.scene.setOrientation(value?.id === engine.id ? value : null)),
    setPlacement: value => engines.forEach(engine => engine.scene.setPlacement(value)),
    dispose: () => { disposed = true; effects.dispose(); engines.forEach(engine => engine.scene.dispose()); }
  };
}
