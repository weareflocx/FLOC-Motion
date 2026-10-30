import * as THREE from 'three';

// The CPU supplies lattice values: GLSL sin() cannot reproduce the double-precision
// hash that defines the actual mesh. Sampling shared cells keeps both fields aligned.
const pars = /* glsl */ `
uniform highp sampler3D flocMorphLattice;
uniform vec3 flocMorphOrigin;
uniform float flocMorphTime;
uniform float flocMorphWarp;
uniform float flocMorphFrequency;
uniform float flocMorphFalloff;
uniform int flocMorphDetail;
uniform float flocMorphContrast;
uniform float flocMorphAmplitude;

float flocMorphCell(ivec3 cell) {
  return texelFetch(flocMorphLattice, cell, 0).r;
}

vec4 flocMorphNoise(vec3 position) {
  vec3 cell = floor(position);
  ivec3 index = ivec3(cell - flocMorphOrigin);
  vec3 f = position - cell;
  vec3 u = f * f * f * (f * (6.0 * f - 15.0) + 10.0);
  vec3 du = 30.0 * f * f * (f - 1.0) * (f - 1.0);
  float a = flocMorphCell(index);
  float b = flocMorphCell(index + ivec3(1, 0, 0));
  float c = flocMorphCell(index + ivec3(0, 1, 0));
  float d = flocMorphCell(index + ivec3(1, 1, 0));
  float e = flocMorphCell(index + ivec3(0, 0, 1));
  float fz = flocMorphCell(index + ivec3(1, 0, 1));
  float g = flocMorphCell(index + ivec3(0, 1, 1));
  float h = flocMorphCell(index + ivec3(1, 1, 1));
  float ab = mix(a, b, u.x), cd = mix(c, d, u.x);
  float ef = mix(e, fz, u.x), gh = mix(g, h, u.x);
  float lower = mix(ab, cd, u.y), upper = mix(ef, gh, u.y);
  float value = clamp(mix(lower, upper, u.z), 0.0, 1.0);
  float scale = flocMorphContrast * pow(max(value, 1e-12), flocMorphContrast - 1.0);
  vec3 gradient = vec3(
    mix(mix(b - a, d - c, u.y), mix(fz - e, h - g, u.y), u.z) * du.x,
    mix(cd - ab, gh - ef, u.z) * du.y,
    (upper - lower) * du.z
  ) * scale;
  return vec4(pow(value, flocMorphContrast), gradient);
}

vec3 flocSurfaceNormal(vec3 localPosition) {
  vec3 direction = normalize(localPosition);
  if (flocMorphAmplitude == 0.0) return direction;
  vec3 p = direction * 0.4;
  vec3 gx = vec3(0.4, 0.0, 0.0);
  vec3 gy = vec3(0.0, 0.4, 0.0);
  vec3 gz = vec3(0.0, 0.0, 0.4);
  float frequency = flocMorphFrequency;
  float power = pow(flocMorphFalloff, frequency);
  float phase = flocMorphTime * -0.4;
  for (int iteration = 0; iteration < 16; iteration++) {
    if (iteration >= flocMorphDetail) break;
    vec3 angle = p.yzx * power + phase + frequency * vec3(0.18, 0.21, 0.24);
    vec3 coefficient = flocMorphWarp * cos(angle);
    vec3 nextX = gx + coefficient.x * gy;
    vec3 nextY = gy + coefficient.y * gz;
    vec3 nextZ = gz + coefficient.z * gx;
    p += flocMorphWarp * sin(angle) / power;
    gx = nextX; gy = nextY; gz = nextZ;
    frequency += 1.0;
    power *= flocMorphFalloff;
  }
  vec4 sampleValue = flocMorphNoise(p * 3.1 + flocMorphTime * 0.3);
  float t = clamp((sampleValue.x - 0.2) / 0.6, 0.0, 1.0);
  float height = t * t * (3.0 - 2.0 * t);
  vec3 gradient = (sampleValue.y * gx + sampleValue.z * gy + sampleValue.w * gz) * (3.1 * 6.0 * t * (1.0 - t) / 0.6);
  float radius = 1.0 + flocMorphAmplitude * height;
  return normalize(direction - (flocMorphAmplitude / radius) * (gradient - direction * dot(direction, gradient)));
}
`;

export function createMorphSurfaceNormals(style, time, hash) {
  const uniforms = {
    flocMorphLattice: { value: null },
    flocMorphOrigin: { value: new THREE.Vector3() },
    flocMorphTime: { value: time },
    flocMorphWarp: { value: style.morphWarp },
    flocMorphFrequency: { value: style.morphFrequency },
    flocMorphFalloff: { value: style.morphFalloff },
    flocMorphDetail: { value: style.morphDetail },
    flocMorphContrast: { value: style.morphContrast },
    flocMorphAmplitude: { value: style.morphAmplitude }
  };
  const descriptor = { key: 'morph-c2-v1', uniforms, pars };
  let texture = null, latticeOrigin = NaN, latticeSize = 0, disposed = false;
  function update(settings, signedTime) {
    if (disposed) return;
    uniforms.flocMorphTime.value = signedTime;
    uniforms.flocMorphWarp.value = settings.morphWarp;
    uniforms.flocMorphFrequency.value = settings.morphFrequency;
    uniforms.flocMorphFalloff.value = settings.morphFalloff;
    uniforms.flocMorphDetail.value = settings.morphDetail;
    uniforms.flocMorphContrast.value = settings.morphContrast;
    uniforms.flocMorphAmplitude.value = settings.morphAmplitude;
    let extent = .4, power = Math.pow(settings.morphFalloff, settings.morphFrequency);
    for (let i = 0; i < settings.morphDetail; i++) {
      extent += settings.morphWarp / power;
      power *= settings.morphFalloff;
    }
    // A complete extra cell absorbs fractional drift and float shader rounding.
    const radius = Math.ceil(extent * 3.1) + 1;
    const size = 2 * radius + 2, origin = Math.floor(signedTime * .3) - radius;
    if (size === latticeSize && origin === latticeOrigin) return;
    if (size !== latticeSize) {
      if (texture) texture.dispose();
      texture = new THREE.Data3DTexture(new Float32Array(size ** 3), size, size, size);
      texture.format = THREE.RedFormat;
      texture.type = THREE.FloatType;
      texture.minFilter = THREE.NearestFilter;
      texture.magFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.unpackAlignment = 1;
      uniforms.flocMorphLattice.value = texture;
    }
    const data = texture.image.data;
    let index = 0;
    for (let z = 0; z < size; z++) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) data[index++] = hash(origin + x, origin + y, origin + z);
      }
    }
    latticeOrigin = origin;
    latticeSize = size;
    uniforms.flocMorphOrigin.value.setScalar(origin);
    texture.needsUpdate = true;
  }
  update(style, time);
  return {
    descriptor,
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      texture.dispose();
    }
  };
}
