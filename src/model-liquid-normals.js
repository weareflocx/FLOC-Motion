import * as THREE from 'three';

const AXIS_LENGTH = Math.hypot(.35, 1, .45);
const AX = .35 / AXIS_LENGTH, AY = 1 / AXIS_LENGTH, AZ = .45 / AXIS_LENGTH;

// Distance minus thickness and its exact derivative in the unrotated field
// domain. Reverse differentiation carries the rounded cut through direction
// normalization and all three domain warps; the branch selects the min sheet.
const FIELD = /* glsl */`
uniform vec4 flocLiquidShape;
uniform vec2 flocLiquidCycle;
uniform mat3 flocLiquidRotation;
uniform vec4 flocLiquidNewton;

float flocLiquidField(vec3 p, out vec3 gradient, out bool branchA) {
  float radiusA = flocLiquidShape.x;
  float radiusB = flocLiquidShape.y;
  float warp = flocLiquidShape.z;
  float frequency = flocLiquidShape.w;
  float phase = flocLiquidCycle.x;
  float opening = flocLiquidCycle.y;
  float phase2 = 2.0 * phase;
  float phase3 = 3.0 * phase;
  mat3 octave = mat3(0.0, .8, .6, -.8, .36, -.48, -.6, -.48, .64);

  vec3 args = p.yzx * frequency + vec3(phase, 2.1 + phase, 4.2 + phase);
  vec3 derivative1 = warp * frequency * cos(args);
  p = octave * (p + warp * sin(args));
  args = p.yzx * (frequency * 2.2) + vec3(1.3, 3.7, 5.1) - phase2;
  vec3 derivative2 = (warp * .85) * (frequency * 2.2) * cos(args);
  p = octave * (p + (warp * .85) * sin(args));
  args = p.yzx * (frequency * 4.5) + vec3(4.0, .7, 2.9) + phase3;
  vec3 derivative3 = (warp * .15) * (frequency * 4.5) * cos(args);
  p += (warp * .15) * sin(args);

  float r = length(p);
  float divisor = max(r, .001);
  vec3 n = p / divisor;
  float a3 = 3.0 * n.x + phase;
  float a2 = 2.0 * n.z - phase;
  float a5 = 5.0 * n.z + phase2;
  float a9 = 9.0 * n.x - phase3;
  float b3 = 3.0 * n.y - phase;
  float b2 = 2.0 * n.x + phase;
  float b5 = 5.0 * n.y - phase2;
  float b9 = 9.0 * n.z + phase3;
  float sa3 = sin(a3), ca2 = cos(a2), sb3 = sin(b3), cb2 = cos(b2);
  float a = n.y + .30 * sa3 * ca2 + .12 * sin(a5) + .05 * sin(a9);
  float b = .8 * n.x + .6 * n.z + .30 * sb3 * cb2 + .12 * sin(b5) + .05 * sin(b9);
  float cutRadiusA = radiusA * .6;
  float cutRadiusB = radiusB * .6;
  float cutA = max(0.0, (abs(a) - opening) * cutRadiusA);
  float cutB = max(0.0, (abs(b) - opening * .9) * cutRadiusB);
  float drA = r - radiusA, drB = r - radiusB;
  branchA = drA * drA + cutA * cutA <= drB * drB + cutB * cutB;
  float dr = branchA ? drA : drB;
  float cut = branchA ? cutA : cutB;
  float distance = length(vec2(dr, cut));
  vec3 g = vec3(0.0);
  if (cut > 0.0) {
    float factor = cut * (branchA ? cutRadiusA * sign(a) : cutRadiusB * sign(b));
    if (branchA) {
      g = factor * vec3(.9 * cos(a3) * ca2 + .45 * cos(a9),
        1.0, -.6 * sa3 * sin(a2) + .6 * cos(a5));
    } else {
      g = factor * vec3(.8 - .6 * sb3 * sin(b2),
        .9 * cos(b3) * cb2 + .6 * cos(b5), .6 + .45 * cos(b9));
    }
  }
  // J(normalize(q))^T g; the clamped central divisor is constant below .001.
  float radial = r >= .001 ? dot(g, n) / divisor : 0.0;
  float radialDistance = r > 0.0 ? dr / r : 0.0;
  g = g / divisor + p * radialDistance - n * radial;
  if (distance > 0.0) g /= distance;

  // Each warp is q + amplitude*sin(q.yzx*frequency+offset).
  g += derivative3.zxy * g.zxy;
  g = transpose(octave) * g;
  g += derivative2.zxy * g.zxy;
  g = transpose(octave) * g;
  g += derivative1.zxy * g.zxy;
  gradient = g;
  return distance - flocLiquidNewton.x;
}
`;

