import * as THREE from 'three';
import { animatedFields } from './choreography.js';
import { halftoneDotsFragmentShader } from './vendor/paper-shaders/halftone-dots.js';
import { imageDitheringFragmentShader } from './vendor/paper-shaders/image-dithering.js';
import { flutedGlassFragmentShader } from './vendor/paper-shaders/fluted-glass.js';

const effectShaders = {
  halftone: {
    fragmentShader: halftoneDotsFragmentShader,
    uniforms: layer => ({ u_size: { value: layer.halftoneSize } }),
  },
  dithering: {
    fragmentShader: imageDitheringFragmentShader,
    uniforms: layer => ({
      u_size: { value: layer.ditheringSize },
      u_colorSteps: { value: layer.ditheringSteps },
    }),
  },
  'fluted-glass': {
    fragmentShader: flutedGlassFragmentShader,
    uniforms: layer => ({
      u_size: { value: layer.glassSize },
      u_distortion: { value: layer.glassDistortion },
    }),
  },
};

const fullscreenVertex = `varying vec2 v_imageUV;
void main(){v_imageUV=uv;gl_Position=vec4(position,1.);}`;

// The inverse mapping of opticalWarpOffset in src/effects.js, in float shader
// math: the across coordinate sampled for an output point. Coordinates are
// relative to the layer, top-down.
export const OPTICAL_WARP_SOURCE = `float warpSource(float along, float across, float amount, float center) {
  float delta = along - center;
  float edge = min(1., abs(delta) / (delta < 0. ? center : 1. - center));
  float stretch = 1. + 2. * amount * edge * edge * edge * edge;
  return .5 + (across - .5) / stretch;
}`;

// A layer holds at most eight effects.
const MAX_WARPS = 8;
// Composes every live warp in one exact pass: an output point maps through
// the last warp first, so the result equals applying the warps in order.
// Sources outside the layer are transparent. The target holds premultiplied
// linear color; output matches the Paper passes (premultiplied sRGB).
const opticalWarpFragmentShader = `
uniform sampler2D u_image;
uniform int u_warpCount;
uniform vec3 u_warps[${MAX_WARPS}];
varying vec2 v_imageUV;

${OPTICAL_WARP_SOURCE}

void main() {
  vec2 point = vec2(v_imageUV.x, 1. - v_imageUV.y);
  for (int i = 0; i < ${MAX_WARPS}; i++) {
    if (i >= u_warpCount) break;
    vec3 warp = u_warps[i];
    if (warp.z < .5) point.y = warpSource(point.x, point.y, warp.x, warp.y);
    else point.x = warpSource(point.y, point.x, warp.x, warp.y);
  }
  float inside = step(0., point.x) * step(point.x, 1.) * step(0., point.y) * step(point.y, 1.);
  vec4 color = texture2D(u_image, clamp(vec2(point.x, 1. - point.y), 0., 1.)) * inside;
  gl_FragColor = vec4(color.rgb / max(color.a, 0.00001), color.a);
  #include <colorspace_fragment>
  #include <premultiplied_alpha_fragment>
}`;

const paperKey = layer => effectShaders[layer.layerEffect] && layer.layerEffectIntensity > 0 ? layer.layerEffect : '';
// Indices of the warps that can displace: enabled, with a nonzero or animated
// amount. Choreography animates the first warp of a layer.
export function activeWarps(layer) {
  const effects = layer.effects ?? [];
  const animated = animatedFields(layer).includes('warpAmount') ? effects.findIndex(effect => effect.type === 'optical-warp') : -1;
  return effects.flatMap((effect, index) => effect.type === 'optical-warp' && effect.enabled && (effect.amount > 0 || index === animated) ? [index] : []);
}

