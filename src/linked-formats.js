import { choreographyFields, evaluateChoreography } from './choreography.js';
import { fontDefinition } from './fonts.js';
import { DEFAULT_LAYOUT } from './layout.js';

// These are the only per-format properties. Content, timing and motion stay
// on the effective project; choreography caches only the local pose by state ID.
export const FORMAT_LOCAL_FIELDS = Object.freeze({
  text: ['x', 'y', 'roll', 'size', 'width', 'font', 'weight', 'lineHeight', 'letterSpacing', 'textAlign', 'choreography'],
  logo: ['x', 'y', 'roll', 'size', 'choreography'],
  media: ['x', 'y', 'roll', 'size', 'choreography'],
  model: ['x', 'y', 'size', 'tilt', 'yaw', 'roll', 'choreography'],
  carousel: ['x', 'y', 'size', 'tilt', 'yaw', 'roll', 'gap', 'radius', 'perspective', 'cardAspect', 'choreography'],
  background: ['fit', 'x', 'y', 'roll'],
  music: [],
  effect: ['choreography']
});

const fail = message => { throw new Error(message); };
const dangerous = key => ['__proto__', 'constructor', 'prototype'].includes(key);
const record = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const LOCAL_BOUNDS = {
  background: { x: [-100, 100], y: [-100, 100], roll: [-180, 180] },
  text: { roll: [-180, 180], x: [0, 95], y: [0, 95], size: [12, 180], width: [5, 100], lineHeight: [0.5, 3], letterSpacing: [-0.15, 0.5] },
  logo: { roll: [-180, 180], x: [-1000, 1000], y: [-1000, 1000], size: [2, 500] },
  media: { roll: [-180, 180], x: [-1000, 1000], y: [-1000, 1000], size: [2, 500] },
  model: { x: [-1000, 1000], y: [-1000, 1000], size: [2, 500], tilt: [-180, 180], yaw: [-180, 180], roll: [-180, 180] },
  carousel: { x: [10, 90], y: [10, 90], size: [0.5, 2.5], tilt: [-65, 65], yaw: [-180, 180], roll: [-180, 180], gap: [0, 1], radius: [0, 6], perspective: [15, 75], cardAspect: [0.25, 4] }
};
const ALL_FIELDS = new Set(Object.values(FORMAT_LOCAL_FIELDS).flat());
const ALL_BOUNDS = { x: [-100, 100], y: [-100, 100], size: [0.5, 180], width: [5, 100], lineHeight: [0.5, 3], letterSpacing: [-0.15, 0.5], tilt: [-180, 180], yaw: [-180, 180], roll: [-180, 180], gap: [0, 1], radius: [0, 6], perspective: [15, 75], cardAspect: [0.25, 4] };
const POSE_FIELDS = new Set(['x', 'y', 'size', 'tilt', 'yaw', 'roll']);
const numeric = (value, bounds) => typeof value === 'number' && Number.isFinite(value) && value >= bounds[0] && value <= bounds[1];
const validID = id => typeof id === 'string' && id.trim() && id.length <= 80 && !dangerous(id);
const formatRatios = (source, target, formats) => {
  const [sourceWidth, sourceHeight] = formats[source], [width, height] = formats[target];
  const shorter = Math.min(width, height), sourceShorter = Math.min(sourceWidth, sourceHeight);
  return { x: (shorter / width) / (sourceShorter / sourceWidth), y: (shorter / height) / (sourceShorter / sourceHeight) };
};

// Check the original objects before structuredClone can erase their prototypes.
export function assertLinkedFormatInput(linked) {
  if (!record(linked)) fail('Invalid linked format settings.');
  const visit = value => {
    if (value && typeof value === 'object') {
      if (!record(value)) fail('Invalid linked format object.');
      for (const [key, child] of Object.entries(value)) {
        if (dangerous(key)) fail('Unsafe linked format property.');
        visit(child);
      }
    }
  };
  visit(linked);
}

