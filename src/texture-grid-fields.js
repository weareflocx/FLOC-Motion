// Adapted from Textures (textures.dev), Copyright(c)2026Textures. MIT; see public/licenses/textures-dev.txt.
// Originals: https://textures.dev/s/settle · https://textures.dev/s/magnet
// https://textures.dev/s/warp · https://textures.dev/s/pinch

const WIDTH = 732;
const HEIGHT = 516;
const BAR_W = 31.287;
const BAR_H = 8.683;
const SETTLE_COLUMNS = [
  [17, [47.17, 100.05, 150.79, 197.26, 241.59, 282.18, 320.1, 353.22, 383.13, 411.44, 434.4, 455.23, 473.93, 491.29]],
  [52.04, [64.54, 116.88, 167.09, 214.62, 257.35, 299.55, 336.4, 370.58, 401.56, 428.8, 452.3, 473.67, 491.29]],
  [87.08, [26.61, 81.09, 135.57, 186.32, 232.78, 277.11, 318.78, 355.63, 388.74, 419.72, 448.03, 469.93, 491.29]],
  [122.11, [49.58, 103.53, 156.4, 207.68, 254.68, 298.48, 340.14, 376.46, 410.64, 441.09, 469.39, 491.29]],
  [157.15, [73.08, 129.7, 183.64, 233.32, 280.85, 323.05, 365.24, 401.56, 437.35, 467.26, 491.29]],
  [192.19, [42.1, 102.46, 158.01, 211.42, 262.16, 308.63, 352.96, 392.48, 432.01, 464.59, 491.29]],
  [227.23, [73.08, 132.9, 188.98, 242.93, 293.67, 341.21, 383.4, 424.53, 462.45, 491.29]],
  [262.26, [44.24, 104.6, 166.02, 222.1, 276.05, 325.72, 373.25, 416.52, 458.18, 491.29]],
  [297.3, [17, 81.09, 144.12, 202.34, 257.89, 363.11, 408.51, 450.7, 491.29]],
  [332.34, [54.92, 120.62, 184.18, 245.07, 300.08, 351.89, 403.17, 448.56, 491.29]],
  [367.38, [17, 59.73, 105.13, 156.4, 208.21, 263.23, 324.11, 387.67, 453.37]],
  [402.41, [17, 57.59, 99.79, 145.19, 250.41, 305.96, 364.17, 427.2, 491.29]],
  [437.45, [17, 50.11, 91.78, 135.04, 182.57, 232.25, 286.19, 342.28, 403.7, 464.05]],
  [472.49, [17, 45.84, 83.76, 124.89, 167.09, 214.62, 265.36, 319.31, 375.39, 435.21]],
  [507.53, [17, 43.7, 76.29, 115.81, 155.33, 199.67, 246.13, 296.87, 350.29, 405.83, 466.19]],
  [542.56, [17, 41.04, 70.95, 106.73, 143.05, 185.25, 227.44, 274.98, 324.65, 378.6, 435.21]],
  [577.6, [17, 38.9, 67.21, 97.65, 131.83, 168.15, 209.82, 253.61, 300.61, 351.89, 404.77, 458.71]],
  [612.64, [17, 38.36, 60.26, 88.57, 119.55, 152.66, 189.52, 231.18, 275.51, 321.98, 372.72, 427.2, 481.68]],
  [647.68, [17, 34.63, 55.99, 79.49, 106.73, 137.71, 171.89, 208.75, 250.94, 293.67, 341.21, 391.41, 443.76]],
  [682.71, [17, 34.36, 53.06, 73.89, 96.86, 125.16, 155.08, 188.19, 226.11, 266.71, 311.04, 357.5, 408.24, 461.12]],
];

