// Saved projects keep the schema version they were written with. Each step
// upgrades plain JSON from vN to vN+1; validation only describes the current shape.
export const CURRENT_PROJECT_VERSION = 11;

const fail = message => { throw new Error(message); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
// Legacy text entrance: fixed 0.45 s in / 0.25 s out ramps, optionally rising.
const TEXT_ENTRANCES = { none: [0, 0, false], fade: [0.45, 0.25, false], rise: [0.45, 0.25, true] };

// Image IDs are only list keys (nothing references a card by ID), so empty or
// repeated IDs are renamed by position; the first use of an ID keeps it.
function repairImageIds(images) {
  if (!Array.isArray(images)) return;
  const used = new Set(), broken = [];
  images.forEach((image, index) => {
    if (!record(image) || typeof image.id !== 'string') return;
    if (image.id.trim() && !used.has(image.id)) used.add(image.id);
    else broken.push(index);
  });
  for (const index of broken) {
    let id = `image-${index + 1}`;
    for (let suffix = 2; used.has(id); suffix++) id = `image-${index + 1}-${suffix}`;
    used.add(id);
    images[index].id = id;
  }
}
// Frozen here so later default changes never alter what a v1 file migrates to.
const V1_LAYOUT = { enabled: false, marginX: 5, marginY: 5, guides: true };

function v1ToV2(project) {
  if (project.layout === undefined) project.layout = { ...V1_LAYOUT };
  repairImageIds(project.images);
  for (const layer of Array.isArray(project.layers) ? project.layers : []) {
    if (!record(layer)) continue;
    if (layer.type === 'carousel') repairImageIds(layer.images);
    if (layer.type === 'text' && layer.animation !== undefined) {
      if (!Object.hasOwn(TEXT_ENTRANCES, layer.animation)) fail('Unknown text style.');
      const [fadeIn, fadeOut, rise] = TEXT_ENTRANCES[layer.animation];
      layer.fadeIn ??= fadeIn; layer.fadeOut ??= fadeOut; layer.rise ??= rise;
      delete layer.animation;
    }
  }
  return project;
}

// v2 content fields were bare labels. They become typed declarations whose ids are
// slugs of the label, suffixed in layer order when labels repeat ("headline", "headline-2").
// The slug rule is frozen here so a v2 file always migrates to the same ids.
// Anything that is not a label string is left for validation to reject.
const v2Slug = label => label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56).replace(/-+$/, '') || 'field';
function v2ToV3(project) {
  const used = new Set();
  for (const layer of Array.isArray(project.layers) ? project.layers : []) {
    if (!record(layer) || typeof layer.contentField !== 'string') continue;
    const label = layer.contentField.trim();
    if (!label) { delete layer.contentField; continue; }
    const base = v2Slug(label);
    let id = base;
    for (let suffix = 2; used.has(id); suffix++) id = `${base}-${suffix}`;
    used.add(id);
    layer.contentField = { id, label, required: false };
  }
  return project;
}

// v3 retired the Depth, Arc and Nested Rise carousels. Each maps to its closest
// remaining family; a variant the target family lacks falls back to its default.
// Targets and their variants are frozen here so a v3 file always migrates alike.
const V3_RETIRED_CAROUSELS = {
  depth: { template: 'showcase', variants: ['queue'] },
  arc: { template: 'wheel', variants: ['rock', 'ring'], motionVariant: 'rock' },
  'nested-rise': { template: 'zoom-through', variants: [] }
};
function v3ToV4(project) {
  for (const layer of Array.isArray(project.layers) ? project.layers : []) {
    if (!record(layer) || layer.type !== 'carousel' || !Object.hasOwn(V3_RETIRED_CAROUSELS, layer.template)) continue;
    const { template, variants, motionVariant } = V3_RETIRED_CAROUSELS[layer.template];
    layer.template = template;
    if (motionVariant) layer.motionVariant = motionVariant;
    else if (layer.motionVariant !== undefined && !variants.includes(layer.motionVariant)) layer.motionVariant = 'default';
  }
  return project;
}

