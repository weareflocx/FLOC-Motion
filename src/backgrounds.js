export const PROCEDURAL_BACKGROUNDS = [
  { id: 'grid', name: 'Grid' },
  { id: 'grain', name: 'Grain' },
  { id: 'waves', name: 'Waves' },
  { id: 'geometry', name: 'Geometry' },
  { id: 'dots', name: 'Dots' },
  { id: 'stripes', name: 'Stripes' },
  { id: 'checkerboard', name: 'Checkerboard' },
  { id: 'rings', name: 'Rings' },
  { id: 'rays', name: 'Rays' },
  { id: 'mesh', name: 'Mesh' },
  { id: 'flow', name: 'Flow' },
  { id: 'halftone', name: 'Halftone' }
];
export const DEFAULT_PROCEDURAL_BACKGROUND = { pattern: 'grid', patternColor: '#ffffff', patternScale: 1, patternIntensity: 0.35, patternSpeed: 0.2, patternSeed: 1 };

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = (value, extent) => ((value % extent) + extent) % extent;
// A stateless integer hash keeps every seek reproducible, including reverse seeks.
function sample(seed, index) {
  let value = (seed | 0) ^ Math.imul(index + 1, 0x9e3779b1);
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return ((value ^ (value >>> 15)) >>> 0) / 4294967296;
}

