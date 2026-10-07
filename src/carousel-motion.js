import { DEFAULT_MOTION, motionClock, motionEase, smoothProgress, sweepProgress } from './motion-timing.js';
// Original, absolute-time motion models shared by preview and export.
export const MOTION_VARIANTS = {
  circular: [['wrapped', 'Wrapped ring'], ['billboard', 'Upright orbit'], ['inward', 'Inner corridor'], ['bloom', 'Splayed orbit']],
  horizontal: [['strip', 'Continuous strip'], ['focus', 'Focus scale']],
  showcase: [['queue', 'Perspective queue']],
  sphere: [['billboard', 'Upright cloud'], ['tangent', 'Tangential shell'], ['cloud', 'Multi-axis cloud']],
  spinner: [['rotor', 'Axis rotor'], ['hinge', 'Hinged rotor'], ['fan', 'Radial fan']],
  stack: [['deck', 'Cycling deck'], ['stairs', 'Staircase'], ['spread', 'Splayed deck'], ['radial', 'Rosette'], ['infinite', 'Depth queue']],
  stickers: [['peel', 'Peeling posters'], ['scatter', 'Sticker field']],
  twist: [['single', 'Single torsion'], ['ribbon', 'Torsion ribbon']],
  wheel: [['rock', 'Rocking arc'], ['ring', 'Radial wheel']],
  flip: [['step', 'Step and turn']],
  depth: [], arc: [], 'nested-rise': [], 'zoom-through': [],
  'stack-shuffle': [['down', 'Down'], ['up', 'Up'], ['left', 'Left'], ['right', 'Right']],
  'sweep-reveal': [['right', 'Right'], ['left', 'Left'], ['up', 'Up'], ['down', 'Down']],
  'window-push': [['right', 'Right'], ['left', 'Left'], ['up', 'Up'], ['down', 'Down']]
};
const TAU = Math.PI * 2;
const mod = (v, n) => ((v % n) + n) % n;
const clamp = v => Math.max(0, Math.min(1, v));
const fadeEdge = (d, limit) => clamp((limit - Math.abs(d)) * 2);
export function motionVariant(layer) {
  return layer.motionVariant && layer.motionVariant !== 'default' ? layer.motionVariant : MOTION_VARIANTS[layer.template]?.[0]?.[0];
}
export function carouselCard(layer, index, count, time) {
  const motion = layer.motion ?? DEFAULT_MOTION;
  const clock = motionClock(layer, count, time);
  const phase = clock.phase;
  const angle = phase * TAU;
  const size = layer.size, gap = layer.gap;
  const radius = layer.radius > 0 ? layer.radius : Math.max(1.45, count * (size + gap) / TAU);
  const variant = motionVariant(layer);
  const state = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, opacity: 1, depth: 1, torsion: 0 };
  const theta = index / count * TAU + angle;
  const d = mod(index - phase * count + count / 2, count) - count / 2;
  if (layer.template === 'circular') {
    state.position = [Math.sin(theta) * radius, 0, Math.cos(theta) * radius];
    state.rotation[1] = variant === 'billboard' ? 0 : theta + (variant === 'inward' ? Math.PI : 0);
    if (variant === 'bloom') state.rotation[1] = Math.sin(theta) * 0.65;
    state.depth = 0.65 + (Math.cos(theta) + 1) * 0.175;
    state.opacity = 1 - (layer.fade || 0) * (1 - Math.cos(theta)) / 2;
  } else if (layer.template === 'horizontal' || layer.template === 'depth' || layer.template === 'arc') {
    // Preserve legacy speed semantics unless an explicit loop duration is set.
    const advance = clock.advance;
    const timed = layer.loopDuration > 0 || clock.stepped;
    const offset = mod(index - advance + count / 2, count) - count / 2;
    if (layer.template === 'arc') {
      const a = offset * (0.34 + gap * 0.2);
      state.position = [Math.sin(a) * 3.6, Math.cos(a) * 3.6 - 2.1, -Math.abs(offset) * 0.06];
      state.rotation[2] = -a;
      state.opacity = timed ? fadeEdge(offset, Math.min(count / 2, 1.7 / (0.34 + gap * 0.2))) : Math.abs(a) < 1.7 ? 1 : 0;
    } else {
      state.position = layer.template === 'depth' ? [offset * (0.65 + gap), offset * 0.18, -Math.abs(offset) * 0.85] : [offset * (size + gap), 0, -Math.abs(offset) * 0.35];
      state.rotation[1] = offset * (layer.template === 'depth' ? 0.2 : -0.18);
      state.depth = Math.max(0.45, 1 - Math.abs(offset) * 0.14);
      state.opacity = timed ? fadeEdge(offset, Math.min(count / 2, 3.2)) : Math.abs(offset) < 3.2 ? 1 : 0;
      if (variant === 'focus') state.scale = 0.65 + 0.55 * Math.exp(-offset * offset * 1.2);
    }
  } else if (layer.template === 'flip') {
    const step = phase * count;
    const progress = (step % 1 - 0.6) / 0.4;
    const t = clamp(progress);
    const advance = clock.stepped ? step : Math.floor(step) + motionEase(t, motion, smoothProgress(t));
    const offset = mod(index - advance + count / 2, count) - count / 2;
    state.position = [offset * (size + gap + 0.25), 0, -Math.abs(offset) * 0.08];
    const turn = clamp(Math.abs(offset));
    state.rotation[1] = Math.sign(offset) * (layer.transitionTurn ?? 360) * Math.PI / 180 * turn * turn * (3 - 2 * turn);
    state.opacity = fadeEdge(offset, Math.min(count / 2, 2));
  } else if (layer.template === 'showcase') {
    state.position = [d * (size * 0.6 + gap), -d * 0.6, -Math.abs(d) * 0.65];
    state.rotation = [0.18, -0.32, -0.12];
    state.opacity = fadeEdge(d, Math.min(count / 2, 4));
  } else if (layer.template === 'sphere') {
    const y = 1 - 2 * (index + 0.5) / count;
    const a = index * Math.PI * (3 - Math.sqrt(5));
    const r = Math.sqrt(1 - y * y);
    const x = r * Math.cos(a), z = r * Math.sin(a);
    const radial = layer.radius > 0 ? radius : Math.max(1.3, Math.sqrt(count) * size * 0.38);
    state.position = [(x * Math.cos(angle) + z * Math.sin(angle)) * radial, y * radial, (z * Math.cos(angle) - x * Math.sin(angle)) * radial];
    if (variant === 'cloud') {
      state.position[1] += Math.sin(angle * 2 + a) * radial * 0.25;
      state.position[0] += Math.cos(angle * 3 + a) * radial * 0.15;
    }
    if (variant === 'tangent') state.rotation = [-Math.asin(y), Math.atan2(state.position[0], state.position[2]), 0];
    state.scale = 0.55 + 0.25 * (state.position[2] / radial + 1) / 2;
    state.depth = 0.6 + 0.4 * (state.position[2] / radial + 1) / 2;
  } else if (layer.template === 'spinner') {
    const r = layer.radius > 0 ? radius : Math.max(size, count * size / TAU * 0.6);
    if (variant === 'fan') {
      state.position = [Math.sin(theta) * r * 0.6, Math.cos(theta) * r * 0.6, Math.sin(theta) * 0.3];
      state.rotation = [0, Math.sin(theta) * 0.45, -theta];
    } else {
      state.position = [0, Math.sin(theta) * r, Math.cos(theta) * r];
      state.rotation[0] = -theta;
      if (variant === 'hinge') { state.position[0] = Math.sin(theta) * size * 0.5; state.rotation[1] = Math.sin(theta) * 0.6; }
    }
  } else if (['nested-rise', 'zoom-through'].includes(layer.template)) {
    const centered = layer.template === 'zoom-through';
    const age = mod(phase * count - index + (centered ? 0.5 : 0), count);
    // Older cards reach full size behind the next card before being recycled.
    const progress = clamp(age / Math.max(1, Math.min(centered ? 2.4 : 3, count - 1)));
    state.scale = Math.max(1e-6, motionEase(progress, motion, 1 - (1 - progress) ** 3));
    if (centered) state.rotation[2] = (layer.zoomRotation ?? 0) * Math.PI / 180 * (1 - clamp(state.scale));
    else state.position[1] = (state.scale - 1) * size / (2 * layer.cardAspect);
    state.renderOrder = count - age;
    if (count === 1) state.opacity = clamp((1 - age) * 8);
  } else if (layer.template === 'window-push') {
    const rawBeat = phase * count;
    const nearestBeat = Math.round(rawBeat);
    const beat = Math.abs(rawBeat - nearestBeat) < 1e-10 ? nearestBeat : rawBeat;
    const progress = clock.stepped ? beat % 1 : clamp(motionEase(beat % 1, motion, 1 - (1 - beat % 1) ** 3));
    const slot = mod(index - Math.floor(beat), count);
    const horizontal = ['left', 'right'].includes(variant);
    const sign = ['left', 'down'].includes(variant) ? -1 : 1;
    state.push = [0, 0, 1, layer.windowSpacing ?? 0];
    state.renderOrder = slot === 1 ? 2 : 1;
    state.opacity = slot === 0 || slot === 1 && progress > 0 ? 1 : 0;
    if (count > 1) {
      state.push[horizontal ? 0 : 1] = sign * (progress - Math.min(slot, 1));
      state.push[2] = 1 + (layer.windowZoom ?? 0.5) * (slot === 0 ? progress : 1 - progress);
    }
  } else if (layer.template === 'sweep-reveal') {
    const beat = phase * count;
    const progress = clock.stepped ? beat % 1 : sweepProgress(beat % 1, motion);
    const slot = mod(index - Math.floor(beat), count);
    state.clip = [0, 0, 1, 1];
    state.renderOrder = slot === 1 ? 2 : 1;
    state.opacity = slot === 0 || slot === 1 && progress > 0 ? 1 : 0;
    // Clip local UVs, so the photograph never shifts or scales during the reveal.
    if (slot === 1) {
      if (variant === 'left') state.clip[0] = 1 - progress;
      else if (variant === 'up') state.clip[3] = progress;
      else if (variant === 'down') state.clip[1] = 1 - progress;
      else state.clip[2] = progress;
    }
  } else if (layer.template === 'stack-shuffle') {
    const beat = phase * count;
    const transition = clamp((beat % 1 - 0.25) / 0.25);
    const progress = clock.stepped ? beat % 1 : clamp(motionEase(transition, motion, smoothProgress(transition)));
    const slot = mod(index - Math.floor(beat), count);
    state.renderOrder = 4 - slot;
    state.positionPixels = [0, 0];
    if (slot === 0) {
      const travel = progress ** 2 * (1.5 + size);
      const horizontal = ['left', 'right'].includes(variant);
      const sign = ['down', 'left'].includes(variant) ? -1 : 1;
      state.position[horizontal ? 0 : 1] = sign * travel;
      state.rotation[2] = (layer.shuffleRotation ?? 28) * Math.PI / 180 * progress;
      state.opacity = progress < 1 ? 1 : 0;
    } else {
      const level = slot - progress;
      state.scale = 0.9 ** level;
      // Keep an exposed strip above each smaller card, measured in canvas pixels.
      state.position[1] = (1 - state.scale) * size / (2 * layer.cardAspect);
      state.positionPixels[1] = level * (layer.shuffleGap ?? 36);
      state.opacity = clamp(3 - level);
    }
  } else if (layer.template === 'stack') {
    const slot = mod(index - phase * count, count);
    const limit = Math.min(count, variant === 'radial' ? 10 : 5);
    state.opacity = clamp(slot * 3) * clamp((limit - slot) * 2);
    state.position = [slot * 0.07, slot * 0.07, -slot * 0.2];
    if (variant === 'stairs') state.position = [slot * 0.35, slot * 0.35, -slot * 0.35];
    if (variant === 'spread') { state.position = [Math.sin(slot * 0.28) * 1.3, Math.cos(slot * 0.28) * 1.3 - 1.3, -slot * 0.2]; state.rotation[2] = -slot * 0.28; }
    if (variant === 'radial') { state.rotation[2] = slot * TAU / limit; state.position = [Math.sin(state.rotation[2]) * 0.5, Math.cos(state.rotation[2]) * 0.5, -slot * 0.1]; }
    if (variant === 'infinite') state.position = [0, slot * 0.5 - 1, -slot * 0.85];
  } else if (layer.template === 'stickers') {
    const rawProgress = mod(phase - index / count, 1);
    const progress = clock.stepped ? rawProgress : motionEase(rawProgress, motion);
    const envelope = clamp(progress * count * 2) * clamp((1 - progress) * count * 2);
    state.opacity = index === 0 && variant === 'scatter' ? 1 : envelope;
    if (variant === 'peel') {
      state.position = [progress ** 3 * 4, progress ** 3 * 2, -index * 0.02 + progress];
      state.rotation = [progress ** 2 * 0.5, progress ** 2 * 1.5, progress ** 2 * -0.4];
      state.torsion = progress * 0.5;
    } else {
      const a = index * 2.399963;
      const r = index === 0 ? 0 : 0.5 + Math.sqrt(index / count) * 1.8;
      state.position = [Math.cos(a) * r, Math.sin(a) * r, index * 0.015];
      state.rotation[2] = Math.sin(index * 7.1) * 0.45;
      state.scale = index === 0 ? 1 : 0.55 * (0.6 + 0.4 * envelope);
      state.torsion = (1 - envelope) * 0.7;
    }
  } else if (layer.template === 'twist') {
    state.position = variant === 'single' ? [0, 0, -Math.abs(d) * 0.15] : [0, d * (size / (layer.cardAspect || 1 / 1.14) + gap), -Math.abs(d) * 0.15];
    state.opacity = fadeEdge(d, Math.min(count / 2, variant === 'single' ? 1 : 2.5));
    state.torsion = Math.sin(angle * count + index / count * TAU) * 1.2;
    state.rotation[1] = Math.sin(angle * count) * 0.35;
  } else if (layer.template === 'wheel') {
    const a = variant === 'rock' ? (index - (count - 1) / 2) * 0.3 + Math.sin(angle) * 0.45 : theta;
    const r = layer.radius > 0 ? radius : Math.max(2.2, count * (size + gap) / TAU);
    state.position = [Math.sin(a) * r, Math.cos(a) * r - (variant === 'rock' ? r * 0.55 : 0), 0];
    state.rotation[2] = -a;
    if (variant === 'rock') state.opacity = fadeEdge(a, 1.55);
  }
  return state;
}

export function elasticState(layer, card) {
  const distance = Math.abs(card.position[0]) / (layer.size + layer.gap + 0.25);
  const influence = clamp(distance);
  const weight = influence * influence * (3 - 2 * influence);
  const facing = Math.cos(card.rotation[1]);
  return {
    strength: layer.shader === 'elastic' ? layer.intensity * weight * Math.abs(facing) : 0,
    side: Math.sign(card.position[0]) * (facing < 0 ? -1 : 1)
  };
}
