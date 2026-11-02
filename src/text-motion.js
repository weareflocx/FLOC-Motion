import { easeProgress } from './easing.js';
import { assertPlainSceneRecord } from './scene-settings.js';

// Text entry/exit movement. Opacity ramps stay in the layer's fadeIn/fadeOut,
// so a movement and its fade may have different lengths. Distances are a
// percentage of the composition's shorter side; Scale amounts are the
// percentage the text grows or shrinks by. Directions name the direction of
// travel along the text's own axes.
export const TEXT_MOTIONS = Object.freeze(['none', 'rise', 'slide', 'reveal', 'scale']);
export const TEXT_DIRECTIONS = Object.freeze(['up', 'down', 'left', 'right']);
export const TEXT_CHARACTERS = Object.freeze([
  Object.freeze({ id: 'linear', name: 'Linear', easing: 'linear' }),
  Object.freeze({ id: 'smooth', name: 'Smooth', easing: 'ease-out' }),
  Object.freeze({ id: 'precise', name: 'Precise', easing: 'ease-in-out' }),
  Object.freeze({ id: 'weighted', name: 'Weighted', easing: 'back' }),
  Object.freeze({ id: 'elastic', name: 'Elastic', easing: 'spring' })
]);
export const TEXT_MOTION_RANGES = Object.freeze({ duration: Object.freeze([0, 30]), distance: Object.freeze([0, 25]), scale: Object.freeze([0, 50]) });
export const DEFAULT_TEXT_ENTRY = Object.freeze({ motion: 'none', direction: 'up', amount: 4, duration: .6, character: 'smooth' });
// A mirrored exit plays the entry movement backwards over its own duration.
export const DEFAULT_TEXT_EXIT = Object.freeze({ mirror: true, motion: 'none', direction: 'up', amount: 4, duration: .4, character: 'smooth' });

// Presets are recipes over a movement and the layer's fade on the same side.
export const TEXT_MOTION_PRESETS = Object.freeze([
  Object.freeze({ id: 'none', name: 'None', motion: 'none', fade: false }),
  Object.freeze({ id: 'fade', name: 'Fade', motion: 'none', fade: true }),
  Object.freeze({ id: 'rise', name: 'Rise', motion: 'rise', amount: 3, fade: true }),
  Object.freeze({ id: 'slide', name: 'Slide', motion: 'slide', direction: 'right', amount: 8, fade: true }),
  Object.freeze({ id: 'reveal', name: 'Reveal', motion: 'reveal', direction: 'up', amount: 4, fade: false }),
  Object.freeze({ id: 'scale', name: 'Scale', motion: 'scale', amount: 10, fade: true })
]);

const fail = message => { throw new Error(message); };
const DIRECTED = ['slide', 'reveal'];
const fadeKey = side => side === 'entry' ? 'fadeIn' : 'fadeOut';

export function normalizeTextMotion(side, input) {
  if (!['entry', 'exit'].includes(side)) fail('Unknown text motion side.');
  const defaults = side === 'entry' ? DEFAULT_TEXT_ENTRY : DEFAULT_TEXT_EXIT;
  const value = input === undefined ? {} : assertPlainSceneRecord(input, `text ${side}`);
  for (const key of Object.keys(value)) if (!Object.hasOwn(defaults, key)) fail(`Unknown text ${side} property.`);
  const motion = { ...defaults, ...value };
  if (side === 'exit' && typeof motion.mirror !== 'boolean') fail('Exit mirror must be true or false.');
  if (!TEXT_MOTIONS.includes(motion.motion)) fail(`Unknown text ${side} movement.`);
  if (!TEXT_DIRECTIONS.includes(motion.direction)) fail(`Unknown text ${side} direction.`);
  if (!TEXT_CHARACTERS.some(character => character.id === motion.character)) fail(`Unknown text ${side} character.`);
  const [min, max] = motion.motion === 'scale' ? TEXT_MOTION_RANGES.scale : TEXT_MOTION_RANGES.distance;
  if (typeof motion.amount !== 'number' || !Number.isFinite(motion.amount) || motion.amount < min || motion.amount > max) fail(`Text ${side} ${motion.motion === 'scale' ? 'scale' : 'distance'} must be between ${min} and ${max}.`);
  const [shortest, longest] = TEXT_MOTION_RANGES.duration;
  if (typeof motion.duration !== 'number' || !Number.isFinite(motion.duration) || motion.duration < shortest || motion.duration > longest) fail(`Text ${side} duration must be between ${shortest} and ${longest} seconds.`);
  return motion;
}

// The movement that actually plays on each side; a mirrored exit borrows the entry's.
const exitSpec = layer => layer.exit?.mirror ? layer.entry : layer.exit;
const active = spec => Boolean(spec && spec.motion !== 'none');

