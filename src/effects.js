import { animatedFields, evaluateChoreography } from './choreography.js';
// One catalog for every visual layer. Each effect is an SVG filter applied in
// stack order to the layer's element, so text, images, models, backgrounds,
// carousels and adjustment layers share the same implementation.
export const EFFECTS = [
  { id: 'noise', name: 'Noise' }, { id: 'blur', name: 'Blur' }, { id: 'monochrome', name: 'Monochrome' }, { id: 'duotone', name: 'Duotone' },
  { id: 'chromatic', name: 'Chromatic split' }, { id: 'wave', name: 'Liquid wave' }, { id: 'optical-warp', name: 'Optical Warp' },
  { id: 'halftone', name: 'Halftone' }, { id: 'dithering', name: 'Dithering' }, { id: 'fluted-glass', name: 'Fluted glass' }
];
export const MAX_EFFECTS = 10;
export const EFFECT_LAYER_TYPES = ['background', 'text', 'logo', 'media', 'model', 'carousel', 'effect'];
export const DEFAULT_NOISE = Object.freeze({ type: 'noise', enabled: true, mode: 'mono', sizeX: 1, sizeY: 1, linked: true, density: 1, opacity: 0.15, color1: '#000000', color2: '#ffffff', animated: false, seed: 42 });

export const DEFAULT_FILTERS = Object.freeze({
  blur: Object.freeze({ type: 'blur', enabled: true, amount: 8, mode: 'uniform', direction: 'bottom' }),
  monochrome: Object.freeze({ type: 'monochrome', enabled: true, amount: 1 }),
  duotone: Object.freeze({ type: 'duotone', enabled: true, amount: 1, shadow: '#111111', highlight: '#0000ff' }),
  chromatic: Object.freeze({ type: 'chromatic', enabled: true, amount: 0.5, animated: false }),
  wave: Object.freeze({ type: 'wave', enabled: true, amount: 0.5, size: 0.5, speed: 1 }),
  'optical-warp': Object.freeze({ type: 'optical-warp', enabled: true, amount: 0.5, axis: 'horizontal', center: 0.5 }),
  halftone: Object.freeze({ type: 'halftone', enabled: true, amount: 1, size: 0.35 }),
  dithering: Object.freeze({ type: 'dithering', enabled: true, amount: 1, size: 0.35, steps: 4 }),
  'fluted-glass': Object.freeze({ type: 'fluted-glass', enabled: true, amount: 1, size: 0.35, distortion: 0.5 }),
});

export function newEffect(type, index = 0) {
  if (type === 'noise') return { ...DEFAULT_NOISE, seed: (42 + index * 997) % 65536 };
  if (Object.hasOwn(DEFAULT_FILTERS, type)) return { ...DEFAULT_FILTERS[type] };
  throw new Error('Unknown effect.');
}

const fraction = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const hex = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export function validateEffects(effects) {
  const fail = () => { throw new Error('Invalid noise effect settings.'); };
  if (!Array.isArray(effects) || effects.length > MAX_EFFECTS) throw new Error(`A layer holds at most ${MAX_EFFECTS} effects.`);
  for (const effect of effects) {
    if (!effect || typeof effect !== 'object' || Array.isArray(effect)) fail();
    if (Object.hasOwn(DEFAULT_FILTERS, effect.type)) {
      const defaults = DEFAULT_FILTERS[effect.type];
      if (Object.keys(effect).some(key => !Object.hasOwn(defaults, key))) throw new Error('Invalid effect settings.');
      for (const [key, value] of Object.entries(defaults)) if (effect[key] === undefined) effect[key] = value;
      if (typeof effect.enabled !== 'boolean' || typeof effect.amount !== 'number' || !Number.isFinite(effect.amount) || effect.amount < 0 || effect.amount > (effect.type === 'blur' ? 48 : 1)) throw new Error('Invalid effect settings.');
      if (effect.type === 'blur' && (!['uniform', 'progressive'].includes(effect.mode) || !['top', 'bottom', 'left', 'right'].includes(effect.direction))) throw new Error('Invalid blur settings.');
      if (effect.type === 'optical-warp' && (!['horizontal', 'vertical'].includes(effect.axis) || typeof effect.center !== 'number' || !Number.isFinite(effect.center) || effect.center < 0.1 || effect.center > 0.9)) throw new Error('Invalid optical warp settings.');
      if (effect.type === 'duotone' && !(hex(effect.shadow) && hex(effect.highlight))) throw new Error('Invalid duotone colors.');
      if (effect.type === 'chromatic' && typeof effect.animated !== 'boolean') throw new Error('Invalid chromatic split settings.');
      if (effect.type === 'wave' && !(fraction(effect.size) && typeof effect.speed === 'number' && effect.speed >= 0 && effect.speed <= 2)) throw new Error('Invalid liquid wave settings.');
      if (['halftone', 'dithering', 'fluted-glass'].includes(effect.type) && !fraction(effect.size)) throw new Error('Invalid effect size.');
      if (effect.type === 'dithering' && !(Number.isInteger(effect.steps) && effect.steps >= 1 && effect.steps <= 7)) throw new Error('Dithering color steps must be an integer between 1 and 7.');
      if (effect.type === 'fluted-glass' && !fraction(effect.distortion)) throw new Error('Invalid fluted glass distortion.');
      continue;
    }
    if (Object.keys(effect).some(key => !Object.hasOwn(DEFAULT_NOISE, key))) fail();
    for (const [key, value] of Object.entries(DEFAULT_NOISE)) if (effect[key] === undefined) effect[key] = value;
    if (effect.type !== 'noise' || !['mono', 'duo', 'multi'].includes(effect.mode)) fail();
    if (!['enabled', 'linked', 'animated'].every(key => typeof effect[key] === 'boolean')) fail();
    for (const [key, min, max] of [['sizeX', 0.5, 32], ['sizeY', 0.5, 32], ['density', 0, 1], ['opacity', 0, 1], ['seed', 0, 65535]]) {
      if (typeof effect[key] !== 'number' || !Number.isFinite(effect[key]) || effect[key] < min || effect[key] > max) fail();
    }
    if (!Number.isInteger(effect.seed) || ![effect.color1, effect.color2].every(hex)) fail();
    if (effect.linked && effect.sizeX !== effect.sizeY) fail();
  }
}

