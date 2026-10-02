/*!
 * Adapted from Paper Shaders fluted-glass.ts, Apache-2.0.
 * https://github.com/paper-design/shaders/blob/43cd68db79fa0b1759f72ffc941b3238e2a3954c/packages/shaders/src/shaders/fluted-glass.ts
 * License and attribution: public/licenses/paper-shaders/{LICENSE,NOTICE}.
 * Modifications: retained the static lines grid and prism refraction;
 * removed grain, shadows, highlights, blur, margins and background overlays;
 * rewrote reversed smoothstep bounds, adapted to Three.js and normalized scene
 * sizing. Refraction affects straight sRGB colors, with alpha-aware samples,
 * preserved original silhouette and premultiplied sRGB output.
 */
export const flutedGlassFragmentShader = `
uniform sampler2D u_image;
uniform float u_imageAspectRatio;
uniform float u_size;
uniform float u_distortion;
uniform float u_intensity;
varying vec2 v_imageUV;

vec4 getImage(vec2 uv) {
  vec4 tex = texture2D(u_image, uv);
  vec3 straight = tex.a > 0.00001 ? tex.rgb / tex.a : vec3(0.);
  float frame = step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.);
  return vec4(sRGBTransferOETF(vec4(straight, 1.)).rgb, tex.a * frame);
}

vec2 rotateAspect(vec2 p, float angle, float aspect) {
  p.x *= aspect;
  p = mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * p;
  p.x /= aspect;
  return p;
}

float smoothFract(float x) {
  float f = fract(x);
  float w = max(fwidth(x), .00001);
  float edge = abs(f - .5) - .5;
  float band = smoothstep(-w, w, edge);
  return mix(f, 1. - f, band);
}

void main() {
  vec4 original = texture2D(u_image, v_imageUV);
  vec3 originalLinear = original.rgb / max(original.a, .00001);
  vec3 originalSRGB = sRGBTransferOETF(vec4(originalLinear, 1.)).rgb;

  // The Paper lines/prism grid is already normalized to the image width.
  // Its density and distortion remain independent of output pixel dimensions.
  const float patternRotation = 0.;
  float patternSize = mix(200., 5., u_size);
  vec2 uv = (v_imageUV - vec2(.5)) * patternSize;
  uv = rotateAspect(uv, patternRotation, u_imageAspectRatio);
  vec2 fractOrigUV = fract(uv);
  vec2 floorOrigUV = floor(uv);

  // Derivatives execute for every fragment, including transparent pixels.
  // Keeping them outside alpha branches also makes tiled exports consistent.
  float x = smoothFract(uv.x);
  float xNonSmooth = fract(uv.x) + .0001;
  float aa = max(fwidth(xNonSmooth), fwidth(uv.x));
  aa = max(.2, aa);
  aa += mix(.2, 0., u_size);
  float fadeX = smoothstep(0., aa, xNonSmooth) * (1. - smoothstep(1. - aa, 1., xNonSmooth));
  float distortion = -pow(1.5 * x, 3.) + .5;
  distortion = mix(.5, distortion, fadeX);
  distortion *= 3. * u_distortion;

  fractOrigUV.x += distortion;
  floorOrigUV = rotateAspect(floorOrigUV, -patternRotation, u_imageAspectRatio);
  fractOrigUV = rotateAspect(fractOrigUV, -patternRotation, u_imageAspectRatio);
  vec2 samplingUV = (floorOrigUV + fractOrigUV) / patternSize + vec2(.5);
  vec4 image = getImage(samplingUV);
  // When refraction leaves covered pixels or the canvas, retain the base color
  // rather than pulling clamped edge colors into the source silhouette.
  float coverage = min(1., image.a / max(original.a, .00001));
  vec3 effectSRGB = mix(originalSRGB, image.rgb, coverage);
  vec3 effectLinear = sRGBTransferEOTF(vec4(effectSRGB, 1.)).rgb;

  gl_FragColor = vec4(mix(originalLinear, effectLinear, u_intensity), original.a);
  #include <colorspace_fragment>
  #include <premultiplied_alpha_fragment>
}
`;
