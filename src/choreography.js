export const CHOREOGRAPHY_EASINGS = [
  ['linear', 'Linear'], ['smooth', 'Smooth'], ['ease-in', 'Ease in'], ['ease-out', 'Ease out']
];

const COMMON_FIELDS = { x: [0, 95], y: [0, 95], opacity: [0, 1], roll: [-180, 180] };
const FIELDS = {
  effect: { opacity: [0, 1] },
  text: { ...COMMON_FIELDS, size: [12, 180] },
  logo: { ...COMMON_FIELDS, x: [-1000, 1000], y: [-1000, 1000], size: [2, 500] },
  media: { ...COMMON_FIELDS, x: [-1000, 1000], y: [-1000, 1000], size: [2, 500] },
  model: { ...COMMON_FIELDS, x: [-1000, 1000], y: [-1000, 1000], size: [2, 500], tilt: [-180, 180], yaw: [-180, 180], roll: [-180, 180] },
  carousel: { x: [10, 90], y: [10, 90], size: [0.5, 2.5], opacity: [0, 1], tilt: [-65, 65], yaw: [-180, 180], roll: [-180, 180] }
};

export const choreographyFields = layer => FIELDS[layer?.type] ?? {};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const ease = (value, easing) => easing === 'smooth' ? value * value * (3 - 2 * value)
  : easing === 'ease-in' ? value * value
    : easing === 'ease-out' ? 1 - (1 - value) ** 2 : value;

// Only the supplied time determines a pose, so seeking and exported frames agree.
export function evaluateChoreography(layer, absoluteTime) {
  const states = layer.choreography;
  if (!states?.length) return layer;
  const time = absoluteTime - layer.start;
  if (time <= states[0].time) return { ...layer, ...states[0].values };
  const last = states.at(-1);
  if (time >= last.time) return { ...layer, ...last.values };
  const index = states.findIndex(state => state.time >= time);
  const from = states[index - 1], to = states[index];
  const progress = ease((time - from.time) / (to.time - from.time), to.easing);
  const values = Object.fromEntries(Object.keys(choreographyFields(layer)).map(field => [field, from.values[field] + (to.values[field] - from.values[field]) * progress]));
  return { ...layer, ...values };
}

function frameRate(fps) {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('A positive frame rate is required.');
  return fps;
}

export function stateAtTime(layer, absoluteTime, fps) {
  frameRate(fps);
  const time = absoluteTime - layer.start;
  const exact = layer.choreography?.reduce((closest, state) => Math.abs(state.time - time) <= 1e-9 && (!closest || Math.abs(state.time - time) < Math.abs(closest.time - time)) ? state : closest, undefined);
  const frame = Math.round(time * fps);
  return exact ?? layer.choreography?.find(state => Math.round(state.time * fps) === frame);
}

export function captureState(layer, absoluteTime, fps, patch = {}, id = crypto.randomUUID()) {
  frameRate(fps);
  const fields = choreographyFields(layer);
  if (!Object.keys(fields).length) throw new Error('This layer cannot have choreography.');
  if (!Number.isFinite(absoluteTime)) throw new Error('State time must be finite.');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(field => !Object.hasOwn(fields, field))) throw new Error('Invalid choreography values.');
  const maxFrame = Math.floor(Math.min(30, layer.end - layer.start) * fps + 1e-9);
  const frameTime = clamp(Math.round((absoluteTime - layer.start) * fps), 0, maxFrame) / fps;
  const existing = stateAtTime(layer, absoluteTime, fps) ?? stateAtTime(layer, layer.start + frameTime, fps);
  // Preserve off-frame imported times when replacing their frame, keeping ordering intact.
  const time = existing?.time ?? frameTime;
  const pose = evaluateChoreography(layer, layer.start + time);
  const values = Object.fromEntries(Object.keys(fields).map(field => [field, Object.hasOwn(patch, field) ? patch[field] : pose[field] ?? (field === 'opacity' ? 1 : field === 'roll' ? 0 : undefined)]));
  const state = { id: existing?.id ?? id, time, easing: existing?.easing ?? 'smooth', values };
  return [...(layer.choreography ?? []).filter(entry => entry.id !== existing?.id), state].sort((a, b) => a.time - b.time);
}

export function moveState(layer, id, localTime, fps) {
  frameRate(fps);
  if (!Number.isFinite(localTime)) throw new Error('State time must be finite.');
  const states = layer.choreography ?? [];
  const index = states.findIndex(state => state.id === id);
  if (index === -1) throw new Error('State not found.');
  const minFrame = index > 0 ? Math.round(states[index - 1].time * fps) + 1 : 0;
  const clipEnd = Math.floor(Math.min(30, layer.end - layer.start) * fps + 1e-9);
  const maxFrame = Math.min(clipEnd, index < states.length - 1 ? Math.round(states[index + 1].time * fps) - 1 : clipEnd);
  if (minFrame > maxFrame) return states;
  const time = clamp(Math.round(localTime * fps), minFrame, maxFrame) / fps;
  return states.map(state => state.id === id ? { ...state, time } : state);
}
