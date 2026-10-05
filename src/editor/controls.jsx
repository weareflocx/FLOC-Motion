import React, { useEffect, useRef } from 'react';

export function Field({ label, children, value }) {
  return <div className="field"><div className="field-label"><span>{label}</span>{value !== undefined && <output>{value}</output>}</div>{children}</div>;
}

export function Range({ label, ariaLabel = label, value, min, max, step = 1, suffix = '', onChange }) {
  const display = `${Number(value).toFixed(step < 1 ? 2 : 0)}${suffix}`;
  const progress = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  return <label className="field integrated-range" style={{ '--range-progress': progress }}>
    <span className="range-fill" aria-hidden="true"/>
    <span className="range-ticks" aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <i key={i}/>)}</span>
    <span className="range-label">{label}</span>
    <input aria-label={ariaLabel} aria-valuetext={display} type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))}/>
    <output>{display}</output>
  </label>;
}

export function Color({ label, value, onChange }) {
  return <Field label={label}><div className="color-field"><input aria-label={label} type="color" value={value} onChange={e => onChange(e.target.value)}/><span>{value.toUpperCase()}</span></div></Field>;
}

export function NumberField({ label, ariaLabel = label, value, min, max, step = 1, onChange }) {
  return <Field label={label}><input aria-label={ariaLabel} type="number" min={min} max={max} step={step} value={value} onChange={e => { const n = Number(e.target.value); if (n >= min && n <= max) onChange(n); }}/></Field>;
}

export function Section({ title, children }) {
  return <section className="property-section"><h3>{title}</h3>{children}</section>;
}

export function IconButton({ label, children, ...props }) {
  return <button type="button" className="icon-button" aria-label={label} title={label} {...props}>{children}</button>;
}

export function Modal({ children, onClose, labelledBy }) {
  const ref = useRef();
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="modal-backdrop" aria-labelledby={labelledBy} onCancel={e => { e.preventDefault(); onClose(); }}>{children}</dialog>;
}