function validateLocalFields(local, layer, pose = false) {
  if (!record(local)) fail('Invalid linked layer settings.');
  const allowed = pose
    ? new Set(layer ? Object.keys(choreographyFields(layer)).filter(key => key !== 'opacity') : POSE_FIELDS)
    : new Set(layer ? FORMAT_LOCAL_FIELDS[layer.type] : ALL_FIELDS);
  const bounds = layer ? (pose ? choreographyFields(layer) : LOCAL_BOUNDS[layer.type] ?? {}) : ALL_BOUNDS;
  for (const [key, value] of Object.entries(local)) {
    if (dangerous(key) || !allowed.has(key)) fail('Only framing and typography may vary by format.');
    if (key === 'choreography') {
      if (!record(value) || Object.keys(value).length > 32) fail('Invalid linked choreography settings.');
      for (const [id, values] of Object.entries(value)) {
        if (!validID(id)) fail('Invalid linked state ID.');
        validateLocalFields(values, layer, true);
      }
    } else if (key === 'font') {
      if (typeof value !== 'string' || !fontDefinition(value)) fail('Unknown linked text font.');
    } else if (key === 'weight') {
      if (!Number.isInteger(value) || value < 100 || value > 900 || value % 100) fail('Invalid linked text weight.');
    } else if (key === 'fit') {
      if (!['cover', 'contain'].includes(value)) fail('Unknown linked background fit.');
    } else if (key === 'textAlign') {
      if (!['left', 'center', 'right'].includes(value)) fail('Unknown linked text alignment.');
    } else if (!bounds[key] || !numeric(value, bounds[key])) fail(`Invalid linked ${key}.`);
  }
  if (local.font !== undefined && local.weight !== undefined && !fontDefinition(local.font).weights.includes(local.weight)) fail('Unknown linked text style.');
}

function validateSnapshot(snapshot, layers) {
  if (!record(snapshot) || Object.keys(snapshot).some(key => !['layout', 'layers'].includes(key))
    || !record(snapshot.layout) || !record(snapshot.layers)) fail('Invalid linked format layout.');
  const layout = snapshot.layout;
  if (Object.keys(layout).some(key => !Object.hasOwn(DEFAULT_LAYOUT, key))
    || typeof layout.enabled !== 'boolean' || typeof layout.guides !== 'boolean'
    || !numeric(layout.marginX, [0, 25]) || !numeric(layout.marginY, [0, 25])) fail('Invalid linked safe layout.');
  if (Object.keys(snapshot.layers).length > 20) fail('Use up to 20 linked layer layouts.');
  for (const [id, local] of Object.entries(snapshot.layers)) {
    if (!validID(id)) fail('Invalid linked layer ID.');
    // A removed layer is checked before pruning so malformed data cannot hide.
    validateLocalFields(local, layers.find(layer => layer.id === id));
  }
}

export function captureFormatSnapshot(project) {
  const layers = {};
  for (const layer of project.layers) {
    const fields = FORMAT_LOCAL_FIELDS[layer.type];
    if (!fields.length) continue;
    if (!validID(layer.id)) fail('Invalid linked layer ID.');
    const local = {};
    for (const field of fields) {
      if (field === 'choreography') {
        local.choreography = {};
        for (const state of layer.choreography ?? []) {
          if (!validID(state.id)) fail('Invalid linked state ID.');
          local.choreography[state.id] = Object.fromEntries(Object.entries(state.values).filter(([key]) => key !== 'opacity'));
        }
      } else if (Object.hasOwn(layer, field)) local[field] = layer[field];
    }
    layers[layer.id] = local;
  }
  return { layout: { ...project.layout }, layers };
}

export function applyFormatSnapshot(project, format, snapshot) {
  return { ...project, format, layout: { ...snapshot.layout }, layers: project.layers.map(layer => {
    const local = snapshot.layers[layer.id];
    if (!local) return { ...layer };
    const { choreography, ...fields } = local;
    return { ...layer, ...fields, ...(layer.choreography === undefined ? {} : {
      choreography: layer.choreography.map(state => ({ ...state, values: { ...state.values, ...choreography?.[state.id] } }))
    }) };
  }) };
}

