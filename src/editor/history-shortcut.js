export function historyShortcut(event) {
  if (event.defaultPrevented || event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey)) return null;
  const target = event.target;
  if (target?.isContentEditable || target?.closest?.('input, textarea, select, [role="dialog"], [aria-modal="true"]')) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey) return 'redo';
  return null;
}
