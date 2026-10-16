import * as THREE from 'three';
import { FORMATS } from './project.js';
import { SCENE_VIEW_HEIGHT, sceneDimensions, projectedObjectBounds } from './scene-camera.js';
import { createScenePass, SCENE_PASS, SCENE_PASS_PARS, SCENE_PASS_FRAGMENT, setSceneMaterialPass } from './scene-pass.js';

const VERTEX = `varying vec2 vUv;uniform bool flocProjected;
void main(){vUv=uv;vec4 world=modelMatrix*vec4(position,1.0);gl_Position=flocProjected?vec4(world.xy,0.0,1.0):projectionMatrix*viewMatrix*world;}`;
const FRAGMENT = `${SCENE_PASS_PARS}
varying vec2 vUv;uniform sampler2D flocMap;uniform sampler2D flocMask;uniform sampler2D flocDepthMap;uniform sampler2D flocPickMap;
uniform bool flocUseMask;uniform bool flocHasDepth;uniform bool flocHasPick;uniform bool flocProjected;uniform vec4 flocDepthRect;uniform float flocFallbackDepth;
void main(){
  vec2 sampleUv=flocDepthRect.xy+vUv*flocDepthRect.zw;
  bool inFrame=all(greaterThanEqual(sampleUv,vec2(0.0)))&&all(lessThanEqual(sampleUv,vec2(1.0)));
  vec4 depthPixel=flocHasDepth&&inFrame?texture2D(flocDepthMap,sampleUv):vec4(0.0);
  float depth=depthPixel.a>0.0?dot(depthPixel.rgb,vec3(1.0,1.0/255.0,1.0/65025.0)):(flocProjected?flocFallbackDepth:gl_FragCoord.z);
  gl_FragDepth=depth;
  gl_FragColor=flocUseMask?texture2D(flocMask,vUv):texture2D(flocMap,vUv);
  if(flocScenePass==3&&flocHasPick){
    if(gl_FragColor.a*flocSceneOpacity<0.02||!inFrame)discard;
    vec4 id=texture2D(flocPickMap,sampleUv);if(id.a<0.5)discard;gl_FragColor=vec4(id.rgb,1.0);return;
  }
  if(flocScenePass==6){if(depth>=1.0||gl_FragColor.a*flocSceneOpacity<0.00001)discard;gl_FragColor=flocPackDepth(depth);return;}
  ${SCENE_PASS_FRAGMENT}
}`;

function canvasTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace; texture.premultiplyAlpha = true;
  texture.generateMipmaps = false; texture.minFilter = texture.magFilter = THREE.LinearFilter;
  return texture;
}