function opticalWarpFactor(effect, along) {
  const distance = along - effect.center;
  const edge = Math.min(1, Math.abs(distance) / (distance < 0 ? effect.center : 1 - effect.center));
  return 1 / (1 + 2 * effect.amount * edge ** 4) - 1;
}

// Inverse sampling stretches the sides while leaving the center at its native
// scale. Coordinates are relative to the layer, including transparent padding.
export function opticalWarpOffset(effect, x, y) {
  const along = effect.axis === 'horizontal' ? x : y;
  const across = effect.axis === 'horizontal' ? y : x;
  const offset = (across - 0.5) * opticalWarpFactor(effect, along);
  return effect.axis === 'horizontal' ? [0, offset] : [offset, 0];
}

// Generated textures depend only on their settings, so scenes rebuilt for
// unrelated edits reuse them. Each entry keeps its decoded image alive.
const textures = new Map();
function cachedTexture(key, create) {
  let texture = textures.get(key);
  if (texture) textures.delete(key);
  else {
    texture = create();
    if (textures.size >= 24) textures.delete(textures.keys().next().value);
  }
  textures.set(key, texture);
  return texture;
}
function decodable(texture) {
  if (!texture.url) {
    texture.url = texture.canvas.toDataURL();
    texture.image = new Image(); texture.image.src = texture.url;
    texture.ready = texture.image.decode();
  }
  return texture;
}

