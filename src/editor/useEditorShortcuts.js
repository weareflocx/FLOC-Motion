import { useEffect } from 'react';

export function useEditorShortcuts({ blocked, projectRef, selected, setPlaying, removeLayer }) {
  useEffect(() => {
    const onKeyDown = event => {
      if (blocked || event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target;
      if (target?.isContentEditable || target?.closest?.('input, textarea, select, [role="textbox"], [role="dialog"], [aria-modal="true"]')) return;
      if (document.querySelector('dialog[open], [aria-modal="true"]')) return;
      if (event.key === ' ') {
        // Canvas, layer selection and playback retain the editor's Space shortcut.
        if (target?.closest?.('button, a[href], [role="button"]') && !target.closest('.stage-holder, .layer-select, .canvas-play')) return;
        event.preventDefault();
        if (!event.repeat) setPlaying(value => !value);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        if (event.repeat) return;
        const layer = projectRef.current.layers.find(item => item.id === selected);
        if (!layer || layer.locked) return;
        setPlaying(false);
        removeLayer(layer.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [blocked, projectRef, selected, setPlaying, removeLayer]);
}
