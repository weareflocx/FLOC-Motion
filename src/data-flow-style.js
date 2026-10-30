import { assertPlainSceneRecord } from './scene-settings.js';

export const DEFAULT_DATA_FLOW = Object.freeze({
  seed: 7, fiberCount: 150, samples: 450,
  nodeDistance: 511, pinchSharpness: 3.6, spread: 100, pinchWidth: 0, noise: 2.5,
  speed: 1, flowSpeed: 85, travelSpeed: 6, particleSpeed: 50, particleCount: 1500,
  lineColor: '#36547d', lineOpacity: .4, lineWidth: 1,
  particleColor: '#8fb4ff', particleSize: 2,
  glowStrength: 1, glowRadius: .22, fog: .004, perspective: 45
});
export const DATA_FLOW_RANGES = Object.freeze({
  seed: [0, 65535], fiberCount: [1, 300], samples: [64, 512],
  nodeDistance: [100, 800], pinchSharpness: [1, 8], spread: [10, 150], pinchWidth: [0, 20], noise: [0, 10],
  speed: [-4, 4], flowSpeed: [-300, 300], travelSpeed: [-100, 100], particleSpeed: [-300, 300], particleCount: [0, 5000],
  lineOpacity: [0, 1], lineWidth: [.25, 6], particleSize: [.5, 12],
  glowStrength: [0, 3], glowRadius: [0, 1], fog: [0, .02], perspective: [15, 75]
});
export const DATA_FLOW_INTEGERS = Object.freeze(['seed', 'fiberCount', 'samples', 'particleCount']);
export function normalizeDataFlowStyle(input) {
  if (input !== undefined) {
    assertPlainSceneRecord(input, 'Data flow settings');
    if (Object.keys(input).some(key => !Object.hasOwn(DEFAULT_DATA_FLOW, key))) throw new Error('Unknown Data flow setting.');
  }
  const value = { ...DEFAULT_DATA_FLOW, ...input };
  for (const [key, [min, max]] of Object.entries(DATA_FLOW_RANGES)) {
    const setting = value[key];
    if (typeof setting !== 'number' || !Number.isFinite(setting) || setting < min || setting > max || DATA_FLOW_INTEGERS.includes(key) && !Number.isInteger(setting)) throw new Error(`Invalid Data flow ${key}.`);
  }
  for (const key of ['lineColor', 'particleColor']) if (typeof value[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(value[key])) throw new Error('Invalid Data flow color.');
  if (value.pinchWidth > value.spread) throw new Error('Data flow pinch width must not exceed bundle spread.');
  return value;
}

export function dataFlowLayer(duration, id) {
  return { id, type: 'dataflow', name: 'Data flow', visible: true, locked: false,
    start: 0, end: duration, space: 'flat', z: 0, tilt: 0, yaw: 0, roll: 0,
    x: 0, y: 0, size: 100, opacity: 1, fadeIn: 0, fadeOut: 0,
    flowStyle: normalizeDataFlowStyle()
  };
}
