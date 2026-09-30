import { MOTION_VARIANTS } from './carousel-motion.js';
import { BRAND } from './brand.js';
export const FORMATS = { square: [1080, 1080], portrait: [1080, 1920], landscape: [1920, 1080] };
export const TEMPLATES = [
  { id: 'circular', name: 'Circular', description: 'Curved cards around a rotating ring', kind: 'ring' },
  { id: 'depth', name: 'Depth', description: 'A layered stack moving through space', kind: 'stack' },
  { id: 'arc', name: 'Arc', description: 'An open arc of front-facing cards', kind: 'arc' },
  { id: 'horizontal', name: 'Horizontal', description: 'A continuous perspective gallery', kind: 'strip' },
  ...['showcase', 'sphere', 'spinner', 'stack', 'stickers', 'twist', 'wheel'].map(id => ({ id, name: id[0].toUpperCase() + id.slice(1), description: MOTION_VARIANTS[id].map(v => v[1]).join(' / '), kind: id }))
];
export const SHADERS = [
  { id: 'none', name: 'Original', mode: 0 }, { id: 'wave', name: 'Liquid wave', mode: 1 },
  { id: 'mono', name: 'Monochrome', mode: 2 }, { id: 'duotone', name: 'Duotone', mode: 3 },
  { id: 'chromatic', name: 'Chromatic split', mode: 4 }
];
export function demoProject() {
  return { version: 1, name: 'Weekly design recap', format: 'square', duration: 12, fps: 24,
    images: Array.from({ length: 6 }, (_, i) => ({ id: `demo-${i}`, src: `/demo/poster-${i + 1}.svg`, name: `Studio study ${String(i + 1).padStart(2, '0')}` })),
    layers: [
      { id: 'background', type: 'background', name: 'Background', visible: true, start: 0, end: 12, color: BRAND.colors.black, mode: 'color', src: '', fit: 'cover', offset: 0, loop: true },
      { id: 'carousel', type: 'carousel', name: 'Carousel', visible: true, start: 0, end: 12, template: 'circular', speed: 18, cardCount: 0, cardAspect: 1 / 1.14, radius: 0, loopDuration: 0, motionVariant: 'default', fade: 0, tilt: -12, yaw: 0, roll: -26, size: 1.35, gap: 0.28, curve: 0.8, x: 50, y: 54, shader: 'none', intensity: 0.35, tint: BRAND.colors.blue },
      { id: 'headline', type: 'text', name: 'Headline', visible: true, start: 0, end: 12, text: 'WEEKLY\nDESIGN\nRECAP', x: 6, y: 6, size: 66, color: BRAND.colors.white, weight: 800, width: 55, animation: 'fade' },
      { id: 'signature', type: 'text', name: 'Signature', visible: true, start: 0, end: 12, text: 'ALWAYS ON*', x: 77, y: 92, size: 21, color: BRAND.colors.white, weight: 600, width: 22, animation: 'none' },
      { id: 'logo', type: 'logo', name: 'Studio mark', visible: true, start: 0, end: 12, src: BRAND.assets.symbolWhite, x: 87, y: 6, size: 7 },
      { id: 'music', type: 'music', name: 'Music', visible: true, start: 0, end: 12, src: '', volume: 0.6, offset: 0, fade: 0.5, loop: false }
    ] };
}
const fail = message => { throw new Error(message); };
const finite = (v, min, max, label) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max || fail(`${label} must be between ${min} and ${max}.`);
const str = (v, max, label) => typeof v === 'string' && v.length <= max || fail(`Invalid ${label}.`);
export function validAsset(src, allowEmpty = true) {
  return typeof src === 'string' && ((allowEmpty && src === '') || Object.values(BRAND.assets).includes(src) || /^\/demo\/poster-[1-6]\.svg$/.test(src) || /^\/assets\/[a-f0-9-]{36}\.(?:png|jpg|jpeg|webp|gif|avif|mp4|webm|mp3|wav|m4a|ogg)$/.test(src));
}
export function validateProject(input) {
  if (!input || input.version !== 1) fail('Unsupported project version.');
  const p = structuredClone(input);
  str(p.name, 100, 'project name');
  if (!Object.hasOwn(FORMATS, p.format)) fail('Unknown output format.');
  finite(p.duration, 1, 30, 'Duration');
  if (![24, 30].includes(p.fps)) fail('Frame rate must be 24 or 30.');
  if (!Array.isArray(p.images) || p.images.length > 24) fail('Use up to 24 images.');
  const asset = src => validAsset(src) || fail('Only local studio assets are accepted.');
  const color = c => /^#[0-9a-f]{6}$/i.test(c) || fail('Use a six-digit hex color.');
  const ids = new Set();
  p.images.forEach(img => { str(img.id, 80, 'image ID'); asset(img.src); if (!img.src) fail('Image source is required.'); str(img.name, 200, 'image name'); });
  if (!Array.isArray(p.layers) || p.layers.length > 20) fail('Use up to 20 layers.');
  for (const l of p.layers) {
    str(l.id, 80, 'layer ID'); if (!l.id || ids.has(l.id)) fail('Layer IDs must be unique.'); ids.add(l.id);
    str(l.name, 100, 'layer name');
    if (typeof l.visible !== 'boolean') fail('Layer visibility must be a boolean.');
    finite(l.start, 0, p.duration, 'Layer start'); finite(l.end, l.start + 0.01, p.duration, 'Layer end');
    if (l.type === 'text') {
      str(l.text, 500, 'text'); finite(l.x, 0, 95, 'X'); finite(l.y, 0, 95, 'Y'); finite(l.size, 12, 180, 'Font size'); finite(l.width, 5, 100, 'Text width'); color(l.color);
      if (![400, 600, 800].includes(l.weight) || !['none', 'fade', 'rise'].includes(l.animation)) fail('Unknown text style.');
    } else if (l.type === 'carousel') {
      if (!TEMPLATES.some(t => t.id === l.template) || !SHADERS.some(s => s.id === l.shader)) fail('Unknown carousel or shader.');
      l.yaw ??= 0;
      l.cardCount ??= 0; l.cardAspect ??= 1 / 1.14; l.radius ??= 0; l.loopDuration ??= 0; l.motionVariant ??= 'default'; l.fade ??= 0;
      if (!Number.isInteger(l.cardCount)) fail('Card count must be an integer.');
      finite(l.cardCount, 0, 48, 'Card count'); finite(l.cardAspect, 0.25, 4, 'Card aspect'); finite(l.radius, 0, 6, 'Radius'); finite(l.loopDuration, 0, 60, 'Loop duration'); finite(l.fade, 0, 1, 'Rear fade');
      if (l.motionVariant !== 'default' && !MOTION_VARIANTS[l.template].some(v => v[0] === l.motionVariant)) fail('Unknown motion variant for this family.');
      finite(l.yaw, -180, 180, 'Orientation Y'); finite(l.speed, -90, 90, 'Speed'); finite(l.tilt, -65, 65, 'Tilt'); finite(l.roll, -180, 180, 'Rotation'); finite(l.size, 0.5, 2.5, 'Card size'); finite(l.gap, 0, 1, 'Gap'); finite(l.curve, 0, 1, 'Curve'); finite(l.x, 10, 90, 'X'); finite(l.y, 10, 90, 'Y'); finite(l.intensity, 0, 1, 'Shader intensity'); color(l.tint);
    } else if (l.type === 'background') {
      if (!['color', 'image', 'video'].includes(l.mode) || !['cover', 'contain'].includes(l.fit)) fail('Unknown background setting.');
      color(l.color); asset(l.src); finite(l.offset, 0, 3600, 'Media offset'); if (typeof l.loop !== 'boolean') fail('Invalid media loop.');
    } else if (l.type === 'logo') { asset(l.src); finite(l.x, 0, 95, 'X'); finite(l.y, 0, 95, 'Y'); finite(l.size, 2, 35, 'Logo size');
    } else if (l.type === 'music') { asset(l.src); finite(l.volume, 0, 1, 'Volume'); finite(l.offset, 0, 3600, 'Audio offset'); finite(l.fade, 0, 5, 'Audio fade'); if (typeof l.loop !== 'boolean') fail('Invalid audio loop.');
    } else fail('Unknown layer type.');
  }
  for (const type of ['background', 'carousel', 'music']) if (p.layers.filter(l => l.type === type).length !== 1) fail(`Project requires exactly one ${type} layer.`);
  return p;
}
export function resizeDuration(project, duration) {
  return validateProject({ ...project, duration, layers: project.layers.map(l => ({ ...l, start: Math.min(l.start, duration - 0.05), end: l.end === project.duration ? duration : Math.min(l.end, duration) })) });
}
export function patchLayer(project, id, patch) {
  if (!project.layers.some(l => l.id === id)) fail('Layer not found.');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) fail('Invalid layer patch.');
  const layer = project.layers.find(l => l.id === id);
  if (Object.keys(patch).some(key => !Object.hasOwn(layer, key))) fail('Unknown layer property.');
  if (['id', 'type'].some(key => Object.hasOwn(patch, key))) fail('Layer identity cannot be changed.');
  return validateProject({ ...project, layers: project.layers.map(l => l.id === id ? { ...l, ...(patch.template && patch.template !== l.template ? { motionVariant: 'default' } : {}), ...patch } : l) });
}
export function layerAlpha(layer, time) {
  if (!layer.visible || time < layer.start || time >= layer.end) return 0;
  if (layer.type === 'text' && layer.animation !== 'none') return Math.min(1, (time - layer.start) / 0.45, (layer.end - time) / 0.25);
  return 1;
}
export function audioTime(layer, time, mediaDuration) {
  const elapsed = Math.max(0, time - layer.start);
  const remaining = Math.max(0, mediaDuration - layer.offset);
  return layer.offset + (layer.loop && remaining > 0 ? elapsed % remaining : Math.min(elapsed, remaining));
}
export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
