import * as THREE from 'three';

// GPU morphing-sphere surface: vertices take their displaced position, normal and
// palette color from the same field that fragments evaluate for continuous normals.
// The CPU supplies lattice values: GLSL sin() cannot reproduce the double-precision
// hash that defines the surface. Sampling shared cells keeps every pass aligned.
const fract = value => value - Math.floor(value);
const hash = (x, y, z) => fract(Math.sin(x * 12.9898 + y * 78.283 + z * 37.919) * 43758.7053);
const TAU = Math.PI * 2;

const FIELD = /* glsl */ `
uniform highp sampler3D flocMorphLattice;
uniform highp sampler3D flocMorphChromaLattice;
uniform float flocMorphDrift;
uniform float flocMorphChromaDrift;
uniform float flocMorphPhase;
uniform float flocMorphWarp;
uniform float flocMorphFrequency;
uniform float flocMorphPower;
uniform float flocMorphFalloff;
uniform int flocMorphDetail;
uniform float flocMorphContrast;
uniform float flocMorphAmplitude;

// Quintic value noise in lattice-local cells: .x clamped value, .yzw its gradient.
vec4 flocMorphNoise(highp sampler3D lattice, vec3 position) {
  vec3 cell = floor(position);
  ivec3 index = ivec3(cell);
  vec3 f = position - cell;
  vec3 u = f * f * f * (f * (6.0 * f - 15.0) + 10.0);
  vec3 du = 30.0 * f * f * (f - 1.0) * (f - 1.0);
  float a = texelFetch(lattice, index, 0).r;
  float b = texelFetch(lattice, index + ivec3(1, 0, 0), 0).r;
  float c = texelFetch(lattice, index + ivec3(0, 1, 0), 0).r;
  float d = texelFetch(lattice, index + ivec3(1, 1, 0), 0).r;
  float e = texelFetch(lattice, index + ivec3(0, 0, 1), 0).r;
  float fz = texelFetch(lattice, index + ivec3(1, 0, 1), 0).r;
  float g = texelFetch(lattice, index + ivec3(0, 1, 1), 0).r;
  float h = texelFetch(lattice, index + ivec3(1, 1, 1), 0).r;
  float ab = mix(a, b, u.x), cd = mix(c, d, u.x);
  float ef = mix(e, fz, u.x), gh = mix(g, h, u.x);
  float lower = mix(ab, cd, u.y), upper = mix(ef, gh, u.y);
  return vec4(clamp(mix(lower, upper, u.z), 0.0, 1.0), vec3(
    mix(mix(b - a, d - c, u.y), mix(fz - e, h - g, u.y), u.z) * du.x,
    mix(cd - ab, gh - ef, u.z) * du.y,
    (upper - lower) * du.z
  ));
}

// Smoothstepped height over the warped direction; the warp Jacobian carries the
// noise gradient back to direction space. level is the contrasted noise value.
float flocMorphHeight(vec3 direction, out vec3 warped, out vec3 gradient, out float level) {
  vec3 p = direction * 0.4;
  vec3 gx = vec3(0.4, 0.0, 0.0);
  vec3 gy = vec3(0.0, 0.4, 0.0);
  vec3 gz = vec3(0.0, 0.0, 0.4);
  float frequency = flocMorphFrequency;
  float power = flocMorphPower;
  for (int iteration = 0; iteration < 16; iteration++) {
    if (iteration >= flocMorphDetail) break;
    vec3 angle = p.yzx * power + flocMorphPhase + frequency * vec3(0.18, 0.21, 0.24);
    vec3 coefficient = flocMorphWarp * cos(angle);
    vec3 nextX = gx + coefficient.x * gy;
    vec3 nextY = gy + coefficient.y * gz;
    vec3 nextZ = gz + coefficient.z * gx;
    p += flocMorphWarp * sin(angle) / power;
    gx = nextX; gy = nextY; gz = nextZ;
    frequency += 1.0;
    power *= flocMorphFalloff;
  }
  warped = p;
  vec4 sampleValue = flocMorphNoise(flocMorphLattice, p * 3.1 + flocMorphDrift);
  level = pow(sampleValue.x, flocMorphContrast);
  // Fractional powers have a singular derivative at zero where the height is flat.
  float scale = flocMorphContrast * pow(max(sampleValue.x, 1e-12), flocMorphContrast - 1.0);
  float t = clamp((level - 0.2) / 0.6, 0.0, 1.0);
  gradient = (sampleValue.y * gx + sampleValue.z * gy + sampleValue.w * gz) * (scale * 3.1 * 6.0 * t * (1.0 - t) / 0.6);
  return t * t * (3.0 - 2.0 * t);
}

// Normal of r(direction) * direction: subtract the tangential radius gradient.
vec3 flocMorphNormal(vec3 direction, float height, vec3 gradient) {
  float radius = 1.0 + flocMorphAmplitude * height;
  return normalize(direction - (flocMorphAmplitude / radius) * (gradient - direction * dot(direction, gradient)));
}
`;

const NORMAL = FIELD + /* glsl */ `
vec3 flocSurfaceNormal(vec3 localPosition) {
  vec3 direction = normalize(localPosition);
  if (flocMorphAmplitude == 0.0) return direction;
  vec3 warped, gradient;
  float level;
  float height = flocMorphHeight(direction, warped, gradient, level);
  return flocMorphNormal(direction, height, gradient);
}
`;

