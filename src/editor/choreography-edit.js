import { captureState, choreographyFields } from '../choreography.js';

// Property controls and canvas gestures edit the state at the current playhead.
export function choreographyPatch(layer, patch, time, fps) {
  if (!layer.choreography?.length || Object.hasOwn(patch, 'choreography')) return patch;
  const fields = choreographyFields(layer);
  const values = Object.fromEntries(Object.entries(patch).filter(([key]) => Object.hasOwn(fields, key)));
  if (!Object.keys(values).length) return patch;
  const rest = Object.fromEntries(Object.entries(patch).filter(([key]) => !Object.hasOwn(fields, key)));
  return { ...rest, choreography: captureState(layer, time, fps, values) };
}
