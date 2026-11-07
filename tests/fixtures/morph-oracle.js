// Independent double-precision reference for the GPU morphing-sphere surface: the
// former CPU implementation, kept only as a test oracle.
const fract = value => value - Math.floor(value);
export const morphHash = (x, y, z) => fract(Math.sin(x * 12.9898 + y * 78.283 + z * 37.919) * 43758.7053);
const smooth = (low, high, value) => {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

// Value and its analytic spatial gradient share the same eight lattice hashes.
export function morphNoise(x, y, z, contrast, gradient, out, hash = morphHash) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * fx * (fx * (6 * fx - 15) + 10);
  const v = fy * fy * fy * (fy * (6 * fy - 15) + 10);
  const w = fz * fz * fz * (fz * (6 * fz - 15) + 10);
  const a = hash(ix, iy, iz), b = hash(ix + 1, iy, iz);
  const c = hash(ix, iy + 1, iz), d = hash(ix + 1, iy + 1, iz);
  const e = hash(ix, iy, iz + 1), f = hash(ix + 1, iy, iz + 1);
  const g = hash(ix, iy + 1, iz + 1), h = hash(ix + 1, iy + 1, iz + 1);
  const ab = a + (b - a) * u, cd = c + (d - c) * u;
  const ef = e + (f - e) * u, gh = g + (h - g) * u;
  const lower = ab + (cd - ab) * v, upper = ef + (gh - ef) * v;
  const value = Math.max(0, Math.min(1, lower + (upper - lower) * w));
  out[0] = Math.pow(value, contrast);
  if (!gradient) return;
  const scale = contrast * Math.pow(Math.max(value, 1e-12), contrast - 1);
  out[1] = ((b - a + ((d - c) - (b - a)) * v) * (1 - w) + (f - e + ((h - g) - (f - e)) * v) * w) * (30 * fx * fx * (fx - 1) * (fx - 1)) * scale;
  out[2] = ((cd - ab) * (1 - w) + (gh - ef) * w) * (30 * fy * fy * (fy - 1) * (fy - 1)) * scale;
  out[3] = (upper - lower) * (30 * fz * fz * (fz - 1) * (fz - 1)) * scale;
}

// Warp of a unit direction and its Jacobian rows.
export function morphWarp(x, y, z, style, time) {
  x *= .4; y *= .4; z *= .4;
  let xx = .4, xy = 0, xz = 0, yx = 0, yy = .4, yz = 0, zx = 0, zy = 0, zz = .4;
  let frequency = style.morphFrequency, power = Math.pow(style.morphFalloff, style.morphFrequency);
  const phase = time * -.4;
  for (let iteration = 0; iteration < style.morphDetail; iteration++) {
    const ax = y * power + phase + frequency * .18;
    const ay = z * power + phase + frequency * .21;
    const az = x * power + phase + frequency * .24;
    const cx = style.morphWarp * Math.cos(ax), cy = style.morphWarp * Math.cos(ay), cz = style.morphWarp * Math.cos(az);
    const nxx = xx + cx * yx, nxy = xy + cx * yy, nxz = xz + cx * yz;
    const nyx = yx + cy * zx, nyy = yy + cy * zy, nyz = yz + cy * zz;
    const nzx = zx + cz * xx, nzy = zy + cz * xy, nzz = zz + cz * xz;
    x += style.morphWarp * Math.sin(ax) / power;
    y += style.morphWarp * Math.sin(ay) / power;
    z += style.morphWarp * Math.sin(az) / power;
    xx = nxx; xy = nxy; xz = nxz; yx = nyx; yy = nyy; yz = nyz; zx = nzx; zy = nzy; zz = nzz;
    frequency++;
    power *= style.morphFalloff;
  }
  return { point: [x, y, z], jacobian: [xx, xy, xz, yx, yy, yz, zx, zy, zz] };
}

// `directions` are any nonzero vectors (normalized here); `palette` is four linear
// THREE.Color values, or null to skip colors. `time` is the signed field clock.
export function morphOracle(directions, style, time, palette = null) {
  const count = directions.length / 3, scratch = new Float64Array(4);
  const positions = new Float64Array(count * 3), normals = new Float64Array(count * 3), colors = new Float64Array(count * 3);
  const heights = new Float64Array(count), factors = new Float64Array(count);
  const drift = time * .3, chromaDrift = time * .6 + 20, amplitude = style.morphAmplitude;
  for (let i = 0; i < count; i++) {
    const k = i * 3, length = Math.hypot(directions[k], directions[k + 1], directions[k + 2]);
    const x = directions[k] / length, y = directions[k + 1] / length, z = directions[k + 2] / length;
    const { point: [wx, wy, wz], jacobian: [xx, xy, xz, yx, yy, yz, zx, zy, zz] } = morphWarp(x, y, z, style, time);
    morphNoise(wx * 3.1 + drift, wy * 3.1 + drift, wz * 3.1 + drift, style.morphContrast, true, scratch);
    const level = scratch[0], t = Math.max(0, Math.min(1, (level - .2) / .6));
    const height = heights[i] = t * t * (3 - 2 * t), scale = 3.1 * 6 * t * (1 - t) / .6;
    const gx = (scratch[1] * xx + scratch[2] * yx + scratch[3] * zx) * scale;
    const gy = (scratch[1] * xy + scratch[2] * yy + scratch[3] * zy) * scale;
    const gz = (scratch[1] * xz + scratch[2] * yz + scratch[3] * zz) * scale;
    const radius = 1 + amplitude * height;
    positions[k] = x * radius; positions[k + 1] = y * radius; positions[k + 2] = z * radius;
    const radialGradient = x * gx + y * gy + z * gz, normalScale = amplitude / radius;
    const nx = x - normalScale * (gx - x * radialGradient), ny = y - normalScale * (gy - y * radialGradient), nz = z - normalScale * (gz - z * radialGradient);
    const inverseLength = 1 / Math.max(1e-12, Math.hypot(nx, ny, nz));
    normals[k] = nx * inverseLength; normals[k + 1] = ny * inverseLength; normals[k + 2] = nz * inverseLength;
    if (!palette) continue;
    const light = .4 + smooth(.4, .8, level) * 1.3;
    morphNoise(wx * 1.5 + chromaDrift, wy * 1.5 + chromaDrift, wz * 1.5 + chromaDrift, style.morphContrast, false, scratch);
    const factor = factors[i] = fract((x + y + z) * .27 + Math.pow(scratch[0], 4.6)) * 4;
    const index = Math.floor(factor), blend = smooth(0, 1.4, fract(factor));
    const a = palette[index], b = palette[(index + 1) % 4];
    colors[k] = (a.r + (b.r - a.r) * blend) * light;
    colors[k + 1] = (a.g + (b.g - a.g) * blend) * light;
    colors[k + 2] = (a.b + (b.b - a.b) * blend) * light;
  }
  return { positions, normals, colors, heights, factors };
}
