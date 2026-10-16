import * as THREE from 'three';

// Upstream notice retained for the referenced transmission implementation:
// MIT License
// Copyright (c) 2020 react-spring
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
//
// Screen-space volume transmission, following the framebuffer approach used by
// pmndrs/drei MeshTransmissionMaterial (MIT, Copyright (c) 2020 react-spring).
// The renderer supplies the actual lower-layer composite, not an environment map.
// No Drei/React runtime or remote resource is needed. Keep captured display colors
// outside the model's tone mapping so its lighting cannot restyle the layers below.
const PARS = `
uniform mat4 projectionMatrix;
uniform sampler2D modelRefractionBuffer;
uniform vec4 modelRefractionRect;
uniform float modelRefractionThickness;
uniform float modelRefractionIOR;
uniform float modelRefractionDispersion;
uniform float modelRefractionBlur;
uniform bool modelRefractionMask;
uniform bool modelRefractionProjectedPlane;
uniform mat4 modelRefractionPlaneMatrix;

vec2 modelRefractionUV(vec3 normal, vec3 viewDir, float eta) {
  vec3 ray = refract(-viewDir, normal, 1.0 / eta);
  vec4 exitPoint = projectionMatrix * vec4(-vViewPosition + ray * modelRefractionThickness, 1.0);
  return exitPoint.xy / max(exitPoint.w, 1e-5) * 0.5 + 0.5;
}
vec4 modelRefractionSample(vec2 uv) {
  uv = modelRefractionRect.xy + uv * modelRefractionRect.zw;
  if (modelRefractionProjectedPlane) {
    vec4 point = modelRefractionPlaneMatrix * vec4(uv, 0.0, 1.0);
    if (point.w <= 0.0) return vec4(0.0);
    uv = point.xy / point.w * 0.5 + 0.5;
  }
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0);
  return texture2D(modelRefractionBuffer, uv);
}
`;

const output = samples => `
  float sourceOpacity = clamp(diffuseColor.a, 0.0, 1.0);
  {
    vec3 refractionN = normalize(geometryNormal);
    vec3 refractionV = normalize(geometryViewDir);
    float spread = modelRefractionDispersion * 0.05;
    vec2 uvR = modelRefractionUV(refractionN, refractionV, max(1.0, modelRefractionIOR * (1.0 - spread)));
    vec2 uvG = modelRefractionUV(refractionN, refractionV, modelRefractionIOR);
    vec2 uvB = modelRefractionUV(refractionN, refractionV, modelRefractionIOR * (1.0 + spread));
    vec3 through = vec3(0.0);
    float throughAlpha = 0.0;
    // A fixed, evenly distributed disk is seek-safe and does not shimmer between frames.
    for (int i = 0; i < ${samples}; i++) {
      float radius = sqrt(float(i) / ${Math.max(1, samples - 1)}.0) * modelRefractionBlur;
      float angle = float(i) * 2.399963229728653;
      vec2 offset = vec2(cos(angle), sin(angle)) * radius;
      vec4 r = modelRefractionSample(uvR + offset);
      vec4 g = modelRefractionSample(uvG + offset);
      vec4 b = modelRefractionSample(uvB + offset);
      through += vec3(r.r, g.g, b.b);
      throughAlpha += max(r.a, max(g.a, b.a));
    }
    through /= ${samples}.0;
    throughAlpha /= ${samples}.0;
    float f0 = pow((modelRefractionIOR - 1.0) / (modelRefractionIOR + 1.0), 2.0);
    float fresnel = modelRefractionIOR <= 1.00001 ? 0.0 : f0 + (1.0 - f0) * pow(1.0 - saturate(dot(refractionN, refractionV)), 5.0);
    vec3 tint = clamp(sRGBTransferOETF(vec4(material.diffuseColor, 1.0)).rgb, 0.0, 1.0);
    vec3 reflection = clamp(gl_FragColor.rgb, 0.0, 1.0);
    float reflectionAlpha = max(reflection.r, max(reflection.g, reflection.b));
    vec3 premultiplied = through * tint * (1.0 - fresnel) + reflection;
    // Bright reflections must remain valid premultiplied pixels on alpha exports.
    float coverage = clamp(max(throughAlpha + (1.0 - throughAlpha) * reflectionAlpha,
      max(premultiplied.r, max(premultiplied.g, premultiplied.b))), 0.0, 1.0);
    gl_FragColor = vec4(premultiplied / max(coverage, 1e-6), coverage * sourceOpacity);
  }
  #include <premultiplied_alpha_fragment>
`;

