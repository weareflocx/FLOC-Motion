// Adapted from Textures (textures.dev), Copyright(c)2026Textures. MIT; see public/licenses/textures-dev.txt.
// Originals: https://textures.dev/s/pillars, https://textures.dev/s/sphere,
// https://textures.dev/s/twist, https://textures.dev/s/watch

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const round2 = value => Math.round(value * 100) / 100;
const round3 = value => Math.round(value * 1000) / 1000;
const round4 = value => Math.round(value * 10000) / 10000;
// Wraps to [-90, 90); branches replace fmod where the subtraction is exact.
const arc = degrees => {
  const turned = (degrees > -180 && degrees < 180 ? degrees : degrees % 180) + 270;
  return (turned >= 360 ? turned - 360 : turned >= 180 ? turned - 180 : turned) - 90;
};
const smooth = value => value <= 0 ? 0 : value >= 1 ? 1 : value * value * (3 - 2 * value);
const spring = (velocity, from, to, dt, omega = 30) => velocity + (omega * omega * (to - from) - 2 * omega * velocity) * dt;

// The source uses four cubic segments rather than an SVG ellipse.
function pillarCap(ctx, right, cy, scale = 1) {
  ctx.moveTo(right, cy);
  ctx.bezierCurveTo(right, cy + 3.41056 * scale, right - 5.3936 * scale, cy + 6.17535 * scale, right - 12.047 * scale, cy + 6.17535 * scale);
  ctx.bezierCurveTo(right - 18.7004 * scale, cy + 6.17535 * scale, right - 24.094 * scale, cy + 3.41056 * scale, right - 24.094 * scale, cy);
  ctx.bezierCurveTo(right - 24.094 * scale, cy - 3.41056 * scale, right - 18.7004 * scale, cy - 6.17535 * scale, right - 12.047 * scale, cy - 6.17535 * scale);
  ctx.bezierCurveTo(right - 5.3936 * scale, cy - 6.17535 * scale, right, cy - 3.41056 * scale, right, cy);
  ctx.closePath();
}

export function createPillarsTexture(layout) {
  const cols = layout ? layout.columns : 34, rows = layout ? layout.rows : 16, count = cols * rows;
  const pitchX = 23.0941, pitchY = 33.4779, elementSize = layout ? layout.elementSize : 1;
  const bodyWidth = 23.094 * elementSize, bodyHeight = 158.23 * elementSize;
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const x = new Float64Array(count), y = new Float64Array(count);
  const bodyX = new Float64Array(count), capX = new Float64Array(count);
  const bodyY = new Float64Array(count), capY = new Float64Array(count);
  const lift = new Float32Array(count);
  const atRest = new Uint8Array(rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      x[i] = layout
        ? (c + 0.5) * pitchX + (rows > 1 ? (r % 2 ? 6 : -6) : 0) - 12.047 * elementSize
        : (r % 2 ? -15 : -27) + c * pitchX;
      y[i] = layout ? (r + 0.5) * pitchY - 6.17535 * elementSize : 0.74 + r * pitchY;
      bodyX[i] = round2(x[i] + 0.5 * elementSize);
      capX[i] = round2(x[i] + 24.0941 * elementSize);
      if (layout) {
        bounds.minX = Math.min(bounds.minX, x[i] - 0.01);
        bounds.maxX = Math.max(bounds.maxX, x[i] + 24.0941 * elementSize + 0.01);
        bounds.minY = Math.min(bounds.minY, y[i] - 64 - 0.01);
        bounds.maxY = Math.max(bounds.maxY, y[i] + (6.748 + 158.23 + 0.5) * elementSize + 0.01);
      }
    }
  }
  function writeRow(r) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      bodyY[i] = round2(y[i] - lift[i] + 6.748 * elementSize);
      capY[i] = round2(y[i] - lift[i] + 6.17535 * elementSize);
    }
  }
  function reset() {
    lift.fill(0);
    atRest.fill(1);
    for (let r = 0; r < rows; r++) writeRow(r);
  }
  function step(pointer, dt) {
    const k = pointer.reduced ? 1 : 1 - Math.exp(-dt / 0.06);
    for (let r = 0; r < rows; r++) {
      let rowMoving = false, rowLifted = false;
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const dx = (x[i] + 12.047 * elementSize - pointer.x) / pitchX;
        const dy = (y[i] + 6.175 * elementSize - pointer.y) / pitchY;
        const d = Math.hypot(dx, dy);
        const want = d >= 5.2 ? 0 : 64 * pointer.active * Math.pow(1 - d / 5.2, 1.5);
        let next = lift[i] + (want - lift[i]) * k;
        if (Math.abs(next - want) < 0.03) next = want;
        else rowMoving = true;
        lift[i] = next;
        if (next !== 0) rowLifted = true;
      }
      if (!rowLifted) {
        if (!atRest[r]) writeRow(r);
        atRest[r] = 1;
      } else if (rowMoving || atRest[r] || pointer.reduced) {
        writeRow(r);
        atRest[r] = 0;
      }
    }
  }
  function draw(ctx, paint) {
    ctx.save();
    ctx.globalAlpha = paint.weight;
    ctx.lineWidth = elementSize;
    ctx.lineJoin = 'miter';
    // Each source row paints its field-filled bodies, body outlines, then caps.
    // Later rows occlude the long bodies behind them; never sort by lift.
    for (let r = 0; r < rows; r++) {
      ctx.beginPath();
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        ctx.rect(bodyX[i], bodyY[i], bodyWidth, bodyHeight);
      }
      ctx.fillStyle = paint.field;
      ctx.fill();
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        ctx.strokeStyle = paint.colorAt(x[i] + 12.047 * elementSize, capY[i]);
        ctx.beginPath();
        ctx.rect(bodyX[i], bodyY[i], bodyWidth, bodyHeight);
        ctx.stroke();
      }
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        ctx.fillStyle = paint.colorAt(x[i] + 12.047 * elementSize, capY[i]);
        ctx.beginPath();
        pillarCap(ctx, capX[i], capY[i], elementSize);
        ctx.fill();
      }
    }
    ctx.restore();
  }
  reset();
  return layout ? { reset, step, draw, bounds } : { reset, step, draw };
}

