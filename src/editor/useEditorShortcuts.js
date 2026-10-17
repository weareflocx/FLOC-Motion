import { useEffect } from 'react';

const FIELD = 'input, textarea, select, [role="textbox"], [role="dialog"], [aria-modal="true"]';

// Typing targets and open dialogs keep their own keys; editor shortcuts stand down.
export function shortcutsBlocked(target) {
  return Boolean(target?.isContentEditable || target?.closest?.(FIELD) || document.querySelector('dialog[open], [aria-modal="true"]'));
}

export function useEditorShortcuts({ blocked, projectRef, selected, selection = selected == null ? [] : [selected], setPlaying, removeLayer, removeLayers, onSelectAll, onCollapseSelection, onOpenPalette }) {
  useEffect(() => {
    const onKeyDown = event => {
      if (blocked || event.defaultPrevented || event.isComposing) return;
      const target = event.target;
      const command = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey ? event.key.toLowerCase() : null;
      // ⌘K / Ctrl+K opens the command palette from anywhere outside another dialog.
      if (command === 'k' && onOpenPalette) {
        if (target?.closest?.('[role="dialog"], [aria-modal="true"]') || document.querySelector('dialog[open], [aria-modal="true"]')) return;
        event.preventDefault();
        if (!event.repeat) onOpenPalette();
        return;
      }
      if (shortcutsBlocked(target)) return;
      if (command === 'a' && onSelectAll) {
        event.preventDefault();
        onSelectAll();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key === 'Escape' && selection.length > 1 && onCollapseSelection) {
        event.preventDefault();
        onCollapseSelection();
      } else if (event.key === ' ') {
        // Canvas, layer selection and playback retain the editor's Space shortcut.
        if (target?.closest?.('button, a[href], [role="button"]') && !target.closest('.stage-holder, .layer-select, .canvas-play')) return;
        event.preventDefault();
        if (!event.repeat) setPlaying(value => !value);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        if (event.repeat) return;
        if (selection.length > 1 && removeLayers) {
          setPlaying(false);
          removeLayers(selection);
          return;
        }
        const layer = projectRef.current.layers.find(item => item.id === selected);
        if (!layer || layer.locked || layer.type === 'background') return;
        setPlaying(false);
        removeLayer(layer.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [blocked, projectRef, selected, selection, setPlaying, removeLayer, removeLayers, onSelectAll, onCollapseSelection, onOpenPalette]);
}
