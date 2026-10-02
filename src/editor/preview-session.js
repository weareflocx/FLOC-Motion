// Keep the current scene alive while preparing at most one replacement.
export function createPreviewSession({ prepare, activate, onError, update }) {
  let current;
  let pending;
  let preparing = false;
  let disposed = false;
  async function drain() {
    if (preparing || disposed) return;
    preparing = true;
    while (pending && !disposed) {
      const request = pending;
      pending = null;
      try {
        const next = await prepare(request);
        if (disposed || pending) next.scene.dispose();
        else {
          const previous = current;
          try { activate(next); current = next; }
          catch (error) { next.scene.dispose(); throw error; }
          previous?.scene.dispose();
        }
      } catch (error) { if (!disposed && !pending) onError(error); }
    }
    preparing = false;
  }
  return {
    request(project) {
      if (disposed) return;
      if (!preparing && current && update?.(current, project)) { current.project = project; return; }
      pending = project; void drain();
    },
    get current() { return current; },
    dispose() { disposed = true; pending = null; current?.scene.dispose(); current = null; }
  };
}
