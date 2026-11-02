import React, { useRef } from 'react';
import { X } from '@phosphor-icons/react';
import { Modal } from '../controls.jsx';
import { useRadialFollow } from '../useRadialFollow.js';
import '../../styles/radial-layer-menu.css';

// The dialog closes at once, so focus returns and the canvas takes input immediately; a detached,
// inert copy folds the icons back along their entry spiral. The chosen icon pops instead.
function playExit(menu, chosen) {
  if (!menu?.offsetWidth || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = document.createElement('div');
  layer.className = 'radial-layer-ghost';
  layer.inert = true;
  layer.setAttribute('aria-hidden', 'true');
  const copy = menu.cloneNode(true);
  copy.removeAttribute('aria-label');
  copy.querySelector('h2')?.remove();
  copy.classList.add('is-leaving');
  if (chosen) copy.querySelector(`[data-option="${chosen}"]`)?.classList.add('is-chosen');
  layer.append(copy);
  document.body.append(layer);
  const remove = () => layer.remove();
  Promise.allSettled(layer.getAnimations({ subtree: true }).map(animation => animation.finished)).then(remove);
  setTimeout(remove, 600);
}

// Animate the artwork, not the hit targets: every action is selectable immediately.
// `area()` returns the canvas box: the ring stays inside it, and right-clicking elsewhere in it
// moves the menu there (`onReopen`); right-clicking outside it closes the menu.
export function RadialLayerMenu({ origin, area, options, blockedReason, onReopen, onClose }) {
  const menu = useRef();
  useRadialFollow(menu, origin, area);
  const leave = chosen => { playExit(menu.current, chosen); menu.current.closest('dialog').close(); };
  const close = () => { leave(null); onClose(); };
  const outside = event => event.target === event.currentTarget || event.target === menu.current;
  function contextMenu(event) {
    event.preventDefault();
    if (!outside(event)) return;
    const box = area?.(), x = event.clientX, y = event.clientY;
    if (!onReopen || !box || x < box.left || x > box.right || y < box.top || y > box.bottom) { close(); return; }
    leave(null);
    onReopen({ x, y });
  }
  return <Modal onClose={close} labelledBy="radial-layer-heading">
    <div className="radial-layer-dismiss" onPointerDown={event => { if (event.button !== 2 && outside(event)) { event.preventDefault(); close(); } }} onContextMenu={contextMenu}>
      <section ref={menu} className="radial-layer-menu" aria-label="Layer options">
        <h2 id="radial-layer-heading" hidden>Add layer</h2>
        <button type="button" className="radial-layer-close" aria-label="Close add layer menu" onClick={close} autoFocus><X size={16} aria-hidden="true"/></button>
        {options.map(({ id, Icon, label, description, disabled, onClick }, index) => {
          const angle = index * Math.PI * 2 / options.length - Math.PI / 2;
          const x = Math.cos(angle), y = Math.sin(angle);
          return <button key={id} type="button" className="radial-layer-option" data-option={id} aria-label={label} aria-description={disabled ? blockedReason : description} title={disabled ? blockedReason : undefined} disabled={disabled} onClick={() => { leave(id); onClick(); }}
            style={{ left: `${50 + x * 36}%`, top: `${50 + y * 36}%`, '--entry-x': -x * .36, '--entry-y': -y * .36, '--bend-x': (-x - y) * .09, '--bend-y': (x - y) * .09, '--entry-delay': `${index * 10}ms`, '--exit-delay': `${(options.length - 1 - index) * 6}ms` }}>
            <span className="radial-layer-content"><span className="radial-layer-icon"><Icon size={23} weight="light" aria-hidden="true"/></span></span>
            <span className="radial-layer-label" aria-hidden="true">{label}</span>
          </button>;
        })}
      </section>
    </div>
  </Modal>;
}
