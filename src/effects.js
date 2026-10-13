import { animatedFields, evaluateChoreography } from './choreography.js';
export const EFFECTS = [{ id: 'noise', name: 'Noise' }, { id: 'blur', name: 'Blur' }, { id: 'monochrome', name: 'Monochrome' }, { id: 'optical-warp', name: 'Optical Warp' }];
export const EFFECT_LAYER_TYPES = ['background', 'text', 'logo', 'media', 'model', 'carousel', 'effect'];
export const DEFAULT_NOISE = Object.freeze({ type: 'noise', enabled: true, mode: 'mono', sizeX: 1, sizeY: 1, linked: true, density: 1, opacity: 0.15, color1: '#000000', color2: '#ffffff', animated: false, seed: 42 });

export const DEFAULT_FILTERS = Object.freeze({
  blur: Object.freeze({ type: 'blur', enabled: true, amount: 8, mode: 'uniform', direction: 'bottom' }),
  monochrome: Object.freeze({ type: 'monochrome', enabled: true, amount: 1 }),
  'optical-warp': Object.freeze({ type: 'optical-warp', enabled: true, amount: 0.5, axis: 'horizontal', center: 0.5 }),
});

export function newEffect(type, index = 0) {
  if (type === 'noise') return { ...DEFAULT_NOISE, seed: (42 + index * 997) % 65536 };
  if (Object.hasOwn(DEFAULT_FILTERS, type)) return { ...DEFAULT_FILTERS[type] };
  throw new Error('Unknown effect.');
}

export function validateEffects(effects) {
  const fail = () => { throw new Error('Invalid noise effect settings.'); };
  if (!Array.isArray(effects) || effects.length > 8) fail();
  for (const effect of effects) {
    if (!effect || typeof effect !== 'object' || Array.isArray(effect)) fail();
    if (Object.hasOwn(DEFAULT_FILTERS, effect.type)) {
      const defaults = DEFAULT_FILTERS[effect.type];
      if (Object.keys(effect).some(key => !Object.hasOwn(defaults, key))) throw new Error('Invalid effect settings.');
      for (const [key, value] of Object.entries(defaults)) if (effect[key] === undefined) effect[key] = value;
      if (typeof effect.enabled !== 'boolean' || typeof effect.amount !== 'number' || !Number.isFinite(effect.amount) || effect.amount < 0 || effect.amount > (effect.type === 'blur' ? 48 : 1)) throw new Error('Invalid effect settings.');
      if (effect.type === 'blur' && (!['uniform', 'progressive'].includes(effect.mode) || !['top', 'bottom', 'left', 'right'].includes(effect.direction))) throw new Error('Invalid blur settings.');
      if (effect.type === 'optical-warp' && (!['horizontal', 'vertical'].includes(effect.axis) || typeof effect.center !== 'number' || !Number.isFinite(effect.center) || effect.center < 0.1 || effect.center > 0.9)) throw new Error('Invalid optical warp settings.');
      continue;
    }
    if (Object.keys(effect).some(key => !Object.hasOwn(DEFAULT_NOISE, key))) fail();
    for (const [key, value] of Object.entries(DEFAULT_NOISE)) if (effect[key] === undefined) effect[key] = value;
    if (effect.type !== 'noise' || !['mono', 'duo', 'multi'].includes(effect.mode)) fail();
    if (!['enabled', 'linked', 'animated'].every(key => typeof effect[key] === 'boolean')) fail();
    for (const [key, min, max] of [['sizeX', 0.5, 32], ['sizeY', 0.5, 32], ['density', 0, 1], ['opacity', 0, 1], ['seed', 0, 65535]]) {
      if (typeof effect[key] !== 'number' || !Number.isFinite(effect[key]) || effect[key] < min || effect[key] > max) fail();
    }
    if (!Number.isInteger(effect.seed) || ![effect.color1, effect.color2].every(color => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))) fail();
    if (effect.linked && effect.sizeX !== effect.sizeY) fail();
  }
}