export function assistedFormatSnapshot(project, format, formats) {
  const { x: ratioX, y: ratioY } = formatRatios(project.format, format, formats);
  const layers = project.layers.map(layer => {
    const bounds = LOCAL_BOUNDS[layer.type];
    if (!bounds) return { ...layer };
    const center = ['carousel', 'model'].includes(layer.type);
    if (layer.type === 'background') return { ...layer };
    const position = (value, axis) => {
      const ratio = axis === 'x' ? ratioX : ratioY;
      // Keep outer-quarter edge margins while moving the baseline anchor
      // continuously through the center. Every state uses this same anchor.
      const anchor = center ? 50 : clamp((layer[axis] - 25) * 2, 0, 100);
      return clamp(anchor + (value - anchor) * ratio, ...bounds[axis]);
    };
    const sizeRatio = layer.type === 'carousel' ? ratioY : ratioX;
    const adapt = values => Object.fromEntries(Object.entries(values).map(([key, value]) => {
      if (key === 'x' || key === 'y') return [key, position(value, key)];
      if (['size', 'width', 'gap', 'radius'].includes(key)) return [key, clamp(value * (key === 'width' ? ratioX : sizeRatio), ...bounds[key])];
      return [key, value];
    }));
    const local = Object.fromEntries(FORMAT_LOCAL_FIELDS[layer.type].filter(key => key !== 'choreography' && Object.hasOwn(layer, key)).map(key => [key, layer[key]]));
    return { ...layer, ...adapt(local), choreography: layer.choreography.map(state => ({ ...state, values: adapt(state.values) })) };
  });
  return captureFormatSnapshot({ ...project, layers, layout: {
    ...project.layout, marginX: clamp(project.layout.marginX * ratioX, 0, 25), marginY: clamp(project.layout.marginY * ratioY, 0, 25)
  } });
}

function fillSnapshot(project, format, cached, formats, validate) {
  const assisted = assistedFormatSnapshot(project, format, formats);
  const ratios = formatRatios(project.format, format, formats);
  const layers = {};
  for (const [id, defaults] of Object.entries(assisted.layers)) {
    const local = cached.layers[id] ?? {};
    const source = project.layers.find(layer => layer.id === id);
    // Evaluate the existing curves before inserting missing states. A neutral
    // capture stays on each format's curve even after local pose corrections.
    const existing = source.choreography?.filter(state => Object.hasOwn(local.choreography ?? {}, state.id)) ?? [];
    const sourceBefore = { ...source, choreography: existing };
    const destinationBefore = { ...source, ...defaults, ...local, choreography: existing.map(state => ({
      ...state, values: { ...state.values, ...defaults.choreography[state.id], ...local.choreography[state.id] }
    })) };
    const choreography = defaults.choreography === undefined ? undefined : Object.fromEntries(source.choreography.map(state => {
      if (!Object.hasOwn(cached.layers, id)) return [state.id, defaults.choreography[state.id]];
      const time = source.start + state.time;
      const from = evaluateChoreography(sourceBefore, time), to = evaluateChoreography(destinationBefore, time);
      const values = Object.fromEntries(Object.entries(choreographyFields(source)).filter(([field]) => field !== 'opacity').map(([field, bounds]) => {
        const ratio = field === 'x' || field === 'y' ? ratios[field] : field === 'size' ? ratios[source.type === 'carousel' ? 'y' : 'x'] : 1;
        return [field, clamp(to[field] + (state.values[field] - from[field]) * ratio, ...bounds)];
      }));
      return [state.id, { ...values, ...local.choreography?.[state.id] }];
    }));
    layers[id] = { ...defaults, ...local, ...(choreography === undefined ? {} : { choreography }) };
  }
  const candidate = applyFormatSnapshot(project, format, { layout: cached.layout, layers });
  delete candidate.linkedFormats;
  return validate(candidate);
}

export function normalizeLinkedFormats(project, formats, validate) {
  const linked = project.linkedFormats;
  if (Object.keys(linked).some(key => !['master', 'layouts'].includes(key))
    || !Object.hasOwn(formats, linked.master) || !record(linked.layouts)
    || !Object.hasOwn(linked.layouts, linked.master)
    || Object.keys(linked.layouts).some(format => !Object.hasOwn(formats, format))) fail('Invalid linked format master or layouts.');
  for (const snapshot of Object.values(linked.layouts)) validateSnapshot(snapshot, project.layers);
  // Also validate the previous active cache before replacing it with current edits.
  if (linked.layouts[project.format]) fillSnapshot(project, project.format, linked.layouts[project.format], formats, validate);
  const active = captureFormatSnapshot(project);
  const master = project.format === linked.master ? project
    : fillSnapshot(project, linked.master, linked.layouts[linked.master], formats, validate);
  const layouts = { [linked.master]: captureFormatSnapshot(master) };
  for (const [format, cached] of Object.entries(linked.layouts)) {
    if (format === linked.master || format === project.format) continue;
    layouts[format] = captureFormatSnapshot(fillSnapshot(master, format, cached, formats, validate));
  }
  layouts[project.format] = active;
  return { master: linked.master, layouts };
}
