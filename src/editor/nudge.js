export const DEFAULT_NUDGE = Object.freeze({ small: 1, big: 8 });
const valid = value => Number.isInteger(value) && value >= 1 && value <= 1000;

export function loadNudge() {
  try {
    const saved = JSON.parse(localStorage.getItem('floc-motion:nudge'));
    if (saved && valid(saved.small) && valid(saved.big)) return { small: saved.small, big: saved.big };
  } catch {}
  return { ...DEFAULT_NUDGE };
}

export function saveNudge(value) {
  if (!valid(value.small) || !valid(value.big)) return;
  try { localStorage.setItem('floc-motion:nudge', JSON.stringify(value)); } catch {}
}

export const nudgeAmount = (settings = DEFAULT_NUDGE, shift = false) => shift ? settings.big : settings.small;
