import { CARD_FITS, MOTION_VARIANTS } from './carousel-motion.js';
import { BRAND } from './brand.js';
import { textFontValid } from './fonts.js';
import { DEFAULT_LAYOUT } from './layout.js';
import { DEFAULT_MOTION, motionBaseline, validateMotion } from './motion-timing.js';
import { choreographyFields, optionalChoreographyFields, evaluateChoreography, supportsChoreography } from './choreography.js';
import { isEasing } from './easing.js';
import { CONTENT_PROPERTIES, normalizeContentField } from './template-content.js';
import { DEFAULT_PROCEDURAL_BACKGROUND, PROCEDURAL_BACKGROUNDS, proceduralDefaults } from './backgrounds.js';
import { DEFAULT_TEXT_STYLE, TEXT_REVEALS } from './text-style.js';
import { EFFECT_LAYER_TYPES, validateEffects } from './effects.js';
import { FORMAT_LOCAL_FIELDS, assertLinkedFormatInput, captureFormatSnapshot, applyFormatSnapshot, assistedFormatSnapshot, normalizeLinkedFormats } from './linked-formats.js';
import { CURRENT_PROJECT_VERSION, migrateProject } from './project-migrations.js';
import { PATTERN_SCALE, PROJECT_LIMITS } from './project-limits.js';
import { normalizeModelStyle } from './model-style.js';
import { SPATIAL_LAYER_TYPES, LAYER_SPACES, SCENE_DEPTH_RANGE, normalizeScene, assertPlainSceneRecord } from './scene-settings.js';
export { PROJECT_LIMITS } from './project-limits.js';
export const FORMATS = { square: [1080, 1080], portrait: [1080, 1920], landscape: [1920, 1080], portrait34: [1080, 1440], landscape43: [1440, 1080] };
export const FORMAT_LABELS = { square: '1 : 1', portrait: '9 : 16', landscape: '16 : 9', portrait34: '3 : 4', landscape43: '4 : 3' };
export const TEMPLATES = [
  { id: 'circular', name: 'Circular', description: 'Curved cards around a rotating ring', kind: 'ring' },
  { id: 'horizontal', name: 'Horizontal', description: 'A continuous perspective gallery', kind: 'strip' },
  { id: 'flip', name: 'Flip slider', description: 'A stepped gallery with an independent center transition turn', kind: 'strip' },
  { id: 'zoom-through', name: 'Zoom Through', description: 'A continuous zoom through centered, nested images', kind: 'stack', defaults: { cardCount: 8, cardAspect: 4 / 3, loopDuration: 4.8, speed: 75, motionVariant: 'default', motion: { ...DEFAULT_MOTION }, size: 1, x: 50, y: 50, tilt: 0, yaw: 0, roll: 0, zoomRotation: 0, cornerRadius: 0, cardShape: 'rounded', frontface: 'show', backface: 'show', stretch: 0 } },
  { id: 'stack-shuffle', name: 'Stack Shuffle', description: 'The front card drops away as the next card advances through the deck', kind: 'stack', defaults: { cardCount: 6, cardAspect: 1, loopDuration: 9.6, speed: 37.5, motionVariant: 'down', motion: { ...DEFAULT_MOTION }, size: 0.58, x: 50, y: 50, tilt: 0, yaw: 0, roll: 0, shuffleGap: 36, shuffleRotation: 28, shuffleCorner: 15, cornerRadius: 0, cardShape: 'rounded', frontface: 'show', backface: 'show', stretch: 0 } },
  { id: 'sweep-reveal', name: 'Sweep Reveal', description: 'A clean directional wipe reveals each stationary photograph', kind: 'stack', defaults: { cardCount: 6, cardAspect: 4 / 3, loopDuration: 10.2, speed: 360 / 10.2, motionVariant: 'right', motion: { ...DEFAULT_MOTION, action: 1.7 }, size: 1, x: 50, y: 50, tilt: 0, yaw: 0, roll: 0, cornerRadius: 0, cardShape: 'rounded', frontface: 'show', backface: 'show', stretch: 0 } },
  { id: 'window-push', name: 'Window Push', description: 'Synchronized sliding images fill the canvas and a fixed central window', kind: 'stack', defaults: { cardCount: 6, cardAspect: 3 / 5, loopDuration: 7.2, speed: 50, motionVariant: 'right', motion: { ...DEFAULT_MOTION, action: 1.2 }, size: 1, x: 50, y: 50, tilt: 0, yaw: 0, roll: 0, windowZoom: 0.5, windowSpacing: 0, cornerRadius: 0, cardShape: 'rounded', frontface: 'show', backface: 'show', stretch: 0 } },
  ...['showcase', 'sphere', 'spinner', 'stack', 'stickers', 'wheel'].map(id => ({ id, name: id[0].toUpperCase() + id.slice(1), description: MOTION_VARIANTS[id].map(v => v[1]).join(' / '), kind: id }))
];
export function blankProject(name = 'Untitled') {
  return { version: CURRENT_PROJECT_VERSION, name, format: 'square', duration: 12, fps: 24, scene: normalizeScene(), layout: { ...DEFAULT_LAYOUT }, images: [], layers: [
    { id: 'background', type: 'background', name: 'Background', visible: true, locked: false, start: 0, end: 12, color: '#ffffff', mode: 'color', src: '', fit: 'cover', offset: 0, loop: true }
  ] };
}
export function demoProject() {
  return { version: CURRENT_PROJECT_VERSION, name: 'Weekly design recap', format: 'square', duration: 12, fps: 24, scene: normalizeScene(), layout: { ...DEFAULT_LAYOUT },
    images: Array.from({ length: 6 }, (_, i) => ({ id: `demo-${i}`, src: `/demo/poster-${i + 1}.svg`, name: `Studio study ${String(i + 1).padStart(2, '0')}` })),
    layers: [
      { id: 'background', type: 'background', name: 'Background', visible: true, start: 0, end: 12, color: BRAND.colors.black, mode: 'color', src: '', fit: 'cover', offset: 0, loop: true },
      { id: 'carousel', type: 'carousel', name: 'Carousel', visible: true, start: 0, end: 12, template: 'circular', speed: 18, cardCount: 0, cardAspect: 1 / 1.14, radius: 0, loopDuration: 0, motion: { ...DEFAULT_MOTION }, motionVariant: 'default', fade: 0, transitionTurn: 360, cornerRadius: 0, cardShape: 'rounded', frontface: 'show', backface: 'show', tilt: -12, yaw: 0, roll: -26, size: 1.35, gap: 0.28, curve: 0.8, x: 50, y: 54, stretch: 0, fadeIn: 0, fadeOut: 0 },
      { id: 'headline', type: 'text', name: 'Headline', visible: true, start: 0, end: 12, text: 'WEEKLY\nDESIGN\nRECAP', x: 6, y: 6, size: 48, color: BRAND.colors.white, font: 'druk-wide', weight: 900, width: 80, fadeIn: 0.45, fadeOut: 0.25, rise: false },
      { id: 'signature', type: 'text', name: 'Signature', visible: true, start: 0, end: 12, text: 'ALWAYS ON*', x: 77, y: 92, size: 21, color: BRAND.colors.white, font: 'geist-mono', weight: 500, width: 22, fadeIn: 0, fadeOut: 0, rise: false },
      { id: 'logo', type: 'logo', name: 'Studio mark', visible: true, start: 0, end: 12, src: BRAND.assets.symbolWhite, x: 87, y: 6, size: 7, fadeIn: 0, fadeOut: 0 },
      { id: 'music', type: 'music', name: 'Music', visible: true, start: 0, end: 12, src: '', volume: 0.6, offset: 0, fade: 0.5, loop: false }
    ] };
}
const fail = message => { throw new Error(message); };
const finite = (v, min, max, label) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max || fail(`${label} must be between ${min} and ${max}.`);
const str = (v, max, label) => typeof v === 'string' && v.length <= max || fail(`Invalid ${label}.`);
const FADE_LAYERS = ['text', 'logo', 'carousel', 'media', 'model', 'effect'];
function validateChoreography(layer) {
  const fields = choreographyFields(layer), optional = optionalChoreographyFields(layer);
  if (!Array.isArray(layer.choreography) || layer.choreography.length > 32) fail('Use up to 32 choreography states.');
  const ids = new Set();
  let previousTime = -1;
  for (const state of layer.choreography) {
    if (!state || typeof state !== 'object' || Array.isArray(state) || Object.keys(state).some(key => !['id', 'time', 'easing', 'values'].includes(key))) fail('Invalid choreography state.');
    str(state.id, 80, 'state ID');
    if (!state.id.trim() || ids.has(state.id)) fail('State IDs must be nonempty and unique.');
    ids.add(state.id);
    finite(state.time, 0, PROJECT_LIMITS.maxDuration, 'State time');
    if (state.time <= previousTime) fail('State times must be unique and increasing.');
    previousTime = state.time;
    if (!isEasing(state.easing)) fail('Unknown choreography easing.');
    if (!state.values || typeof state.values !== 'object' || Array.isArray(state.values) || Object.keys(state.values).some(key => !Object.hasOwn(fields, key) && !Object.hasOwn(optional, key))) fail('Invalid choreography values.');
    if (!Object.keys(state.values).length && !Object.keys(fields).length) fail('A choreography state must hold at least one value.');
    for (const [field, [min, max]] of Object.entries(fields)) {
      if (['z', 'tilt', 'yaw', 'roll'].includes(field) && state.values[field] === undefined) state.values[field] = layer[field] ?? 0;
      finite(state.values[field], min, max, `State ${field}`);
    }
    // Optional values may outlive their effect; they apply again when it returns.
    for (const [field, kind] of Object.entries(optional)) {
      if (!Object.hasOwn(state.values, field)) continue;
      if (kind === 'color') { if (typeof state.values[field] !== 'string' || !/^#[0-9a-f]{6}$/i.test(state.values[field])) fail(`State ${field} must be a six-digit hex color.`); }
      else finite(state.values[field], kind[0], kind[1], `State ${field}`);
    }
  }
}
// The epsilon keeps re-validation idempotent once fades have been scaled to fit.
export const fitFades = (fadeIn, fadeOut, span) => fadeIn + fadeOut > span + 1e-9 ? { fadeIn: fadeIn * span / (fadeIn + fadeOut), fadeOut: fadeOut * span / (fadeIn + fadeOut) } : { fadeIn, fadeOut };
export function validAsset(src, allowEmpty = true) {
  return typeof src === 'string' && ((allowEmpty && src === '') || Object.values(BRAND.assets).includes(src) || /^\/demo\/poster-[1-6]\.svg$/.test(src) || /^\/assets\/[a-f0-9-]{36}\.(?:png|jpg|jpeg|webp|gif|avif|mp4|webm|mp3|wav|m4a|ogg|svg|glb)$/.test(src));
}
// The closed current shape: unknown keys are dropped after migration. Misplaced
// effects, scope, opacity, choreography and content fields stay so they still fail.
const PROJECT_KEYS = new Set(['version', 'name', 'format', 'duration', 'fps', 'scene', 'layout', 'images', 'layers', 'linkedFormats']);
const IMAGE_KEYS = new Set(['id', 'src', 'name']);
const LAYER_KEYS = Object.fromEntries(Object.entries({
  text: ['text', 'x', 'y', 'size', 'width', 'color', 'font', 'weight', 'roll', 'rise', ...Object.keys(DEFAULT_TEXT_STYLE)],
  logo: ['src', 'x', 'y', 'size', 'roll'],
  media: ['src', 'x', 'y', 'size', 'roll', 'offset', 'loop'],
  model: ['src', 'x', 'y', 'size', 'yaw', 'tilt', 'roll', 'offset', 'loop', 'modelStyle'],
  carousel: ['images', 'template', 'speed', 'cardCount', 'cardAspect', 'cardFit', 'radius', 'loopDuration', 'motion', 'motionBaseline', 'motionVariant', 'fade', 'transitionTurn',
    'cornerRadius', 'cardShape', 'frontface', 'backface', 'tilt', 'yaw', 'roll', 'size', 'gap', 'curve', 'x', 'y', 'perspective', 'stretch',
    'zoomRotation', 'shuffleGap', 'shuffleRotation', 'shuffleCorner', 'windowZoom', 'windowSpacing'],
  background: ['color', 'mode', 'src', 'fit', 'offset', 'loop', 'x', 'y', 'roll', ...Object.keys(DEFAULT_PROCEDURAL_BACKGROUND)],
  music: ['src', 'volume', 'offset', 'fade', 'loop'],
  effect: []
}).map(([type, keys]) => [type, new Set(['id', 'type', 'name', 'visible', 'locked', 'start', 'end', 'effects', 'effectScope', 'opacity', 'choreography', 'contentField',
  ...(SPATIAL_LAYER_TYPES.includes(type) ? ['space', 'z', 'tilt', 'yaw', 'roll'] : []), ...(FADE_LAYERS.includes(type) ? ['fadeIn', 'fadeOut'] : []), ...keys])]));
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keepKeys = (value, keys) => { if (record(value)) for (const key of Object.keys(value)) if (!keys.has(key)) delete value[key]; };
function closeShape(p) {
  keepKeys(p, PROJECT_KEYS);
  const layers = Array.isArray(p.layers) ? p.layers.filter(record) : [];
  for (const images of [p.images, ...layers.filter(l => l.type === 'carousel').map(l => l.images)]) if (Array.isArray(images)) images.forEach(img => keepKeys(img, IMAGE_KEYS));
  for (const l of layers) {
    if (l.type !== 'model' && Object.hasOwn(l, 'modelStyle')) fail('Only model layers accept model settings.');
    if (Object.hasOwn(LAYER_KEYS, l.type)) keepKeys(l, LAYER_KEYS[l.type]);
  }
  return p;
}
// Every caller gets migration: the result always carries CURRENT_PROJECT_VERSION.
export function validateProject(input) {
  if (!record(input)) fail('Invalid project.');
  // Check the original objects before structuredClone can erase their prototypes.
  assertPlainSceneRecord(input, 'project');
  if (Object.hasOwn(input, 'scene')) normalizeScene(input.scene);
  if (Object.hasOwn(input, 'linkedFormats')) assertLinkedFormatInput(input.linkedFormats);
  for (const layer of Array.isArray(input.layers) ? input.layers : []) {
    assertPlainSceneRecord(layer, 'layer');
    for (const state of Array.isArray(layer.choreography) ? layer.choreography : []) {
      assertPlainSceneRecord(state, 'choreography state');
      assertPlainSceneRecord(state.values, 'choreography values');
    }
    for (const key of ['space', 'z', 'tilt', 'yaw', 'roll']) {
      if (!Object.hasOwn(layer, key)) continue;
      if (['space', 'z', 'tilt', 'yaw'].includes(key) && !SPATIAL_LAYER_TYPES.includes(layer.type)) fail('Only spatial visual layers accept spatial settings.');
      if (key === 'space' ? !LAYER_SPACES.includes(layer[key]) : typeof layer[key] !== 'number' || !Number.isFinite(layer[key])) fail(`Invalid layer ${key}.`);
    }
    // Older model settings are migrated later; inspect only record identity here.
    if (layer?.type === 'model' && layer.modelStyle !== undefined) {
      assertPlainSceneRecord(layer.modelStyle, '3D model settings');
      if (layer.modelStyle.motionTiming && typeof layer.modelStyle.motionTiming === 'object') assertPlainSceneRecord(layer.modelStyle.motionTiming, '3D model motion timing');
    }
    // Legacy curve names are migrated later; inspect only record identity here.
    if (layer?.type === 'carousel') for (const motion of [layer.motion, layer.motionBaseline?.motion]) {
      if (motion && typeof motion === 'object') assertPlainSceneRecord(motion, 'motion settings');
    }
  }
  const p = closeShape(migrateProject(input));
  p.scene = normalizeScene(p.scene);
  str(p.name, 100, 'project name');
  if (!Object.hasOwn(FORMATS, p.format)) fail('Unknown output format.');
  finite(p.duration, PROJECT_LIMITS.minDuration, PROJECT_LIMITS.maxDuration, 'Duration');
  if (![24, 30, 60].includes(p.fps)) fail('Frame rate must be 24, 30 or 60.');
  if (!record(p.layout) || Object.keys(p.layout).some(key => !Object.hasOwn(DEFAULT_LAYOUT, key))) fail('Invalid layout settings.');
  if (typeof p.layout.enabled !== 'boolean' || typeof p.layout.guides !== 'boolean') fail('Layout switches must be booleans.');
  finite(p.layout.marginX, 0, 25, 'Horizontal margin'); finite(p.layout.marginY, 0, 25, 'Vertical margin');
  if (!Array.isArray(p.images) || p.images.length > PROJECT_LIMITS.maxImages) fail(`Use up to ${PROJECT_LIMITS.maxImages} images.`);
  const asset = src => validAsset(src) || fail('Only local studio assets are accepted.');
  const color = c => /^#[0-9a-f]{6}$/i.test(c) || fail('Use a six-digit hex color.');
  const ids = new Set(), contentIds = new Set();
  const validateImages = images => {
    if (!Array.isArray(images) || images.length > PROJECT_LIMITS.maxImages) fail(`Use up to ${PROJECT_LIMITS.maxImages} carousel cards.`);
    const imageIds = new Set();
    images.forEach(img => {
      str(img.id, 80, 'image ID'); if (!img.id.trim() || imageIds.has(img.id)) fail('Image IDs must be nonempty and unique.'); imageIds.add(img.id);
      asset(img.src); if (/\.(mp3|wav|m4a|ogg|glb)$/i.test(img.src)) fail('Carousel cards require an image, GIF or video.'); if (!img.src) fail('Image source is required.'); str(img.name, 200, 'image name');
    });
  };
  validateImages(p.images);
  if (!Array.isArray(p.layers) || p.layers.length > PROJECT_LIMITS.maxLayers) fail(`Use up to ${PROJECT_LIMITS.maxLayers} layers.`);
  for (const l of p.layers) {
    str(l.id, 80, 'layer ID'); if (!l.id || ids.has(l.id)) fail('Layer IDs must be unique.'); ids.add(l.id);
    str(l.name, 100, 'layer name');
    if (l.locked === undefined) l.locked = false;
    if (typeof l.locked !== 'boolean') fail('Layer lock must be a boolean.');
    if (typeof l.visible !== 'boolean') fail('Layer visibility must be a boolean.');
    finite(l.start, 0, p.duration, 'Layer start'); finite(l.end, l.start + 0.01, p.duration, 'Layer end');
    if (l.effects !== undefined) {
      if (!EFFECT_LAYER_TYPES.includes(l.type)) fail('Only visual layers accept effects.');
      validateEffects(l.effects);
    }
    if (Object.hasOwn(l, 'effectScope') && l.type !== 'effect') fail('Only effect layers declare effect scope.');
    if (SPATIAL_LAYER_TYPES.includes(l.type)) {
      if (l.space === undefined) l.space = 'spatial';
      if (!LAYER_SPACES.includes(l.space)) fail('Unknown layer space.');
      for (const field of ['z', 'tilt', 'yaw', 'roll']) if (l[field] === undefined) l[field] = 0;
      finite(l.z, ...SCENE_DEPTH_RANGE, 'Depth');
      finite(l.tilt, l.type === 'carousel' ? -65 : -180, l.type === 'carousel' ? 65 : 180, 'Tilt');
      finite(l.yaw, -180, 180, 'Yaw'); finite(l.roll, -180, 180, 'Rotation');
    }
    if (['text', 'logo', 'media', 'background'].includes(l.type)) {
      l.roll ??= 0;
      finite(l.roll, -180, 180, 'Rotation');
    }
    if (l.type === 'background') {
      l.x ??= 0; l.y ??= 0;
      finite(l.x, -100, 100, 'Background X'); finite(l.y, -100, 100, 'Background Y');
    }
    if (l.type === 'text') {
      str(l.text, 500, 'text'); finite(l.x, 0, 95, 'X'); finite(l.y, 0, 95, 'Y'); finite(l.size, 12, 180, 'Font size'); finite(l.width, 5, 100, 'Text width'); color(l.color);
      l.font ??= 'geist';
      for (const [field, value] of Object.entries(DEFAULT_TEXT_STYLE)) if (l[field] === undefined) l[field] = value;
      finite(l.lineHeight, 0.5, 3, 'Line height'); finite(l.letterSpacing, -0.15, 0.5, 'Letter spacing');
      if (!['left', 'center', 'right'].includes(l.textAlign) || !TEXT_REVEALS.some(({ id }) => id === l.reveal)) fail('Unknown text alignment or reveal.');
      finite(l.revealDuration, 0, 5, 'Reveal duration'); l.revealDuration = Math.min(l.revealDuration, l.end - l.start);
      if (!textFontValid(l.font, l.weight)) fail('Unknown text style.');
      l.rise ??= false; if (typeof l.rise !== 'boolean') fail('Text rise must be true or false.');
    } else if (l.type === 'carousel') {
      if (l.images !== undefined) validateImages(l.images);
      if (!TEMPLATES.some(t => t.id === l.template)) fail('Unknown carousel.');
      l.stretch ??= 0;
      finite(l.stretch, 0, 1, 'Edge stretch');
      l.perspective ??= 38;
      finite(l.perspective, 15, 75, 'Perspective');
      l.yaw ??= 0; l.transitionTurn ??= 360;
      finite(l.transitionTurn, 0, 360, 'Transition turn');
      if (l.template === 'zoom-through') l.zoomRotation ??= 0;
      if (l.zoomRotation !== undefined) finite(l.zoomRotation, -180, 180, 'Entry rotation');
      if (l.template === 'stack-shuffle') { l.shuffleGap ??= 36; l.shuffleRotation ??= 28; l.shuffleCorner ??= 15; }
      if (l.shuffleGap !== undefined) finite(l.shuffleGap, 0, 160, 'Stack spacing');
      if (l.shuffleRotation !== undefined) finite(l.shuffleRotation, -180, 180, 'Exit rotation');
      if (l.shuffleCorner !== undefined) finite(l.shuffleCorner, 0, 100, 'Stack corner radius');
      if (l.template === 'window-push') { l.windowZoom ??= 0.5; l.windowSpacing ??= 0; }
      if (l.windowZoom !== undefined) finite(l.windowZoom, 0, 1, 'Window zoom');
      if (l.windowSpacing !== undefined) finite(l.windowSpacing, 0, 160, 'Window spacing');
      l.cornerRadius ??= 0; l.cardShape ??= 'rounded'; l.frontface ??= 'show'; l.backface ??= 'show';
      finite(l.cornerRadius, 0, 100, 'Corner radius');
      if (!['rounded', 'squircle'].includes(l.cardShape)) fail('Unknown card shape.');
      if (![l.frontface, l.backface].every(face => ['show', 'hide'].includes(face))) fail('Unknown face visibility.');
      l.cardCount ??= 0; l.cardAspect ??= 1 / 1.14; l.radius ??= 0; l.loopDuration ??= 0; l.motionVariant ??= 'default'; l.fade ??= 0;
      if (!Number.isInteger(l.cardCount)) fail('Card count must be an integer.');
      finite(l.cardCount, 0, PROJECT_LIMITS.maxCardCount, 'Card count'); finite(l.cardAspect, 0.25, 4, 'Card aspect'); finite(l.radius, 0, 6, 'Radius'); finite(l.loopDuration, 0, 60, 'Loop duration'); finite(l.fade, 0, 1, 'Rear fade');
      // Optional: absent means fixed, so older projects keep their exact shape.
      if (l.cardFit !== undefined && !CARD_FITS.includes(l.cardFit)) fail('Unknown card fit.');
      if (l.motionVariant !== 'default' && !MOTION_VARIANTS[l.template].some(v => v[0] === l.motionVariant)) fail('Unknown motion variant for this family.');
      finite(l.yaw, -180, 180, 'Orientation Y'); finite(l.speed, -90, 90, 'Speed'); finite(l.tilt, -65, 65, 'Tilt'); finite(l.roll, -180, 180, 'Rotation'); finite(l.size, 0.5, 2.5, 'Card size'); finite(l.gap, 0, 1, 'Gap'); finite(l.curve, 0, 1, 'Curve'); finite(l.x, 10, 90, 'X'); finite(l.y, 10, 90, 'Y');
      if (l.motion === undefined) l.motion = { ...DEFAULT_MOTION };
      validateMotion(l.motion);
      if (l.motionBaseline === undefined) l.motionBaseline = motionBaseline(l);
      const baseline = l.motionBaseline;
      if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline) || Object.keys(baseline).some(key => !['name', 'speed', 'loopDuration', 'motion'].includes(key))) fail('Invalid motion baseline.');
      str(baseline.name, 100, 'motion baseline name'); finite(baseline.speed, -90, 90, 'Original speed'); finite(baseline.loopDuration, 0, 60, 'Original loop duration'); validateMotion(baseline.motion);
    } else if (l.type === 'background') {
      if (!['color', 'image', 'video', 'procedural'].includes(l.mode) || !['cover', 'contain'].includes(l.fit)) fail('Unknown background setting.');
      for (const [field, value] of Object.entries(proceduralDefaults(l))) if (l[field] === undefined) l[field] = value;
      if (!PROCEDURAL_BACKGROUNDS.some(({ id }) => id === l.pattern)) fail('Unknown background pattern.');
      color(l.patternColor); finite(l.patternScale, PATTERN_SCALE.min, PATTERN_SCALE.max, 'Pattern scale'); finite(l.patternIntensity, 0, 1, 'Pattern intensity'); finite(l.patternSpeed, -2, 2, 'Pattern speed'); finite(l.patternVignette, 0, 1, 'Vignette'); finite(l.patternGrain, 0, 1, 'Grain overlay');
      if (!Number.isInteger(l.patternSeed)) fail('Pattern seed must be an integer.');
      finite(l.patternSeed, 0, 65535, 'Pattern seed');
      if (typeof l.patternLoop !== 'boolean') fail('Pattern loop must be true or false.');
      finite(l.patternDirection, 0, 360, 'Pattern direction'); finite(l.patternFocusX, 0, 100, 'Pattern focus X'); finite(l.patternFocusY, 0, 100, 'Pattern focus Y');
      color(l.color); asset(l.src); if (l.src && !(l.mode === 'video' ? /\.(mp4|webm)$/i : l.mode === 'image' ? /\.(png|jpe?g|webp|gif|avif|svg)$/i : /\.(png|jpe?g|webp|gif|avif|svg|mp4|webm)$/i).test(l.src)) fail('Invalid background asset type.'); finite(l.offset, 0, 3600, 'Media offset'); if (typeof l.loop !== 'boolean') fail('Invalid media loop.');
    } else if (l.type === 'logo') { asset(l.src); if (l.src && !/\.(png|jpe?g|webp|gif|avif|svg)$/i.test(l.src)) fail('Logo requires an image.'); finite(l.x, -1000, 1000, 'X'); finite(l.y, -1000, 1000, 'Y'); finite(l.size, 2, 500, 'Logo size');
    } else if (l.type === 'media' || l.type === 'model') {
      asset(l.src);
      if (!l.src || !(l.type === 'model' ? /\.glb$/i : /\.(png|jpe?g|webp|gif|avif|svg|mp4|webm)$/i).test(l.src)) fail('Invalid layer asset type.');
      finite(l.x, -1000, 1000, 'X'); finite(l.y, -1000, 1000, 'Y'); finite(l.size, 2, 500, 'Size');
      finite(l.offset, 0, 3600, 'Source offset'); if (typeof l.loop !== 'boolean') fail('Invalid media loop.');
      if (l.type === 'model') {
        finite(l.yaw, -180, 180, 'Model yaw'); finite(l.tilt, -180, 180, 'Model tilt'); finite(l.roll, -180, 180, 'Model roll');
        l.modelStyle = normalizeModelStyle(l.modelStyle);
      }
    } else if (l.type === 'music') { asset(l.src); if (l.src && !/\.(mp3|wav|m4a|ogg)$/i.test(l.src)) fail('Music requires an audio file.'); finite(l.volume, 0, 1, 'Volume'); finite(l.offset, 0, 3600, 'Audio offset'); finite(l.fade, 0, 5, 'Audio fade'); if (typeof l.loop !== 'boolean') fail('Invalid audio loop.');
    } else if (l.type === 'effect') {
      if (!l.effects?.length) fail('An effect layer needs at least one effect.');
      l.effectScope ??= 'overlay';
      if (!['below', 'overlay'].includes(l.effectScope)) fail('Unknown effect scope.');
      if (l.effectScope === 'overlay' && l.effects.some(effect => effect.type !== 'noise')) fail('Texture overlays only accept Noise.');
    } else fail('Unknown layer type.');
    if (Object.hasOwn(l, 'contentField')) {
      if (!Object.hasOwn(CONTENT_PROPERTIES, l.type)) fail('This layer cannot declare a content field.');
      // `null` is how an edit removes a declaration.
      if (l.contentField === null) delete l.contentField;
      else {
        l.contentField = normalizeContentField(l.contentField, l.type);
        if (contentIds.has(l.contentField.id)) fail('Content field IDs must be unique.');
        contentIds.add(l.contentField.id);
      }
    }
    if (EFFECT_LAYER_TYPES.includes(l.type)) {
      if (l.opacity === undefined) l.opacity = 1;
      finite(l.opacity, 0, 1, 'Opacity');
    } else if (Object.hasOwn(l, 'opacity')) fail('Only visual layers accept opacity.');
    if (FADE_LAYERS.includes(l.type)) {
      if (l.choreography === undefined) l.choreography = [];
      validateChoreography(l);
      l.fadeIn ??= 0; l.fadeOut ??= 0; finite(l.fadeIn, 0, 30, 'Fade in'); finite(l.fadeOut, 0, 30, 'Fade out');
      Object.assign(l, fitFades(l.fadeIn, l.fadeOut, l.end - l.start));
    } else if (supportsChoreography(l)) {
      // Backgrounds have no fades; their optional states animate colors and pattern values.
      if (l.choreography !== undefined) validateChoreography(l);
    } else if (Object.hasOwn(l, 'choreography')) fail('This layer cannot have choreography.');
  }
  if (Object.hasOwn(p, 'linkedFormats')) p.linkedFormats = normalizeLinkedFormats(p, FORMATS, validateProject);
  return p;
}
export function linkFormats(project) {
  const p = validateProject(project);
  if (p.linkedFormats) return p;
  const layouts = { [p.format]: captureFormatSnapshot(p) };
  for (const format of ['square', 'portrait', 'landscape']) {
    if (format !== p.format) layouts[format] = assistedFormatSnapshot(p, format, FORMATS);
  }
  return validateProject({ ...p, linkedFormats: { master: p.format, layouts } });
}
export function switchFormat(project, format) {
  if (!Object.hasOwn(FORMATS, format)) fail('Unknown output format.');
  const p = validateProject(project);
  if (!p.linkedFormats) return validateProject({ ...p, format });
  if (format === p.format) return p;
  if (!p.linkedFormats.layouts[format]) {
    const master = applyFormatSnapshot(p, p.linkedFormats.master, p.linkedFormats.layouts[p.linkedFormats.master]);
    p.linkedFormats.layouts[format] = assistedFormatSnapshot(master, format, FORMATS);
  }
  return validateProject(applyFormatSnapshot(p, format, p.linkedFormats.layouts[format]));
}
export function resetFormat(project) {
  const p = validateProject(project);
  if (!p.linkedFormats || p.format === p.linkedFormats.master) return p;
  const master = applyFormatSnapshot(p, p.linkedFormats.master, p.linkedFormats.layouts[p.linkedFormats.master]);
  const snapshot = assistedFormatSnapshot(master, p.format, FORMATS);
  p.linkedFormats.layouts[p.format] = snapshot;
  return validateProject(applyFormatSnapshot(p, p.format, snapshot));
}
export function unlinkFormats(project) {
  const p = validateProject(project);
  delete p.linkedFormats;
  return p;
}
export function resizeDuration(project, duration) {
  return validateProject({ ...project, duration, layers: project.layers.map(l => ({ ...l, start: Math.min(l.start, duration - 0.05), end: l.end === project.duration ? duration : Math.min(l.end, duration) })) });
}
// Whole-project edits must leave locked layers as they were. `allow` names the
// explicit composition-wide exceptions: 'timing' (duration resize), 'format'
// (linked-format layout fields) and 'content' (declared template content).
const canonicalJson = value => Array.isArray(value) ? `[${value.map(canonicalJson).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  : JSON.stringify(value);
function lockedView(project, layer, allow) {
  const { locked, visible, ...view } = layer;
  if (layer.type === 'carousel') view.images = carouselImages(project, layer);
  if (allow.includes('timing')) for (const field of ['start', 'end', 'fadeIn', 'fadeOut', 'revealDuration']) delete view[field];
  if (allow.includes('content') && layer.contentField && Object.hasOwn(CONTENT_PROPERTIES, layer.type)) delete view[CONTENT_PROPERTIES[layer.type]];
  if (allow.includes('format')) {
    for (const field of FORMAT_LOCAL_FIELDS[layer.type] ?? []) if (field !== 'choreography') delete view[field];
    // Only the pose varies by format; opacity and optional values are shared.
    const pose = Object.keys(choreographyFields(layer)).filter(field => field !== 'opacity');
    if (view.choreography) view.choreography = view.choreography.map(({ values, ...state }) => ({ ...state, values: Object.fromEntries(Object.entries(values).filter(([field]) => !pose.includes(field))) }));
  }
  return canonicalJson(view);
}
export function assertLocksRespected(previous, next, { allow = [] } = {}) {
  if (allow.some(item => !['timing', 'format', 'content'].includes(item))) fail('Unknown lock exception.');
  // Backgrounds are editable composition fixtures, not removable/reorderable layers. Retain
  // legacy stacks as authored: content may move within, but never across, background boundaries.
  const backgrounds = previous.layers.filter(layer => layer.type === 'background');
  if (next.layers.filter(layer => layer.type === 'background').length !== backgrounds.length) fail('The composition background cannot be added or removed.');
  for (const background of backgrounds) {
    if (!next.layers.some(layer => layer.id === background.id && layer.type === 'background')) fail('The composition background cannot be removed or replaced.');
    const before = previous.layers.findIndex(layer => layer.id === background.id), after = next.layers.findIndex(layer => layer.id === background.id);
    for (const layer of previous.layers) {
      const index = next.layers.findIndex(item => item.id === layer.id);
      if (index >= 0 && (previous.layers.indexOf(layer) < before) !== (index < after)) fail('The composition background keeps its stacking position.');
    }
    if (before === 0 && after !== 0) fail('The composition background stays below the other layers.');
  }
  const locked = previous.layers.filter(l => l.locked);
  for (const layer of locked) {
    const after = next.layers.find(l => l.id === layer.id);
    if (!after || after.type !== layer.type) fail(`Unlock “${layer.name}” before deleting it.`);
    if (lockedView(previous, layer, allow) !== lockedView(next, after, allow)) fail(`Unlock “${layer.name}” before editing it.`);
    if (!allow.includes('format') && previous.linkedFormats && next.linkedFormats) {
      for (const [format, snapshot] of Object.entries(previous.linkedFormats.layouts)) {
        if (format === previous.format) continue;
        if (canonicalJson(snapshot.layers[layer.id]) !== canonicalJson(next.linkedFormats.layouts[format]?.layers[layer.id])) fail(`Unlock “${layer.name}” before editing its linked framing.`);
      }
    }
  }
  const order = next.layers.filter(l => locked.some(item => item.id === l.id));
  const moved = locked.find((layer, index) => order[index].id !== layer.id);
  if (moved) fail(`Unlock “${moved.name}” before reordering it.`);
  return next;
}
export function patchScene(project, patch) {
  assertPlainSceneRecord(patch, 'scene patch');
  if (Object.keys(patch).some(key => key !== 'camera') || !Object.hasOwn(patch, 'camera')) fail('Scene patches require camera settings.');
  // Validate the unmerged patch before spreading can erase unsafe descriptors.
  normalizeScene(patch);
  const p = validateProject(project);
  return validateProject({ ...p, scene: { camera: { ...p.scene.camera, ...patch.camera } } });
}
export function patchLayer(project, id, patch) {
  // Apply edits to the current schema so migration cannot overwrite an explicit
  // Flat → Spatial conversion (or its depth) on a legacy in-memory project.
  if (project.version !== CURRENT_PROJECT_VERSION) project = validateProject(project);
  if (!project.layers.some(l => l.id === id)) fail('Layer not found.');
  assertPlainSceneRecord(patch, 'layer patch');
  const layer = project.layers.find(l => l.id === id);
  if (Object.keys(patch).some(key => !LAYER_KEYS[layer.type]?.has(key)
    || key === 'effects' && !EFFECT_LAYER_TYPES.includes(layer.type)
    || key === 'opacity' && !EFFECT_LAYER_TYPES.includes(layer.type)
    || key === 'choreography' && !supportsChoreography(layer)
    || key === 'effectScope' && layer.type !== 'effect'
    || key === 'contentField' && !Object.hasOwn(CONTENT_PROPERTIES, layer.type))) fail('Unknown layer property.');
  if (layer.locked && Object.keys(patch).some(key => !['locked', 'visible'].includes(key))) fail('Unlock the layer before editing it.');
  if (['id', 'type'].some(key => Object.hasOwn(patch, key))) fail('Layer identity cannot be changed.');
  return validateProject({ ...project, layers: project.layers.map(l => {
    if (l.id !== id) return l;
    const changedFamily = patch.template && patch.template !== l.template;
    const next = { ...l, ...(changedFamily ? { motionVariant: 'default', motion: { ...DEFAULT_MOTION }, ...TEMPLATES.find(template => template.id === patch.template)?.defaults } : {}), ...patch };
    if (l.type === 'model' && Object.hasOwn(patch, 'src') && patch.src !== l.src) next.modelStyle = { ...normalizeModelStyle(next.modelStyle), animationClip: 0 };
    // Capture the pre-edit rhythm for legacy in-memory projects as well as saved ones.
    if (l.type === 'carousel' && !Object.hasOwn(patch, 'motionBaseline') && (changedFamily || !l.motionBaseline)) next.motionBaseline = motionBaseline(changedFamily ? next : l);
    return next;
  }) });
}
export function patchTemplateContent(project, id, value) {
  const p = validateProject(project);
  const layer = p.layers.find(l => l.id === id);
  if (!layer) fail('Layer not found.');
  if (!Object.hasOwn(CONTENT_PROPERTIES, layer.type) || !layer.contentField) fail('Layer has no declared content field.');
  const property = CONTENT_PROPERTIES[layer.type];
  if (property === 'images' && !Array.isArray(value)) fail(`Use up to ${PROJECT_LIMITS.maxImages} carousel cards.`);
  return validateProject({ ...p, layers: p.layers.map(l => l.id === id ? { ...l, [property]: value } : l) });
}
export function reorderLayer(project, id, targetId, side = 'above') {
  const p = validateProject(project);
  const layer = p.layers.find(l => l.id === id);
  if (!layer || !p.layers.some(l => l.id === targetId)) fail('Layer not found.');
  if (layer.locked) fail('Unlock the layer before reordering it.');
  if (layer.type === 'background') fail('The composition background cannot be reordered.');
  if (!['above', 'below'].includes(side)) fail('Unknown layer order.');
  if (id === targetId) return p;
  const layers = p.layers.filter(l => l.id !== id);
  const target = layers.findIndex(l => l.id === targetId);
  layers.splice(target + (side === 'above' ? 1 : 0), 0, layer);
  // Moving another layer cannot place it underneath a fixed background.
  for (const background of p.layers.filter(item => item.type === 'background')) {
    const wasBelow = p.layers.indexOf(layer) < p.layers.indexOf(background);
    if (wasBelow !== (layers.indexOf(layer) < layers.indexOf(background))) fail('The composition background keeps its stacking position.');
  }
  return validateProject({ ...p, layers });
}
export function duplicateLayer(project, id, newId) {
  const p = validateProject(project);
  const index = p.layers.findIndex(l => l.id === id);
  const source = p.layers[index];
  if (!source) fail('Layer not found.');
  if (source.locked) fail('Unlock the layer before duplicating it.');
  if (source.type === 'background') fail('The composition background cannot be duplicated.');
  const copy = { ...structuredClone(source), ...(source.type === 'carousel' ? { images: structuredClone(carouselImages(p, source)) } : {}), id: newId, name: `${source.name.slice(0, 95)} copy`, locked: false };
  delete copy.contentField;
  if (p.linkedFormats) {
    for (const snapshot of Object.values(p.linkedFormats.layouts)) {
      if (Object.hasOwn(snapshot.layers, id)) snapshot.layers[newId] = structuredClone(snapshot.layers[id]);
    }
  }
  p.layers.splice(index + 1, 0, copy);
  return validateProject(p);
}
export function layerAlpha(layer, time) {
  if (!layer.visible || time < layer.start || time >= layer.end) return 0;
  const fadeIn = layer.fadeIn ?? 0, fadeOut = layer.fadeOut ?? 0;
  return (evaluateChoreography(layer, time).opacity ?? 1) * Math.min(1, fadeIn > 0 ? (time - layer.start) / fadeIn : 1, fadeOut > 0 ? (layer.end - time) / fadeOut : 1);
}
export function audioTime(layer, time, mediaDuration) {
  const elapsed = Math.max(0, time - layer.start);
  const remaining = Math.max(0, mediaDuration - layer.offset);
  return layer.offset + (layer.loop && remaining > 0 ? elapsed % remaining : Math.min(elapsed, remaining));
}
export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function fileLayer(asset, duration, id) {
  const common = { id, name: asset.name.slice(0, 100), visible: true, locked: false, start: 0, end: duration, src: asset.src };
  if (/\.(mp3|wav|m4a|ogg)$/i.test(asset.src)) return { ...common, type: 'music', volume: 0.6, offset: 0, fade: 0.5, loop: false };
  const model = /\.glb$/i.test(asset.src);
  return { ...common, type: model ? 'model' : 'media', space: 'spatial', z: 0, tilt: 0, yaw: 0, roll: 0, x: 25, y: 25, size: 50, offset: 0, loop: true, fadeIn: 0, fadeOut: 0, ...(model ? { modelStyle: normalizeModelStyle() } : {}) };
}

export const carouselImages = (project, layer) => layer?.images ?? (layer ? project.images : []);