// Called for every carousel; null keeps the normal renderer as the exact path
// for projects without a Paper effect (None or zero intensity) or a warp.
// Paper runs first, then the warps on its output.
export function createCarouselEffect(renderer, width, height, layer) {
  const paper = paperKey(layer) ? effectShaders[layer.layerEffect] : null;
  const warps = activeWarps(layer);
  if (!paper && !warps.length) return null;
  const gl = renderer.getContext();
  // Linear 8-bit buffers discard dark premultiplied RGB at translucent edges.
  // Half floats retain it. Without float color buffers, sRGB-encoded 8-bit
  // storage keeps the most dark precision; blending and sampling stay linear.
  const float = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const targetOptions = {
    type: float ? THREE.HalfFloatType : THREE.UnsignedByteType,
    colorSpace: float ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  };
  // MSAA must be supported by both attachments.
  const colorSamples = gl.getInternalformatParameter(gl.RENDERBUFFER, float ? gl.RGBA16F : gl.SRGB8_ALPHA8, gl.SAMPLES) ?? [];
  const depthSamples = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, gl.SAMPLES) ?? [];
  const samples = Math.max(0, ...colorSamples.filter(count => count <= 4 && depthSamples.includes(count)));
  const target = new THREE.WebGLRenderTarget(width, height, { ...targetOptions, samples });
  // Holds the Paper output when warps follow it.
  const paperTarget = paper && warps.length ? new THREE.WebGLRenderTarget(width, height, targetOptions) : null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const pass = (fragmentShader, uniforms) => new THREE.ShaderMaterial({
    vertexShader: fullscreenVertex,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    premultipliedAlpha: true,
    toneMapped: false,
  });
  const paperMaterial = paper ? pass(paper.fragmentShader, {
    u_image: { value: target.texture },
    u_imageAspectRatio: { value: width / height },
    u_intensity: { value: layer.layerEffectIntensity },
    ...paper.uniforms(layer),
  }) : null;
  const warpMaterial = warps.length ? pass(opticalWarpFragmentShader, {
    u_image: { value: (paperTarget ?? target).texture },
    u_warpCount: { value: 0 },
    u_warps: { value: Array.from({ length: MAX_WARPS }, () => new THREE.Vector3()) },
  }) : null;
  const passScene = new THREE.Scene();
  const passCamera = new THREE.Camera();
  const mesh = new THREE.Mesh(geometry, paperMaterial ?? warpMaterial);
  mesh.frustumCulled = false;
  passScene.add(mesh);
  const drawPass = (material, output) => {
    mesh.material = material;
    renderer.setRenderTarget(output);
    renderer.render(passScene, passCamera);
  };
  return {
    // `sampled` is the carousel layer at this frame: warp amounts follow its
    // choreography exactly. Warps at zero leave the frame untouched.
    render(scene, camera, sampled = layer) {
      const live = sampled.effects ?? [];
      const displacing = warps.map(index => live[index]).filter(effect => effect?.amount > 0).reverse();
      if (!paper && !displacing.length) { renderer.render(scene, camera); return; }
      const previousTarget = renderer.getRenderTarget();
      try {
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        // Without a live warp the Paper pass draws straight to the output.
        if (paper) drawPass(paperMaterial, displacing.length ? paperTarget : previousTarget);
        if (displacing.length) {
          const uniforms = warpMaterial.uniforms;
          displacing.forEach((effect, i) => uniforms.u_warps.value[i].set(effect.amount, effect.center, effect.axis === 'horizontal' ? 0 : 1));
          uniforms.u_warpCount.value = displacing.length;
          drawPass(warpMaterial, previousTarget);
        }
      } finally {
        renderer.setRenderTarget(previousTarget);
      }
    },
    setResolution(w, h) {
      target.setSize(w, h);
      paperTarget?.setSize(w, h);
      if (paperMaterial) paperMaterial.uniforms.u_imageAspectRatio.value = w / h;
    },
    // Parameter edits reuse the targets and programs; false asks for a new
    // chain when the Paper effect or the set of active warps changes.
    update(next) {
      if (paperKey(next) !== paperKey(layer) || activeWarps(next).join() !== warps.join()) return false;
      if (paperMaterial) {
        paperMaterial.uniforms.u_intensity.value = next.layerEffectIntensity;
        for (const [key, uniform] of Object.entries(paper.uniforms(next))) paperMaterial.uniforms[key].value = uniform.value;
      }
      return true;
    },
    dispose() { target.dispose(); paperTarget?.dispose(); geometry.dispose(); paperMaterial?.dispose(); warpMaterial?.dispose(); },
  };
}
