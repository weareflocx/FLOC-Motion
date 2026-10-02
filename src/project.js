import { MOTION_VARIANTS } from './carousel-motion.js';
import { BRAND } from './brand.js';
import { fontDefinition } from './fonts.js';
export const FORMATS = { square: [1080, 1080], portrait: [1080, 1920], landscape: [1920, 1080], portrait34: [1080, 1440], landscape43: [1440, 1080] };
export const FORMAT_LABELS = { square: '1 : 1', portrait: '9 : 16', landscape: '16 : 9', portrait34: '3 : 4', landscape43: '4 : 3' };
export const TEMPLATES = [
  { id: 'circular', name: 'Circular', description: 'Curved cards around a rotating ring', kind: 'ring' },
  { id: 'depth', name: 'Depth', description: 'A layered stack moving through space', kind: 'stack' },
  { id: 'arc', name: 'Arc', description: 'An open arc of front-facing cards', kind: 'arc' },
  { id: 'horizontal', name: 'Horizontal', description: 'A continuous perspective gallery', kind: 'strip' },
  { id: 'flip', name: 'Flip slider', description: 'A stepped gallery with an independent center transition turn', kind: 'strip' },
  ...['showcase', 'sphere', 'spinner', 'stack', 'stickers', 'twist', 'wheel'].map(id => ({ id, name: id[0].toUpperCase() + id.slice(1), description: MOTION_VARIANTS[id].map(v => v[1]).join(' / '), kind: id }))
];
export const SHADERS = [
  { id: 'none', name: 'Original', mode: 0 }, { id: 'wave', name: 'Liquid wave', mode: 1 },
  { id: 'mono', name: 'Monochrome', mode: 2 }, { id: 'duotone', name: 'Duotone', mode: 3 },
  { id: 'chromatic', name: 'Chromatic split', mode: 4 }, { id: 'elastic', name: 'Elastic stretch', mode: 5 }
];
export function demoProject() {
  return { version: 1, name: 'Weekly design recap', format: 'square', duration: 12, fps: 24,
    images: Array.from({ length: 6 }, (_, i) => ({ id: `demo-${i}`, src: `/demo/poster-${i + 1}.svg`, name: `Studio study ${String(i + 1).padStart(2, '0')}` })),
    layers: [
      { id: 'background', type: 'background', name: 'Background', visible: true, start: 0, end: 12, color: BRAND.colors.black, mode: 'color', src: '', fit: 'cover', offset: 0, loop: true },
      { id: 'carousel', type: 'carousel', name: 'Carousel', visible: true, start: 0, end: 12, template: 'circular', speed: 18, cardCount: 0, cardAspect: 1 / 1.14, radius: 0, loopDuration: 0, motionVariant: 'default', fade: 0, transitionTurn: 360, cornerRadius: 0, cardShape: 'rounded', frontface: 'show', backface: 'show', tilt: -12, yaw: 0, roll: -26, size: 1.35, gap: 0.28, curve: 0.8, x: 50, y: 54, shader: 'none', intensity: 0.35, tint: BRAND.colors.blue, fadeIn: 0, fadeOut: 0 },
      { id: 'headline', type: 'text', name: 'Headline', visible: true, start: 0, end: 12, text: 'WEEKLY\nDESIGN\nRECAP', x: 6, y: 6, size: 48, color: BRAND.colors.white, font: 'druk-wide', weight: 900, width: 80, fadeIn: 0.45, fadeOut: 0.25, rise: false },
      { id: 'signature', type: 'text', name: 'Signature', visible: true, start: 0, end: 12, text: 'ALWAYS ON*', x: 77, y: 92, size: 21, color: BRAND.colors.white, font: 'geist-mono', weight: 500, width: 22, fadeIn: 0, fadeOut: 0, rise: false },
      { id: 'logo', type: 'logo', name: 'Studio mark', visible: true, start: 0, end: 12, src: BRAND.assets.symbolWhite, x: 87, y: 6, size: 7, fadeIn: 0, fadeOut: 0 },
      { id: 'music', type: 'music', name: 'Music', visible: true, start: 0, end: 12, src: '', volume: 0.6, offset: 0, fade: 0.5, loop: false }
    ] };
}
const fail = message => { throw new Error(message); };
const finite = (v, min, max, label) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max || fail(`${label} must be between ${min} and ${max}.`);
const str = (v, max, label) => typeof v === 'string' && v.length <= max || fail(`Invalid ${label}.`);
const FADE_LAYERS = ['text', 'logo', 'carousel'];
// The epsilon keeps re-validation idempotent once fades have been scaled to fit.
export const fitFades = (fadeIn, fadeOut, span) => fadeIn + fadeOut > span + 1e-9 ? { fadeIn: fadeIn * span / (fadeIn + fadeOut), fadeOut: fadeOut * span / (fadeIn + fadeOut) } : { fadeIn, fadeOut };
export function validAsset(src, allowEmpty = true) {
  return typeof src === 'string' && ((allowEmpty && src === '') || Object.values(BRAND.assets).includes(src) || /^\/demo\/poster-[1-6]\.svg$/.test(src) || /^\/assets\/[a-f0-9-]{36}\.(?:png|jpg|jpeg|webp|gif|avif|mp4|webm|mp3|wav|m4a|ogg)$/.test(src));
}
export function validateProject(input) {
  if (!input || input.version !== 1) fail('Unsupported project version.');
  const p = structuredClone(input);
  str(p.name, 100, 'project name');
  if (!Object.hasOwn(FORMATS, p.format)) fail('Unknown output format.');
  finite(p.duration, 1, 30, 'Duration');
  if (![24, 30, 60].includes(p.fps)) fail('Frame rate must be 24, 30 or 60.');
  if (!Array.isArray(p.images) || p.images.length > 24) fail('Use up to 24 images.');
  const asset = src => validAsset(src) || fail('Only local studio assets are accepted.');
  const color = c => /^#[0-9a-f]{6}$/i.test(c) || fail('Use a six-digit hex color.');
  const ids = new Set();
  p.images.forEach(img => { str(img.id, 80, 'image ID'); asset(img.src); if (/\.(mp3|wav|m4a|ogg)$/i.test(img.src)) fail('Carousel cards require an image, GIF or video.'); if (!img.src) fail('Image source is required.'); str(img.name, 200, 'image name'); });
  if (!Array.isArray(p.layers) || p.layers.length > 20) fail('Use up to 20 layers.');
  for (const l of p.layers) {
    str(l.id, 80, 'layer ID'); if (!l.id || ids.has(l.id)) fail('Layer IDs must be unique.'); ids.add(l.id);
    str(l.name, 100, 'layer name');
    if (l.locked === undefined) l.locked = false;
    if (typeof l.locked !== 'boolean') fail('Layer lock must be a boolean.');
    if (typeof l.visible !== 'boolean') fail('Layer visibility must be a boolean.');
    finite(l.start, 0, p.duration, 'Layer start'); finite(l.end, l.start + 0.01, p.duration, 'Layer end');
    if (l.type === 'text') {
      str(l.text, 500, 'text'); finite(l.x, 0, 95, 'X'); finite(l.y, 0, 95, 'Y'); finite(l.size, 12, 180, 'Font size'); finite(l.width, 5, 100, 'Text width'); color(l.color);
      l.font ??= 'geist';
      if (!fontDefinition(l.font)?.weights.includes(l.weight) || (l.animation !== undefined && !['none', 'fade', 'rise'].includes(l.animation))) fail('Unknown text style.');
      // Legacy text entrance: fixed 0.45 s in / 0.25 s out ramps, optionally rising.
      if (l.animation !== undefined) { l.fadeIn ??= l.animation === 'none' ? 0 : 0.45; l.fadeOut ??= l.animation === 'none' ? 0 : 0.25; l.rise ??= l.animation === 'rise'; delete l.animation; }
      l.rise ??= false; if (typeof l.rise !== 'boolean') fail('Text rise must be true or false.');
    } else if (l.type === 'carousel') {
      if (!TEMPLATES.some(t => t.id === l.template) || !SHADERS.some(s => s.id === l.shader)) fail('Unknown carousel or shader.');
      l.yaw ??= 0; l.transitionTurn ??= 360;
      finite(l.transitionTurn, 0, 360, 'Transition turn');
      l.cornerRadius ??= 0; l.cardShape ??= 'rounded'; l.frontface ??= 'show'; l.backface ??= 'show';
      finite(l.cornerRadius, 0, 100, 'Corner radius');
      if (!['rounded', 'squircle'].includes(l.cardShape)) fail('Unknown card shape.');
      if (![l.frontface, l.backface].every(face => ['show', 'hide'].includes(face))) fail('Unknown face visibility.');
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
    if (FADE_LAYERS.includes(l.type)) {
      l.fadeIn ??= 0; l.fadeOut ??= 0; finite(l.fadeIn, 0, 30, 'Fade in'); finite(l.fadeOut, 0, 30, 'Fade out');
      Object.assign(l, fitFades(l.fadeIn, l.fadeOut, l.end - l.start));
    } else { delete l.fadeIn; delete l.fadeOut; }
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
  if (Object.keys(patch).some(key => key !== 'locked' && !(key === 'font' && layer.type === 'text') && !Object.hasOwn(layer, key))) fail('Unknown layer property.');
  if (layer.locked && Object.keys(patch).some(key => !['locked', 'visible'].includes(key))) fail('Unlock the layer before editing it.');
  if (['id', 'type'].some(key => Object.hasOwn(patch, key))) fail('Layer identity cannot be changed.');
  return validateProject({ ...project, layers: project.layers.map(l => l.id === id ? { ...l, ...(patch.template && patch.template !== l.template ? { motionVariant: 'default' } : {}), ...patch } : l) });
}
export function reorderLayer(project, id, targetId, side = 'above') {
  const p = validateProject(project);
  const layer = p.layers.find(l => l.id === id);
  if (!layer || !p.layers.some(l => l.id === targetId)) fail('Layer not found.');
  if (layer.locked) fail('Unlock the layer before reordering it.');
  if (!['above', 'below'].includes(side)) fail('Unknown layer order.');
  if (id === targetId) return p;
  const layers = p.layers.filter(l => l.id !== id);
  const target = layers.findIndex(l => l.id === targetId);
  layers.splice(target + (side === 'above' ? 1 : 0), 0, layer);
  return validateProject({ ...p, layers });
}
export function duplicateLayer(project, id, newId) {
  const p = validateProject(project);
  const index = p.layers.findIndex(l => l.id === id);
  const source = p.layers[index];
  if (!source) fail('Layer not found.');
  if (!['text', 'logo'].includes(source.type)) fail('Only text and logo layers can be duplicated.');
  if (source.locked) fail('Unlock the layer before duplicating it.');
  const copy = { ...source, id: newId, name: `${source.name.slice(0, 95)} copy`, locked: false };
  p.layers.splice(index + 1, 0, copy);
  return validateProject(p);
}
export function layerAlpha(layer, time) {
  if (!layer.visible || time < layer.start || time >= layer.end) return 0;
  const fadeIn = layer.fadeIn ?? 0, fadeOut = layer.fadeOut ?? 0;
  return Math.min(1, fadeIn > 0 ? (time - layer.start) / fadeIn : 1, fadeOut > 0 ? (layer.end - time) / fadeOut : 1);
}
export function audioTime(layer, time, mediaDuration) {
  const elapsed = Math.max(0, time - layer.start);
  const remaining = Math.max(0, mediaDuration - layer.offset);
  return layer.offset + (layer.loop && remaining > 0 ? elapsed % remaining : Math.min(elapsed, remaining));
}
export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
