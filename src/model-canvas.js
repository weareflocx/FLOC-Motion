// What each drawn model canvas shows, for editor hit-testing, guides and handles.
// Keyed by the layer canvas so editor geometry needs only the DOM node.
const drawn = new WeakMap();

// `geometry` reports `bounds()` as canvas fractions ({ x, y, width, height },
// null when nothing is visible) and `hitTest(u, v)` for canvas fractions, both
// for the pose last drawn. Returns the unregister function.
export function registerModelCanvas(canvas, geometry) {
  drawn.set(canvas, geometry);
  return () => { if (drawn.get(canvas) === geometry) drawn.delete(canvas); };
}

export const modelCanvasGeometry = canvas => drawn.get(canvas) ?? null;