function createSettleColumns(layout) {
  const columns = new Array(layout.columns);
  const halfWidth = BAR_W * layout.elementSize / 2;
  const halfHeight = BAR_H * layout.elementSize / 2;
  const profileCenter = (17 + 491.29) / 2;
  const profileSpan = 491.29 - 17;
  const span = (layout.rows - 1) * 39.5;
  for (let col = 0; col < layout.columns; col++) {
    const source = layout.columns === 1 ? (SETTLE_COLUMNS.length - 1) / 2 :
      col / (layout.columns - 1) * (SETTLE_COLUMNS.length - 1);
    const left = Math.floor(source);
    const right = Math.min(left + 1, SETTLE_COLUMNS.length - 1);
    const blend = source - left;
    const ys = new Float64Array(layout.rows);
    for (let row = 0; row < layout.rows; row++) {
      const u = layout.rows === 1 ? 0.5 : row / (layout.rows - 1);
      const a = sampleSettleProfile(SETTLE_COLUMNS[left][1], u);
      const b = sampleSettleProfile(SETTLE_COLUMNS[right][1], u);
      ys[row] = layout.height / 2 + (a + (b - a) * blend - profileCenter) / profileSpan * span - halfHeight;
    }
    columns[col] = [(col + 0.5) * 35.04 - halfWidth, ys];
  }
  return columns;
}

function sampleSettleProfile(profile, u) {
  const index = u * (profile.length - 1);
  const start = Math.floor(index);
  const end = Math.min(start + 1, profile.length - 1);
  return profile[start] + (profile[end] - profile[start]) * (index - start);
}

function settleBounds(columns, barWidth, barHeight) {
  // |dy * exp(-dy² / (2σ²))| peaks at σ. Include collision propagation
  // through the whole column, not just the unconstrained pointer excursion.
  const excursion = 0.85 * 130 / Math.sqrt(Math.E);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, ys] of columns) {
    let upper = -Infinity;
    for (const y of ys) {
      minY = Math.min(minY, y - excursion - 0.005);
      upper = Math.max(y + excursion, upper + barHeight + 2);
      maxY = Math.max(maxY, upper + barHeight + 0.005);
    }
  }
  return { minX: columns[0][0], minY, maxX: columns[columns.length - 1][0] + barWidth, maxY };
}

export function createSettleTexture(layout) {
  const columns = layout ? createSettleColumns(layout) : SETTLE_COLUMNS;
  const barWidth = BAR_W * (layout ? layout.elementSize : 1);
  const barHeight = BAR_H * (layout ? layout.elementSize : 1);
  const offsets = new Uint16Array(columns.length + 1);
  for (let i = 0; i < columns.length; i++) offsets[i + 1] = offsets[i] + columns[i][1].length;
  const home = new Float64Array(offsets[offsets.length - 1]);
  for (let i = 0; i < columns.length; i++) home.set(columns[i][1], offsets[i]);
  const current = new Float64Array(home);
  const target = new Float64Array(home);
  const bounds = layout ? settleBounds(columns, barWidth, barHeight) : undefined;
  return {
    ...(layout ? { bounds } : {}),
    reset() {
      current.set(home);
      target.set(home);
    },
    step(pointer, dt) {
      const k = pointer.reduced ? 1 : 1 - 0.68 ** (Math.min(dt, 1 / 30) * 60);
      for (let col = 0; col < columns.length; col++) {
        const start = offsets[col];
        const end = offsets[col + 1];
        const dx = columns[col][0] + barWidth / 2 - pointer.x;
        const wx = Math.exp(-dx * dx / (2 * 90 * 90));
        for (let j = start; j < end; j++) {
          const dy = pointer.y - (home[j] + barHeight / 2);
          target[j] = home[j] + dy * wx * Math.exp(-dy * dy / (2 * 130 * 130)) * 0.85 * pointer.active;
        }
        for (let j = start + 1; j < end; j++) {
          if (target[j] < target[j - 1] + barHeight + 2) target[j] = target[j - 1] + barHeight + 2;
        }
        for (let j = end - 2; j >= start; j--) {
          if (target[j] > target[j + 1] - barHeight - 2) target[j] = target[j + 1] - barHeight - 2;
        }
        for (let j = start; j < end; j++) {
          const delta = target[j] - current[j];
          current[j] = Math.abs(delta) < 0.03 ? target[j] : current[j] + delta * k;
        }
      }
    },
    draw(ctx, paint) {
      ctx.save();
      ctx.globalAlpha *= paint.weight;
      for (let col = 0; col < columns.length; col++) {
        const x = columns[col][0];
        for (let j = offsets[col]; j < offsets[col + 1]; j++) {
          const y = home[j] + Math.round((current[j] - home[j]) * 100) / 100;
          ctx.fillStyle = paint.colorAt(x + barWidth / 2, y + barHeight / 2);
          ctx.fillRect(x, y, barWidth, barHeight);
        }
      }
      ctx.restore();
    }
  };
}