export function drawProceduralBackground(canvas, layer, suppliedTime) {
  const context = canvas.getContext('2d');
  if (!context || !canvas.width || !canvas.height) return;
  const settings = { ...DEFAULT_PROCEDURAL_BACKGROUND, ...layer };
  const scale = clamp(settings.patternScale, 0.25, 4);
  const intensity = clamp(settings.patternIntensity, 0, 1);
  const seed = settings.patternSeed;
  const time = Math.max(0, Number.isFinite(suppliedTime) ? suppliedTime : 0) * settings.patternSpeed;
  const unit = Math.min(canvas.width, canvas.height) / 1080;
  const width = canvas.width / unit, height = canvas.height / unit;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = settings.color ?? '#080808';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.setTransform(unit, 0, 0, unit, 0, 0);
  context.fillStyle = settings.patternColor;
  context.strokeStyle = settings.patternColor;
  context.globalAlpha = intensity;
  context.lineWidth = 1.25;

  if (settings.pattern === 'grid') {
    const spacing = 96 / scale;
    const offset = wrap(time * 24 + sample(seed, 0) * spacing, spacing);
    context.beginPath();
    for (let x = offset - spacing; x < width + spacing; x += spacing) { context.moveTo(x, 0); context.lineTo(x, height); }
    for (let y = offset - spacing; y < height + spacing; y += spacing) { context.moveTo(0, y); context.lineTo(width, y); }
    context.stroke();
    const dotOffset = offset + spacing / 2;
    for (let x = dotOffset - spacing; x < width + spacing; x += spacing) {
      for (let y = dotOffset - spacing; y < height + spacing; y += spacing) context.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
  } else if (settings.pattern === 'grain') {
    const count = Math.round(1700 * Math.sqrt(scale));
    for (let i = 0; i < count; i++) {
      const x = wrap(sample(seed, i * 4) * width + time * 13, width);
      const y = wrap(sample(seed, i * 4 + 1) * height + time * 7, height);
      const size = (0.8 + sample(seed, i * 4 + 2) * 2.2) / scale;
      context.globalAlpha = intensity * (0.25 + sample(seed, i * 4 + 3) * 0.75);
      context.fillRect(x, y, size, size);
    }
  } else if (settings.pattern === 'waves') {
    const spacing = 104 / scale;
    const count = Math.min(96, Math.ceil(height / spacing) + 3);
    const phase = sample(seed, 0) * Math.PI * 2 + time * 0.7;
    const amplitude = 72 / Math.sqrt(scale);
    for (let row = -1; row < count; row++) {
      context.beginPath();
      for (let point = 0; point <= 64; point++) {
        const x = point / 64 * width;
        const y = row * spacing + Math.sin(x / (260 / scale) + phase + row * 0.22) * amplitude;
        if (point === 0) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.stroke();
    }
  } else if (settings.pattern === 'geometry') {
    const count = Math.round(8 + scale * 4);
    for (let i = 0; i < count; i++) {
      const radius = (90 + sample(seed, i * 4 + 2) * 180) / Math.sqrt(scale);
      const x = sample(seed, i * 4) * width, y = sample(seed, i * 4 + 1) * height;
      const angle = sample(seed, i * 4 + 3) * Math.PI * 2 + time * (i % 2 ? -0.16 : 0.16);
      context.save();
      context.translate(x, y);
      context.rotate(angle);
      context.lineWidth = i % 3 === 0 ? 2 : 1.25;
      context.beginPath();
      if (i % 3 === 0) context.arc(0, 0, radius, 0, Math.PI * 2);
      else if (i % 3 === 1) context.rect(-radius, -radius, radius * 2, radius * 2);
      else { context.moveTo(0, -radius); context.lineTo(radius * 0.866, radius * 0.5); context.lineTo(-radius * 0.866, radius * 0.5); context.closePath(); }
      context.stroke();
      context.restore();
    }
  } else if (settings.pattern === 'dots' || settings.pattern === 'halftone') {
    const spacing = Math.max(36, (settings.pattern === 'dots' ? 92 : 72) / scale);
    const phase = sample(seed, 0) * Math.PI * 2 + time * 0.5;
    const offset = wrap(sample(seed, 1) * spacing + time * 10, spacing);
    for (let x = offset - spacing; x < width + spacing; x += spacing) {
      for (let y = offset - spacing; y < height + spacing; y += spacing) {
        const field = (Math.sin(x / 270 + phase) * Math.cos(y / 220 - phase) + 1) / 2;
        const radius = spacing * (settings.pattern === 'dots' ? 0.12 : 0.035 + field * 0.37);
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
      }
    }
  } else if (settings.pattern === 'stripes') {
    const extent = Math.hypot(width, height);
    const spacing = Math.max(36, 112 / scale);
    const offset = wrap(sample(seed, 0) * spacing + time * 28, spacing);
    context.save();
    context.translate(width / 2, height / 2);
    context.rotate(-Math.PI / 4);
    for (let x = -extent + offset; x < extent; x += spacing) context.fillRect(x, -extent, spacing * 0.28, extent * 2);
    context.restore();
  } else if (settings.pattern === 'checkerboard') {
    const spacing = Math.max(40, 120 / scale);
    const offsetX = wrap(sample(seed, 0) * spacing + time * 15, spacing * 2);
    const offsetY = wrap(sample(seed, 1) * spacing + time * 7, spacing * 2);
    for (let row = -2; row < Math.ceil(height / spacing) + 1; row++) {
      for (let col = -2; col < Math.ceil(width / spacing) + 1; col++) {
        if ((row + col) % 2 === 0) context.fillRect(col * spacing + offsetX, row * spacing + offsetY, spacing, spacing);
      }
    }
  } else if (settings.pattern === 'rings' || settings.pattern === 'rays') {
    const centerX = width * (0.3 + sample(seed, 0) * 0.4), centerY = height * (0.3 + sample(seed, 1) * 0.4);
    const extent = Math.hypot(width, height);
    if (settings.pattern === 'rings') {
      const spacing = Math.max(40, 112 / scale);
      const offset = wrap(sample(seed, 2) * spacing + time * 24, spacing);
      for (let radius = offset + 1; radius < extent; radius += spacing) {
        context.beginPath();
        context.arc(centerX, centerY, radius, 0, Math.PI * 2);
        context.stroke();
      }
    } else {
      const count = Math.round(24 * scale);
      const offset = sample(seed, 2) * Math.PI * 2 + time * 0.16;
      context.beginPath();
      for (let i = 0; i < count; i++) {
        const angle = i / count * Math.PI * 2 + offset;
        context.moveTo(centerX + Math.cos(angle) * 60, centerY + Math.sin(angle) * 60);
        context.lineTo(centerX + Math.cos(angle) * extent, centerY + Math.sin(angle) * extent);
      }
      context.stroke();
    }
  } else if (settings.pattern === 'mesh') {
    const spacing = Math.max(54, 132 / scale);
    const phase = sample(seed, 0) * Math.PI * 2 + time * 0.4;
    const amplitude = spacing * 0.28;
    for (let col = -1; col < Math.ceil(width / spacing) + 1; col++) {
      context.beginPath();
      for (let point = 0; point <= 48; point++) {
        const y = point / 48 * height;
        const x = col * spacing + Math.sin(y / 220 + phase + col * 0.31) * amplitude;
        if (point === 0) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.stroke();
    }
    for (let row = -1; row < Math.ceil(height / spacing) + 1; row++) {
      context.beginPath();
      for (let point = 0; point <= 48; point++) {
        const x = point / 48 * width;
        const y = row * spacing + Math.sin(x / 260 - phase + row * 0.37) * amplitude;
        if (point === 0) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.stroke();
    }
  } else if (settings.pattern === 'flow') {
    const spacing = Math.max(36, 92 / scale);
    const phase = sample(seed, 0) * Math.PI * 2 + time * 0.45;
    const length = spacing * 0.52;
    context.beginPath();
    for (let x = spacing / 2; x < width; x += spacing) {
      for (let y = spacing / 2; y < height; y += spacing) {
        const angle = Math.sin(x / 230 + phase) * 1.5 + Math.cos(y / 250 - phase) * 1.2;
        const dx = Math.cos(angle) * length / 2, dy = Math.sin(angle) * length / 2;
        context.moveTo(x - dx, y - dy);
        context.lineTo(x + dx, y + dy);
      }
    }
    context.stroke();
  }
  context.globalAlpha = 1;
  context.setTransform(1, 0, 0, 1, 0, 0);
}