// v4 retired Twist. A single torsion panel becomes Flip (one card changing through a turn);
// the torsion ribbon becomes a Horizontal strip. Frozen here so a v4 file always migrates alike.
function v4ToV5(project) {
  for (const layer of Array.isArray(project.layers) ? project.layers : []) {
    if (!record(layer) || layer.type !== 'carousel' || layer.template !== 'twist') continue;
    const ribbon = layer.motionVariant === 'ribbon';
    layer.template = ribbon ? 'horizontal' : 'flip';
    layer.motionVariant = ribbon ? 'strip' : 'default';
  }
  return project;
}

// v5 progress curves were blended with linear by their intensity k. Each becomes
// its closest v6 curve, whose intensity is the curve's own strength (null keeps
// k). At k = 0 every curve showed the family's Original motion, and Sweep Reveal
// always drew Glide as its Original wipe. Choreography transitions keep their
// character at the default strength. Frozen here so a v5 file always migrates alike.
const V5_CURVES = {
  linear: ['linear', null], smooth: ['ease-in-out', 0.35], natural: ['ease-in-out', 0.35], slow: ['ease-in-out', 0.5],
  'ease-in': ['ease-in', 0.25], 'ease-out': ['ease-out', 0.25], glide: ['ease-out', 0.5], vive: ['ease-out', 1],
  back: ['back', 0.4], bounce: ['bounce', 1], elastic: ['spring', 1]
};
const V5_EASINGS = { smooth: 'ease-in-out', natural: 'ease-in-out', slow: 'ease-in-out', glide: 'ease-out', vive: 'ease-out', elastic: 'spring' };
function v5Motion(motion, template) {
  if (!record(motion) || typeof motion.curve !== 'string' || !Object.hasOwn(V5_CURVES, motion.curve) || typeof motion.intensity !== 'number') return;
  if (motion.intensity === 0 || (template === 'sweep-reveal' && motion.curve === 'glide')) {
    motion.curve = 'native';
    motion.intensity = 0.5;
    return;
  }
  const [curve, scale] = V5_CURVES[motion.curve];
  motion.curve = curve;
  if (scale !== null) motion.intensity = Math.round(motion.intensity * scale * 1000) / 1000;
}
function v5ToV6(project) {
  for (const layer of Array.isArray(project.layers) ? project.layers : []) {
    if (!record(layer)) continue;
    if (layer.type === 'carousel') {
      v5Motion(layer.motion, layer.template);
      if (record(layer.motionBaseline)) v5Motion(layer.motionBaseline.motion, layer.template);
    }
    for (const state of Array.isArray(layer.choreography) ? layer.choreography : []) {
      if (record(state) && typeof state.easing === 'string' && Object.hasOwn(V5_EASINGS, state.easing)) state.easing = V5_EASINGS[state.easing];
    }
  }
  return project;
}

// v6 Pattern scale was a density: larger values drew smaller, denser patterns.
// From v7 larger values draw larger patterns. The 0.25–4 range maps onto
// itself under 1/x, so every saved background keeps its exact feature size.
function v6ToV7(project) {
  for (const layer of Array.isArray(project.layers) ? project.layers : []) {
    if (record(layer) && layer.type === 'background' && typeof layer.patternScale === 'number' && layer.patternScale > 0) layer.patternScale = 1 / layer.patternScale;
  }
  return project;
}

