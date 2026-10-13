import * as THREE from 'three';
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

// Called only for enabled effects. The normal renderer remains the exact path
// for existing projects, None, and zero intensity.
export function createCarouselEffect(renderer, width, height, layer) {
  const effect = effectShaders[layer.layerEffect];
  if (!effect || !(layer.layerEffectIntensity > 0)) return null;
  const gl = renderer.getContext();
  // Linear 8-bit buffers discard dark premultiplied RGB at translucent edges.
  // Half floats retain it. Without float color buffers, sRGB-encoded 8-bit
  // storage keeps the most dark precision; blending and sampling stay linear.
  const float = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  // MSAA must be supported by both attachments.
  const colorSamples = gl.getInternalformatParameter(gl.RENDERBUFFER, float ? gl.RGBA16F : gl.SRGB8_ALPHA8, gl.SAMPLES) ?? [];
  const depthSamples = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, gl.SAMPLES) ?? [];
  const samples = Math.max(0, ...colorSamples.filter(count => count <= 4 && depthSamples.includes(count)));
  const target = new THREE.WebGLRenderTarget(width, height, {
    type: float ? THREE.HalfFloatType : THREE.UnsignedByteType,
    samples,
    colorSpace: float ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const material = new THREE.ShaderMaterial({
    vertexShader: fullscreenVertex,
    fragmentShader: effect.fragmentShader,
    uniforms: {
      u_image: { value: target.texture },
      u_imageAspectRatio: { value: width / height },
      u_intensity: { value: layer.layerEffectIntensity },
      ...effect.uniforms(layer),
    },
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    premultipliedAlpha: true,
    toneMapped: false,
  });
  const passScene = new THREE.Scene();
  const passCamera = new THREE.Camera();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  passScene.add(mesh);
  return {
    render(scene, camera) {
      const previousTarget = renderer.getRenderTarget();
      try {
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        renderer.setRenderTarget(previousTarget);
        renderer.render(passScene, passCamera);
      } finally {
        renderer.setRenderTarget(previousTarget);
      }
    },
    setResolution(w, h) {
      target.setSize(w, h);
      material.uniforms.u_imageAspectRatio.value = w / h;
    },
    // Parameter edits reuse the target and program; false asks for a new effect.
    update(next) {
      if (next.layerEffect !== layer.layerEffect || !(next.layerEffectIntensity > 0)) return false;
      material.uniforms.u_intensity.value = next.layerEffectIntensity;
      for (const [key, uniform] of Object.entries(effect.uniforms(next))) material.uniforms[key].value = uniform.value;
      return true;
    },
    dispose() { target.dispose(); geometry.dispose(); material.dispose(); },
  };
}
