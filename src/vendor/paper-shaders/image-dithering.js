/*!
 * Adapted from Paper Shaders image-dithering.ts, Apache-2.0.
 * https://github.com/paper-design/shaders/blob/43cd68db79fa0b1759f72ffc941b3238e2a3954c/packages/shaders/src/shaders/image-dithering.ts
 * License and attribution: public/licenses/paper-shaders/{LICENSE,NOTICE}.
 * Modifications: retained originalColors and the ordered 4x4 Bayer algorithm;
 * removed palette, random noise, image transforms and alpha quantization;
 * use normalized scene sizing and alpha-aware cell sampling. Three.js linear
 * premultiplied samples are converted to straight sRGB for Paper's luminance
 * quantization, then output with the original alpha and premultiplied sRGB.
 */
export const imageDitheringFragmentShader = `
uniform sampler2D u_image;
uniform float u_imageAspectRatio;
uniform float u_size;
uniform float u_colorSteps;
uniform float u_intensity;
varying vec2 v_imageUV;

vec4 getImage(vec2 uv) {
  vec4 tex = texture2D(u_image, uv);
  vec3 straight = tex.a > 0.00001 ? tex.rgb / tex.a : vec3(0.);
  float frame = step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.);
  return vec4(sRGBTransferOETF(vec4(straight, 1.)).rgb, tex.a * frame);
}

// This digit expansion is the exact Paper 4x4 Bayer matrix:
// 0,8,2,10 / 12,4,14,6 / 3,11,1,9 / 15,7,13,5.
float bayer2(vec2 p) {
  p = mod(floor(p), 2.);
  return p.y < .5 ? 2. * p.x : 3. - 2. * p.x;
}

float getBayerValue(vec2 p) {
  return (4. * bayer2(p) + bayer2(floor(p / 2.))) / 16.;
}

void main() {
  vec4 original = texture2D(u_image, v_imageUV);
  vec3 originalLinear = original.rgb / max(original.a, 0.00001);
  vec3 originalSRGB = sRGBTransferOETF(vec4(originalLinear, 1.)).rgb;

  // Paper's .5..20 pixel range is expressed against a fixed normalized scene
  // height, so preview, device pixel ratio and export use the same grid.
  float cellsPerSide = 600. / mix(.5, 20., u_size);
  vec2 gridScale = vec2(u_imageAspectRatio, 1.) * cellsPerSide;
  vec2 gridUV = (v_imageUV - vec2(.5)) * gridScale;
  vec2 samplingUV = (floor(gridUV) + .5) / gridScale + vec2(.5);
  vec4 image = getImage(samplingUV);
  float coverage = min(1., image.a / max(original.a, 0.00001));
  vec3 imageColor = mix(originalSRGB, image.rgb, coverage);

  float lum = dot(vec3(.2126, .7152, .0722), imageColor);
  float colorSteps = max(floor(u_colorSteps), 1.);
  float dithering = getBayerValue(gridUV) - .5;
  float brightness = clamp(lum + dithering / colorSteps, 0., 1.);
  float quantLum = floor(brightness * colorSteps + .5) / colorSteps;
  vec3 normColor = imageColor / max(lum, .001);
  // Paper's normalized colors can exceed the display range after luminance
  // rounding. Clip straight colors before premultiplying translucent pixels.
  vec3 effectSRGB = clamp(normColor * quantLum, vec3(0.), vec3(1.));
  vec3 effectLinear = sRGBTransferEOTF(vec4(effectSRGB, 1.)).rgb;

  gl_FragColor = vec4(mix(originalLinear, effectLinear, u_intensity), original.a);
  #include <colorspace_fragment>
  #include <premultiplied_alpha_fragment>
}
`;