// Inverse sampling stretches the sides while leaving the center at its native
// scale. Coordinates are relative to the layer, including transparent padding.
export function opticalWarpOffset(effect, x, y) {
  const along = effect.axis === 'horizontal' ? x : y;
  const across = effect.axis === 'horizontal' ? y : x;
  const distance = along - effect.center;
  const edge = Math.min(1, Math.abs(distance) / (distance < 0 ? effect.center : 1 - effect.center));
  const stretch = 1 + 2 * effect.amount * edge ** 4;
  const offset = (across - 0.5) * (1 / stretch - 1);
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

// Displacement range of a warp map, as a multiple of the layer's across size.
// Padded coordinates reach one layer beyond each side, at most 1.5 layers from
// the center line, and move by up to 1.5 × (1 - 1 / (1 + 2 × amount)) either
// way; 127 channel steps on each side of the neutral 128 cover that exactly.
//
// Precision limit: one 8-bit step displaces by range / 255 of the layer, e.g.
// about 0.8 % (3 px on a 400 px layer) at amount 1 and 0.6 % at 0.5. Edges
// curving across the stretch therefore still move in small steps on large
// layers; the 0.35 px blur below only softens them. Carousels warp in float
// shader math instead (src/carousel-effects.js).
export const opticalWarpMapScale = amount => 1.5 * (1 - 1 / (1 + 2 * amount)) * 255 / 127;
function opticalWarpMap(effect) {
  const scale = opticalWarpMapScale(effect.amount);
  return decodable(cachedTexture(`warp:${effect.axis}:${effect.amount}:${effect.center}:${scale}`, () => {
    const horizontal = effect.axis === 'horizontal';
    const canvas = document.createElement('canvas');
    canvas.width = horizontal ? 256 : 768;
    canvas.height = horizontal ? 768 : 256;
    const context = canvas.getContext('2d');
    const pixels = context.createImageData(canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const [dx, dy] = opticalWarpOffset(effect, horizontal ? x / (canvas.width - 1) : -1 + 3 * x / (canvas.width - 1), horizontal ? -1 + 3 * y / (canvas.height - 1) : y / (canvas.height - 1));
      const index = (y * canvas.width + x) * 4;
      pixels.data[index] = 128 + Math.round(dx / scale * 255);
      pixels.data[index + 1] = 128 + Math.round(dy / scale * 255);
      pixels.data[index + 2] = 0; pixels.data[index + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    return { canvas };
  }));
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
        // Carousels warp their own WebGL output exactly (src/carousel-effects.js),
        // before the CSS effects on their canvas.
        if (layer.type === 'carousel') return;
        const id = `floc-warp-${sceneId}-${layerIndex}-${index}`;
        const horizontal = effect.axis === 'horizontal';
        const bounds = { x: horizontal ? 0 : -1, y: horizontal ? -1 : 0, width: horizontal ? 1 : 3, height: horizontal ? 3 : 1 };
        const filter = element('filter', { id, ...bounds, filterUnits: 'objectBoundingBox', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' });
        const map = opticalWarpMap(effect);
        const image = element('feImage', { href: map.url, preserveAspectRatio: 'none', result: 'warpMap' });
        // PNG channels use 128 as neutral. Correct it to exactly 0.5 to avoid
        // translating the untouched axis or the center of the layer. Offset
        // the source rather than rounding the map again in a color transfer.
        const sourceOffset = element('feOffset', { in: 'SourceGraphic', result: 'centeredSource' });
        const displacement = element('feDisplacementMap', { in: 'centeredSource', in2: 'warpMap', xChannelSelector: 'R', yChannelSelector: 'G' });
        // Antialias the displacement's pixel sampling at curved edges.
        filter.append(image, sourceOffset, displacement, element('feGaussianBlur', { stdDeviation: 0.35 })); defs.append(filter);
        imagesReady.push(map.ready);
        filters.push({ effect, index, url: `url(#${id})`, displacement, image, sourceOffset, amount: effect.amount });
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
        const { effect, index, url, alpha, blurs, displacement, image, sourceOffset, fades } = filter;
        const value = live[index] ?? effect;
        if (!effect.enabled || strength <= 0) return [];
        if (effect.type === 'optical-warp') {
          // Animated amounts reuse cached maps in hundredths.
          const amount = value.amount === effect.amount ? effect.amount : Math.round(value.amount * 100) / 100;
          if (!amount) return [];
          const width = target.nodes[0].offsetWidth, height = target.nodes[0].offsetHeight;
          if (!width || !height) return [];
          if (filter.amount !== amount) {
            const map = opticalWarpMap({ ...effect, amount });
            image.setAttribute('href', map.url);
            pending.push(map.ready);
            filter.amount = amount;
          }
          const key = `${width}:${height}:${strength}:${amount}`;
          if (filter.key !== key) {
            const horizontal = effect.axis === 'horizontal';
            const bounds = { x: horizontal ? 0 : -width, y: horizontal ? -height : 0, width: horizontal ? width : width * 3, height: horizontal ? height * 3 : height };
            for (const node of [image, sourceOffset, displacement]) for (const [key, value] of Object.entries(bounds)) node.setAttribute(key, value);
            const scale = opticalWarpMapScale(amount) * (horizontal ? height : width) * strength;
            displacement.setAttribute('scale', scale);
            sourceOffset.setAttribute('dx', scale * 0.5 / 255);
            sourceOffset.setAttribute('dy', scale * 0.5 / 255);
            filter.key = key;
          }
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
