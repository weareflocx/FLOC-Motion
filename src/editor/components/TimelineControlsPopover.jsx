import React, { useLayoutEffect, useRef } from 'react';
import { X } from '@phosphor-icons/react';

// The native top layer keeps controls outside the timeline's scrolling viewport.
export function TimelineControlsPopover({ anchor, layer, onClose, children }) {
  const ref = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!anchor?.isConnected) { close.current(); return; }
    panel.showPopover();
    const position = () => {
      const rect = anchor.getBoundingClientRect();
      const width = panel.offsetWidth, height = panel.offsetHeight;
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
      const top = rect.top >= height + 20 ? rect.top - height - 8 : Math.min(rect.bottom + 8, window.innerHeight - height - 12);
      panel.style.left = `${left}px`;
      panel.style.top = `${Math.max(12, top)}px`;
    };
    position();
    panel.focus({ preventScroll: true });
    const observer = new ResizeObserver(position);
    observer.observe(panel);
    const scroll = event => { if (event.target.contains?.(anchor)) close.current(); };
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', position);
    return () => {
      observer.disconnect();
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', position);
      panel.hidePopover();
    };
  }, [anchor]);

  function dismiss() {
    anchor?.focus({ preventScroll: true });
    onClose();
  }

  return <div ref={ref} id="timeline-layer-controls" className="timeline-controls-popover" popover="auto" role="dialog" aria-modal="false" aria-labelledby="timeline-controls-title" tabIndex={-1}
    onToggle={event => { if (event.newState === 'closed' && !ref.current?.matches(':popover-open')) onClose(); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); } }}>
    <div className="timeline-controls-heading"><h3 id="timeline-controls-title">{layer.name} · Choreography</h3>{layer.locked && <span className="timeline-context-hint">Locked</span>}<button type="button" className="icon-button" aria-label="Close layer controls" onClick={dismiss}><X size={16}/></button></div>
    {children}
  </div>;
}