// Large translations belong in feOffset, not an 8-bit displacement channel.
// Small residual ranges avoid layer-sized quantization. The same filter graph
// works on every visual layer, without blurring away the displaced detail.
function opticalWarpMaps(effect, width, height, clipped) {
  return cachedTexture(`warp:${effect.axis}:${effect.amount}:${effect.center}:${width}:${height}:${clipped}`, () => {
    const horizontal = effect.axis === 'horizontal', alongSize = horizontal ? width : height, acrossSize = horizontal ? height : width;
    const offset = (along, across) => (across - acrossSize / 2) * opticalWarpFactor(effect, along / alongSize);
    const tiles = [];
    function split(a, b, w, h) {
      const points = [a, a + w], center = effect.center * alongSize;
      if (a < center && center < a + w) points.push(center);
      const top = points.map(x => offset(x, b)), bottom = points.map(x => offset(x, b + h));
      const base = Math.round(offset(a + w / 2, b + h / 2));
      const range = Math.max(...top.concat(bottom).map(value => Math.abs(value - base)));
      if (range > 31 && (w > 1 || h > 1)) {
        const along = Math.max(Math.max(...top) - Math.min(...top), Math.max(...bottom) - Math.min(...bottom));
        const across = Math.max(...top.map((value, i) => Math.abs(value - bottom[i])));
        if (w > 1 && (along >= across || h <= 1)) {
          const half = Math.floor(w / 2); split(a, b, half, h); split(a + half, b, w - half, h);
        } else {
          const half = Math.floor(h / 2); split(a, b, w, half); split(a, b + half, w, h - half);
        }
        return;
      }
      const scale = Math.max(1, range * 2), canvas = document.createElement('canvas');
      canvas.width = Math.min(horizontal ? w : h, 64); canvas.height = Math.min(horizontal ? h : w, 64);
      const context = canvas.getContext('2d'), pixels = context.createImageData(canvas.width, canvas.height);
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const along = a + (horizontal ? (x + .5) / canvas.width : (y + .5) / canvas.height) * w;
        const across = b + (horizontal ? (y + .5) / canvas.height : (x + .5) / canvas.width) * h;
        const index = (y * canvas.width + x) * 4;
        pixels.data[index] = 128 + Math.round((offset(along, across) - base) / scale * 254);
        pixels.data[index + 1] = 0; pixels.data[index + 2] = 0; pixels.data[index + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      tiles.push({ ...decodable({ canvas }), base, scale, x: horizontal ? a : b, y: horizontal ? b : a, width: horizontal ? w : h, height: horizontal ? h : w });
    }
    split(0, clipped ? 0 : -acrossSize, alongSize, acrossSize * (clipped ? 1 : 3));
    return { tiles, ready: Promise.all(tiles.map(tile => tile.ready)) };
  });
}

function sample(seed, index) {
  let value = (seed | 0) ^ Math.imul(index + 1, 0x9e3779b1);
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return ((value ^ (value >>> 15)) >>> 0) / 4294967296;
}

export const NOISE_TILE = 128;
// One seeded tile per look; animation never regenerates it.
export function noisePixels(effect, side = NOISE_TILE) {
  const pixels = new Uint8ClampedArray(side * side * 4);
  if (!effect.enabled) return pixels;
  const rgb = color => [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
  const first = rgb(effect.color1), second = rgb(effect.color2);
  for (let i = 0; i < side * side; i++) {
    if (sample(effect.seed, i * 5) >= effect.density) continue;
    const tone = sample(effect.seed, i * 5 + 1);
    for (let channel = 0; channel < 3; channel++) pixels[i * 4 + channel] = effect.mode === 'multi' ? sample(effect.seed, i * 5 + channel + 2) * 255 : effect.mode === 'duo' ? first[channel] + (second[channel] - first[channel]) * tone : first[channel];
    pixels[i * 4 + 3] = effect.opacity * (0.2 + tone * 0.8) * 255;
  }
  return pixels;
}

// Animated grain moves the tile to a new whole-cell offset 12 times per
// second. Offsets derive from the seed and the frame index, so reverse seeks
// and export reproduce the preview without regenerating any texture.
export function noiseOffset(effect, time) {
  if (!effect.animated) return [0, 0];
  const frame = Math.floor(Math.max(0, time) * 12 + 1e-8);
  return [0, 1].map(axis => Math.floor(sample(effect.seed, -2 - 2 * frame - axis) * NOISE_TILE));
}

// `repeat` × `repeat` copies of the tile, so an offset crop still holds a whole tile.
function noiseTexture(effect, repeat) {
  return cachedTexture(`noise:${[effect.enabled, effect.mode, effect.density, effect.opacity, effect.color1, effect.color2, effect.seed, repeat]}`, () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = NOISE_TILE * repeat;
    const context = canvas.getContext('2d'), pixels = context.createImageData(NOISE_TILE, NOISE_TILE);
    pixels.data.set(noisePixels(effect));
    for (let y = 0; y < repeat; y++) for (let x = 0; x < repeat; x++) context.putImageData(pixels, x * NOISE_TILE, y * NOISE_TILE);
    return { canvas };
  });
}

export function effectLayer(id, duration) {
  return { id, type: 'effect', name: 'Adjustment', effectScope: 'below', visible: true, start: 0, end: duration, effects: [{ ...DEFAULT_NOISE }], opacity: 1, fadeIn: 0, fadeOut: 0 };
}

// Sizes are in scene units (1080 per short side of the composition), so an
// effect looks the same on every layer and at every export resolution.
const mixWith = (from, to, t) => from + (to - from) * t;
const halftoneCell = size => 1080 / (mixWith(300, 7, size ** 0.7) / 2);
const ditheringCell = size => 1.8 * mixWith(0.5, 20, size);
const glassRib = size => mixWith(8, 160, size);
const waveLength = size => mixWith(40, 400, size);
const svgData = markup => `data:image/svg+xml,${encodeURIComponent(markup)}`;
const rgbHex = color => [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255);
const LUMA = '0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0';
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const SVG_EFFECTS = new Set(['duotone', 'chromatic', 'wave', 'halftone', 'dithering', 'fluted-glass']);

// Two sine periods stacked vertically: R carries the horizontal displacement.
function waveMap() {
  return decodable(cachedTexture('wave', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 512;
    const context = canvas.getContext('2d'), pixels = context.createImageData(1, 512);
    for (let y = 0; y < 512; y++) pixels.data.set([Math.round(127.5 + 127.5 * Math.sin(y / 256 * Math.PI * 2)), 128, 0, 255], y * 4);
    context.putImageData(pixels, 0, 0);
    return { canvas };
  }));
}
// A 4 × 4 ordered-dither threshold tile, `cell` pixels per entry.
function bayerMap(cell) {
  return decodable(cachedTexture(`bayer:${cell}`, () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = cell * 4;
    const context = canvas.getContext('2d');
    BAYER.forEach((value, index) => { const v = Math.round((value + 0.5) / 16 * 255); context.fillStyle = `rgb(${v},${v},${v})`; context.fillRect(index % 4 * cell, Math.floor(index / 4) * cell, cell, cell); });
    return { canvas };
  }));
}