// v7 carousels carried a single per-card shader and a single whole-carousel
// finish beside their effect stack. From v8 both are entries of the one effect
// stack every layer shares: the card shader first (cards were drawn first), then
// the finish, then the existing effects. Elastic stretch becomes the `stretch`
// geometry property. Choreography `intensity` and `layerEffectIntensity` values
// move to the amount field of the effect they drove. Defaults are the v7
// validation defaults, frozen here so a v7 file always migrates alike.
const V7_CARD_DEFAULTS = { shader: 'none', intensity: 0.35, tint: '#0000ff' };
const V7_FINISH_DEFAULTS = { layerEffect: 'none', layerEffectIntensity: 1, halftoneSize: 0.35, ditheringSize: 0.35, ditheringSteps: 4, glassSize: 0.35, glassDistortion: 0.5 };
const V7_FIELDS = [...Object.keys(V7_CARD_DEFAULTS), ...Object.keys(V7_FINISH_DEFAULTS)];
// [effect, choreography field] per card shader. The duotone shader mixed from
// linear 0.02 (sRGB #282828) to the tint; the chromatic shader pulsed.
const V7_CARD_SHADERS = {
  none: [null, null],
  wave: [v => ({ type: 'wave', enabled: true, amount: v.intensity, size: 0.5, speed: 1 }), 'waveAmount'],
  mono: [v => ({ type: 'monochrome', enabled: true, amount: v.intensity }), 'monochromeAmount'],
  duotone: [v => ({ type: 'duotone', enabled: true, amount: v.intensity, shadow: '#282828', highlight: v.tint }), 'duotoneAmount'],
  chromatic: [v => ({ type: 'chromatic', enabled: true, amount: v.intensity, animated: true }), 'chromaticAmount'],
  elastic: [null, 'stretch']
};
const V7_FINISHES = {
  none: [null, null],
  halftone: [v => ({ type: 'halftone', enabled: true, amount: v.layerEffectIntensity, size: v.halftoneSize }), 'halftoneAmount'],
  dithering: [v => ({ type: 'dithering', enabled: true, amount: v.layerEffectIntensity, size: v.ditheringSize, steps: v.ditheringSteps }), 'ditheringAmount'],
  'fluted-glass': [v => ({ type: 'fluted-glass', enabled: true, amount: v.layerEffectIntensity, size: v.glassSize, distortion: v.glassDistortion }), 'glassAmount']
};
const v7Number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
function validateV7Effects(v) {
  if (!Object.hasOwn(V7_CARD_SHADERS, v.shader) || !Object.hasOwn(V7_FINISHES, v.layerEffect) || !/^#[0-9a-f]{6}$/i.test(v.tint)
    || !v7Number(v.intensity, 0, 1) || !v7Number(v.layerEffectIntensity, 0, 1) || !v7Number(v.halftoneSize, 0, 1)
    || !v7Number(v.ditheringSize, 0, 1) || !Number.isInteger(v.ditheringSteps) || !v7Number(v.ditheringSteps, 1, 7)
    || !v7Number(v.glassSize, 0, 1) || !v7Number(v.glassDistortion, 0, 1)) fail('Invalid v7 carousel effect settings.');
}
function v7ToV8(project) {
  for (const layer of Array.isArray(project.layers) ? project.layers : []) {
    if (!record(layer) || layer.type !== 'carousel') continue;
    const v = { ...V7_CARD_DEFAULTS, ...V7_FINISH_DEFAULTS };
    for (const field of V7_FIELDS) if (layer[field] !== undefined) v[field] = layer[field];
    validateV7Effects(v);
    const [card, cardField] = V7_CARD_SHADERS[v.shader];
    const [finish, finishField] = V7_FINISHES[v.layerEffect];
    const added = [card?.(v), finish?.(v)].filter(Boolean);
    if (layer.effects === undefined) layer.effects = [];
    if (added.length) {
      if (!Array.isArray(layer.effects)) fail('Invalid carousel effects.');
      layer.effects = [...added, ...layer.effects];
    }
    if (v.shader === 'elastic') layer.stretch = v.intensity;
    for (const state of Array.isArray(layer.choreography) ? layer.choreography : []) {
      if (!record(state) || !record(state.values)) continue;
      const { values } = state;
      if (Object.hasOwn(values, 'intensity')) { if (cardField) values[cardField] = values.intensity; delete values.intensity; }
      if (Object.hasOwn(values, 'layerEffectIntensity')) { if (finishField) values[finishField] = values.layerEffectIntensity; delete values.layerEffectIntensity; }
    }
    for (const field of V7_FIELDS) delete layer[field];
  }
  return project;
}

