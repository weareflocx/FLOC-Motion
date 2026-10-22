// Composition size limits shared by validation, editor controls and agent tools.
export const PROJECT_LIMITS = Object.freeze({
  minDuration: 1,
  maxDuration: 300,
  maxLayers: 50,
  maxImages: 48,
  maxCardCount: 48
});
// Procedural background pattern scale: 10–400%.
export const PATTERN_SCALE = Object.freeze({ min: 0.1, max: 4 });