// Builds the SVG filter for duotone, chromatic split, liquid wave, halftone,
// dithering and fluted glass. Every filter ends by mixing its result with the
// untouched input by `amount`, so the layer's alpha is preserved. `update`
// applies animated values and the adjustment strength for one frame.
function svgEffect(element, effect, id, unit, imagesReady) {
  const filter = element('filter', { id, x: 0, y: 0, width: '100%', height: '100%', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' });
  const add = (tag, attributes = {}, children = []) => {
    const node = element(tag, attributes); node.append(...children); filter.append(node);
    // Export captures wait until generated SVG tiles are decoded.
    if (tag === 'feImage' && attributes.href.startsWith('data:image/svg')) { const decoded = new Image(); decoded.src = attributes.href; imagesReady.push(decoded.decode()); }
    return node;
  };
  const funcs = (type, values) => ['R', 'G', 'B'].map((channel, i) => element(`feFunc${channel}`, { type, ...values(i) }));
  // Pixelates `input` into cells: one sample per cell, spread over the cell.
  const pixelate = (cell, input, result) => {
    const sample = Math.max(1, Math.min(6, Math.round(cell * 0.2)));
    const tile = svgData(`<svg xmlns="http://www.w3.org/2000/svg" width="${cell}" height="${cell}"><rect x="${(cell - sample) / 2}" y="${(cell - sample) / 2}" width="${sample}" height="${sample}" fill="#fff" shape-rendering="crispEdges"/></svg>`);
    add('feImage', { href: tile, x: 0, y: 0, width: cell, height: cell, preserveAspectRatio: 'none', result: `${result}Tile` });
    add('feTile', { in: `${result}Tile`, result: `${result}Grid` });
    add('feComposite', { in: input, in2: `${result}Grid`, operator: 'in', result: `${result}Samples` });
    add('feMorphology', { in: `${result}Samples`, operator: 'dilate', radius: Math.max(0, Math.floor((cell - 1) / 2)), result });
  };
  const finish = input => add('feComposite', { in: input, in2: 'SourceGraphic', operator: 'arithmetic', k1: 0, k2: 1, k3: 0, k4: 0 });
  let mix, update = () => {};
  if (effect.type === 'duotone') {
    const [shadow, highlight] = [rgbHex(effect.shadow), rgbHex(effect.highlight)];
    add('feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: `${LUMA} 0 0 0 1 0`, result: 'luma' });
    add('feComponentTransfer', { in: 'luma', result: 'duo' }, funcs('table', i => ({ tableValues: `${shadow[i]} ${highlight[i]}` })));
    mix = finish('duo');
  } else if (effect.type === 'chromatic') {
    // Keeps one color channel and the alpha.
    const channel = (row, result) => add('feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: [0, 1, 2].map(r => [0, 1, 2, 3, 4].map(c => +(r === row && c === row)).join(' ')).join(' ') + ' 0 0 0 1 0', result });
    channel(0, 'red'); channel(1, 'green'); channel(2, 'blue');
    const red = add('feOffset', { in: 'red', dx: 0, dy: 0, result: 'redShift' });
    const blue = add('feOffset', { in: 'blue', dx: 0, dy: 0, result: 'blueShift' });
    add('feBlend', { in: 'redShift', in2: 'green', mode: 'screen', result: 'redGreen' });
    add('feBlend', { in: 'redGreen', in2: 'blueShift', mode: 'screen', result: 'split' });
    update = (value, strength, time) => {
      const shift = value.amount * strength * 12 * unit * (effect.animated ? 0.5 + 0.5 * Math.sin(Math.max(0, time) * 1.4) : 1);
      red.setAttribute('dx', shift); blue.setAttribute('dx', -shift);
    };
  } else if (effect.type === 'wave') {
    const length = waveLength(effect.size) * unit, map = waveMap();
    imagesReady.push(map.ready);
    add('feImage', { href: map.url, x: 0, y: 0, width: 1, height: length * 2, preserveAspectRatio: 'none', result: 'periods' });
    // The tile window slides down the two stacked periods, so it is always full.
    const window = add('feOffset', { in: 'periods', dx: 0, dy: 0, x: 0, y: 0, width: 1, height: length, result: 'period' });
    add('feTile', { in: 'period', result: 'waveMap' });
    const displacement = add('feDisplacementMap', { in: 'SourceGraphic', in2: 'waveMap', scale: 0, xChannelSelector: 'R', yChannelSelector: 'G', result: 'waved' });
    update = (value, strength, time) => {
      window.setAttribute('dy', -((Math.max(0, time) * effect.speed / Math.PI) % 1) * length);
      displacement.setAttribute('scale', value.amount * strength * 48 * unit);
    };
  } else if (effect.type === 'halftone') {
    // Dots keep each cell's color and grow with its brightness over dark gaps,
    // inside the layer's silhouette.
    const cell = halftoneCell(effect.size) * unit, reach = 0.406 * cell, edge = 0.4 / Math.max(reach, 0.5);
    pixelate(cell, 'SourceGraphic', 'cells');
    add('feColorMatrix', { in: 'cells', type: 'matrix', values: `${LUMA} 0 0 0 1 0`, result: 'cellLuma' });
    add('feFlood', { 'flood-color': '#000000', result: 'black' });
    add('feComposite', { in: 'cellLuma', in2: 'black', operator: 'over', result: 'brightness' });
    const field = svgData(`<svg xmlns="http://www.w3.org/2000/svg" width="${cell}" height="${cell}"><defs><radialGradient id="g" cx="${cell / 2}" cy="${cell / 2}" r="${reach * 1.25}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient></defs><rect width="${cell}" height="${cell}" fill="url(#g)"/></svg>`);
    add('feImage', { href: field, x: 0, y: 0, width: cell, height: cell, preserveAspectRatio: 'none', result: 'fieldTile' });
    add('feTile', { in: 'fieldTile', result: 'field' });
    // 1 + (field - 0.2 - 0.8 × (1 - brightness)) / 2 saturates inside the dot.
    add('feComposite', { in: 'field', in2: 'brightness', operator: 'arithmetic', k1: 0, k2: 0.5, k3: 0.4, k4: 0.5, result: 'coverage' });
    add('feComponentTransfer', { in: 'coverage', result: 'dotMask' }, [element('feFuncR', { type: 'linear', slope: 1 / edge, intercept: 1 - 1 / edge })]);
    add('feColorMatrix', { in: 'dotMask', type: 'matrix', values: '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0', result: 'dotAlpha' });
    add('feComposite', { in: 'cells', in2: 'dotAlpha', operator: 'in', result: 'dots' });
    add('feFlood', { 'flood-color': '#060606', result: 'gap' });
    add('feComposite', { in: 'dots', in2: 'gap', operator: 'over', result: 'screen' });
    add('feComposite', { in: 'screen', in2: 'SourceAlpha', operator: 'in', result: 'halftone' });
    mix = finish('halftone');
  } else if (effect.type === 'dithering') {
    // Ordered dithering of each channel to `steps` levels on pixelated cells.
    const cell = Math.max(1, 2 * Math.round((ditheringCell(effect.size) * unit - 1) / 2) + 1), map = bayerMap(cell), steps = effect.steps;
    imagesReady.push(map.ready);
    if (cell > 1) pixelate(cell, 'SourceGraphic', 'cells');
    add('feImage', { href: map.url, x: 0, y: 0, width: cell * 4, height: cell * 4, preserveAspectRatio: 'none', result: 'bayerTile' });
    add('feTile', { in: 'bayerTile', result: 'bayer' });
    add('feComposite', { in: cell > 1 ? 'cells' : 'SourceGraphic', in2: 'bayer', operator: 'arithmetic', k1: 0, k2: 1, k3: 1 / steps, k4: -0.5 / steps, result: 'jittered' });
    // floor(v × steps + 0.5) / steps, as a discrete table of steps + 1 levels.
    add('feComponentTransfer', { in: 'jittered', result: 'centered' }, funcs('linear', () => ({ slope: steps / (steps + 1), intercept: 0.5 / (steps + 1) })));
    add('feComponentTransfer', { in: 'centered', result: 'levels' }, funcs('discrete', () => ({ tableValues: Array.from({ length: steps + 1 }, (_, i) => i / steps).join(' ') })));
    add('feComposite', { in: 'levels', in2: 'SourceAlpha', operator: 'in', result: 'dithered' });
    mix = finish('dithered');
  } else {
    // Fluted glass: each rib shows a compressed, slightly shaded slice.
    const rib = glassRib(effect.size) * unit;
    const ramp = svgData(`<svg xmlns="http://www.w3.org/2000/svg" width="${rib}" height="1"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#ff8000"/><stop offset="1" stop-color="#008000"/></linearGradient></defs><rect width="${rib}" height="1" fill="url(#g)"/></svg>`);
    add('feImage', { href: ramp, x: 0, y: 0, width: rib, height: 1, preserveAspectRatio: 'none', result: 'rampTile' });
    add('feTile', { in: 'rampTile', result: 'ramp' });
    const displacement = add('feDisplacementMap', { in: 'SourceGraphic', in2: 'ramp', scale: 0, xChannelSelector: 'R', yChannelSelector: 'G', result: 'fluted' });
    add('feGaussianBlur', { in: 'fluted', stdDeviation: 0.35, result: 'smooth' });
    add('feColorMatrix', { in: 'ramp', type: 'matrix', values: '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 1 0', result: 'shade' });
    const shading = add('feComposite', { in: 'smooth', in2: 'shade', operator: 'arithmetic', k1: 0, k2: 1, k3: 0, k4: 0, result: 'shaded' });
    add('feComposite', { in: 'shaded', in2: 'smooth', operator: 'in' });
    update = (value, strength) => {
      const amount = value.amount * strength;
      displacement.setAttribute('scale', rib * effect.distortion * 0.8 * amount);
      shading.setAttribute('k3', 0.1 * amount); shading.setAttribute('k4', -0.05 * amount);
    };
  }
  // Color effects cross-fade with their input by amount; displacements scale
  // their own strength instead, which avoids a double image.
  return {
    filter,
    update(value, strength, time) {
      const amount = value.amount * strength;
      if (mix) { mix.setAttribute('k2', amount); mix.setAttribute('k3', 1 - amount); }
      update(value, strength, time);
    }
  };
}

let nextScene = 0;
export function createEffects(root, project, formats, layerAlpha) {
  const ns = 'http://www.w3.org/2000/svg';
  const element = (tag, attributes = {}) => {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  };
  const svg = element('svg', { width: 0, height: 0, 'aria-hidden': 'true' });
  svg.style.cssText = 'position:absolute;pointer-events:none';
  const defs = element('defs'); svg.append(defs); root.prepend(svg);
  const sceneId = nextScene++;
  const entries = [];
  const targets = [];
  const imagesReady = [];
  const wrappers = [];
  let layers = project.layers;
  const current = id => layers.find(layer => layer.id === id);
  const nodesFor = layer => [...root.querySelectorAll('[data-floc-layer]')].filter(node => node.dataset.flocLayer === layer.id && !node.hasAttribute('data-floc-background-content'));
  const wrap = (nodes, index) => {
    const group = document.createElement('div');
    group.style.cssText = `position:absolute;inset:0;z-index:${index}`;
    nodes[0].before(group); group.append(...nodes); wrappers.push(group);
    return group;
  };
  // Each adjustment owns the composition below its position, including earlier
  // adjustments. Later layers remain outside, even while the adjustment is off.
  let below = [];
  const adjustmentTargets = new Map();
  project.layers.forEach((layer, index) => {
    const nodes = nodesFor(layer);
    if (layer.type === 'effect' && layer.effectScope === 'below') {
      nodes.forEach(node => { node.style.display = 'none'; });
      if (below.length) {
        const group = wrap(below, index);
        group.dataset.flocAdjustment = layer.id;
        adjustmentTargets.set(layer.id, [group]); below = [group];
      }
    } else if (layer.type !== 'music') below.push(...nodes);
  });
  const [width, height] = formats[project.format], unit = Math.min(width, height) / 1080;
  const drawn = new Map();
  project.layers.forEach((layer, layerIndex) => {
    const overlay = layer.type === 'effect' && layer.effectScope !== 'below';
    let nodes = adjustmentTargets.get(layer.id) ?? (layer.type === 'effect' ? [] : nodesFor(layer));
    if (nodes.length > 1 && layer.effects?.length) nodes = [wrap(nodes, layerIndex)];
    const filters = [];
    // Animated noise bakes full-strength grain once and fades it per frame.
    const fadingNoise = animatedFields(layer).includes('noiseOpacity') ? layer.effects?.findIndex(effect => effect.type === 'noise') ?? -1 : -1;
    (layer.effects ?? []).forEach((effect, index) => {
      const fades = index === fadingNoise;
      const look = fades ? { ...effect, opacity: 1 } : effect;
      if (effect.type === 'optical-warp') {
        const id = `floc-warp-${sceneId}-${layerIndex}-${index}`;
        const horizontal = effect.axis === 'horizontal';
        const bounds = { x: horizontal ? 0 : -1, y: horizontal ? -1 : 0, width: horizontal ? 1 : 3, height: horizontal ? 3 : 1 };
        const filter = element('filter', { id, ...bounds, filterUnits: 'objectBoundingBox', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' });
        defs.append(filter);
        const pointwise = effect => !effect.enabled || ['monochrome', 'duotone'].includes(effect.type);
        const pointwiseTail = (layer.effects ?? []).slice(index + 1).every(pointwise) && project.layers.slice(layerIndex + 1).every(layer => layer.type !== 'effect' || layer.effectScope !== 'below' || layer.effects.every(pointwise));
        filters.push({ effect, index, url: `url(#${id})`, filterNode: filter, patches: [], pointwiseTail });
        return;
      }
      if (SVG_EFFECTS.has(effect.type)) {
        const id = `floc-${effect.type}-${sceneId}-${layerIndex}-${index}`;
        const built = svgEffect(element, effect, id, unit, imagesReady);
        defs.append(built.filter);
        filters.push({ effect, index, url: `url(#${id})`, update: built.update });
        return;
      }
      if (effect.type === 'blur' && effect.mode === 'progressive') {
        const id = `floc-blur-${sceneId}-${layerIndex}-${index}`;
        const filter = element('filter', { id, x: 0, y: 0, width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' });
        const directions = { bottom: [0, 0, 0, 1], top: [0, 1, 0, 0], right: [0, 0, 1, 0], left: [1, 0, 0, 0] };
        const [x1, y1, x2, y2] = directions[effect.direction];
        const blurs = [];
        // Interpolate five increasing blur radii. The masks partition unity,
        // so the progression preserves color/alpha instead of ghosting a sharp
        // copy over a single fully blurred copy.
        for (let level = 0; level <= 4; level++) {
          const stops = Array.from({ length: 5 }, (_, stop) => `<stop offset="${stop / 4}" stop-color="white" stop-opacity="${stop === level ? 1 : 0}"/>`).join('');
          const source = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="${ns}" width="128" height="128"><defs><linearGradient id="g" x1="${x1 * 100}%" y1="${y1 * 100}%" x2="${x2 * 100}%" y2="${y2 * 100}%">${stops}</linearGradient></defs><rect width="128" height="128" fill="url(#g)"/></svg>`);
          filter.append(element('feImage', { href: source, x: 0, y: 0, width: '100%', height: '100%', preserveAspectRatio: 'none', result: `mask${level}` }));
          const decoded = new Image(); decoded.src = source; imagesReady.push(decoded.decode());
          let input = 'SourceGraphic';
          if (level) {
            const blur = element('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: 0, result: `blur${level}` });
            filter.append(blur); blurs.push({ blur, level }); input = `blur${level}`;
          }
          filter.append(element('feComposite', { in: input, in2: `mask${level}`, operator: 'in', result: level ? `part${level}` : 'mix0' }));
          if (level) filter.append(element('feComposite', { in: `mix${level - 1}`, in2: `part${level}`, operator: 'arithmetic', k2: 1, k3: 1, result: `mix${level}` }));
        }
        defs.append(filter); filters.push({ effect, index, url: `url(#${id})`, blurs });
        return;
      }
      if (effect.type !== 'noise') {
        filters.push({ effect, index });
        return;
      }
      const id = `floc-noise-${sceneId}-${layerIndex}-${index}`;
      const cell = [effect.sizeX * unit, effect.sizeY * unit];
      let alpha, image;
      if (!overlay) {
        // Animated noise slides a 2 × 2 copy of the tile under a fixed
        // one-tile crop: offset tiles must not leave the filter region, which
        // clips them on layers smaller than the tile.
        const repeat = effect.animated ? 2 : 1, texture = decodable(noiseTexture(look, repeat));
        imagesReady.push(texture.ready);
        const filter = element('filter', { id, x: 0, y: 0, width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' });
        image = element('feImage', { href: texture.url, x: 0, y: 0, width: NOISE_TILE * repeat * cell[0], height: NOISE_TILE * repeat * cell[1], preserveAspectRatio: 'none', result: effect.animated ? 'atlas' : 'noise' });
        const transfer = element('feComponentTransfer', { in: 'texture', result: 'fadedTexture' });
        alpha = element('feFuncA', { type: 'linear', slope: 1 }); transfer.append(alpha);
        filter.append(image);
        if (effect.animated) filter.append(element('feOffset', { in: 'atlas', x: 0, y: 0, width: NOISE_TILE * cell[0], height: NOISE_TILE * cell[1], result: 'noise' }));
        filter.append(element('feTile', { in: 'noise', result: 'texture' }), transfer, element('feComposite', { in: 'fadedTexture', in2: 'SourceGraphic', operator: 'atop' }));
        defs.append(filter); filters.push({ effect, index, url: `url(#${id})`, alpha, fades });
      }
      entries.push({ layer, effect, index, fades, image, cell, offset: [0, 0], key: '0:0', tile: overlay && noiseTexture(look, 1).canvas });
    });
    if (nodes.length && filters.length) targets.push({ id: layer.id, adjustment: layer.type === 'effect', nodes, filters });
  });
  async function seek(time) {
    const pending = [];
    for (const target of targets) {
      const layer = current(target.id);
      const strength = target.adjustment ? layerAlpha(layer, time) : 1;
      const live = evaluateChoreography(layer, time).effects ?? [];
      const filters = target.filters.flatMap(filter => {
        const { effect, index, url, alpha, blurs, fades, update } = filter;
        const value = live[index] ?? effect;
        if (!effect.enabled || strength <= 0) return [];
        if (effect.type === 'optical-warp') {
          const amount = value.amount;
          if (!amount) return [];
          const node = target.nodes[0];
          const width = Number(node.dataset.flocFilterWidth) || node.offsetWidth, height = Number(node.dataset.flocFilterHeight) || node.offsetHeight;
          if (!width || !height) return [];
          const horizontal = effect.axis === 'horizontal';
          // A final full-stage lens cannot expose its off-stage padding. Keep
          // padding for smaller/transformed layers and later spatial filters.
          const clipped = filter.pointwiseTail && (node.dataset.flocFilterFullFrame === 'true' || width === root.offsetWidth && height === root.offsetHeight && node.offsetLeft === 0 && node.offsetTop === 0 && (!node.style.transform || node.style.transform === 'none'));
          const geometry = `${width}:${height}:${amount}:${clipped}`;
          if (filter.geometry !== geometry) {
            const map = opticalWarpMaps({ ...effect, amount }, width, height, clipped);
            const bounds = { x: !clipped && !horizontal ? -1 : 0, y: !clipped && horizontal ? -1 : 0, width: !clipped && !horizontal ? 3 : 1, height: !clipped && horizontal ? 3 : 1 };
            for (const [key, value] of Object.entries(bounds)) filter.filterNode.setAttribute(key, value);
            pending.push(map.ready);
            for (const child of [...filter.filterNode.childNodes]) child.remove();
            // Materialize one unchanged RGBA source before translated views.
            // Direct WebGL-backed SourceGraphic branches corrupt large GPU tiles.
            filter.filterNode.append(element('feConvolveMatrix', { in: 'SourceGraphic', order: 3, kernelMatrix: '0 0 0 0 1 0 0 0 0', preserveAlpha: true, edgeMode: 'none', result: 'warpSource' }));
            const merge = element('feMerge');
            // Alpha 254 makes neutral RGB exactly 127/254 after premultiplying.
            // This prevents rounding/dithering from moving the untouched axis.
            const varying = `${255 / 254} 0 0 0 ${.5 - 128 / 254}`, neutral = '0 0 0 0 .5';
            const matrix = `${horizontal ? neutral : varying} ${horizontal ? varying : neutral} 0 0 0 0 0 0 0 0 0 ${254 / 255}`;
            filter.patches = map.tiles.map((tile, i) => {
              const { x, y, width, height, scale } = tile, bounds = { x, y, width, height }, padding = Math.ceil(scale / 2) + 2;
              const image = element('feImage', { href: tile.url, ...bounds, preserveAspectRatio: 'none', result: `raw${i}` });
              const channels = element('feColorMatrix', { in: `raw${i}`, ...bounds, values: matrix, result: `map${i}` });
              const source = element('feOffset', { in: 'warpSource', x: x - padding, y: y - padding, width: width + padding * 2, height: height + padding * 2, result: `source${i}` });
              const displacement = element('feDisplacementMap', { in: `source${i}`, in2: `map${i}`, ...bounds, xChannelSelector: 'R', yChannelSelector: 'G', result: `tile${i}` });
              filter.filterNode.append(image, channels, source, displacement);
              merge.append(element('feMergeNode', { in: `tile${i}` }));
              return { tile, source, displacement };
            });
            filter.filterNode.append(merge);
            filter.geometry = geometry; filter.strength = undefined;
          }
          if (filter.strength !== strength) {
            for (const { tile, source, displacement } of filter.patches) {
              displacement.setAttribute('scale', tile.scale * strength);
              source.setAttribute('dx', horizontal ? 0 : -tile.base * strength);
              source.setAttribute('dy', horizontal ? -tile.base * strength : 0);
            }
            filter.strength = strength;
          }
          return [url];
        }
        if (update) {
          if (!(value.amount * strength)) return [];
          update(value, strength, time - layer.start);
          return [url];
        }
        if (effect.type === 'blur') {
          const radius = value.amount * strength * unit;
          if (!radius) return [];
          if (!blurs) return [`blur(${radius}px)`];
          blurs.forEach(({ blur, level }) => blur.setAttribute('stdDeviation', radius * level / 4));
          return [url];
        }
        if (effect.type === 'monochrome') return [`grayscale(${value.amount * strength})`];
        alpha.setAttribute('slope', fades ? strength * value.opacity : strength); return [url];
      }).join(' ');
      target.nodes.forEach(node => { if (node.style.filter !== filters) node.style.filter = filters; });
    }
    for (const entry of entries) {
      const offset = noiseOffset(entry.effect, time - entry.layer.start), key = offset.join(':');
      if (entry.key === key) continue;
      entry.key = key; entry.offset = offset;
      if (entry.image) { entry.image.setAttribute('x', -offset[0] * entry.cell[0]); entry.image.setAttribute('y', -offset[1] * entry.cell[1]); }
    }
    for (const layer of layers.filter(layer => layer.type === 'effect' && layer.effectScope !== 'below')) {
      const canvas = root.querySelector(`[data-floc-layer="${CSS.escape(layer.id)}"]`);
      const context = canvas?.getContext('2d');
      if (!context) continue;
      const layerEntries = entries.filter(entry => entry.layer.id === layer.id);
      const live = evaluateChoreography(layer, time).effects ?? [];
      const opacity = entry => entry.fades ? live[entry.index].opacity : 1;
      const key = `${canvas.width}:${canvas.height}:${layerEntries.map(entry => `${entry.key}:${opacity(entry)}`).join(':')}`;
      if (drawn.get(layer.id) === key) continue;
      drawn.set(layer.id, key);
      context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, canvas.width, canvas.height);
      for (const entry of layerEntries) {
        const { effect, tile, offset } = entry;
        const unit = Math.min(canvas.width, canvas.height) / 1080;
        context.save(); context.globalAlpha = opacity(entry); context.scale(effect.sizeX * unit, effect.sizeY * unit); context.translate(-offset[0], -offset[1]);
        context.imageSmoothingEnabled = false; context.fillStyle = context.createPattern(tile, 'repeat');
        context.fillRect(offset[0], offset[1], canvas.width / (effect.sizeX * unit), canvas.height / (effect.sizeY * unit)); context.restore();
      }
    }
    await Promise.all([...imagesReady, ...pending]);
  }
  return {
    seek,
    updateLayers(next) { layers = next; },
    dispose() {
      targets.forEach(target => target.nodes.forEach(node => { node.style.filter = ''; }));
      for (const wrapper of wrappers.reverse()) wrapper.replaceWith(...wrapper.childNodes);
      svg.remove();
    },
  };
}