export function createModelRefraction() {
  let canvas, context, texture;
  let thickness = .5, worldScale = 1;
  const uniforms = {
    modelRefractionBuffer: { value: null },
    modelRefractionRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    modelRefractionThickness: { value: 1 },
    modelRefractionIOR: { value: 1.5 },
    modelRefractionDispersion: { value: 0 },
    modelRefractionBlur: { value: 0 },
    modelRefractionMask: { value: false },
    modelRefractionProjectedPlane: { value: false },
    modelRefractionPlaneMatrix: { value: new THREE.Matrix4() }
  };
  return {
    attach(material, samples) {
      material.transparent = false;
      material.transmission = 0;
      material.depthWrite = true;
      material.premultipliedAlpha = true;
      material.side = THREE.DoubleSide;
      material.onBeforeCompile = program => {
        Object.assign(program.uniforms, uniforms);
        program.fragmentShader = program.fragmentShader
          .replace('void main() {', PARS + '\nvoid main() {')
          .replace('#include <alphahash_fragment>', `
            #include <alphahash_fragment>
            if (diffuseColor.a <= 1e-5) discard;
            if (modelRefractionMask) {
              gl_FragColor = vec4(0.0, 0.0, 0.0, clamp(diffuseColor.a, 0.0, 1.0));
              // floc-refraction-mask-return
              return;
            }`)
          // Only reflections use the model lighting, tone mapping and exposure.
          .replace('#include <opaque_fragment>', 'gl_FragColor = vec4(totalSpecular, 1.0);')
          .replace('#include <premultiplied_alpha_fragment>', output(samples));
      };
      material.customProgramCacheKey = () => `floc-model-refractive-v5-${samples}`;
    },
    update(style) {
      thickness = style.refractionThickness;
      uniforms.modelRefractionThickness.value = thickness * 2 * worldScale;
      uniforms.modelRefractionIOR.value = style.ior;
      uniforms.modelRefractionDispersion.value = style.dispersion;
      uniforms.modelRefractionBlur.value = style.roughness ** 2 * .14;
    },
    input(source, rect, resolution, scaleInWorld = 1, planeMatrix = null) {
      uniforms.modelRefractionProjectedPlane.value = Boolean(planeMatrix);
      if (planeMatrix) uniforms.modelRefractionPlaneMatrix.value.copy(planeMatrix);
      worldScale = scaleInWorld;
      uniforms.modelRefractionThickness.value = thickness * 2 * worldScale;
      uniforms.modelRefractionRect.value.set(rect.x, 1 - rect.y - rect.height, rect.width, rect.height);
      if (source.isTexture) { uniforms.modelRefractionBuffer.value = source; return; }
      if (!canvas) {
        canvas = document.createElement('canvas');
        context = canvas.getContext('2d');
        if (!context) throw new Error('Refractive glass needs a 2D canvas for its layer capture.');
        texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.NoColorSpace;
        texture.minFilter = texture.magFilter = THREE.LinearFilter;
        texture.premultiplyAlpha = true;
        texture.generateMipmaps = false;
      }
      const scale = Math.min(1, resolution / Math.max(source.width, source.height));
      const width = Math.max(1, Math.round(source.width * scale));
      const height = Math.max(1, Math.round(source.height * scale));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, width, height);
      context.drawImage(source, 0, 0, width, height);
      uniforms.modelRefractionBuffer.value = texture;
      texture.needsUpdate = true;
    },
    mask(value) { uniforms.modelRefractionMask.value = value; },
    dispose() { texture?.dispose(); if (canvas) canvas.width = canvas.height = 1; }
  };
}
