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
  depth: [], arc: []
};
const TAU = Math.PI * 2;
const mod = (v, n) => ((v % n) + n) % n;
const clamp = v => Math.max(0, Math.min(1, v));
const fadeEdge = (d, limit) => clamp((limit - Math.abs(d)) * 2);
export function motionVariant(layer) {
  return layer.motionVariant && layer.motionVariant !== 'default' ? layer.motionVariant : MOTION_VARIANTS[layer.template]?.[0]?.[0];
}
export function carouselCard(layer, index, count, time) {
  const local = Math.max(0, time - layer.start);
  const cycle = layer.loopDuration > 0 ? (layer.speed === 0 ? 0 : local / layer.loopDuration * Math.sign(layer.speed)) : local * layer.speed / 360;
  const phase = mod(cycle, 1);
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
    const advance = layer.loopDuration > 0 ? phase * count : local * layer.speed / (layer.template === 'arc' ? 60 : 35);
    const offset = mod(index - advance + count / 2, count) - count / 2;
    if (layer.template === 'arc') {
      const a = offset * (0.34 + gap * 0.2);
      state.position = [Math.sin(a) * 3.6, Math.cos(a) * 3.6 - 2.1, -Math.abs(offset) * 0.06];
      state.rotation[2] = -a;
      state.opacity = layer.loopDuration > 0 ? fadeEdge(offset, Math.min(count / 2, 1.7 / (0.34 + gap * 0.2))) : Math.abs(a) < 1.7 ? 1 : 0;
    } else {
      state.position = layer.template === 'depth' ? [offset * (0.65 + gap), offset * 0.18, -Math.abs(offset) * 0.85] : [offset * (size + gap), 0, -Math.abs(offset) * 0.35];
      state.rotation[1] = offset * (layer.template === 'depth' ? 0.2 : -0.18);
      state.depth = Math.max(0.45, 1 - Math.abs(offset) * 0.14);
      state.opacity = layer.loopDuration > 0 ? fadeEdge(offset, Math.min(count / 2, 3.2)) : Math.abs(offset) < 3.2 ? 1 : 0;
      if (variant === 'focus') state.scale = 0.65 + 0.55 * Math.exp(-offset * offset * 1.2);
    }
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
    const progress = mod(phase - index / count, 1);
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
