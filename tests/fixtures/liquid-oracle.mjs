// Float64 reference for the liquid ribbons GPU projection: the CPU Newton
// refinement that model-liquid.js ran before projection moved into the vertex
// shader, applied to the controller's welded, unprojected local samples.
const TAU = Math.PI * 2;
const AXIS_LENGTH = Math.hypot(.35, 1, .45);
const AX = .35 / AXIS_LENGTH, AY = 1 / AXIS_LENGTH, AZ = .45 / AXIS_LENGTH;

export function liquidPhase(style, elapsed) {
  const u = ((Math.max(0, elapsed) * style.liquidSpeed / style.liquidDuration % 1) + 1) % 1;
  return TAU * (u - style.liquidEase * Math.sin(TAU * u));
}
export function liquidRadius(style) {
  return Math.max(style.liquidRadius, style.liquidInnerRadius) + style.liquidThickness + Math.sqrt(3) * style.liquidWarp * 2;
}
// Marching-cubes cell edge; the conservative sphere stays two cells inside the grid.
export const liquidCell = style => 2 * liquidRadius(style) / (style.liquidDetail - 4);
// Row-major R(phase): local positions map into the field domain as R*p.
export function liquidRotation(phase) {
  const c = Math.cos(phase), s = Math.sin(phase), v = 1 - c;
  return [
    AX * AX * v + c, AX * AY * v - AZ * s, AX * AZ * v + AY * s,
    AY * AX * v + AZ * s, AY * AY * v + c, AY * AZ * v - AX * s,
    AZ * AX * v - AY * s, AZ * AY * v + AX * s, AZ * AZ * v + c
  ];
}

// Distance minus thickness, analytic derivative and branch in the field domain.
export function createLiquidEvaluator(style, phase) {
  const w1 = style.liquidWarp, w2 = w1 * .85, w3 = w1 * .15;
  const f1 = style.liquidFrequency, f2 = f1 * 2.2, f3 = f1 * 4.5;
  const opening = style.liquidOpen + (style.liquidClosed - style.liquidOpen) * (.5 - .5 * Math.cos(phase));
  const radiusA = style.liquidRadius, radiusB = style.liquidInnerRadius;
  const cutRadiusA = radiusA * .6, cutRadiusB = radiusB * .6;
  const thickness = style.liquidThickness, phase2 = 2 * phase, phase3 = 3 * phase;
  return (x, y, z, out) => {
    let ax = y * f1 + phase, ay = z * f1 + 2.1 + phase, az = x * f1 + 4.2 + phase;
    const dx1 = w1 * f1 * Math.cos(ax), dy1 = w1 * f1 * Math.cos(ay), dz1 = w1 * f1 * Math.cos(az);
    let nx = x + w1 * Math.sin(ax), ny = y + w1 * Math.sin(ay), nz = z + w1 * Math.sin(az);
    let qx = -.8 * ny - .6 * nz, qy = .8 * nx + .36 * ny - .48 * nz, qz = .6 * nx - .48 * ny + .64 * nz;
    ax = qy * f2 + 1.3 - phase2; ay = qz * f2 + 3.7 - phase2; az = qx * f2 + 5.1 - phase2;
    const dx2 = w2 * f2 * Math.cos(ax), dy2 = w2 * f2 * Math.cos(ay), dz2 = w2 * f2 * Math.cos(az);
    nx = qx + w2 * Math.sin(ax); ny = qy + w2 * Math.sin(ay); nz = qz + w2 * Math.sin(az);
    qx = -.8 * ny - .6 * nz; qy = .8 * nx + .36 * ny - .48 * nz; qz = .6 * nx - .48 * ny + .64 * nz;
    ax = qy * f3 + 4 + phase3; ay = qz * f3 + .7 + phase3; az = qx * f3 + 2.9 + phase3;
    const dx3 = w3 * f3 * Math.cos(ax), dy3 = w3 * f3 * Math.cos(ay), dz3 = w3 * f3 * Math.cos(az);
    x = qx + w3 * Math.sin(ax); y = qy + w3 * Math.sin(ay); z = qz + w3 * Math.sin(az);
    const r = Math.sqrt(x * x + y * y + z * z), divisor = Math.max(r, .001);
    nx = x / divisor; ny = y / divisor; nz = z / divisor;
    const a3 = 3 * nx + phase, a2 = 2 * nz - phase, a5 = 5 * nz + phase2, a9 = 9 * nx - phase3;
    const b3 = 3 * ny - phase, b2 = 2 * nx + phase, b5 = 5 * ny - phase2, b9 = 9 * nz + phase3;
    const sa3 = Math.sin(a3), ca2 = Math.cos(a2), sb3 = Math.sin(b3), cb2 = Math.cos(b2);
    const a = ny + .30 * sa3 * ca2 + .12 * Math.sin(a5) + .05 * Math.sin(a9);
    const b = .8 * nx + .6 * nz + .30 * sb3 * cb2 + .12 * Math.sin(b5) + .05 * Math.sin(b9);
    const cutA = Math.max(0, (Math.abs(a) - opening) * cutRadiusA);
    const cutB = Math.max(0, (Math.abs(b) - opening * .9) * cutRadiusB);
    const drA = r - radiusA, drB = r - radiusB;
    const branch = drA * drA + cutA * cutA <= drB * drB + cutB * cutB ? 0 : 1;
    const dr = branch === 0 ? drA : drB, cut = branch === 0 ? cutA : cutB;
    const distance = Math.sqrt(dr * dr + cut * cut);
    let gx = 0, gy = 0, gz = 0;
    if (cut > 0) {
      const factor = cut * (branch === 0 ? cutRadiusA * Math.sign(a) : cutRadiusB * Math.sign(b));
      if (branch === 0) {
        gx = factor * (.9 * Math.cos(a3) * ca2 + .45 * Math.cos(a9));
        gy = factor;
        gz = factor * (-.6 * sa3 * Math.sin(a2) + .6 * Math.cos(a5));
      } else {
        gx = factor * (.8 - .6 * sb3 * Math.sin(b2));
        gy = factor * (.9 * Math.cos(b3) * cb2 + .6 * Math.cos(b5));
        gz = factor * (.6 + .45 * Math.cos(b9));
      }
    }
    const radial = r >= .001 ? (gx * nx + gy * ny + gz * nz) / divisor : 0;
    const radialDistance = r > 0 ? dr / r : 0;
    gx = gx / divisor + x * radialDistance - nx * radial;
    gy = gy / divisor + y * radialDistance - ny * radial;
    gz = gz / divisor + z * radialDistance - nz * radial;
    if (distance > 0) { gx /= distance; gy /= distance; gz /= distance; }
    qx = gx + dz3 * gz; qy = gy + dx3 * gx; qz = gz + dy3 * gy;
    gx = .8 * qy + .6 * qz; gy = -.8 * qx + .36 * qy - .48 * qz; gz = -.6 * qx - .48 * qy + .64 * qz;
    qx = gx + dz2 * gz; qy = gy + dx2 * gx; qz = gz + dy2 * gy;
    gx = .8 * qy + .6 * qz; gy = -.8 * qx + .36 * qy - .48 * qz; gz = -.6 * qx - .48 * qy + .64 * qz;
    out[0] = distance - thickness;
    out[1] = gx + dz1 * gz; out[2] = gy + dx1 * gx; out[3] = gz + dy1 * gy;
    out[4] = branch;
  };
}

