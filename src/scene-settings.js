export const SPATIAL_LAYER_TYPES = Object.freeze(['text', 'logo', 'media', 'model', 'carousel']);
export const LAYER_SPACES = Object.freeze(['flat', 'spatial']);
export const SCENE_DEPTH_RANGE = Object.freeze([-1000, 1000]);
export const SCENE_CAMERA_RANGES = Object.freeze(Object.fromEntries(Object.entries({
  zoom: [.25, 4], perspective: [15, 75], yaw: [-180, 180], pitch: [-85, 85], roll: [-180, 180],
  targetX: [-1000, 1000], targetY: [-1000, 1000], targetZ: SCENE_DEPTH_RANGE
}).map(([key, range]) => [key, Object.freeze(range)])));
export const DEFAULT_SCENE = Object.freeze({ camera: Object.freeze({
  projection: 'orthographic', zoom: 1, perspective: 38, yaw: 0, pitch: 0, roll: 0, targetX: 50, targetY: 50, targetZ: 0
}) });

const OBJECT_CONSTRUCTOR_SOURCE = Function.prototype.toString.call(Object);

// Realm identity differs, but a standard Object prototype is the null-rooted,
// reciprocal prototype of its native Object constructor. Inspect without getters.
function plainRecordPrototype(prototype) {
  if (prototype === null) return true;
  if (Object.getPrototypeOf(prototype) !== null) return false;
  const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
  if (!constructor || !Object.hasOwn(constructor, 'value') || constructor.enumerable
    || !constructor.writable || !constructor.configurable || typeof constructor.value !== 'function'
    || Function.prototype.toString.call(constructor.value) !== OBJECT_CONSTRUCTOR_SOURCE) return false;
  const owner = Object.getOwnPropertyDescriptor(constructor.value, 'prototype');
  return owner?.value === prototype && !owner.writable && !owner.enumerable && !owner.configurable;
}

// Inspect descriptors before cloning/spreading: accessors, symbols and exotic
// prototypes must not turn into apparently safe authored settings.
export function assertPlainSceneRecord(value, label = 'scene settings') {
  if (!value || typeof value !== 'object' || !plainRecordPrototype(Object.getPrototypeOf(value))) throw new Error(`Invalid ${label}.`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)
      || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new Error(`Invalid ${label}.`);
  }
  return value;
}

export function normalizeScene(value = DEFAULT_SCENE) {
  assertPlainSceneRecord(value);
  if (Object.keys(value).some(key => key !== 'camera')) throw new Error('Unknown scene property.');
  const camera = Object.hasOwn(value, 'camera') ? assertPlainSceneRecord(value.camera, 'scene camera') : {};
  for (const [key, setting] of Object.entries(camera)) {
    if (key === 'projection') {
      if (!['orthographic', 'perspective'].includes(setting)) throw new Error('Unknown scene camera projection.');
    } else {
      if (!Object.hasOwn(SCENE_CAMERA_RANGES, key)) throw new Error('Unknown scene camera property.');
      const range = SCENE_CAMERA_RANGES[key];
      if (typeof setting !== 'number' || !Number.isFinite(setting) || setting < range[0] || setting > range[1]) throw new Error(`Scene camera ${key} must be between ${range[0]} and ${range[1]}.`);
    }
  }
  return { camera: { ...DEFAULT_SCENE.camera, ...camera } };
}
