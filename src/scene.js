import { createModelScene } from './model-scene.js';
import { cardMediaKind, cardVideoSource, cardMediaTime, waitForVideo, seekCardVideo } from './card-media.js';
import { carouselCard, motionVariant, elasticState } from './carousel-motion.js';
import * as THREE from 'three';
import { fontDefinition } from './fonts.js';
import { FORMATS, SHADERS, escapeHtml, layerAlpha, audioTime, demoProject, carouselImages } from './project.js';
import { constrainPlacement, fitsSafeArea, safeArea } from './layout.js';
import { createCarouselEffect } from './carousel-effects.js';

export function stageMarkup(p, path = src => src) {
  const [w, h] = FORMATS[p.format];
  const esc = escapeHtml;
  return p.layers.map((l, i) => {
    const timing = `data-start="${l.start}" data-duration="${l.end - l.start}" data-track-index="${i}"`;
    const common = `data-floc-layer="${esc(l.id)}" style="position:absolute;z-index:${i};opacity:${l.visible ? 1 : 0};`;
    if (l.type === 'background') {
      const fill = `<div ${common}inset:0;background:${l.color}"></div>`;
      if (l.mode === 'color' || !l.src) return fill;
      const style = `${common}inset:0;width:100%;height:100%;object-fit:${l.fit}">`;
      return fill + (l.mode === 'video' ? `<video id="media-${esc(l.id)}" ${timing} data-media-start="${l.offset}" ${l.loop ? 'loop data-loop="true"' : ''} muted playsinline preload="auto" src="${esc(path(l.src))}" ${style}</video>` : `<img alt="" src="${esc(path(l.src))}" ${style}`);
    }
    if (l.type === 'carousel') return `<canvas id="carousel-${esc(l.id)}" class="clip" ${timing} ${common}inset:0;width:${w}px;height:${h}px" width="${w}" height="${h}"></canvas>`;
    if (l.type === 'text') return `<div ${common}left:${l.x}%;top:${l.y}%;width:${l.width}%;font-size:${l.size * w / 1080}px;line-height:0.98;letter-spacing:-0.035em;font-family:${esc(fontDefinition(l.font).family)};font-weight:${l.weight};white-space:pre-wrap;overflow-wrap:anywhere;color:${l.color}">${esc(l.text)}</div>`;
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
const fragment = `varying vec2 vUv; uniform sampler2D uMap; uniform float uTime; uniform float uStrength; uniform float uEffect; uniform float uDepth; uniform vec3 uTint; uniform vec2 uCrop; uniform float uOpacity; uniform float uCorner; uniform float uAspect; uniform float uShape; uniform float uElastic; uniform float uSide;
void main(){
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
vec2 uv=(vUv-0.5)*uCrop+0.5; if(uEffect==1.0)uv.x+=sin(uv.y*14.0+uTime*2.0)*uStrength*0.015;
if(uEffect==5.0){float edge=pow(clamp(0.5+(vUv.x-0.5)*uSide,0.0,1.0),2.0);float anchor=uSide>0.0?0.12:0.88;uv.x=mix(uv.x,(anchor-0.5)*uCrop.x+0.5,uElastic*edge*0.85);}
vec4 c=texture2D(uMap,uv);float lum=dot(c.rgb,vec3(0.2126,0.7152,0.0722));
if(uEffect==2.0)c.rgb=mix(c.rgb,vec3(lum),uStrength);
if(uEffect==3.0)c.rgb=mix(c.rgb,mix(vec3(0.02),uTint,lum),uStrength);
if(uEffect==4.0){float s=uStrength*0.018*(0.5+0.5*sin(uTime*1.4));c.r=texture2D(uMap,uv+vec2(s,0.0)).r;c.b=texture2D(uMap,uv-vec2(s,0.0)).b;}
if(!gl_FrontFacing)c.rgb*=0.28;c.rgb*=uDepth;gl_FragColor=vec4(c.rgb,c.a*uOpacity*mask);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;

async function createLayerScene(root, p, { renderMode = false, onMediaError = () => {} } = {}) {
  const [width, height] = FORMATS[p.format];
  const carousel = p.layers.find(l => l.type === 'carousel');
  const layer = carousel || { ...demoProject().layers.find(l => l.type === 'carousel'), visible: false };
  const canvas = (carousel ? root.querySelector(`[id="carousel-${CSS.escape(carousel.id)}"]`) : null) || document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(layer.perspective ?? 38, width / height, 0.1, 100);
  camera.position.z = 8 * Math.tan(THREE.MathUtils.degToRad(19)) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  if (layer.template === 'wheel') {
    const count = layer.cardCount || p.images.length;
    const radius = layer.radius || Math.max(2.2, count * (layer.size + layer.gap) / (2 * Math.PI));
    const extent = radius + Math.max(layer.size, layer.size / layer.cardAspect) * 0.6;
    camera.position.z = Math.max(camera.position.z, extent * 1.12 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, width / height)));
  }
  const group = new THREE.Group(); scene.add(group);
  let disposed = false;
  let carouselEffect = null;
  let orientation = null;
  let placement = null;
  const layerNodes = [...root.querySelectorAll('[data-floc-layer]')].filter(node => p.layers.some(l => l.id === node.dataset.flocLayer));
  const mediaNodes = layerNodes.filter(node => ['AUDIO', 'VIDEO'].includes(node.tagName));
  const imageNodes = layerNodes.filter(node => node.tagName === 'IMG');
  const models = [];
  const meshes = [];
  const textures = [];
  const cardVideos = [];
  const placementBounds = new Map();
  let requestedTime = 0;
  function placeLayers(time) {
    const frame = p.layout?.enabled ? (carousel ? canvas : root).getBoundingClientRect() : null;
    for (const l of p.layers.filter(l => ['text', 'logo', 'media', 'model'].includes(l.type))) {
      const el = layerNodes.find(node => node.dataset.flocLayer === l.id); if (!el) continue;
      const pos = placement?.id === l.id ? { ...l, ...placement } : l;
      const sizeProperty = l.type === 'text' ? 'fontSize' : 'width';
      const sizeValue = l.type === 'text' ? `${pos.size * width / 1080}px` : `${pos.size}%`;
      if (el.style[sizeProperty] !== sizeValue) el.style[sizeProperty] = sizeValue;
      if (l.type === 'model') el.style.height = `${pos.size * width / 100}px`;
      let position = pos, rise = l.type === 'text' && l.rise ? (1 - layerAlpha(l, time)) * 24 : 0;
      if (p.layout?.enabled && ['text', 'logo'].includes(l.type)) {
        if (frame.width && frame.height) {
          const key = `${sizeValue}:${frame.width}:${frame.height}`;
          let bounds = placementBounds.get(el);
          if (bounds?.key !== key) {
            const rect = el.getBoundingClientRect();
            bounds = { key, width: rect.width / frame.width * 100, height: rect.height / frame.height * 100 };
            placementBounds.set(el, bounds);
          }
          if (renderMode && l.visible && !fitsSafeArea(bounds, p.layout)) throw new Error(`${l.name} exceeds the safe area. Reduce its width or size before exporting.`);
          position = constrainPlacement(pos.x, pos.y, bounds.width, bounds.height, p.layout);
          const area = safeArea(p.layout);
          rise = Math.min(rise, Math.max(0, (area.y + area.height - position.y - bounds.height) * height / 100));
        }
      }
      el.style.left = `${position.x}%`; el.style.top = `${position.y}%`;
      el.style.transform = rise ? `translateY(${rise}px)` : '';
    }
  }
  try {
    await Promise.all(p.layers.filter(l => l.type === 'text').map(l => document.fonts.load(`${l.weight} ${l.size * width / 1080}px "${fontDefinition(l.font).family}"`)));
    await document.fonts.ready;
    for (const model of p.layers.filter(l => l.type === 'model')) models.push(await createModelScene(root.querySelector(`[id="model-${CSS.escape(model.id)}"]`), model, width, width));
    const loader = new THREE.TextureLoader();
    const results = await Promise.allSettled((carousel ? p.images : []).map(async img => {
      if (cardMediaKind(img.src) === 'image') return loader.loadAsync(img.src);
      const video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.preload = 'auto';
      const texture = new THREE.VideoTexture(video);
      const card = { video, texture }; cardVideos.push(card);
      await waitForVideo(video, 'loadeddata', () => { video.src = cardVideoSource(img.src); video.load(); }, () => video.readyState >= 2);
      if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('Carousel videos must have a finite duration.');
      texture.needsUpdate = true;
      return texture;
    }));
    textures.push(...results.filter(result => result.status === 'fulfilled').map(result => result.value));
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    const loaded = textures;
    Array.from({ length: loaded.length ? layer.cardCount || loaded.length : 0 }, (_, i) => loaded[i % loaded.length]).forEach(texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const size = layer.size;
      const geometry = new THREE.PlaneGeometry(size, size / layer.cardAspect, layer.shader === 'elastic' ? 64 : 32, 16);
      if (layer.template === 'circular' && ['wrapped', undefined].includes(motionVariant(layer))) {
        const radius = layer.radius || Math.max(1.45, ((layer.cardCount || p.images.length) * (size + layer.gap)) / (2 * Math.PI));
        const pos = geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); const a = x / radius; pos.setX(i, x * (1 - layer.curve) + Math.sin(a) * radius * layer.curve); pos.setZ(i, (Math.cos(a) - 1) * radius * layer.curve); }
        geometry.computeVertexNormals();
      }
      const imageRatio = (texture.image.videoWidth || texture.image.width) / (texture.image.videoHeight || texture.image.height);
      const cardRatio = layer.cardAspect;
      const crop = imageRatio > cardRatio ? new THREE.Vector2(cardRatio / imageRatio, 1) : new THREE.Vector2(1, imageRatio / cardRatio);
      const material = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, side: layer.backface === 'hide' ? THREE.FrontSide : layer.frontface === 'hide' ? THREE.BackSide : THREE.DoubleSide, transparent: true,
        uniforms: { uMap: { value: texture }, uTorsion: { value: 0 }, uElastic: { value: 0 }, uSide: { value: 0 }, uCardSize: { value: size }, uOpacity: { value: 1 }, uCorner: { value: layer.cornerRadius / 100 }, uAspect: { value: layer.cardAspect }, uShape: { value: layer.cardShape === 'squircle' ? 1 : 0 }, uTime: { value: 0 }, uStrength: { value: layer.intensity }, uEffect: { value: SHADERS.find(s => s.id === layer.shader).mode }, uTint: { value: new THREE.Color(layer.tint) }, uDepth: { value: 1 }, uCrop: { value: crop } }
      });
      const mesh = new THREE.Mesh(geometry, material);
      // Vertex wings extend beyond the CPU-side geometry bounds.
      if (layer.shader === 'elastic') mesh.frustumCulled = false;
      group.add(mesh); meshes.push(mesh);
    });
    await Promise.all(imageNodes.map(img => img.decode().catch(() => { throw new Error('An image could not be decoded.'); })));
    placeLayers(0);
    carouselEffect = createCarouselEffect(renderer, width, height, layer);
  } catch (error) { dispose(); throw error; }
  function dispose() {
    if (disposed) return;
    disposed = true;
    carouselEffect?.dispose();
    models.forEach(model => model.dispose());
    cardVideos.forEach(({ video, texture }) => { video.pause(); video.removeAttribute('src'); video.load(); texture.dispose(); });
    mediaNodes.forEach(m => { m.pause(); m.removeAttribute('src'); m.load(); });
    meshes.forEach(m => { m.geometry.dispose(); m.material.dispose(); });
    textures.forEach(t => t.dispose());
    renderer.dispose(); renderer.forceContextLoss();
  }
  function draw(time, playing = false) {
    if (disposed) return;
    placeLayers(time);
    models.forEach(model => model.draw(time));
    const local = Math.max(0, time - layer.start);
    group.rotation.set(THREE.MathUtils.degToRad(orientation?.tilt ?? layer.tilt), THREE.MathUtils.degToRad(orientation?.yaw ?? layer.yaw ?? 0), THREE.MathUtils.degToRad(orientation?.roll ?? layer.roll));
    const viewHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const position = placement?.id === layer.id ? { ...layer, ...placement } : layer;
    group.position.set((position.x / 100 - 0.5) * viewHeight * width / height, (0.5 - position.y / 100) * viewHeight, 0);
    meshes.forEach((mesh, i) => {
      const state = carouselCard(orientation?.size === undefined ? layer : { ...layer, size: orientation.size }, i, meshes.length, time);
      const optical = elasticState(layer, state);
      mesh.material.uniforms.uElastic.value = optical.strength;
      mesh.material.uniforms.uSide.value = optical.side;
      mesh.position.set(...state.position);
      mesh.rotation.set(...state.rotation);
      mesh.scale.setScalar(state.scale);
      mesh.visible = !(layer.frontface === 'hide' && layer.backface === 'hide') && layerAlpha(layer, time) > 0 && state.opacity > 0.001;
      mesh.material.uniforms.uDepth.value = state.depth;
      mesh.material.uniforms.uOpacity.value = state.opacity;
      mesh.material.uniforms.uTorsion.value = state.torsion;
      mesh.material.uniforms.uTime.value = local;
    });
    cardVideos.forEach(({ video, texture }) => { if (video.readyState >= 2) texture.needsUpdate = true; });
    if (carouselEffect) carouselEffect.render(scene, camera);
    else renderer.render(scene, camera);
    p.layers.forEach(l => {
      const alpha = layerAlpha(l, time);
      layerNodes.forEach(el => { if (el.dataset.flocLayer === l.id && !['AUDIO', 'VIDEO'].includes(el.tagName)) el.style.opacity = alpha; });
      const media = mediaNodes.find(el => el.dataset.flocLayer === l.id);
      if (!media) return;
      if (media.tagName === 'VIDEO') media.style.opacity = alpha;
      if (renderMode || !Number.isFinite(media.duration)) return;
      const desired = audioTime(l, time, media.duration);
      const active = alpha > 0 && (l.loop || desired < media.duration - 0.02);
      if (Math.abs(media.currentTime - desired) > (playing ? 0.2 : 0.025)) media.currentTime = desired;
      if (l.type === 'music') media.volume = l.volume * (l.fade ? Math.max(0, Math.min(1, (time - l.start) / l.fade, (l.end - time) / l.fade)) : 1);
      if (playing && active) { if (media.paused) media.play().catch(() => {}); } else if (!media.paused) media.pause();
    });
  }
  function seek(time, playing = false) {
    if (disposed) return Promise.resolve();
    requestedTime = time;
    if (playing && !renderMode) {
      for (const { video } of cardVideos) {
        const desired = cardMediaTime(time, layer.start, video.duration);
        if (Math.abs(video.currentTime - desired) > 0.2) video.currentTime = desired;
        video.loop = true;
        if (layerAlpha(layer, time) > 0) { if (video.paused) video.play().catch(onMediaError); }
        else if (!video.paused) video.pause();
      }
      draw(time, playing);
      return Promise.resolve();
    }
    const standalone = renderMode ? [] : mediaNodes.filter(video => video.tagName === 'VIDEO').map(async video => {
      const l = p.layers.find(l => l.id === video.dataset.flocLayer);
      if (video.readyState < 2) await waitForVideo(video, 'loadeddata', () => video.load(), () => video.readyState >= 2);
      video.pause();
      await seekCardVideo(video, audioTime(l, time, video.duration));
    });
    const frames = cardVideos.map(({ video }) => {
      video.pause();
      return seekCardVideo(video, cardMediaTime(time, layer.start, video.duration));
    });
    frames.push(...standalone);
    if (!frames.length) { draw(time, playing); return Promise.resolve(); }
    const ready = Promise.all(frames).then(() => { if (!disposed && requestedTime === time) draw(time, playing); });
    if (renderMode) return ready;
    return ready.catch(error => { if (!disposed) onMediaError(error); });
  }
  try { await seek(0); } catch (error) { dispose(); throw error; }
  return { seek, hitTest(x, y) { if (disposed) return false; scene.updateMatrixWorld(true); const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), camera); return ray.intersectObjects(meshes.filter(mesh => mesh.visible)).length > 0; }, setResolution(w, h) { if (!disposed && (canvas.width !== w || canvas.height !== h)) { renderer.setSize(w, h, false); carouselEffect?.setResolution(w, h); models.forEach(model => model.setResolution(w, w)); } }, setOrientation(value) { orientation = value; }, setPlacement(value) { placement = value; }, dispose };
}

export async function createScene(root, project, options = {}) {
  const carousels = project.layers.filter(layer => layer.type === 'carousel');
  const engines = [];
  try {
    const first = carousels[0];
    engines.push({ id: first?.id, scene: await createLayerScene(root, { ...project, images: carouselImages(project, first), layers: project.layers.filter(layer => layer.type !== 'carousel' || layer.id === first?.id) }, options) });
    for (const layer of carousels.slice(1)) {
      engines.push({ id: layer.id, scene: await createLayerScene(root, { ...project, images: carouselImages(project, layer), layers: [layer] }, options) });
    }
  } catch (error) { engines.forEach(engine => engine.scene.dispose()); throw error; }
  return {
    seek: (time, playing) => Promise.all(engines.map(engine => engine.scene.seek(time, playing))),
    hitTest: (x, y, id) => engines.find(engine => engine.id === id)?.scene.hitTest(x, y) ?? false,
    setResolution: (w, h) => engines.forEach(engine => engine.scene.setResolution(w, h)),
    setOrientation: value => engines.forEach(engine => engine.scene.setOrientation(value?.id === engine.id ? value : null)),
    setPlacement: value => engines.forEach(engine => engine.scene.setPlacement(value)),
    dispose: () => engines.forEach(engine => engine.scene.dispose())
  };
}