export function createSphereTexture(layout) {
  const cols = layout ? layout.columns : 34, rows = layout ? layout.rows : 24, count = cols * rows;
  const pitch = layout ? 22.181818 : 732 / (cols - 1);
  const y0 = layout ? pitch / 2 : (516 - (rows - 1) * pitch) / 2;
  const elementSize = layout ? layout.elementSize : 1;
  const dotRadius = 10.6 * elementSize;
  // max(0.47 * d * (1 - (d / 135)^2)^2) < 18.17; radius <= 13.78.
  // Include native rounding before scaling both the dot and its orbit.
  const reach = 32.1 * elementSize + 0.01;
  const bounds = layout ? {
    minX: pitch / 2 - reach, minY: pitch / 2 - reach,
    maxX: (cols - 0.5) * pitch + reach, maxY: (rows - 0.5) * pitch + reach,
  } : null;
  const x = new Float64Array(count), y = new Float64Array(count);
  const drawX = new Float64Array(count), drawY = new Float64Array(count);
  const writtenR = new Float32Array(count), writtenT = new Float32Array(count);
  const writtenX = new Float32Array(count), writtenY = new Float32Array(count);
  const radiusR = new Float64Array(count), radiusT = new Float64Array(count);
  const offsetX = new Float64Array(count), offsetY = new Float64Array(count);
  const rotation = new Float64Array(count);
  let bx, by, vx, vy, press, vPress, lx, ly, vlx, vly;
  for (let i = 0; i < count; i++) {
    x[i] = (i % cols) * pitch + (layout ? pitch / 2 : 0);
    y[i] = y0 + Math.floor(i / cols) * pitch;
    drawX[i] = round2(x[i]);
    drawY[i] = round2(y[i]);
  }
  function reset() {
    bx = layout ? layout.width / 2 : 366; by = layout ? layout.height / 2 : 258;
    vx = 0; vy = 0; press = 0; vPress = 0;
    lx = -0.5; ly = -0.4; vlx = 0; vly = 0;
    writtenR.fill(1); writtenT.fill(1); writtenX.fill(0); writtenY.fill(0);
    radiusR.fill(dotRadius); radiusT.fill(dotRadius);
    offsetX.fill(0); offsetY.fill(0); rotation.fill(0);
  }
  function step(pointer, dt) {
    if (pointer.reduced) return;
    vx = spring(vx, bx, pointer.x, dt); bx += vx * dt;
    vy = spring(vy, by, pointer.y, dt); by += vy * dt;
    vPress = spring(vPress, press, pointer.active, dt); press += vPress * dt;
    const speed = Math.hypot(vx, vy), swing = Math.min(1, speed / 900);
    const tx = -0.5 + ((speed > 1 ? (vx / speed) * 0.9 : 0) + 0.5) * swing;
    const ty = -0.4 + ((speed > 1 ? (vy / speed) * 0.9 : 0) + 0.4) * swing;
    vlx = spring(vlx, lx, tx, dt, 28); lx += vlx * dt;
    vly = spring(vly, ly, ty, dt, 28); ly += vly * dt;
    const settled = Math.abs(bx - pointer.x) < 0.05 && Math.abs(by - pointer.y) < 0.05 &&
      Math.abs(vx) + Math.abs(vy) < 0.5 && Math.abs(press - pointer.active) < 0.001 &&
      Math.abs(vPress) < 0.01 && Math.abs(lx + 0.5) + Math.abs(ly + 0.4) < 0.002 &&
      Math.abs(vlx) + Math.abs(vly) < 0.02;
    if (settled) {
      bx = pointer.x; by = pointer.y; press = pointer.active; lx = -0.5; ly = -0.4;
      vx = vy = vPress = vlx = vly = 0;
    }
    const fieldPress = layout ? Math.max(0, Math.min(1, press)) : press;
    const ln = Math.hypot(lx, ly, 0.55), lightX = lx / ln, lightY = ly / ln, lightZ = 0.55 / ln;
    for (let i = 0; i < count; i++) {
      const dx = x[i] - bx, dy = y[i] - by;
      let sr = 1, st = 1, mx = 0, my = 0;
      if (fieldPress > 0.001) {
        const d = Math.hypot(dx, dy);
        if (d > 0.001 && d < 135 * 1.45) {
          const rho = Math.min(1, d / 135), ux = dx / d, uy = dy / d;
          const q = 1 - rho * rho, lift = 0.47 * q * q;
          const radial = Math.max(0.3, 1 + lift - 4 * 0.47 * rho * rho * q);
          const tangential = 1 + lift, nz = Math.sqrt(q);
          const lit = rho * (ux * lightX + uy * lightY) + nz * lightZ;
          const beyond = d > 135 ? smooth((d - 135) / (135 * 0.45)) : 0;
          const shade = 1 - (1 - (0.08 + 0.92 * smooth((lit + 0.25) / 1.05))) * (1 - beyond);
          mx = lift * d * ux * fieldPress;
          my = lift * d * uy * fieldPress;
          sr = 1 + (Math.min(1.3, radial) * shade - 1) * fieldPress;
          st = 1 + (Math.min(1.3, tangential) * shade - 1) * fieldPress;
        }
      }
      const atRest = fieldPress <= 0.001;
      if (settled || (atRest && (writtenR[i] !== 1 || writtenT[i] !== 1 || writtenX[i] !== 0 || writtenY[i] !== 0)) ||
        Math.abs(sr - writtenR[i]) > 0.004 || Math.abs(st - writtenT[i]) > 0.004 ||
        Math.abs(mx - writtenX[i]) > 0.15 || Math.abs(my - writtenY[i]) > 0.15) {
        writtenR[i] = sr; writtenT[i] = st; writtenX[i] = mx; writtenY[i] = my;
        radiusR[i] = dotRadius * round3(sr);
        radiusT[i] = dotRadius * round3(st);
        offsetX[i] = Math.round(mx * 10) / 10 * elementSize;
        offsetY[i] = Math.round(my * 10) / 10 * elementSize;
        rotation[i] = Math.round((Math.atan2(dy, dx) / DEG) * 10) / 10 * DEG;
      }
    }
  }
  function draw(ctx, paint) {
    ctx.save();
    ctx.globalAlpha = paint.weight;
    for (let i = 0; i < count; i++) {
      const cx = drawX[i] + offsetX[i], cy = drawY[i] + offsetY[i];
      ctx.fillStyle = paint.colorAt(cx, cy);
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.abs(radiusR[i]), Math.abs(radiusT[i]), rotation[i], 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
  reset();
  return layout ? { reset, step, draw, bounds } : { reset, step, draw };
}

export function createTwistTexture(layout) {
  const cols = layout ? layout.columns : 25, rows = layout ? layout.rows : 18, count = cols * rows;
  const elementSize = layout ? layout.elementSize : 1;
  const width = 27 * elementSize, height = 26 * elementSize;
  const barWidth = 3.75 * elementSize, barHeight = 44 * elementSize;
  const pitchX = layout ? 27.916667 : (714 - 17 - width) / (cols - 1);
  const pitchY = layout ? 26.764706 : (498 - 17 - height) / (rows - 1);
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const x = new Float64Array(count), y = new Float64Array(count);
  const cx = new Float32Array(count), cy = new Float32Array(count);
  const angle = new Float32Array(count), thick = new Float32Array(count);
  const writtenAngle = new Float32Array(count), writtenScale = new Float32Array(count);
  const rotation = new Float64Array(count), drawScale = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    x[i] = layout ? (i % cols + 0.5) * pitchX - width / 2 : round2(17 + (i % cols) * pitchX);
    y[i] = layout ? (Math.floor(i / cols) + 0.5) * pitchY - height / 2 : round2(17 + Math.floor(i / cols) * pitchY);
    cx[i] = x[i] + width / 2;
    cy[i] = y[i] + height / 2;
    if (layout) {
      bounds.minX = Math.min(bounds.minX, x[i]);
      bounds.minY = Math.min(bounds.minY, y[i]);
      bounds.maxX = Math.max(bounds.maxX, x[i] + width);
      bounds.maxY = Math.max(bounds.maxY, y[i] + height);
    }
  }
  function reset() {
    angle.fill(0); thick.fill(1); writtenAngle.fill(0); writtenScale.fill(1);
    rotation.fill(0); drawScale.fill(1);
  }
  function step(pointer, dt) {
    // Every element 260+ units from the pointer shares one easing factor.
    const far = 1 - Math.exp(-dt / (pointer.active > 0 ? 0.035 + (0.06 - 0.035) * 1 : 0.16));
    for (let i = 0; i < count; i++) {
      const dx = pointer.x - cx[i], dy = pointer.y - cy[i];
      const d = Math.sqrt(dx * dx + dy * dy), theta = Math.atan2(dy, dx), bearing = theta / DEG - 90;
      const targetAngle = pointer.active > 0 ? arc(bearing) * pointer.active : 0;
      const c = Math.abs(Math.cos(2 * theta)), f = d < 1 ? 1 : c * c * c;
      const targetScale = 1 + (26.5 / 3.75 - 1) * f * pointer.active;
      const a = angle[i], s = thick[i];
      if (a === targetAngle && s === targetScale) continue;
      let nextAngle, nextScale;
      if (pointer.reduced) {
        nextAngle = targetAngle; nextScale = targetScale;
      } else {
        const k = pointer.active > 0 && d < 260 ? 1 - Math.exp(-dt / (0.035 + (0.06 - 0.035) * (d / 260))) : far;
        nextAngle = a + arc(targetAngle - a) * k;
        nextScale = s + (targetScale - s) * k;
        if (Math.abs(arc(targetAngle - nextAngle)) < 0.6) nextAngle = targetAngle;
        if (Math.abs(targetScale - nextScale) < 0.04) nextScale = targetScale;
      }
      angle[i] = nextAngle; thick[i] = nextScale;
      if (Math.abs(nextAngle - writtenAngle[i]) > 0.2 || Math.abs(nextScale - writtenScale[i]) > 0.01 ||
        (nextAngle === 0 && nextScale === 1 && (writtenAngle[i] !== 0 || writtenScale[i] !== 1))) {
        writtenAngle[i] = nextAngle; writtenScale[i] = nextScale;
        rotation[i] = round2(nextAngle) * DEG;
        drawScale[i] = round3(nextScale);
      }
    }
  }
  function draw(ctx, paint) {
    ctx.save();
    ctx.globalAlpha = paint.weight;
    for (let i = 0; i < count; i++) {
      ctx.save();
      // This fixed viewport clipping is essential: rotating the long source bar
      // without it would turn the thin diagonal quadrants into oversized slashes.
      ctx.beginPath();
      ctx.rect(x[i], y[i], width, height);
      ctx.clip();
      ctx.translate(x[i] + width / 2, y[i] + height / 2);
      ctx.rotate(rotation[i]);
      ctx.scale(drawScale[i], 1);
      ctx.fillStyle = paint.colorAt(cx[i], cy[i]);
      ctx.fillRect(-barWidth / 2, -barHeight / 2, barWidth, barHeight);
      ctx.restore();
    }
    ctx.restore();
  }
  reset();
  return layout ? { reset, step, draw, bounds } : { reset, step, draw };
}

export function createWatchTexture(layout) {
  const cols = layout ? layout.columns : 27, rows = layout ? layout.rows : 19, count = cols * rows;
  const cell = 23.58, pitch = 26.08, minimum = 3.77;
  const elementSize = layout ? layout.elementSize : 1, plateRadius = cell / 2 * elementSize;
  // Size and offset share one interpolation, so the dot remains within the
  // plate envelope, plus the source's 23.6-vs-23.58 excess and quantization.
  const reach = 11.82 * elementSize + 0.01;
  const bounds = layout ? {
    minX: pitch / 2 - reach, minY: pitch / 2 - reach,
    maxX: (cols - 0.5) * pitch + reach, maxY: (rows - 0.5) * pitch + reach,
  } : null;
  const sizes = new Float64Array([23.6, 22.8, 21.65, 19.77, 16.95, 11.3, 9.4, 7.5, 5.6, 3.77]);
  const cx = new Float64Array(count), cy = new Float64Array(count);
  const size = new Float32Array(count), ox = new Float32Array(count), oy = new Float32Array(count);
  const written = new Float32Array(count * 3);
  const radius = new Float64Array(count), offsetX = new Float64Array(count), offsetY = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    cx[i] = layout ? (i % cols + 0.5) * pitch : round2(15 + (i % cols) * pitch) + cell / 2;
    cy[i] = layout ? (Math.floor(i / cols) + 0.5) * pitch : round2(11.49 + Math.floor(i / cols) * pitch) + cell / 2;
  }
  function reset() {
    size.fill(minimum); ox.fill(0); oy.fill(0); written.fill(Infinity);
    radius.fill(cell * round4(minimum / cell) / 2 * elementSize); offsetX.fill(0); offsetY.fill(0);
  }
  function step(pointer, dt) {
    const px = layout ? pointer.x / pitch - 0.5 : (pointer.x - 15 - cell / 2) / pitch;
    const py = layout ? pointer.y / pitch - 0.5 : (pointer.y - 11.49 - cell / 2) / pitch;
    for (let i = 0; i < count; i++) {
      const dx = px - i % cols, dy = py - Math.floor(i / cols), d = Math.hypot(dx, dy);
      const index = Math.min(sizes.length - 1, d), index0 = Math.floor(index), f = index - index0;
      const target = index0 >= sizes.length - 1 ? sizes[sizes.length - 1] : sizes[index0] * (1 - f) + sizes[index0 + 1] * f;
      const wantSize = minimum + (target - minimum) * pointer.active;
      const room = ((cell - wantSize) / 2) * 0.85 * pointer.active * (d < 14 ? 1 : Math.max(0, 1 - (d - 14) / 3));
      const wantX = d > 0.001 ? (dx / d) * room : 0;
      const wantY = d > 0.001 ? (dy / d) * room : 0;
      let s = size[i], x = ox[i], y = oy[i];
      if (pointer.reduced) {
        s = wantSize; x = wantX; y = wantY;
      } else {
        const tau = 0.045 + (0.14 - 0.045) * Math.min(1, d / 14);
        const k = 1 - Math.exp(-dt / tau);
        s += (wantSize - s) * k;
        x += (wantX - x) * k;
        y += (wantY - y) * k;
        if (Math.abs(s - wantSize) < 0.02 && Math.abs(x - wantX) < 0.02 && Math.abs(y - wantY) < 0.02) {
          s = wantSize; x = wantX; y = wantY;
        }
      }
      size[i] = s; ox[i] = x; oy[i] = y;
      const j = i * 3, rest = s === minimum && x === 0 && y === 0;
      if ((rest && (written[j] !== minimum || written[j + 1] !== 0 || written[j + 2] !== 0)) ||
        Math.abs(s - written[j]) > 0.03 || Math.abs(x - written[j + 1]) > 0.1 || Math.abs(y - written[j + 2]) > 0.1) {
        written[j] = s; written[j + 1] = x; written[j + 2] = y;
        radius[i] = cell * round4(s / cell) / 2 * elementSize;
        offsetX[i] = round2(x) * elementSize; offsetY[i] = round2(y) * elementSize;
      }
    }
  }
  function draw(ctx, paint) {
    ctx.save();
    // The SVG background pattern is one dim pass, followed by all inner dots.
    ctx.globalAlpha = paint.weight * 0.1;
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = paint.colorAt(cx[i], cy[i]);
      ctx.beginPath();
      ctx.arc(cx[i], cy[i], plateRadius, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = paint.weight;
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = paint.colorAt(cx[i], cy[i]);
      ctx.beginPath();
      ctx.arc(cx[i] + offsetX[i], cy[i] + offsetY[i], radius[i], 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
  reset();
  return layout ? { reset, step, draw, bounds } : { reset, step, draw };
}
