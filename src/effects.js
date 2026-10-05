export const EFFECTS = [{ id: 'noise', name: 'Noise' }];
export const EFFECT_LAYER_TYPES = ['background', 'text', 'logo', 'media', 'model', 'carousel', 'effect'];
export const DEFAULT_NOISE = Object.freeze({ type: 'noise', enabled: true, mode: 'mono', sizeX: 1, sizeY: 1, linked: true, density: 1, opacity: 0.15, color1: '#000000', color2: '#ffffff', animated: false, seed: 42 });

export function validateEffects(effects) {
  const fail = () => { throw new Error('Invalid noise effect settings.'); };
  if (!Array.isArray(effects) || effects.length > 8) fail();
  for (const effect of effects) {
    if (!effect || typeof effect !== 'object' || Array.isArray(effect) || Object.keys(effect).some(key => !Object.hasOwn(DEFAULT_NOISE, key))) fail();
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

function sample(seed, index) {
  let value = (seed | 0) ^ Math.imul(index + 1, 0x9e3779b1);
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return ((value ^ (value >>> 15)) >>> 0) / 4294967296;
}

// A supplied time and seed reproduce the same texture on reverse seeks and export.
export function noisePixels(effect, time, side = 128) {
  const pixels = new Uint8ClampedArray(side * side * 4);
  if (!effect.enabled) return pixels;
  const seed = effect.seed ^ (effect.animated ? Math.floor(Math.max(0, time) * 12 + 1e-8) : 0);
  const rgb = color => [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
  const first = rgb(effect.color1), second = rgb(effect.color2);
  for (let i = 0; i < side * side; i++) {
    if (sample(seed, i * 5) >= effect.density) continue;
    const tone = sample(seed, i * 5 + 1);
    for (let channel = 0; channel < 3; channel++) pixels[i * 4 + channel] = effect.mode === 'multi' ? sample(seed, i * 5 + channel + 2) * 255 : effect.mode === 'duo' ? first[channel] + (second[channel] - first[channel]) * tone : first[channel];
    pixels[i * 4 + 3] = effect.opacity * (0.2 + tone * 0.8) * 255;
  }
  return pixels;
}

export function effectLayer(id, duration) {
  return { id, type: 'effect', name: 'Noise', visible: true, start: 0, end: duration, effects: [{ ...DEFAULT_NOISE }], opacity: 1, fadeIn: 0, fadeOut: 0 };
}

let nextScene = 0;
export function createNoiseEffects(root, project, formats) {
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
  const drawn = new Map();
  project.layers.forEach((layer, layerIndex) => {
    const nodes = [...root.querySelectorAll('[data-floc-layer]')].filter(node => node.dataset.flocLayer === layer.id);
    const ids = [];
    (layer.effects ?? []).forEach((effect, index) => {
      const id = `floc-noise-${sceneId}-${layerIndex}-${index}`;
      const image = element('feImage', { x: 0, y: 0, preserveAspectRatio: 'none', result: 'noise' });
      if (layer.type !== 'effect') {
        const filter = element('filter', { id, x: 0, y: 0, width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' });
        filter.append(image, element('feTile', { in: 'noise', result: 'texture' }), element('feComposite', { in: 'texture', in2: 'SourceGraphic', operator: 'atop' }));
        defs.append(filter); ids.push(`url(#${id})`);
      }
      entries.push({ layer, effect, image, nodes, key: null, tile: document.createElement('canvas') });
    });
    if (ids.length) {
      // Image/video backgrounds include a color fill. Filter their combined
      // output once so translucent media does not receive the noise twice.
      let targets = nodes;
      if (nodes.length > 1) {
        const group = document.createElement('div');
        group.style.cssText = `position:absolute;inset:0;z-index:${layerIndex}`;
        nodes[0].before(group); group.append(...nodes); targets = [group];
      }
      targets.forEach(node => { node.style.filter = ids.join(' '); });
    }
  });
  const [width, height] = formats[project.format];
  async function seek(time) {
    const ready = entries.map(entry => {
      const { effect, layer, tile, image } = entry;
      const localTime = Math.max(0, time - layer.start);
      const key = effect.animated ? Math.floor(localTime * 12 + 1e-8) : 0;
      if (entry.key === key) return entry.ready;
      entry.key = key;
      tile.width = tile.height = 128;
      const context = tile.getContext('2d');
      context.putImageData(new ImageData(noisePixels(effect, localTime), 128, 128), 0, 0);
      const unit = Math.min(width, height) / 1080;
      image.setAttribute('width', 128 * effect.sizeX * unit);
      image.setAttribute('height', 128 * effect.sizeY * unit);
      const source = tile.toDataURL();
      image.setAttribute('href', source);
      const decoded = new Image(); decoded.src = source;
      entry.ready = decoded.decode();
      return entry.ready;
    });
    for (const layer of project.layers.filter(layer => layer.type === 'effect')) {
      const canvas = root.querySelector(`[data-floc-layer="${CSS.escape(layer.id)}"]`);
      const context = canvas?.getContext('2d');
      if (!context) continue;
      const layerEntries = entries.filter(entry => entry.layer.id === layer.id);
      const key = `${canvas.width}:${canvas.height}:${layerEntries.map(entry => entry.key).join(':')}`;
      if (drawn.get(layer.id) === key) continue;
      drawn.set(layer.id, key);
      context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, canvas.width, canvas.height);
      for (const entry of layerEntries) {
        const unit = Math.min(canvas.width, canvas.height) / 1080;
        context.save(); context.scale(entry.effect.sizeX * unit, entry.effect.sizeY * unit);
        context.imageSmoothingEnabled = false; context.fillStyle = context.createPattern(entry.tile, 'repeat');
        context.fillRect(0, 0, canvas.width / (entry.effect.sizeX * unit), canvas.height / (entry.effect.sizeY * unit)); context.restore();
      }
    }
    await Promise.all(ready);
  }
  return { seek, dispose() { svg.remove(); } };
}