// Evaluated at the actual fragment rather than interpolating three vertex
// normals across each triangle. True min-branch creases remain creases.
const NORMAL_PARS = FIELD + /* glsl */`
vec3 flocSurfaceNormal(vec3 localPosition) {
  vec3 gradient;
  bool branchA;
  flocLiquidField(flocLiquidRotation * localPosition, gradient, branchA);
  return normalize(transpose(flocLiquidRotation) * gradient);
}
`;

// Projects each welded marching-cubes sample onto the zero set. Bounded,
// monotone Newton steps stay in the local sheet's basin: a branch switch or an
// opposing derivative is rejected rather than jumping across folds, and no
// step leaves the trust radius around the sample, which bounds the CPU box.
const DISPLACEMENT_PARS = FIELD + /* glsl */`
vec3 flocDisplace(vec3 position, inout vec3 normal, inout vec3 color) {
  vec3 origin = flocLiquidRotation * position, p = origin, gradient, candidateGradient;
  bool branch, candidateBranch;
  float distance = flocLiquidField(p, gradient, branch);
  vec3 initial = gradient;
  float trust2 = flocLiquidNewton.y * flocLiquidNewton.y;
  for (int iteration = 0; iteration < 3; iteration++) {
    float length2 = dot(gradient, gradient);
    if (abs(distance) <= flocLiquidNewton.w || length2 < 1e-20) break;
    float step = distance / length2;
    step *= min(1.0, flocLiquidNewton.z / (abs(step) * sqrt(length2)));
    bool accepted = false;
    for (int attempt = 0; attempt < 3; attempt++, step *= .5) {
      vec3 candidate = p - step * gradient, offset = candidate - origin;
      if (dot(offset, offset) > trust2) continue;
      float candidateDistance = flocLiquidField(candidate, candidateGradient, candidateBranch);
      if (candidateBranch == branch && abs(candidateDistance) < abs(distance) && dot(candidateGradient, initial) > 0.0) {
        p = candidate; distance = candidateDistance; gradient = candidateGradient; accepted = true;
        break;
      }
    }
    if (!accepted) break;
  }
  normal = normalize(transpose(flocLiquidRotation) * gradient);
  return transpose(flocLiquidRotation) * p;
}
`;

// One uniform set serves both descriptors, so the vertex projection and the
// fragment normal always evaluate the same field.
export function createLiquidSurface() {
  const uniforms = {
    flocLiquidShape: { value: new THREE.Vector4() },
    flocLiquidCycle: { value: new THREE.Vector2() },
    flocLiquidRotation: { value: new THREE.Matrix3() },
    flocLiquidNewton: { value: new THREE.Vector4() }
  };
  return {
    uniforms,
    normals: { key: 'liquid-analytic-v2', pars: NORMAL_PARS, uniforms },
    displacement: { key: 'liquid-newton-v1', pars: DISPLACEMENT_PARS, uniforms }
  };
}

// `cell` is the marching-cubes grid spacing: Newton never moves a sample more
// than .35 cells, nor more than .2 cells per step.
export function syncLiquidSurface(surface, style, phase, cell) {
  const uniforms = surface.uniforms;
  uniforms.flocLiquidShape.value.set(style.liquidRadius, style.liquidInnerRadius, style.liquidWarp, style.liquidFrequency);
  const opening = style.liquidOpen + (style.liquidClosed - style.liquidOpen) * (.5 - .5 * Math.cos(phase));
  uniforms.flocLiquidCycle.value.set(phase, opening);
  uniforms.flocLiquidNewton.value.set(style.liquidThickness, cell * .35, cell * .2, Math.max(1e-8, style.liquidThickness * 1e-5));
  const c = Math.cos(phase), s = Math.sin(phase), v = 1 - c;
  uniforms.flocLiquidRotation.value.set(
    AX * AX * v + c, AX * AY * v - AZ * s, AX * AZ * v + AY * s,
    AY * AX * v + AZ * s, AY * AY * v + c, AY * AZ * v - AX * s,
    AZ * AX * v - AY * s, AZ * AY * v + AX * s, AZ * AZ * v + c
  );
}
