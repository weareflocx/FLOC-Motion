import { BRAND } from './brand.js';
import { patchLayer, validateProject } from './project.js';

const fail = message => { throw new Error(message); };
const record = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

const COMMON_VISUAL_FIELDS = ['opacity', 'fadeIn', 'fadeOut'];
const VISUAL_FIELDS = Object.freeze({
  background: new Set(['color', 'mode', 'fit', 'pattern', 'patternColor', 'patternScale', 'patternIntensity', 'patternSpeed', 'patternSeed']),
  text: new Set([...COMMON_VISUAL_FIELDS, 'x', 'y', 'size', 'color', 'font', 'weight', 'width', 'rise', 'lineHeight', 'letterSpacing', 'textAlign', 'reveal', 'revealDuration']),
  logo: new Set([...COMMON_VISUAL_FIELDS, 'x', 'y', 'size']),
  media: new Set([...COMMON_VISUAL_FIELDS, 'x', 'y', 'size']),
  model: new Set([...COMMON_VISUAL_FIELDS, 'x', 'y', 'size', 'tilt', 'yaw', 'roll']),
  carousel: new Set([...COMMON_VISUAL_FIELDS, 'shader', 'intensity', 'tint', 'layerEffect', 'layerEffectIntensity', 'halftoneSize', 'ditheringSize', 'ditheringSteps', 'glassSize', 'glassDistortion', 'perspective', 'yaw', 'transitionTurn', 'cornerRadius', 'cardShape', 'frontface', 'backface', 'cardCount', 'cardAspect', 'radius', 'fade', 'tilt', 'roll', 'size', 'gap', 'curve', 'x', 'y'])
});

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function assertSafeRecord(value, label) {
  if (!record(value)) fail(`Invalid ${label}.`);
  if (Object.keys(value).some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) fail(`Unsafe ${label}.`);
}

function validateAlternativeInput(alternative, names) {
  assertSafeRecord(alternative, 'visual alternative');
  if (Object.keys(alternative).some(key => !['name', 'patches'].includes(key))) fail('Unknown visual alternative property.');
  if (typeof alternative.name !== 'string' || !alternative.name.trim() || alternative.name.length > 40) fail('Alternative names must be nonempty and use up to 40 characters.');
  const name = alternative.name.trim();
  if (names.has(name.toLowerCase())) fail('Alternative names must be unique.');
  names.add(name.toLowerCase());
  if (!Array.isArray(alternative.patches) || !alternative.patches.length || alternative.patches.length > 20) fail('Use between 1 and 20 visual layer patches.');
  return name;
}

function validatePatchInput(entry, project, ids) {
  assertSafeRecord(entry, 'visual layer patch');
  if (Object.keys(entry).some(key => !['id', 'patch'].includes(key))) fail('Unknown visual layer patch property.');
  if (typeof entry.id !== 'string' || !entry.id || entry.id.length > 80) fail('Invalid layer ID.');
  if (ids.has(entry.id)) fail('Each alternative may patch a layer once.');
  ids.add(entry.id);
  const layer = project.layers.find(item => item.id === entry.id);
  if (!layer) fail('Layer not found.');
  if (layer.type === 'music') fail('Music cannot be changed by a visual alternative.');
  if (!layer.visible) fail('Show the layer before including it in an alternative.');
  if (layer.locked) fail('Unlock the layer before including it in an alternative.');
  assertSafeRecord(entry.patch, 'visual patch');
  if (!Object.keys(entry.patch).length) fail('Visual patches cannot be empty.');
  const allowed = VISUAL_FIELDS[layer.type];
  if (!allowed || Object.keys(entry.patch).some(key => !allowed.has(key))) fail(`Only visual ${layer.type} properties may be proposed.`);
}

