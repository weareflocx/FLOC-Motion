// One WebGL 2 program draws every procedural background. Geometry is measured
// in scene units (1080 per short canvas side), so exports at any resolution
// show the same image; antialiasing is analytic in device pixels. Hashes are
// integer-only, so Metal, D3D11 and SwiftShader agree on every random value.
export const BACKGROUND_VERTEX = `#version 300 es
const vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(corners[gl_VertexID], 0.0, 1.0); }`;

export const backgroundFragment = ids => `#version 300 es
precision highp float;
precision highp int;
${ids.map((id, index) => `#define P_${id.toUpperCase()} ${index}`).join('\n')}
uniform vec2 uResolution;  // device pixels
uniform float uUnit;       // device pixels per scene unit
uniform float uLine;       // stroke width multiplier (editor tiles thicken strokes)
uniform float uTime;       // seconds, already scaled by speed and pace
uniform float uLoop;       // pattern time a seamless loop spans; 0 when not looping
uniform uint uFrame;       // grain frame, pinned to 0 when frozen
uniform int uPattern;
uniform float uScale;
uniform float uWeight;     // intensity times the pattern's calibrated gain
uniform uint uSeed;
uniform vec2 uDrift;       // travel in lattice cells (stripes: x along their normal)
uniform vec2 uDirection;   // drift direction in device axes, y down
uniform vec2 uFocus;       // rings and rays center, as a fraction of the frame
uniform vec3 uBase;
uniform vec3 uInk;
uniform vec3 uAccent;
uniform float uAccentAmount;
uniform float uVignette;
uniform float uGrain;
out vec4 outColor;

const float TAU = 6.28318530718;
const float STROKE = 2.0;

uint mixBits(uint x) {
  x ^= x >> 16; x *= 0x7feb352du;
  x ^= x >> 15; x *= 0x846ca68bu;
  x ^= x >> 16; return x;
}
// Cells are offset into the positive range before the integer conversion.
float random(ivec2 cell, uint salt) {
  uvec2 c = uvec2(cell + 1048576);
  return float(mixBits(c.x ^ mixBits(c.y ^ mixBits(salt ^ mixBits(uSeed)))) >> 8) * (1.0 / 16777216.0);
}
float random(uint salt) { return random(ivec2(0), salt); }
float valueNoise(vec2 p, uint salt) {
  vec2 i = floor(p), f = fract(p);
  ivec2 c = ivec2(i);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(random(c, salt), random(c + ivec2(1, 0), salt), u.x),
             mix(random(c + ivec2(0, 1), salt), random(c + ivec2(1, 1), salt), u.x), u.y);
}
float fbm(vec2 p, uint salt) {
  float sum = 0.0, amplitude = 0.5;
  const mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
  for (int octave = 0; octave < 4; octave++) {
    sum += amplitude * valueNoise(p, salt + uint(octave));
    p = turn * p * 2.03 + 17.1;
    amplitude *= 0.5;
  }
  return sum / 0.9375;
}
mat2 rotation(float angle) { float c = cos(angle), s = sin(angle); return mat2(c, s, -s, c); }