// Entry and exit movements share the layer's span, as fades do.
export function fitTextMotion(entry, exit, span) {
  const a = active(entry) ? entry.duration : 0, b = active(exit.mirror ? { ...exit, motion: entry.motion } : exit) ? exit.duration : 0;
  if (a + b <= span + 1e-9) return { entry, exit };
  const scale = span / (a + b);
  return { entry: a ? { ...entry, duration: entry.duration * scale } : entry, exit: b ? { ...exit, duration: exit.duration * scale } : exit };
}

// The preset a side currently shows. A mirrored exit reports 'mirror'.
export function textMotionPreset(layer, side) {
  if (side === 'exit' && layer.exit?.mirror) return 'mirror';
  const spec = side === 'entry' ? layer.entry : layer.exit;
  if (active(spec)) return spec.motion;
  return (layer[fadeKey(side)] ?? 0) > 0 ? 'fade' : 'none';
}

// The layer patch that applies a preset, keeping the side's duration, character
// and (for directed movements) direction. Fading presets fade over the movement.
export function textMotionPresetPatch(layer, side, id) {
  const preset = TEXT_MOTION_PRESETS.find(item => item.id === id) ?? fail('Unknown text motion preset.');
  const current = normalizeTextMotion(side, side === 'entry' ? layer.entry : layer.exit);
  const fade = layer[fadeKey(side)] ?? 0;
  const duration = active(current) ? current.duration : fade > 0 ? fade : current.duration;
  const next = { ...current, motion: preset.motion, duration, ...(side === 'exit' && { mirror: false }) };
  if (preset.amount !== undefined) next.amount = preset.amount;
  if (preset.direction && !(DIRECTED.includes(current.motion) && active(current))) next.direction = preset.direction;
  return { [side]: next, [fadeKey(side)]: preset.fade ? duration : 0 };
}

function opposite(direction) { return { up: 'down', down: 'up', left: 'right', right: 'left' }[direction]; }
const UNIT = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const travel = spec => spec.motion === 'rise' ? 'up' : spec.direction;
const curve = spec => TEXT_CHARACTERS.find(item => item.id === spec.character).easing;

// `remaining` is how much of the movement is left (1 at its far end, 0 at rest; may
// overshoot below 0 with Weighted/Elastic). `visible` is the revealed share.
function apply(spec, direction, remaining, visible, out) {
  if (spec.motion === 'scale') { out.scale *= 1 - spec.amount / 100 * remaining; return; }
  const [ux, uy] = UNIT[direction];
  out.offsetX -= ux * spec.amount * remaining; out.offsetY -= uy * spec.amount * remaining;
  if (spec.motion === 'reveal') { out.reveal = direction; out.visible = visible; }
}

// Pure in the supplied time, so seeks and exported frames agree. Reuses `out`.
export function textMotionAt(layer, time, out = {}) {
  out.offsetX = out.offsetY = 0; out.scale = 1; out.reveal = null; out.visible = 1;
  if (layer.type !== 'text' || !layer.entry || !layer.exit) return out;
  const local = time - layer.start, toEnd = layer.end - time;
  const entry = layer.entry, exit = exitSpec(layer), length = layer.exit.duration;
  if (active(entry) && entry.duration > 0 && local < entry.duration) {
    const eased = easeProgress(curve(entry), Math.max(0, local) / entry.duration);
    apply(entry, travel(entry), 1 - eased, Math.min(1, Math.max(0, eased)), out);
  }
  if (active(exit) && length > 0 && toEnd < length) {
    // An exit is an entry played backwards: mirrored exits retrace the entry; others
    // retrace an entry from the opposite side, so they leave in their own direction.
    const eased = easeProgress(curve(exit), Math.max(0, toEnd) / length);
    apply(exit, layer.exit.mirror ? travel(exit) : opposite(travel(exit)), 1 - eased, Math.min(1, Math.max(0, eased)), out);
  }
  return out;
}

// CSS for a sample on a box of `width` × `height` CSS pixels. Translation follows the
// text's own axes; Reveal clips a window fixed at the text's resting box.
export function textMotionStyle(sample, width, height, shortSide) {
  const dx = sample.offsetX / 100 * shortSide, dy = sample.offsetY / 100 * shortSide;
  const transform = `${dx || dy ? `translate(${dx}px,${dy}px) ` : ''}${sample.scale !== 1 ? `scale(${sample.scale})` : ''}`.trim();
  if (!sample.reveal) return { transform, clipPath: 'none' };
  const hidden = 1 - sample.visible;
  let top = 0, bottom = height, left = 0, right = width;
  if (sample.reveal === 'up') top = hidden * height;
  else if (sample.reveal === 'down') bottom = (1 - hidden) * height;
  else if (sample.reveal === 'right') right = (1 - hidden) * width;
  else left = hidden * width;
  const px = value => `${Number(Math.max(0, value).toFixed(4))}px`;
  return { transform, clipPath: `inset(${px(top - dy)} ${px(width - right + dx)} ${px(height - bottom + dy)} ${px(left - dx)})` };
}
