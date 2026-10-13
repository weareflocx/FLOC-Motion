// Decoded card media and parsed models shared by the scenes of one preview
// session. A rebuild acquires the same keys before the previous scene releases
// them, so unchanged sources are not decoded again. The last release disposes.
export function createResourceCache() {
  const entries = new Map();
  return {
    acquire(key, load, dispose = () => {}) {
      let entry = entries.get(key);
      if (!entry) {
        entry = { refs: 0, value: Promise.resolve().then(load) };
        // A failed load is retried by the next scene instead of being cached.
        entry.value.catch(() => { if (entries.get(key) === entry) entries.delete(key); });
        entries.set(key, entry);
      }
      entry.refs++;
      let released = false;
      return {
        value: entry.value,
        release() {
          if (released) return;
          released = true;
          if (--entry.refs > 0) return;
          if (entries.get(key) === entry) entries.delete(key);
          entry.value.then(dispose, () => {});
        }
      };
    },
    get size() { return entries.size; }
  };
}

// Browsers drop WebGL contexts on GPU resets or when too many are open.
// Three.js recreates its GL state on restore; owners redraw. A context that is
// not restored in time is reported once.
export function watchContextLoss(canvas, { restored, failed, timeout = 5000 }) {
  let lost = false, timer;
  const onLost = event => {
    event.preventDefault();
    lost = true;
    clearTimeout(timer);
    timer = setTimeout(failed, timeout);
  };
  const onRestored = () => { lost = false; clearTimeout(timer); restored(); };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  return {
    get lost() { return lost; },
    dispose() { clearTimeout(timer); canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', onRestored); }
  };
}
