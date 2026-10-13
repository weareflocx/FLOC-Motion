import { EFFECT_FIELDS, animatedFields, captureState, choreographyFields, choreographyValue, evaluateChoreography } from '../choreography.js';

// Property controls and canvas gestures edit the state at the current playhead:
// always for the pose, and for optional values once a state holds them.
// Static values stay static.
export function choreographyPatch(layer, patch, time, fps) {
  if (!layer.choreography?.length || Object.hasOwn(patch, 'choreography')) return patch;
  const fields = choreographyFields(layer), animated = animatedFields(layer);
  const routed = key => Object.hasOwn(fields, key) || (animated.includes(key) && !Object.hasOwn(EFFECT_FIELDS, key));
  const values = Object.fromEntries(Object.entries(patch).filter(([key]) => routed(key)));
  const rest = Object.fromEntries(Object.entries(patch).filter(([key]) => !routed(key)));
  // Effect controls send the whole displayed list; animated amounts go to the
  // state and the layer keeps its own amounts.
  const effectFields = animated.filter(field => Object.hasOwn(EFFECT_FIELDS, field));
  if (Array.isArray(patch.effects) && effectFields.length) {
    const pose = evaluateChoreography(layer, time);
    const effects = patch.effects.map(effect => ({ ...effect }));
    for (const field of effectFields) {
      const { type, key } = EFFECT_FIELDS[field];
      const index = effects.findIndex(effect => effect.type === type);
      if (index === -1 || layer.effects?.findIndex(effect => effect.type === type) !== index) continue;
      if (effects[index][key] !== choreographyValue(pose, field)) values[field] = effects[index][key];
      effects[index][key] = layer.effects[index][key];
    }
    rest.effects = effects;
  }
  if (!Object.keys(values).length) return rest;
  return { ...rest, choreography: captureState(layer, time, fps, values) };
}