// v8 models used source materials, the fixed hemisphere/key rig and the first
// embedded clip. Freeze all settings here so future defaults cannot restyle them.
const V8_MODEL_STYLE = Object.freeze({
  mode: 'original', color: '#ffffff', roughness: 0.5, metalness: 0, clearcoat: 0, iridescence: 0,
  emissive: '#000000', emissiveIntensity: 0,
  shader: 'standard', toonSteps: 4, fresnelColor: '#ffffff', fresnelIntensity: 0.5, fresnelPower: 3,
  environment: 'none', environmentIntensity: 1, environmentRotation: 0,
  ambientIntensity: 3, keyIntensity: 3, fillIntensity: 0, rimIntensity: 0, lightRotation: 0,
  motion: 'none', motionDuration: 6, motionSpeed: 1, motionAmplitude: 1,
  animationClip: 0, animationSpeed: 1
});
function v8ToV9(project) {
  for (const layer of Array.isArray(project.layers) ? project.layers : []) {
    if (!record(layer) || layer.type !== 'model') continue;
    const style = layer.modelStyle;
    if (style === undefined || (record(style) && [Object.prototype, null].includes(Object.getPrototypeOf(style)))) layer.modelStyle = { ...V8_MODEL_STYLE, ...style };
  }
  return project;
}

// v9 automatic motion used the native continuous clock on its preset's axis.
// Keep these frozen rather than importing defaults that may change in the future.
const V9_MODEL_MOTION = Object.freeze({
  motionAxis: 'auto', motionSteps: 4,
  motionTiming: Object.freeze({ mode: 'continuous', action: 1, pause: 0, curve: 'native', intensity: .5 })
});
function v9ToV10(project) {
  for (const layer of Array.isArray(project.layers) ? project.layers : []) {
    if (!record(layer) || layer.type !== 'model') continue;
    const style = layer.modelStyle;
    if (style === undefined || (record(style) && [Object.prototype, null].includes(Object.getPrototypeOf(style)))) {
      layer.modelStyle = { ...V9_MODEL_MOTION, motionTiming: { ...V9_MODEL_MOTION.motionTiming }, ...style };
    }
  }
  return project;
}

// v10 models used a fixed 38° camera 4.5 units away from a model scaled to two
// units, so rotation and motion could reach past the layer. Frozen here.
const V10_MODEL_CAMERA = Object.freeze({ framing: 'fixed', zoom: 1, perspective: 38 });
function v10ToV11(project) {
  for (const layer of Array.isArray(project.layers) ? project.layers : []) {
    if (!record(layer) || layer.type !== 'model') continue;
    const style = layer.modelStyle;
    if (style === undefined || (record(style) && [Object.prototype, null].includes(Object.getPrototypeOf(style)))) layer.modelStyle = { ...V10_MODEL_CAMERA, ...style };
  }
  return project;
}

// MIGRATIONS[n - 1] upgrades version n to n + 1. Steps receive a private copy.
const MIGRATIONS = [v1ToV2, v2ToV3, v3ToV4, v4ToV5, v5ToV6, v6ToV7, v7ToV8, v8ToV9, v9ToV10, v10ToV11];

export function migrateProject(input) {
  if (!record(input)) fail('Invalid project.');
  if (!Object.hasOwn(input, 'version')) fail('Project version is missing.');
  const { version } = input;
  if (!Number.isInteger(version) || version < 1) fail('Invalid project version.');
  if (version > CURRENT_PROJECT_VERSION) fail('This project was created by a newer version of FLOC Motion.');
  let project = structuredClone(input);
  for (let from = version; from < CURRENT_PROJECT_VERSION; from++) project = { ...MIGRATIONS[from - 1](project), version: from + 1 };
  return project;
}
