// Entry and exit movement (including the former wipe reveal) lives in text-motion.js.
export const DEFAULT_TEXT_STYLE = { lineHeight: 0.98, letterSpacing: -0.035, textAlign: 'left' };

export function textTypography(layer) {
  return {
    lineHeight: Number.isFinite(layer.lineHeight) ? layer.lineHeight : DEFAULT_TEXT_STYLE.lineHeight,
    letterSpacing: `${Number.isFinite(layer.letterSpacing) ? layer.letterSpacing : DEFAULT_TEXT_STYLE.letterSpacing}em`,
    textAlign: ['left', 'center', 'right'].includes(layer.textAlign) ? layer.textAlign : DEFAULT_TEXT_STYLE.textAlign
  };
}
