// Metadata comes from the model already decoded by the scene, not a second asset fetch.
const entries = new Map();
const listeners = new Map();
const notify = src => { for (const listener of listeners.get(src) ?? []) listener(); };
export const getModelMetadata = src => entries.get(src)?.value ?? null;
export function subscribeModelMetadata(src, listener) {
  let group = listeners.get(src);
  if (!group) { group = new Set(); listeners.set(src, group); }
  group.add(listener);
  return () => { group.delete(listener); if (!group.size) listeners.delete(src); };
}
export function registerModelMetadata(src, value) {
  let entry = entries.get(src);
  if (entry) entry.refs++;
  else { entry = { value, refs: 1 }; entries.set(src, entry); notify(src); }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--entry.refs === 0 && entries.get(src) === entry) { entries.delete(src); notify(src); }
  };
}
