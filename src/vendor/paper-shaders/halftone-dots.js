/*!
 * Adapted from Paper Shaders halftone-dots.ts, Apache-2.0.
 * https://github.com/paper-design/shaders/blob/43cd68db79fa0b1759f72ffc941b3238e2a3954c/packages/shaders/src/shaders/halftone-dots.ts
 * License and attribution: public/licenses/paper-shaders/{LICENSE,NOTICE}.
 * Modifications: retained only classic square-grid dots and original colors;
 * removed grain, other styles and external sizing; adapted to Three.js GLSL;
 * unpremultiplied linear carousel samples are converted to sRGB for Paper's
 * luminance algorithm, sampled colors are normalized by their alpha, and the
 * original pixel alpha is preserved with premultiplied sRGB output.
 */
export const halftoneDotsFragmentShader = `
uniform sampler2D u_image;
uniform float u_imageAspectRatio;
uniform float u_size;
uniform float u_intensity;
varying vec2 v_imageUV;

// The carousel target stores premultiplied linear RGB. Paper expects straight
// image colors; sample colors in sRGB while keeping the source alpha intact.
vec4 getImage(vec2 uv) {
  vec4 tex = texture2D(u_image, uv);
  vec3 straight = tex.a > 0.00001 ? tex.rgb / tex.a : vec3(0.);
  return vec4(sRGBTransferOETF(vec4(straight, 1.)).rgb, tex.a);
}

float getCircle(vec2 uv, float r, float baseR) {
  r = mix(.25 * baseR, 0., r);
  float d = length(uv - .5);
  float aa = max(fwidth(d), 0.00001);
  return 1. - smoothstep(r - aa, r + aa, d);
}

float getUvFrame(vec2 uv, vec2 pad) {
  const float aa = 0.0001;
  float left = smoothstep(-pad.x, -pad.x + aa, uv.x);
  float right = 1. - smoothstep(1. + pad.x - aa, 1. + pad.x, uv.x);
  float bottom = smoothstep(-pad.y, -pad.y + aa, uv.y);
  float top = 1. - smoothstep(1. + pad.y - aa, 1. + pad.y, uv.y);
  return left * right * bottom * top;
}

float sigmoid(float x, float k) {
  return 1. / (1. + exp(-k * (x - .5)));
}

float getLumAtPx(vec2 uv, float contrast) {
  vec4 tex = getImage(uv);
  vec3 color = vec3(sigmoid(tex.r, contrast), sigmoid(tex.g, contrast), sigmoid(tex.b, contrast));
  float lum = dot(vec3(.2126, .7152, .0722), color);
  return mix(1., lum, tex.a);
}

float getLumBall(vec2 p, vec2 pad, vec2 inCellOffset, float contrast, float baseR, float stepSize, out vec4 ballColor) {
  p += inCellOffset;
  vec2 uv_i = floor(p);
  vec2 uv_f = fract(p);
  vec2 samplingUV = (uv_i + .5 - inCellOffset) * pad + vec2(.5);
  float outOfFrame = getUvFrame(samplingUV, pad * stepSize);
  float lum = getLumAtPx(samplingUV, contrast);
  ballColor = getImage(samplingUV);
  ballColor.rgb *= ballColor.a;
  ballColor *= outOfFrame;
  return getCircle(uv_f, lum, baseR) * outOfFrame;
}

void main() {
  vec4 original = texture2D(u_image, v_imageUV);

  // Paper's classic dots use two samples per grid cell side. The grid is
  // measured in normalized scene space, so export resolution does not scale it.
  const float stepMultiplier = 2.;
  float cellsPerSide = mix(300., 7., pow(u_size, .7)) / stepMultiplier;
  vec2 pad = vec2(1. / u_imageAspectRatio, 1.) / cellsPerSide;
  vec2 uv = (v_imageUV - vec2(.5)) / pad;
  const float contrast = 1.075; // Paper originalColors, contrast = .5.
  float baseRadius = 2. * pow(.5, .3); // Paper radius = 1.

  float totalShape = 0.;
  vec3 totalColor = vec3(0.);
  float totalColorAlpha = 0.;
  const float stepSize = .5;
  for (int x = 0; x < 2; x++) {
    for (int y = 0; y < 2; y++) {
      vec4 ballColor;
      vec2 offset = vec2(float(x), float(y)) * stepSize - vec2(.5);
      float shape = getLumBall(uv, pad, offset, contrast, baseRadius, stepSize, ballColor);
      totalColor += ballColor.rgb * shape;
      totalColorAlpha += ballColor.a * shape;
      totalShape += shape;
    }
  }

  // Normalize sampled premultiplied colors by their coverage, then blend the
  // dots over dark gaps without changing the silhouette or translucent edges.
  vec3 dotColor = totalColor / max(totalColorAlpha, 0.00001);
  vec3 effectSRGB = mix(vec3(.025), dotColor, min(1., totalShape));
  vec3 effectLinear = sRGBTransferEOTF(vec4(effectSRGB, 1.)).rgb;
  vec3 originalLinear = original.rgb / max(original.a, 0.00001);
  gl_FragColor = vec4(mix(originalLinear, effectLinear, u_intensity), original.a);
  #include <colorspace_fragment>
  #include <premultiplied_alpha_fragment>
}
`;