// Flat presentations and editable graphic planes are native scene objects. A
// projected packet is only used by explicit image-space effect groups/sources.
export function createSceneSurface(rendering) {
  const state = createScenePass(), root = new THREE.Group(), scene = new THREE.Scene();
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true,
    premultipliedAlpha: true, side: THREE.DoubleSide, forceSinglePass: true,
    uniforms: { ...state.uniforms, flocSceneOpaque: { value: false }, flocMap: { value: null }, flocMask: { value: null },
      flocDepthMap: { value: null }, flocPickMap: { value: null }, flocUseMask: { value: false }, flocHasDepth: { value: false },
      flocHasPick: { value: false }, flocProjected: { value: false }, flocDepthRect: { value: new THREE.Vector4(0, 0, 1, 1) }, flocFallbackDepth: { value: 1 } } });
  const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false; root.add(mesh); scene.add(root);
  let color, mask, surface, projected = false, disposed = false;
  let elementGeometry, elementMesh, elementTransform, pixelScaleX, pixelScaleY, frameWidth, frameHeight;
  function upload(value, previous) {
    // Capture surfaces are scratch buffers, including alternating beauty/mask
    // output. Own a stable bitmap, and recreate immutable GPU storage on resize.
    if (!previous || previous.image.width !== value.width || previous.image.height !== value.height) {
      previous?.dispose();
      const bitmap = document.createElement('canvas'); bitmap.width = value.width; bitmap.height = value.height;
      previous = canvasTexture(bitmap);
    }
    const context = previous.image.getContext('2d');
    context.resetTransform(); context.clearRect(0, 0, value.width, value.height); context.drawImage(value, 0, 0);
    previous.needsUpdate = true;
    rendering.renderer.initTexture(previous);
    return previous;
  }
  return {
    scene, root, mesh, material,
    get currentSurface() { return surface; },
    setCoverage(value) { mask = upload(value.canvas, mask); material.uniforms.flocMask.value = mask; },
    set(value, { format, layer, index = 0, projected: screen = false, depth = null, picking = null, fallbackDepth = 1, coverage = null } = {}) {
      if (!value) { root.visible = false; return; }
      root.visible = true; surface = value; projected = screen;
      color = upload(value.canvas, color); material.uniforms.flocMap.value = color;
      if (coverage) { mask = upload(coverage.canvas, mask); material.uniforms.flocMask.value = mask; }
      material.uniforms.flocProjected.value = screen;
      material.uniforms.flocDepthMap.value = depth; material.uniforms.flocHasDepth.value = Boolean(depth);
      material.uniforms.flocPickMap.value = picking; material.uniforms.flocHasPick.value = Boolean(picking);
      material.uniforms.flocFallbackDepth.value = fallbackDepth;
      const [nativeWidth, nativeHeight] = FORMATS[format], frame = sceneDimensions(format);
      pixelScaleX = frame.width / nativeWidth; pixelScaleY = frame.height / nativeHeight;
      frameWidth = frame.width; frameHeight = frame.height;
      material.uniforms.flocDepthRect.value.set(value.x / nativeWidth, 1 - (value.y + value.height) / nativeHeight, value.width / nativeWidth, value.height / nativeHeight);
      root.rotation.set(0, 0, 0); root.position.set(0, 0, 0); mesh.position.set(0, 0, 0);
      if (screen) {
        mesh.scale.set(value.width / nativeWidth * 2, value.height / nativeHeight * 2, 1);
        mesh.position.set((value.x + value.width / 2) / nativeWidth * 2 - 1, 1 - (value.y + value.height / 2) / nativeHeight * 2, 0);
      } else {
        mesh.scale.set(value.width / nativeWidth * frame.width, value.height / nativeHeight * frame.height, 1);
        root.position.set(((value.x + value.width / 2) / nativeWidth - .5) * frame.width,
          (.5 - (value.y + value.height / 2) / nativeHeight) * frame.height,
          ((layer.z ?? 0) + index * .002) / 100 * SCENE_VIEW_HEIGHT);
        if (layer.space === 'spatial' && ['text', 'logo', 'media'].includes(layer.type)) root.rotation.set(THREE.MathUtils.degToRad(layer.tilt ?? 0), THREE.MathUtils.degToRad(layer.yaw ?? 0), 0);
      }
      scene.updateMatrixWorld(true);
    },
    render(camera, pass, opacity = 1, id = 0, { coverage = false, background = false, ...options } = {}) {
      if (!root.visible) return;
      state.set(pass, opacity, id); setSceneMaterialPass(material, pass, options);
      material.uniforms.flocUseMask.value = coverage && Boolean(mask);
      if (background) { material.depthTest = false; material.depthWrite = false; }
      rendering.renderer.toneMapping = THREE.NoToneMapping; rendering.renderer.toneMappingExposure = 1;
      rendering.renderer.render(scene, camera);
    },
    bounds(camera) { return projected ? { x: 0, y: 0, width: 100, height: 100 } : projectedObjectBounds(root, camera); },
    elementBounds(camera, element, bounds) {
      if (!root.visible || !bounds) return null;
      // Model geometry is measured in its own canvas. Keep that rectangle on
      // the same Flat plane as the captured bitmap, including CSS placement,
      // transform origin and roll, rather than selecting transparent padding.
      if (!elementGeometry) {
        elementGeometry = new THREE.BufferGeometry(); elementGeometry.boundingBox = new THREE.Box3();
        elementMesh = new THREE.Mesh(elementGeometry); elementMesh.matrixAutoUpdate = false;
        elementTransform = new DOMMatrix();
      }
      const style = getComputedStyle(element), width = parseFloat(style.width), height = parseFloat(style.height);
      const origin = style.transformOrigin.split(/\s+/), ox = parseFloat(origin[0]), oy = parseFloat(origin[1]);
      elementTransform.setMatrixValue(style.transform === 'none' ? 'matrix(1,0,0,1,0,0)' : style.transform);
      const m = elementTransform;
      const x = (parseFloat(style.left) || 0) + ox + m.e - m.a * ox - m.c * oy;
      const y = (parseFloat(style.top) || 0) + oy + m.f - m.b * ox - m.d * oy;
      elementMesh.matrix.set(
        m.a * pixelScaleX, m.c * pixelScaleX, 0, x * pixelScaleX - frameWidth / 2,
        -m.b * pixelScaleY, -m.d * pixelScaleY, 0, frameHeight / 2 - y * pixelScaleY,
        0, 0, 1, root.position.z,
        0, 0, 0, 1);
      elementMesh.matrixWorldNeedsUpdate = true;
      elementGeometry.boundingBox.min.set(bounds.x * width, bounds.y * height, 0);
      elementGeometry.boundingBox.max.set((bounds.x + bounds.width) * width, (bounds.y + bounds.height) * height, 0);
      return projectedObjectBounds(elementMesh, camera);
    },
    dispose() { if (disposed) return; disposed = true; color?.dispose(); mask?.dispose(); geometry.dispose(); elementGeometry?.dispose(); material.dispose(); }
  };
}