const DISPLACE = FIELD + /* glsl */ `
uniform bool flocMorphPainted;
uniform vec3 flocMorphPalette[4];

vec3 flocDisplace(vec3 position, inout vec3 normal, inout vec3 color) {
  vec3 direction = normalize(position);
  vec3 warped, gradient;
  float level;
  float height = flocMorphHeight(direction, warped, gradient, level);
  normal = flocMorphNormal(direction, height, gradient);
  if (flocMorphPainted) {
    float chroma = pow(flocMorphNoise(flocMorphChromaLattice, warped * 1.5 + flocMorphChromaDrift).x, flocMorphContrast);
    float factor = fract(dot(direction, vec3(0.27)) + pow(chroma, 4.6)) * 4.0;
    // fract() may round up to 1.0 in float32; the last palette band absorbs it.
    int band = min(int(factor), 3);
    color = mix(flocMorphPalette[band], flocMorphPalette[(band + 1) % 4], smoothstep(0.0, 1.4, fract(factor)))
      * (0.4 + smoothstep(0.4, 0.8, level) * 1.3);
  }
  return direction * (1.0 + flocMorphAmplitude * height);
}
`;

// Cells cover every warped point of the field at its current drift. The window
// moves with the integer drift cell, so fractional clock changes never refill it.
function createLattice(uniform) {
  let texture = null, origin = NaN, size = 0;
  return {
    // Returns the drift relative to the window, small enough for exact float32 cells.
    refresh(extent, drift) {
      // A complete extra cell absorbs fractional drift and float shader rounding.
      const radius = Math.ceil(extent) + 1;
      const nextSize = 2 * radius + 2, nextOrigin = Math.floor(drift) - radius;
      if (nextSize !== size || nextOrigin !== origin) {
        if (nextSize !== size) {
          if (texture) texture.dispose();
          texture = new THREE.Data3DTexture(new Float32Array(nextSize ** 3), nextSize, nextSize, nextSize);
          texture.format = THREE.RedFormat;
          texture.type = THREE.FloatType;
          texture.minFilter = THREE.NearestFilter;
          texture.magFilter = THREE.NearestFilter;
          texture.generateMipmaps = false;
          texture.unpackAlignment = 1;
          uniform.value = texture;
        }
        const data = texture.image.data;
        let index = 0;
        for (let z = 0; z < nextSize; z++) {
          for (let y = 0; y < nextSize; y++) {
            for (let x = 0; x < nextSize; x++) data[index++] = hash(nextOrigin + x, nextOrigin + y, nextOrigin + z);
          }
        }
        origin = nextOrigin;
        size = nextSize;
        texture.needsUpdate = true;
      }
      return drift - origin;
    },
    dispose() { texture?.dispose(); }
  };
}

// `palette` holds linear THREE.Color values owned by the caller and edited in place.
export function createMorphSurface(style, time, palette) {
  const uniforms = {
    flocMorphLattice: { value: null },
    flocMorphChromaLattice: { value: null },
    flocMorphDrift: { value: 0 },
    flocMorphChromaDrift: { value: 0 },
    flocMorphPhase: { value: 0 },
    flocMorphWarp: { value: 0 },
    flocMorphFrequency: { value: 0 },
    flocMorphPower: { value: 1 },
    flocMorphFalloff: { value: 1 },
    flocMorphDetail: { value: 0 },
    flocMorphContrast: { value: 1 },
    flocMorphAmplitude: { value: 0 },
    flocMorphPainted: { value: false },
    flocMorphPalette: { value: palette }
  };
  const height = createLattice(uniforms.flocMorphLattice), chroma = createLattice(uniforms.flocMorphChromaLattice);
  let disposed = false;
  function update(settings, signedTime) {
    if (disposed) return;
    const power = Math.pow(settings.morphFalloff, settings.morphFrequency);
    uniforms.flocMorphWarp.value = settings.morphWarp;
    uniforms.flocMorphFrequency.value = settings.morphFrequency;
    uniforms.flocMorphPower.value = power;
    uniforms.flocMorphFalloff.value = settings.morphFalloff;
    uniforms.flocMorphDetail.value = settings.morphDetail;
    uniforms.flocMorphContrast.value = settings.morphContrast;
    uniforms.flocMorphAmplitude.value = settings.morphAmplitude;
    uniforms.flocMorphPainted.value = settings.base !== 'custom';
    // Whole turns are removed in double precision so float32 sin() keeps its accuracy.
    const phase = signedTime * -.4;
    uniforms.flocMorphPhase.value = phase - TAU * Math.floor(phase / TAU);
    let extent = .4, scale = power;
    for (let i = 0; i < settings.morphDetail; i++) {
      extent += settings.morphWarp / scale;
      scale *= settings.morphFalloff;
    }
    uniforms.flocMorphDrift.value = height.refresh(extent * 3.1, signedTime * .3);
    if (uniforms.flocMorphPainted.value) uniforms.flocMorphChromaDrift.value = chroma.refresh(extent * 1.5, signedTime * .6 + 20);
  }
  update(style, time);
  const descriptor = pars => ({ key: 'morph-c2-v2', uniforms, pars });
  return {
    normals: descriptor(NORMAL),
    displacement: descriptor(DISPLACE),
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      height.dispose();
      chroma.dispose();
    }
  };
}
