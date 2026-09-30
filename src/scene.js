import * as THREE from 'three';
import { FORMATS, SHADERS, escapeHtml, layerAlpha, audioTime } from './project.js';

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
    if (l.type === 'carousel') return `<canvas id="carousel-canvas" class="clip" ${timing} ${common}inset:0;width:${w}px;height:${h}px" width="${w}" height="${h}"></canvas>`;
    if (l.type === 'text') return `<div ${common}left:${l.x}%;top:${l.y}%;width:${l.width}%;font-size:${l.size * w / 1080}px;line-height:0.98;letter-spacing:-0.035em;font-weight:${l.weight};white-space:pre-wrap;overflow-wrap:anywhere;color:${l.color}">${esc(l.text)}</div>`;
    if (l.type === 'logo' && l.src) return `<img alt="Studio mark" src="${esc(path(l.src))}" ${common}left:${l.x}%;top:${l.y}%;width:${l.size}%;height:auto">`;
    if (l.type === 'music' && l.src) return `<audio id="media-${esc(l.id)}" data-floc-layer="${esc(l.id)}" preload="auto" src="${esc(path(l.src))}"></audio>`;
    return '';
  }).join('');
}
const vertex = `varying vec2 vUv; uniform float uTime; uniform float uStrength; uniform float uEffect;
void main(){vUv=uv;vec3 p=position; if(uEffect==1.0){p.z+=sin(p.x*5.0+uTime*2.0)*cos(p.y*3.0-uTime)*uStrength*0.15;}gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`;
const fragment = `varying vec2 vUv; uniform sampler2D uMap; uniform float uTime; uniform float uStrength; uniform float uEffect; uniform float uDepth; uniform vec3 uTint; uniform vec2 uCrop;
void main(){vec2 uv=(vUv-0.5)*uCrop+0.5; if(uEffect==1.0)uv.x+=sin(uv.y*14.0+uTime*2.0)*uStrength*0.015;
vec4 c=texture2D(uMap,uv);float lum=dot(c.rgb,vec3(0.2126,0.7152,0.0722));
if(uEffect==2.0)c.rgb=mix(c.rgb,vec3(lum),uStrength);
if(uEffect==3.0)c.rgb=mix(c.rgb,mix(vec3(0.02),uTint,lum),uStrength);
if(uEffect==4.0){float s=uStrength*0.018*(0.5+0.5*sin(uTime*1.4));c.r=texture2D(uMap,uv+vec2(s,0.0)).r;c.b=texture2D(uMap,uv-vec2(s,0.0)).b;}
if(!gl_FrontFacing)c.rgb*=0.28;c.rgb*=uDepth;gl_FragColor=vec4(c.rgb,c.a);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;

export async function createScene(root, p, { renderMode = false } = {}) {
  const [width, height] = FORMATS[p.format];
  const layer = p.layers.find(l => l.type === 'carousel');
  const canvas = root.querySelector('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
  camera.position.z = 8;
  const group = new THREE.Group(); scene.add(group);
  let disposed = false;
  const layerNodes = [...root.querySelectorAll('[data-floc-layer]')];
  const mediaNodes = [...root.querySelectorAll('audio,video')];
  const meshes = [];
  const textures = [];
  try {
    await document.fonts.ready;
    const loader = new THREE.TextureLoader();
    const loaded = await Promise.all(p.images.map(img => loader.loadAsync(img.src)));
    textures.push(...loaded);
    loaded.forEach(texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      const size = layer.size;
      const geometry = new THREE.PlaneGeometry(size, size * 1.14, 32, 16);
      if (layer.template === 'circular') {
        const radius = Math.max(1.45, (p.images.length * (size + layer.gap)) / (2 * Math.PI));
        const pos = geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); const a = x / radius; pos.setX(i, x * (1 - layer.curve) + Math.sin(a) * radius * layer.curve); pos.setZ(i, (Math.cos(a) - 1) * radius * layer.curve); }
        geometry.computeVertexNormals();
      }
      const imageRatio = texture.image.width / texture.image.height;
      const cardRatio = 1 / 1.14;
      const crop = imageRatio > cardRatio ? new THREE.Vector2(cardRatio / imageRatio, 1) : new THREE.Vector2(1, imageRatio / cardRatio);
      const material = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, side: THREE.DoubleSide,
        uniforms: { uMap: { value: texture }, uTime: { value: 0 }, uStrength: { value: layer.intensity }, uEffect: { value: SHADERS.find(s => s.id === layer.shader).mode }, uTint: { value: new THREE.Color(layer.tint) }, uDepth: { value: 1 }, uCrop: { value: crop } }
      });
      const mesh = new THREE.Mesh(geometry, material); group.add(mesh); meshes.push(mesh);
    });
    await Promise.all([...root.querySelectorAll('img')].map(img => img.decode().catch(() => { throw new Error('An image could not be decoded.'); })));
  } catch (error) { renderer.dispose(); textures.forEach(t => t.dispose()); throw error; }
  function seek(time, playing = false) {
    if (disposed) return;
    const local = Math.max(0, time - layer.start);
    group.rotation.set(THREE.MathUtils.degToRad(layer.tilt), 0, THREE.MathUtils.degToRad(layer.roll));
    const viewHeight = 2 * Math.tan(THREE.MathUtils.degToRad(19)) * 8;
    group.position.set((layer.x / 100 - 0.5) * viewHeight * width / height, (0.5 - layer.y / 100) * viewHeight, 0);
    const radius = Math.max(1.45, (p.images.length * (layer.size + layer.gap)) / (2 * Math.PI));
    const angle = THREE.MathUtils.degToRad(local * layer.speed);
    meshes.forEach((mesh, i) => {
      const n = meshes.length;
      mesh.visible = layerAlpha(layer, time) > 0;
      mesh.scale.setScalar(1);
      if (layer.template === 'circular') {
        const theta = i / n * Math.PI * 2 + angle;
        mesh.position.set(Math.sin(theta) * radius, 0, Math.cos(theta) * radius);
        mesh.rotation.set(0, theta, 0);
        mesh.material.uniforms.uDepth.value = 0.65 + (Math.cos(theta) + 1) * 0.175;
      } else if (layer.template === 'arc') {
        const cycle = local * layer.speed / 60;
        const n = meshes.length;
        const d = ((i - cycle + n / 2) % n + n) % n - n / 2;
        const a = d * (0.34 + layer.gap * 0.2);
        mesh.position.set(Math.sin(a) * 3.6, Math.cos(a) * 3.6 - 2.1, -Math.abs(d) * 0.06);
        mesh.rotation.set(0, 0, -a);
        mesh.visible &&= Math.abs(a) < 1.7;
        mesh.material.uniforms.uDepth.value = 1;
      } else {
        const focus = local * layer.speed / 35;
        let d = ((i - focus + n / 2) % n + n) % n - n / 2;
        mesh.visible &&= Math.abs(d) < 3.2;
        if (layer.template === 'depth') { mesh.position.set(d * (0.65 + layer.gap), d * 0.18, -Math.abs(d) * 0.85); mesh.rotation.set(0, d * 0.2, 0); }
        else { mesh.position.set(d * (layer.size + layer.gap), 0, -Math.abs(d) * 0.35); mesh.rotation.set(0, -d * 0.18, 0); }
        mesh.material.uniforms.uDepth.value = Math.max(0.45, 1 - Math.abs(d) * 0.14);
      }
      mesh.material.uniforms.uTime.value = local;
    });
    renderer.render(scene, camera);
    p.layers.forEach(l => {
      const alpha = layerAlpha(l, time);
      layerNodes.forEach(el => { if (el.dataset.flocLayer === l.id && !['AUDIO', 'VIDEO'].includes(el.tagName)) { el.style.opacity = alpha; if (l.type === 'text' && l.animation === 'rise') el.style.transform = `translateY(${(1 - alpha) * 24}px)`; } });
      const media = mediaNodes.find(el => el.dataset.flocLayer === l.id);
      if (!media) return;
      if (media.tagName === 'VIDEO') media.style.opacity = alpha;
      if (renderMode || !Number.isFinite(media.duration)) return;
      const desired = audioTime(l, time, media.duration);
      const active = alpha > 0 && (l.loop || desired < media.duration - 0.02);
      if (Math.abs(media.currentTime - desired) > (playing ? 0.2 : 0.025)) media.currentTime = desired;
      if (l.type === 'music') media.volume = l.volume * (l.fade ? Math.max(0, Math.min(1, (time - l.start) / l.fade, (l.end - time) / l.fade)) : 1);
      if (playing && active) media.play().catch(() => {}); else media.pause();
    });
  }
  seek(0);
  return { seek, dispose() { disposed = true; mediaNodes.forEach(m => { m.pause(); m.removeAttribute('src'); m.load(); }); meshes.forEach(m => { m.geometry.dispose(); m.material.dispose(); }); textures.forEach(t => t.dispose()); renderer.dispose(); } };
}