// Below scale 0.25 strokes and marks thin with the square root of the scale,
// so fine patterns stay open instead of closing into a flat tone.
float fine() { return sqrt(min(uScale / 0.25, 1.0)); }
// Seamless loops: uTime runs from 0 to uLoop over the layer. Motion that
// repeats every period completes the nearest whole number of cycles, at
// least one, so the loop ends where it started.
float looped(float period) {
  if (uLoop == 0.0) return uTime;
  float cycles = floor(uLoop / period + 0.5);
  if (cycles == 0.0) cycles = sign(uLoop);
  return cycles * period * (uTime / uLoop);
}
// A rotation rate rounded so a loop turns its shape through whole
// multiples of the shape's symmetry angle.
float loopedSpin(float spin, float symmetry) {
  if (uLoop == 0.0) return spin;
  float turns = floor(spin * uLoop / symmetry + 0.5);
  if (turns == 0.0) turns = sign(spin * uLoop);
  return turns * symmetry / uLoop;
}
// Coverage of a stroke at distance d (scene units). Strokes thinner than one
// device pixel keep their energy as reduced opacity instead of vanishing.
float stroke(float d, float width) {
  float pixels = width * fine() * uLine * uUnit;
  return clamp(max(pixels, 1.0) * 0.5 + 0.5 - abs(d) * uUnit, 0.0, 1.0) * min(pixels, 1.0);
}
// Coverage of a filled shape from its signed distance (negative inside).
float fill(float sd) { return clamp(0.5 - sd * uUnit, 0.0, 1.0); }
float box(vec2 p, vec2 extent) { vec2 d = abs(p) - extent; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float triangle(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r; p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}
float segment(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
// Distance to the nearest of a family of parallel sine curves x = k·spacing + amplitude·sin(y/length + phase + k·step).
float sineFamily(vec2 p, float spacing, float amplitude, float len, float phase, float step) {
  float k0 = floor(p.x / spacing), nearest = 1e9;
  for (int j = -1; j <= 1; j++) {
    float k = k0 + float(j), angle = p.y / len + phase + k * step;
    float slope = amplitude / len * cos(angle);
    nearest = min(nearest, abs(p.x - k * spacing - amplitude * sin(angle)) / sqrt(1.0 + slope * slope));
  }
  return nearest;
}

// Two drifting curtains: a crisp lower hem, a long fade upwards and
// vertical striations, as in the real phenomenon.
vec2 aurora(vec2 uv, float s, float t) {
  float x = uv.x / s + random(1u) * 40.0, y = uv.y / s, coverage = 0.0, hem = 0.0;
  for (int curtain = 0; curtain < 2; curtain++) {
    float k = float(curtain);
    float centre = (0.42 + 0.22 * k) / s + (fbm(vec2(x * 0.55 + t * (0.5 + 0.3 * k), 3.0 + k * 7.0), 0x21u + uint(curtain)) - 0.5) * 0.9;
    float d = y - centre;
    float body = exp(-d * d / (d > 0.0 ? 0.0035 : 0.06));
    float rays = 0.45 + 0.55 * fbm(vec2(x * 7.0 - t * 0.8, y * 0.35), 0x31u + uint(curtain));
    coverage = max(coverage, body * rays * (1.0 - 0.45 * k));
    hem = max(hem, exp(-d * d / 0.0012) * (1.0 - k));
  }
  return vec2(clamp(coverage, 0.0, 1.0), hem);
}
vec2 clouds(vec2 uv, float s, float t) {
  vec2 q = uv / (0.34 * s) + random(1u) * 40.0;
  vec2 warp = vec2(valueNoise(q * 0.5 + t * 0.7, 0x41u), valueNoise(q * 0.5 - t * 0.6 + 9.0, 0x42u));
  float cloud = smoothstep(0.22, 0.95, fbm(q + warp * 1.2 + vec2(t * 0.3, 0.0), 0x43u));
  return vec2(cloud, smoothstep(0.75, 1.0, cloud) * 0.6);
}

// Returns (pattern coverage, highlight mix) for the scene point p.
vec2 pattern(vec2 p, vec2 size) {
  float s = uScale, t = uTime;
  if (uPattern == P_GRID) {
    float cell = 96.0 * s;
    vec2 g = mod(p - (random(1u) + uDrift) * cell, cell), d = min(g, cell - g);
    return vec2(max(max(stroke(d.x, STROKE), stroke(d.y, STROKE)), fill(length(g - cell * 0.5) - 2.2 * fine())), 0.0);
  }
  if (uPattern == P_GRAIN) {
    float n = valueNoise(p / (1.6 * s), 0x51u + uFrame * 7u);
    return vec2(n * n, 0.0);
  }
  if (uPattern == P_WAVES) {
    vec2 q = vec2(p.y, p.x);
    return vec2(stroke(sineFamily(q, 104.0 * s, 72.0 * s, 260.0 * s, random(1u) * TAU + looped(TAU), 0.22), STROKE), 0.0);
  }
  if (uPattern == P_GEOMETRY) {
    float cell = 380.0 * s, coverage = 0.0;
    ivec2 home = ivec2(floor(p / cell));
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      ivec2 id = home + ivec2(x, y);
      if (random(id, 11u) > 0.86) continue;
      float kind = floor(random(id, 12u) * 3.0), radius = cell * (0.16 + random(id, 13u) * 0.18);
      vec2 center = (vec2(id) + 0.5 + (vec2(random(id, 14u), random(id, 15u)) - 0.5) * 0.5) * cell;
      float spin = (random(id, 16u) > 0.5 ? 1.0 : -1.0) * (0.6 + random(id, 17u) * 0.8);
      spin = loopedSpin(spin, kind < 1.0 ? TAU : kind < 2.0 ? TAU / 4.0 : TAU / 3.0);
      vec2 local = rotation(random(id, 18u) * TAU + t * spin) * (p - center);
      float sd = kind < 1.0 ? length(local) - radius : kind < 2.0 ? box(local, vec2(radius * 0.82)) : triangle(local, radius);
      coverage = max(coverage, stroke(sd, kind < 1.0 ? STROKE * 1.5 : STROKE * 1.25));
    }
    return vec2(coverage, 0.0);
  }
  if (uPattern == P_DOTS) {
    float cell = 92.0 * s;
    vec2 g = mod(p - (random(1u) + uDrift) * cell, cell) - cell * 0.5;
    return vec2(fill(length(g) - cell * 0.12), 0.0);
  }
  if (uPattern == P_STRIPES) {
    float period = 112.0 * s, u = dot(p, uDirection) - (random(1u) + uDrift.x) * period - period * 0.14;
    return vec2(fill(abs(u - period * round(u / period)) - period * 0.14), 0.0);
  }
  if (uPattern == P_CHECKERBOARD) {
    float cell = 120.0 * s;
    vec2 q = p - (vec2(random(1u), random(2u)) + uDrift) * cell;
    vec2 edge = abs(mod(q, 2.0 * cell) - cell) - cell * 0.5;
    vec2 side = clamp(0.5 + edge * uUnit, 0.0, 1.0);
    return vec2(side.x * (1.0 - side.y) + side.y * (1.0 - side.x), 0.0);
  }
  if (uPattern == P_RINGS || uPattern == P_RAYS) {
    vec2 d = p - size * uFocus;
    float r = length(d);
    if (uPattern == P_RINGS) {
      float spacing = 112.0 * s, v = mod(r - (random(3u) + looped(4.0) * 0.25) * spacing, spacing);
      return vec2(stroke(min(v, spacing - v), STROKE), 0.0);
    }
    float count = max(3.0, floor(24.0 / s + 0.5));
    float f = fract((atan(d.y, d.x) / TAU) * count - random(3u) * count - looped(25.0 / count) * 0.04 * count);
    float sd = (abs(f - 0.5) - 0.17) * (TAU / count) * r;
    float extent = length(size);
    return vec2(fill(sd) * smoothstep(24.0, 140.0, r) * mix(1.0, 0.45, smoothstep(0.0, extent, r)), 0.0);
  }
  if (uPattern == P_MESH) {
    float cell = 132.0 * s, phase = random(1u) * TAU + looped(TAU), amplitude = cell * 0.28;
    float vertical = sineFamily(p, cell, amplitude, 220.0 * s, phase, 0.31);
    float horizontal = sineFamily(vec2(p.y, p.x), cell, amplitude, 260.0 * s, -phase, 0.37);
    return vec2(max(stroke(vertical, STROKE), stroke(horizontal, STROKE)), 0.0);
  }
  if (uPattern == P_FLOW) {
    float cell = 92.0 * s, phase = random(1u) * TAU + looped(TAU);
    vec2 center = (floor(p / cell) + 0.5) * cell;
    float angle = sin(center.x / (230.0 * s) + phase) * 1.5 + cos(center.y / (250.0 * s) - phase) * 1.2;
    vec2 reach = vec2(cos(angle), sin(angle)) * cell * 0.31;
    return vec2(stroke(segment(p, center - reach, center + reach), STROKE * 1.3), 0.0);
  }
  if (uPattern == P_HALFTONE) {
    float cell = 72.0 * s, phase = random(1u) * TAU + looped(TAU);
    mat2 screen = rotation(0.78539816);
    vec2 q = screen * p - uDrift * cell;
    vec2 id = floor(q / cell);
    vec2 center = transpose(screen) * ((id + 0.5) * cell + uDrift * cell);
    float field = (sin(center.x / (270.0 * s) + phase) * cos(center.y / (220.0 * s) - phase) + 1.0) * 0.5;
    return vec2(fill(length(q - (id + 0.5) * cell) - cell * (0.04 + field * 0.4)), 0.0);
  }
  vec2 uv = p / size.y;
  if (uPattern == P_GRADIENT) {
    t = looped(TAU);
    // Loops orbit at whole-number rates so the glow returns to its start.
    vec2 rate = uLoop == 0.0 ? vec2(1.3, 0.9) : vec2(1.0);
    float angle = random(1u) * TAU + t;
    vec2 centered = (p - size * 0.5) / length(size);
    float spread = clamp(0.45 * s, 0.12, 1.6);
    float linear = smoothstep(-spread, spread, dot(centered, vec2(cos(angle), sin(angle))));
    vec2 orbit = size * 0.5 + size * 0.28 * vec2(cos(t * rate.x + random(2u) * TAU), sin(t * rate.y + random(3u) * TAU));
    float glow = exp(-pow(length(p - orbit) / (length(size) * 0.32 * sqrt(s)), 2.0));
    return vec2(clamp(linear * 0.8 + glow * 0.55, 0.0, 1.0), glow * 0.5);
  }
  vec2 now = uPattern == P_AURORA ? aurora(uv, s, t) : clouds(uv, s, t);
  if (uLoop == 0.0) return now;
  // Noise never repeats, so a loop crossfades towards the state one loop
  // earlier, which at the loop's end is exactly its first frame.
  vec2 earlier = uPattern == P_AURORA ? aurora(uv, s, t - uLoop) : clouds(uv, s, t - uLoop);
  // Animated speed can reverse, so the weight stays within the two states.
  return mix(now, earlier, clamp(t / uLoop, 0.0, 1.0));
}

// Where the accent color takes over the ink, 0–1. Gradient and Aurora place
// it in their highlights (glow and hem); the others, Noise included, get
// two-tone regions across the frame that drift with pattern time and close
// in loops.
float accentField(vec2 p, vec2 size, float highlight) {
  if (uPattern == P_GRADIENT || uPattern == P_AURORA) return clamp(highlight * 2.0, 0.0, 1.0);
  vec2 q = (p - size * 0.5) / length(size);
  float phase = random(5u) * TAU + looped(TAU);
  return smoothstep(-0.6, 0.6, sin(q.x * 4.2 + phase) + cos(q.y * 3.4 - phase));
}

void main() {
  vec2 pixel = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  vec2 size = uResolution / uUnit;
  vec2 coverage = pattern(pixel / uUnit, size);
  vec3 ink = mix(uInk, vec3(1.0), coverage.y * 0.45);
  if (uAccentAmount > 0.0) ink = mix(ink, uAccent, uAccentAmount * accentField(pixel / uUnit, size, coverage.y));
  vec3 color = mix(uBase, ink, clamp(coverage.x * uWeight, 0.0, 1.0));
  vec2 centered = (pixel / uResolution - 0.5) * 2.0;
  color *= 1.0 - uVignette * 0.8 * smoothstep(0.35, 1.0, length(centered) * 0.70710678);
  ivec2 device = ivec2(pixel);
  if (uGrain > 0.0) color += (valueNoise(pixel / (1.4 * uUnit), 0x61u + uFrame * 7u) - 0.5) * uGrain * 0.24;
  // Static sub-LSB dither keeps soft gradients from banding in 8-bit video.
  color += (random(device, 0x71u) - 0.5) / 255.0;
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;