// Projects the first `count` local positions; returns local positions, unit
// outward normals, |field| residuals and the distance each vertex moved.
export function projectLiquid(source, count, style, elapsed) {
  const phase = liquidPhase(style, elapsed), m = liquidRotation(phase), evaluate = createLiquidEvaluator(style, phase);
  const cell = liquidCell(style), trust = cell * .35, maxStep = cell * .2;
  const tolerance = Math.max(1e-8, style.liquidThickness * 1e-5), value = new Float64Array(5);
  const positions = new Float64Array(count * 3), normals = new Float64Array(count * 3);
  const residuals = new Float64Array(count), moved = new Float64Array(count);
  for (let i = 0, k = 0; i < count; i++, k += 3) {
    const lx = source[k], ly = source[k + 1], lz = source[k + 2];
    const ox = m[0] * lx + m[1] * ly + m[2] * lz, oy = m[3] * lx + m[4] * ly + m[5] * lz, oz = m[6] * lx + m[7] * ly + m[8] * lz;
    let x = ox, y = oy, z = oz;
    evaluate(x, y, z, value);
    const branch = value[4], initialX = value[1], initialY = value[2], initialZ = value[3];
    for (let iteration = 0; iteration < 3 && Math.abs(value[0]) > tolerance; iteration++) {
      const distance = value[0], gx = value[1], gy = value[2], gz = value[3];
      const length2 = gx * gx + gy * gy + gz * gz;
      if (length2 < 1e-20) break;
      let step = distance / length2;
      step *= Math.min(1, maxStep / (Math.abs(step) * Math.sqrt(length2)));
      let accepted = false;
      for (let attempt = 0; attempt < 3; attempt++, step *= .5) {
        const px = x - step * gx, py = y - step * gy, pz = z - step * gz;
        if ((px - ox) ** 2 + (py - oy) ** 2 + (pz - oz) ** 2 > trust * trust) continue;
        evaluate(px, py, pz, value);
        if (value[4] === branch && Math.abs(value[0]) < Math.abs(distance)
          && value[1] * initialX + value[2] * initialY + value[3] * initialZ > 0) {
          x = px; y = py; z = pz; accepted = true;
          break;
        }
      }
      if (!accepted) { evaluate(x, y, z, value); break; }
    }
    const length = Math.hypot(value[1], value[2], value[3]);
    positions[k] = m[0] * x + m[3] * y + m[6] * z; positions[k + 1] = m[1] * x + m[4] * y + m[7] * z; positions[k + 2] = m[2] * x + m[5] * y + m[8] * z;
    const nx = value[1] / length, ny = value[2] / length, nz = value[3] / length;
    normals[k] = m[0] * nx + m[3] * ny + m[6] * nz; normals[k + 1] = m[1] * nx + m[4] * ny + m[7] * nz; normals[k + 2] = m[2] * nx + m[5] * ny + m[8] * nz;
    residuals[i] = Math.abs(value[0]);
    moved[i] = Math.hypot(x - ox, y - oy, z - oz);
  }
  return { positions, normals, residuals, moved, trust };
}