export function buildVisualAlternatives(current, input) {
  const validatedCurrent = validateProject(current);
  assertSafeRecord(input, 'visual alternatives request');
  if (Object.keys(input).some(key => !['base', 'alternatives'].includes(key))) fail('Unknown visual alternatives request property.');
  assertSafeRecord(input.base, 'proposal base');
  const base = validateProject(input.base);
  if (canonical(base) !== canonical(validatedCurrent)) fail('The proposal base is stale. Read the current project and try again.');
  if (!Array.isArray(input.alternatives) || input.alternatives.length < 2 || input.alternatives.length > 3) fail('Provide two or three visual alternatives.');

  const names = new Set(), candidates = new Set();
  const alternatives = input.alternatives.map(alternative => {
    const name = validateAlternativeInput(alternative, names);
    const ids = new Set();
    let project = base;
    for (const entry of alternative.patches) {
      validatePatchInput(entry, base, ids);
      project = patchLayer(project, entry.id, entry.patch);
    }
    const fingerprint = canonical(project);
    if (fingerprint === canonical(base)) fail(`Alternative “${name}” does not change the design.`);
    if (candidates.has(fingerprint)) fail('Visual alternatives must produce distinct designs.');
    candidates.add(fingerprint);
    return { name, project };
  });
  return { base: current, alternatives };
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const shifted = (value, delta, min, max) => {
  const preferred = clamp(value + delta, min, max);
  return preferred === value ? clamp(value - delta, min, max) : preferred;
};

function curatedPatch(layer, direction) {
  if (layer.type === 'background') return direction === 'Editorial'
    ? { mode: 'procedural', color: BRAND.colors.black, pattern: 'grid', patternColor: BRAND.colors.white, patternScale: 0.72, patternIntensity: 0.22, patternSpeed: 0.08, patternSeed: (layer.patternSeed + 11) % 65536 }
    : direction === 'Bold'
      ? { mode: 'procedural', color: BRAND.colors.black, pattern: 'rays', patternColor: BRAND.colors.red, patternScale: 1.2, patternIntensity: 0.62, patternSpeed: 0.32, patternSeed: (layer.patternSeed + 23) % 65536 }
      : { mode: 'procedural', color: BRAND.colors.black, pattern: 'flow', patternColor: BRAND.colors.blue, patternScale: 1.65, patternIntensity: 0.7, patternSpeed: -0.45, patternSeed: (layer.patternSeed + 37) % 65536 };
  if (layer.type === 'text') return direction === 'Editorial'
    ? { size: shifted(layer.size, -4, 12, 180), font: 'geist', weight: 400, lineHeight: 1.05, letterSpacing: -0.02, textAlign: 'left', reveal: 'up', revealDuration: 0.5 }
    : direction === 'Bold'
      ? { size: shifted(layer.size, 8, 12, 180), font: 'druk-wide', weight: 900, lineHeight: 0.82, letterSpacing: -0.055, textAlign: 'left', reveal: 'right', revealDuration: 0.35 }
      : { size: shifted(layer.size, -8, 12, 180), font: 'geist-mono', weight: 700, lineHeight: 1.18, letterSpacing: 0.045, textAlign: 'center', reveal: 'left', revealDuration: 0.8 };
  if (layer.type === 'carousel') return direction === 'Editorial'
    ? { size: shifted(layer.size, -0.08, 0.5, 2.5), shader: 'mono', intensity: 0.2, tint: BRAND.colors.white, layerEffect: 'none', cornerRadius: 3, gap: 0.2 }
    : direction === 'Bold'
      ? { size: shifted(layer.size, 0.14, 0.5, 2.5), shader: 'duotone', intensity: 0.76, tint: BRAND.colors.red, layerEffect: 'halftone', layerEffectIntensity: 0.55, halftoneSize: 0.42, cornerRadius: 0, gap: 0.14 }
      : { size: shifted(layer.size, -0.16, 0.5, 2.5), shader: 'chromatic', intensity: 0.72, tint: BRAND.colors.blue, layerEffect: 'fluted-glass', layerEffectIntensity: 0.64, glassSize: 0.46, glassDistortion: 0.7, cornerRadius: 18, gap: 0.36 };
  if (layer.type === 'model') return direction === 'Editorial'
    ? { size: shifted(layer.size, -4, 2, 100), yaw: 0, roll: 0 }
    : direction === 'Bold'
      ? { size: shifted(layer.size, 8, 2, 100), yaw: clamp(layer.yaw + 12, -180, 180), roll: clamp(layer.roll - 6, -180, 180) }
      : { size: shifted(layer.size, -8, 2, 100), yaw: clamp(layer.yaw - 24, -180, 180), roll: clamp(layer.roll + 12, -180, 180) };
  if (['logo', 'media'].includes(layer.type)) {
    const maximum = layer.type === 'logo' ? 35 : 100;
    const delta = direction === 'Editorial' ? -1 : direction === 'Bold' ? 2 : -2;
    return { size: shifted(layer.size, delta, 2, maximum) };
  }
  return null;
}

export function createStyleAlternatives(project) {
  const current = validateProject(project);
  const editable = current.layers.filter(layer => layer.type !== 'music' && layer.visible && !layer.locked && VISUAL_FIELDS[layer.type]);
  if (!editable.length) fail('Unlock and show a visual layer before exploring styles.');
  const alternatives = ['Editorial', 'Bold', 'Experimental'].map(name => {
    const patches = editable.map(layer => ({ id: layer.id, patch: curatedPatch(layer, name) })).filter(entry => entry.patch);
    return { name, patches };
  });
  return buildVisualAlternatives(project, { base: project, alternatives });
}

export function visualAlternativePreview(project) {
  const preview = validateProject(project);
  preview.layout.guides = false;
  preview.layers = preview.layers.map(layer => layer.type === 'music' ? { ...layer, visible: false } : layer);
  return preview;
}