const MAGNET_COLS = 51;
const MAGNET_ROWS = 35;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const noise = seed => {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export function createMagnetTexture(layout) {
  const columns = layout ? layout.columns : MAGNET_COLS;
  const rows = layout ? layout.rows : MAGNET_ROWS;
  const count = columns * rows;
  const originX = layout ? 13.84 / 2 - 2 : 18;
  const originY = layout ? 14 / 2 - 2 : 18;
  const marginX = Math.min(2, Math.floor((columns - 1) / 2));
  const marginY = Math.min(2, Math.floor((rows - 1) / 2));
  const dotSize = 4 * (layout ? layout.elementSize : 1);
  const dotOffset = (4 - dotSize) / 2;
  const hx = new Float64Array(count);
  const hy = new Float64Array(count);
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  const tx = new Float64Array(count);
  const ty = new Float64Array(count);
  const vx = new Float64Array(count);
  const vy = new Float64Array(count);
  const stiffness = new Float64Array(count);
  const damping = new Float64Array(count);
  // A live cell replaces its home dot, just like the SVG mask plus moving pool.
  // Keep original slot acquisition/drawing order, without the DOM pool's 384 cap.
  const slotByCell = new Int32Array(count);
  const cellBySlot = new Int32Array(count);
  let nextFree = 0;
  let highWater = 0;
  let previous = -1;
  for (let cell = 0; cell < count; cell++) {
    hx[cell] = originX + (cell % columns) * 13.84;
    hy[cell] = originY + Math.floor(cell / columns) * 14;
    stiffness[cell] = 760 * (1 + 0.35 * (noise(cell) * 2 - 1));
    damping[cell] = 2 * 0.66 * Math.sqrt(stiffness[cell]);
  }
  function reset() {
    x.set(hx); y.set(hy); tx.set(hx); ty.set(hy);
    vx.fill(0); vy.fill(0);
    slotByCell.fill(-1); cellBySlot.fill(-1);
    nextFree = 0; highWater = 0; previous = -1;
  }
  reset();
  return {
    // Core targets move at most half a pitch plus two compressed intervals.
    // Twice that excursion safely reserves the damped spring's overshoot,
    // including rapid target changes; rounding adds at most 0.005 native units.
    ...(layout ? { bounds: {
      minX: 13.84 / 2 - dotSize / 2 - 56,
      minY: 14 / 2 - dotSize / 2 - 57,
      maxX: (columns - 0.5) * 13.84 + dotSize / 2 + 56,
      maxY: (rows - 0.5) * 14 + dotSize / 2 + 57
    } } : {}),
    reset,
    step(pointer, dt) {
      dt = Math.min(dt, 1 / 30);
      const on = pointer.active > 0.01;
      const mx = clamp(pointer.x, originX + marginX * 13.84 + 2, originX + (columns - 1 - marginX) * 13.84 + 2);
      const my = clamp(pointer.y, originY + marginY * 14 + 2, originY + (rows - 1 - marginY) * 14 + 2);
      const cc = on ? Math.round((mx - 2 - originX) / 13.84) : -1;
      const cr = on ? Math.round((my - 2 - originY) / 14) : -1;
      const key = cr * columns + cc;
      if (key !== previous) {
        for (let slot = 0; slot < highWater; slot++) {
          const cell = cellBySlot[slot];
          if (cell < 0) continue;
          tx[cell] = hx[cell]; ty[cell] = hy[cell];
        }
        previous = key;
      }
      if (on) {
        for (let i = -11; i <= 11; i++) {
          for (let j = -11; j <= 11; j++) {
            const c = cc + i;
            const r = cr + j;
            if (c < 0 || c >= columns || r < 0 || r >= rows) continue;
            const distance = Math.hypot(i, j);
            if (distance > 11) continue;
            const cell = r * columns + c;
            if (slotByCell[cell] < 0) {
              slotByCell[cell] = nextFree;
              cellBySlot[nextFree] = cell;
              highWater = Math.max(highWater, nextFree + 1);
              do { nextFree++; } while (nextFree < count && cellBySlot[nextFree] >= 0);
              x[cell] = tx[cell] = hx[cell]; y[cell] = ty[cell] = hy[cell];
              vx[cell] = vy[cell] = 0;
            }
            if (Math.abs(i) <= 2 && Math.abs(j) <= 2) {
              tx[cell] = mx + i * 3.7 - 2;
              ty[cell] = my + j * 3.7 - 2;
            } else {
              const ox = mx - 2 - hx[cell];
              const oy = my - 2 - hy[cell];
              const length = Math.hypot(ox, oy) || 1;
              const u = clamp((11 - distance) / 9, 0, 1);
              const lean = 5.5 * u * u * (3 - 2 * u);
              tx[cell] = hx[cell] + ox / length * lean;
              ty[cell] = hy[cell] + oy / length * lean;
            }
          }
        }
      }
      const steps = Math.max(1, Math.ceil(dt * 240));
      const h = dt / steps;
      for (let slot = 0; slot < highWater; slot++) {
        const cell = cellBySlot[slot];
        if (cell < 0) continue;
        if (pointer.reduced) {
          x[cell] = tx[cell]; y[cell] = ty[cell]; vx[cell] = vy[cell] = 0;
        } else {
          for (let n = 0; n < steps; n++) {
            vx[cell] += (-stiffness[cell] * (x[cell] - tx[cell]) - damping[cell] * vx[cell]) * h;
            vy[cell] += (-stiffness[cell] * (y[cell] - ty[cell]) - damping[cell] * vy[cell]) * h;
            x[cell] += vx[cell] * h; y[cell] += vy[cell] * h;
          }
        }
        if (Math.abs(x[cell] - tx[cell]) < 0.02 && Math.abs(y[cell] - ty[cell]) < 0.02 &&
            Math.abs(vx[cell]) < 0.5 && Math.abs(vy[cell]) < 0.5) {
          x[cell] = tx[cell]; y[cell] = ty[cell]; vx[cell] = vy[cell] = 0;
          if (tx[cell] === hx[cell] && ty[cell] === hy[cell]) {
            cellBySlot[slot] = -1; slotByCell[cell] = -1;
            nextFree = Math.min(nextFree, slot);
          }
        }
      }
    },
    draw(ctx, paint) {
      ctx.save();
      ctx.globalAlpha *= paint.weight;
      for (let cell = 0; cell < count; cell++) {
        if (slotByCell[cell] >= 0) continue;
        ctx.fillStyle = paint.colorAt(hx[cell] + 2, hy[cell] + 2);
        ctx.fillRect(hx[cell] + dotOffset, hy[cell] + dotOffset, dotSize, dotSize);
      }
      for (let slot = 0; slot < highWater; slot++) {
        const cell = cellBySlot[slot];
        if (cell < 0) continue;
        const px = hx[cell] + Math.round((x[cell] - hx[cell]) * 100) / 100;
        const py = hy[cell] + Math.round((y[cell] - hy[cell]) * 100) / 100;
        ctx.fillStyle = paint.colorAt(px + 2, py + 2);
        ctx.fillRect(px + dotOffset, py + dotOffset, dotSize, dotSize);
      }
      ctx.restore();
    }
  };
}

// Offline-decoded original packed paths, factored losslessly by grid axis.
// Coordinates are original normalized units × 10000; final entry is the
// authored interaction center (which is not always the exact path-box center).
const WARP_X = [
  [235, 365, 300],
  [729, 859, 794],
  [1224, 1354, 1289],
  [1719, 1849, 1784],
  [2214, 2344, 2279],
  [2709, 2839, 2774],
  [3203, 3333, 3268],
  [3698, 3828, 3763],
  [4193, 4323, 4258],
  [4688, 4818, 4753],
  [5182, 5312, 5247],
  [5677, 5807, 5742],
  [6172, 6302, 6237],
  [6667, 6797, 6732],
  [7161, 7291, 7226],
  [7656, 7786, 7721],
  [8151, 8281, 8216],
  [8646, 8776, 8711],
  [9141, 9271, 9206],
  [9635, 9765, 9700],
];
const WARP_Y = [
  [14, 122, 68],
  [398, 506, 452],
  [782, 891, 837],
  [1167, 1275, 1221],
  [1551, 1659, 1605],
  [1935, 2044, 1990],
  [2320, 2428, 2374],
  [2704, 2812, 2758],
  [3088, 3197, 3143],
  [3472, 3581, 3527],
  [3857, 3965, 3911],
  [4241, 4350, 4296],
  [4625, 4734, 4680],
  [5010, 5118, 5064],
  [5394, 5503, 5449],
  [5778, 5887, 5833],
  [6163, 6271, 6217],
  [6547, 6656, 6602],
  [6931, 7040, 6986],
];
const PINCH_X = [
  [218, 251, 537, 570, 394],
  [587, 619, 905, 938, 762],
  [956, 988, 1274, 1307, 1131],
  [1324, 1356, 1642, 1675, 1499],
  [1692, 1725, 2011, 2044, 1868],
  [2061, 2093, 2379, 2412, 2236],
  [2430, 2462, 2748, 2781, 2605],
  [2798, 2830, 3116, 3149, 2973],
  [3167, 3199, 3485, 3518, 3342],
  [3535, 3567, 3853, 3886, 3710],
  [3903, 3936, 4222, 4255, 4079],
  [4272, 4304, 4590, 4623, 4447],
  [4641, 4673, 4959, 4992, 4816],
  [5009, 5041, 5327, 5359, 5184],
  [5378, 5410, 5696, 5729, 5553],
  [5746, 5778, 6064, 6096, 5921],
  [6115, 6147, 6433, 6466, 6290],
  [6483, 6515, 6801, 6833, 6658],
  [6852, 6884, 7170, 7202, 7027],
  [7220, 7252, 7538, 7571, 7395],
  [7589, 7621, 7907, 7939, 7764],
  [7957, 7989, 8275, 8308, 8132],
  [8326, 8358, 8644, 8677, 8501],
  [8694, 8726, 9012, 9045, 8869],
  [9063, 9095, 9381, 9414, 9238],
  [9431, 9463, 9749, 9782, 9606],
];
const PINCH_Y = [
  [217, 249, 535, 568, 392],
  [586, 618, 904, 937, 761],
  [954, 986, 1272, 1305, 1129],
  [1322, 1355, 1641, 1674, 1498],
  [1690, 1723, 2009, 2042, 1866],
  [2060, 2092, 2378, 2411, 2235],
  [2427, 2460, 2746, 2779, 2603],
  [2797, 2829, 3115, 3148, 2972],
  [3165, 3197, 3483, 3516, 3340],
  [3534, 3566, 3852, 3885, 3709],
  [3902, 3934, 4220, 4253, 4077],
  [4271, 4303, 4589, 4622, 4446],
  [4639, 4671, 4957, 4990, 4814],
  [5008, 5040, 5326, 5358, 5183],
  [5376, 5408, 5694, 5727, 5551],
  [5745, 5777, 6063, 6095, 5920],
  [6113, 6145, 6431, 6464, 6288],
  [6482, 6514, 6800, 6832, 6657],
];
const PINCH_PLATE_X = [
  [219, 273, 519, 573],
  [587, 642, 887, 942],
  [955, 1010, 1255, 1310],
  [1324, 1378, 1624, 1678],
  [1692, 1747, 1992, 2047],
  [2060, 2115, 2360, 2415],
  [2429, 2483, 2729, 2783],
  [2797, 2852, 3097, 3152],
  [3165, 3220, 3465, 3520],
  [3534, 3588, 3834, 3888],
  [3902, 3957, 4202, 4257],
  [4270, 4325, 4570, 4625],
  [4639, 4693, 4939, 4993],
  [5007, 5061, 5307, 5361],
  [5375, 5430, 5675, 5730],
  [5743, 5798, 6043, 6098],
  [6112, 6166, 6412, 6466],
  [6480, 6535, 6780, 6835],
  [6848, 6903, 7148, 7203],
  [7217, 7271, 7517, 7571],
  [7585, 7640, 7885, 7940],
  [7953, 8008, 8253, 8308],
  [8322, 8376, 8622, 8676],
  [8690, 8745, 8990, 9045],
  [9058, 9113, 9358, 9413],
  [9427, 9481, 9727, 9781],
];
const PINCH_PLATE_Y = [
  [212, 267, 512, 567],
  [581, 636, 881, 936],
  [950, 1004, 1250, 1304],
  [1319, 1373, 1619, 1673],
  [1687, 1742, 1987, 2042],
  [2056, 2111, 2356, 2411],
  [2425, 2480, 2725, 2780],
  [2794, 2849, 3094, 3149],
  [3163, 3217, 3463, 3517],
  [3532, 3586, 3832, 3886],
  [3901, 3955, 4201, 4255],
  [4269, 4324, 4569, 4624],
  [4638, 4693, 4938, 4993],
  [5007, 5062, 5307, 5362],
  [5376, 5431, 5676, 5731],
  [5745, 5799, 6045, 6099],
  [6114, 6168, 6414, 6468],
  [6483, 6537, 6783, 6837],
];

const smoothstep = value => value * value * (3 - 2 * value);
const roundScale = value => Math.round((1 + (Math.abs(value) < 1e-5 ? 0 : value)) * 100) / 100;

// Both normalized source engines use the same 900/60 spring. Mutate the
// reusable buffers rather than allocating the original [value, velocity] pairs.
function springAt(values, velocities, index, goal, steps, h) {
  let value = values[index];
  let velocity = velocities[index];
  for (let n = 0; n < steps; n++) {
    velocity += (-900 * (value - goal) - 60 * velocity) * h;
    value += velocity * h;
  }
  values[index] = value;
  velocities[index] = velocity;
}

function regenerateAxis(source, count, pitch, unit, elementSize, hasCenter = true) {
  const result = new Array(count);
  for (let index = 0; index < count; index++) {
    const sourceIndex = count === 1 ? Math.floor((source.length - 1) / 2) :
      Math.round(index / (count - 1) * (source.length - 1));
    const original = source[sourceIndex];
    const last = original.length - (hasCenter ? 2 : 1);
    const center = (original[0] + original[last]) / 2;
    const target = (index + 0.5) * pitch / unit;
    const coordinates = new Float64Array(original.length);
    for (let coordinate = 0; coordinate < original.length; coordinate++) {
      coordinates[coordinate] = target + (original[coordinate] - center) * elementSize;
    }
    result[index] = coordinates;
  }
  return result;
}

function axisBounds(axis, unit, scale, hasCenter) {
  let min = Infinity;
  let max = -Infinity;
  for (const coordinates of axis) {
    const last = coordinates.length - (hasCenter ? 2 : 1);
    const center = (coordinates[0] + coordinates[last]) / 2;
    min = Math.min(min, (center + (coordinates[0] - center) * scale) * unit);
    max = Math.max(max, (center + (coordinates[last] - center) * scale) * unit);
  }
  return [min, max];
}

function gridBounds(xs, ys, unitX, unitY, scaleX, scaleY, hasCenter = true) {
  const [minX, maxX] = axisBounds(xs, unitX, scaleX, hasCenter);
  const [minY, maxY] = axisBounds(ys, unitY, scaleY, hasCenter);
  return { minX, minY, maxX, maxY };
}

function createScaleField(xs, ys, aspect, radius, channels, amplitude, layout) {
  const count = xs.length * ys.length;
  const values = new Float32Array(count * channels);
  const velocities = new Float32Array(count * channels);
  const cx = new Float64Array(count);
  const cy = new Float64Array(count);
  const weight = new Float64Array(1);
  const weightVelocity = new Float64Array(1);
  for (let i = 0; i < count; i++) {
    const xa = xs[i % xs.length];
    const ya = ys[Math.floor(i / xs.length)];
    cx[i] = layout ? xa[xa.length - 1] / 10000 * WIDTH / layout.width : xa[xa.length - 1] / 10000;
    cy[i] = layout ? ya[ya.length - 1] / 10000 * HEIGHT / (aspect * layout.width) : ya[ya.length - 1] / 10000;
  }
  const rad = radius * (layout ? layout.height / layout.width : aspect);
  return {
    values,
    reset() {
      values.fill(0); velocities.fill(0);
      weight[0] = 0; weightVelocity[0] = 0;
    },
    step(pointer, dt) {
      dt = Math.min(dt, 1 / 30);
      const steps = Math.max(1, Math.ceil(dt * 240));
      const h = dt / steps;
      const active = pointer.active;
      if (pointer.reduced) weight[0] = active;
      else springAt(weight, weightVelocity, 0, active, steps, h);
      // Layout bounds reserve the authored scale range, including transitions
      // out of reduced motion that can leave a spring with residual velocity.
      if (layout && (weight[0] < 0 || weight[0] > 1)) {
        weight[0] = clamp(weight[0], 0, 1);
        weightVelocity[0] = 0;
      }
      const on = active ? weight[0] : 0;
      const px = pointer.x / (layout ? layout.width : WIDTH);
      const py = layout ? pointer.y / layout.width : pointer.y / HEIGHT * aspect;
      for (let i = 0; i < count; i++) {
        const dx = px - cx[i];
        const dy = py - cy[i];
        const distance = Math.sqrt(dx * dx + dy * dy) / rad;
        const qx = Math.abs(dx) / rad;
        const qy = Math.abs(dy) / rad;
        const f0 = distance >= 1 ? 0 : smoothstep(1 - distance);
        const f1 = channels > 1 && qx < 1 ? smoothstep(1 - qx) : 0;
        const f2 = channels > 1 && qy < 1 ? smoothstep(1 - qy) : 0;
        for (let channel = 0; channel < channels; channel++) {
          const index = i * channels + channel;
          const goal = active ? (channel === 0 ? f0 : channel === 1 ? f1 : f2) * on : 0;
          if (goal === 0 && values[index] === 0 && velocities[index] === 0) continue;
          if (pointer.reduced) values[index] = goal;
          else springAt(values, velocities, index, goal, steps, h);
          if (layout && (values[index] < 0 || values[index] > 1)) {
            values[index] = clamp(values[index], 0, 1);
            velocities[index] = 0;
          }
          if (goal * amplitude < 0.005 && Math.abs(values[index]) * amplitude < 0.005) {
            values[index] = 0; velocities[index] = 0;
          } else if (!active && Math.abs(values[index]) * amplitude <= 1e-3) {
            values[index] = 0; velocities[index] = 0;
          }
        }
      }
      if (active && Math.abs(weight[0] - active) * amplitude <= 1e-3 &&
          Math.abs(weightVelocity[0]) * dt * amplitude <= 1e-3) {
        weight[0] = active; weightVelocity[0] = 0;
      }
    }
  };
}

export function createWarpTexture(layout) {
  const unitX = WIDTH / 10000;
  const unitY = HEIGHT / (0.7053 * 10000);
  const xs = layout ? regenerateAxis(WARP_X, layout.columns, 36.22, unitX, layout.elementSize) : WARP_X;
  const ys = layout ? regenerateAxis(WARP_Y, layout.rows, 28.06, unitY, layout.elementSize) : WARP_Y;
  const state = createScaleField(xs, ys, 0.7053, 0.35, 3, 2.53, layout);
  return {
    // Critically damped scale channels stay within [0, 1]; leave a rounding
    // margin beyond the authored 3.53 × 3.37 maximum expansion.
    ...(layout ? { bounds: gridBounds(xs, ys, unitX, unitY, 3.54, 3.38) } : {}),
    reset: state.reset,
    step: state.step,
    draw(ctx, paint) {
      ctx.save();
      ctx.globalAlpha *= paint.weight;
      for (let row = 0; row < ys.length; row++) {
        const ya = ys[row];
        const y = (ya[0] + ya[1]) / 2 * unitY;
        for (let col = 0; col < xs.length; col++) {
          const xa = xs[col];
          const index = (row * xs.length + col) * 3;
          const x = (xa[0] + xa[1]) / 2 * unitX;
          const width = (xa[1] - xa[0]) * unitX * roundScale(state.values[index + 1] * 2.53);
          const height = (ya[1] - ya[0]) * unitY * roundScale(state.values[index + 2] * 2.37);
          ctx.fillStyle = paint.colorAt(x, y);
          ctx.fillRect(x - width / 2, y - height / 2, width, height);
        }
      }
      ctx.restore();
    }
  };
}

// The source uses quadratic corners, not circular roundRect corners. Preserve
// all four independently rounded coordinates and scale about the fill-box.
function roundedCell(ctx, xa, ya, unitX, unitY, scale) {
  const cx = (xa[0] + xa[3]) / 2;
  const cy = (ya[0] + ya[3]) / 2;
  const x0 = (cx + (xa[0] - cx) * scale) * unitX;
  const x1 = (cx + (xa[1] - cx) * scale) * unitX;
  const x2 = (cx + (xa[2] - cx) * scale) * unitX;
  const x3 = (cx + (xa[3] - cx) * scale) * unitX;
  const y0 = (cy + (ya[0] - cy) * scale) * unitY;
  const y1 = (cy + (ya[1] - cy) * scale) * unitY;
  const y2 = (cy + (ya[2] - cy) * scale) * unitY;
  const y3 = (cy + (ya[3] - cy) * scale) * unitY;
  ctx.beginPath();
  ctx.moveTo(x1, y0); ctx.lineTo(x2, y0);
  ctx.quadraticCurveTo(x3, y0, x3, y1); ctx.lineTo(x3, y2);
  ctx.quadraticCurveTo(x3, y3, x2, y3); ctx.lineTo(x1, y3);
  ctx.quadraticCurveTo(x0, y3, x0, y2); ctx.lineTo(x0, y1);
  ctx.quadraticCurveTo(x0, y0, x1, y0); ctx.closePath();
  ctx.fill();
}

export function createPinchTexture(layout) {
  const unitX = WIDTH / 10000;
  const unitY = HEIGHT / (0.7049 * 10000);
  const xs = layout ? regenerateAxis(PINCH_X, layout.columns, 26.98, unitX, layout.elementSize) : PINCH_X;
  const ys = layout ? regenerateAxis(PINCH_Y, layout.rows, 27, unitY, layout.elementSize) : PINCH_Y;
  const plateX = layout ? regenerateAxis(PINCH_PLATE_X, layout.columns, 26.98, unitX, layout.elementSize, false) : PINCH_PLATE_X;
  const plateY = layout ? regenerateAxis(PINCH_PLATE_Y, layout.rows, 27, unitY, layout.elementSize, false) : PINCH_PLATE_Y;
  const state = createScaleField(xs, ys, 0.7049, 0.42, 1, 1, layout);
  let bounds;
  if (layout) {
    bounds = gridBounds(xs, ys, unitX, unitY, 1.01, 1.01);
    const plateBounds = gridBounds(plateX, plateY, unitX, unitY, 1, 1, false);
    bounds.minX = Math.min(bounds.minX, plateBounds.minX);
    bounds.minY = Math.min(bounds.minY, plateBounds.minY);
    bounds.maxX = Math.max(bounds.maxX, plateBounds.maxX);
    bounds.maxY = Math.max(bounds.maxY, plateBounds.maxY);
  }
  return {
    ...(layout ? { bounds } : {}),
    reset: state.reset,
    step: state.step,
    draw(ctx, paint) {
      ctx.save();
      const alpha = ctx.globalAlpha * paint.weight;
      // The original stationary plate is behind every animated motif at 10%.
      ctx.globalAlpha = alpha * 0.1;
      for (let row = 0; row < plateY.length; row++) {
        const ya = plateY[row];
        for (let col = 0; col < plateX.length; col++) {
          const xa = plateX[col];
          ctx.fillStyle = paint.colorAt((xa[0] + xa[3]) / 2 * unitX, (ya[0] + ya[3]) / 2 * unitY);
          roundedCell(ctx, xa, ya, unitX, unitY, 1);
        }
      }
      ctx.globalAlpha = alpha;
      for (let row = 0; row < ys.length; row++) {
        const ya = ys[row];
        for (let col = 0; col < xs.length; col++) {
          const xa = xs[col];
          const scale = roundScale(state.values[row * xs.length + col] * -0.8462);
          ctx.fillStyle = paint.colorAt((xa[0] + xa[3]) / 2 * unitX, (ya[0] + ya[3]) / 2 * unitY);
          roundedCell(ctx, xa, ya, unitX, unitY, scale);
        }
      }
      ctx.restore();
    }
  };
}
