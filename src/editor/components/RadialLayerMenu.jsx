import React, { useRef } from 'react';
import { X } from '@phosphor-icons/react';
import { Modal } from '../controls.jsx';
import '../../styles/radial-layer-menu.css';

// Animate the artwork, not the hit targets: every action is selectable immediately.
export function RadialLayerMenu({ origin, options, blockedReason, onClose }) {
  const menu = useRef();
  const close = () => { menu.current.closest('dialog').close(); onClose(); };
  const outside = event => event.target === event.currentTarget || event.target.classList.contains('radial-layer-menu');
  return <Modal onClose={close} labelledBy="radial-layer-heading">
    <div className="radial-layer-dismiss" onPointerDown={event => { if (outside(event)) { event.preventDefault(); close(); } }} onContextMenu={event => { event.preventDefault(); if (outside(event)) close(); }}>
      <section ref={menu} className="radial-layer-menu" aria-label="Layer options" style={{ '--origin-x': `${origin.x}px`, '--origin-y': `${origin.y}px` }}>
        <h2 id="radial-layer-heading" hidden>Add layer</h2>
        <button type="button" className="radial-layer-close" aria-label="Close add layer menu" onClick={close} autoFocus><X size={16} aria-hidden="true"/></button>
        {options.map(({ id, Icon, label, description, disabled, onClick }, index) => {
          const angle = index * Math.PI * 2 / options.length - Math.PI / 2;
          const x = Math.cos(angle), y = Math.sin(angle);
          return <button key={id} type="button" className="radial-layer-option" aria-label={label} aria-description={disabled ? blockedReason : description} title={disabled ? blockedReason : undefined} disabled={disabled} onClick={onClick}
            style={{ left: `${50 + x * 36}%`, top: `${50 + y * 36}%`, '--entry-x': -x * .36, '--entry-y': -y * .36, '--bend-x': (-x - y) * .09, '--bend-y': (x - y) * .09, '--entry-delay': `${index * 10}ms` }}>
            <span className="radial-layer-content"><span className="radial-layer-icon"><Icon size={23} weight="light" aria-hidden="true"/></span></span>
            <span className="radial-layer-label" aria-hidden="true">{label}</span>
          </button>;
        })}
      </section>
    </div>
  </Modal>;
}
