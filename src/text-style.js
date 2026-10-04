export const DEFAULT_TEXT_STYLE = { lineHeight: 0.98, letterSpacing: -0.035, textAlign: 'left', reveal: 'none', revealDuration: 0.6 };
export const TEXT_REVEALS = [
  { id: 'none', name: 'None' },
  { id: 'up', name: 'Wipe up' },
  { id: 'down', name: 'Wipe down' },
  { id: 'right', name: 'Wipe right' },
  { id: 'left', name: 'Wipe left' }
];

export function textTypography(layer) {
  return {
    lineHeight: Number.isFinite(layer.lineHeight) ? layer.lineHeight : DEFAULT_TEXT_STYLE.lineHeight,
    letterSpacing: `${Number.isFinite(layer.letterSpacing) ? layer.letterSpacing : DEFAULT_TEXT_STYLE.letterSpacing}em`,
    textAlign: ['left', 'center', 'right'].includes(layer.textAlign) ? layer.textAlign : DEFAULT_TEXT_STYLE.textAlign
  };
}

export function textRevealClip(layer, time) {
  if (!TEXT_REVEALS.some(reveal => reveal.id === layer.reveal && reveal.id !== 'none')) return 'none';
  const duration = Number.isFinite(layer.revealDuration) ? Math.max(0, layer.revealDuration) : DEFAULT_TEXT_STYLE.revealDuration;
  const local = (Number.isFinite(time) ? time : 0) - (layer.start ?? 0);
  const progress = duration === 0 ? (local < 0 ? 0 : 1) : Math.max(0, Math.min(1, local / duration));
  if (progress === 1) return 'none';
  const hidden = `${Number(((1 - progress) * 100).toFixed(6))}%`;
  const edges = { up: [hidden, '0%', '0%', '0%'], down: ['0%', '0%', hidden, '0%'], right: ['0%', hidden, '0%', '0%'], left: ['0%', '0%', '0%', hidden] };
  return `inset(${edges[layer.reveal].join(' ')})`;
}
