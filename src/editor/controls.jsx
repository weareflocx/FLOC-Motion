import React, { useEffect, useRef, useState } from 'react';

export function Field({ label, children, value }) {
  return <div className="field"><div className="field-label"><span>{label}</span>{value !== undefined && <output>{value}</output>}</div>{children}</div>;
}

function IntegerInput({ ariaLabel, value, min, max, scale = 1, suffix = '', onChange }) {
  const [draft, setDraft] = useState(null);
  const [invalid, setInvalid] = useState(false);
  const dirty = useRef(false);
  const lower = Math.ceil(min * scale - 1e-7), upper = Math.floor(max * scale + 1e-7);
  const display = String(Math.round(value * scale) || 0);
  const hint = `Enter a whole number between ${lower} and ${upper}${suffix ? ` ${suffix}` : ''}.`;
  useEffect(() => { dirty.current = false; setDraft(null); setInvalid(false); }, [value, min, max, scale, ariaLabel]);
  function commit(event) {
    if (!dirty.current) return;
    const text = event.currentTarget.value.trim(), number = Number(text);
    if (!/^[+-]?\d+$/.test(text) || !Number.isSafeInteger(number) || number < lower || number > upper) {
      setInvalid(true);
      return;
    }
    dirty.current = false;
    setDraft(null); setInvalid(false);
    const next = number / scale || 0;
    if (next !== value) onChange(next);
  }
  return <span className="numeric-field">
    <input aria-label={ariaLabel} aria-description={hint} type="text" inputMode="numeric" value={draft ?? display} aria-invalid={invalid || undefined} title={hint}
      onFocus={event => event.currentTarget.select()}
      onChange={event => { dirty.current = true; setDraft(event.target.value); setInvalid(false); }}
      onBlur={commit}
      onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); commit(event); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dirty.current = false; setDraft(null); setInvalid(false); }
      }}/>
    {suffix && <span className="numeric-unit" aria-hidden="true">{suffix}</span>}
    {invalid && <span className="numeric-error" role="alert">{hint}</span>}
  </span>;
}

export function Range({ label, ariaLabel = label, value, min, max, step = 1, suffix = '', scale = suffix === 's' ? 1000 : step < 1 ? 100 : 1, onChange }) {
  const unit = suffix === 's' ? 'ms' : suffix || (scale === 100 ? '%' : '');
  const display = `${Math.round(value * scale) || 0}${unit}`;
  const progress = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  return <div className="field integrated-range" style={{ '--range-progress': progress }}>
    <span className="range-fill" aria-hidden="true"/>
    <span className="range-ticks" aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <i key={i}/>)}</span>
    <span className="range-label">{label}</span>
    <input aria-label={ariaLabel} aria-valuetext={display} type="range" min={Math.ceil(min * scale)} max={Math.floor(max * scale)} step={1} value={Math.round(value * scale)} onChange={e => onChange(Number(e.target.value) / scale || 0)}/>
    <IntegerInput ariaLabel={`${ariaLabel} value`} value={value} min={min} max={max} scale={scale} suffix={unit} onChange={onChange}/>
  </div>;
}

export function Color({ label, value, onChange }) {
  return <Field label={label}><div className="color-field"><input aria-label={label} type="color" value={value} onChange={e => onChange(e.target.value)}/><span>{value.toUpperCase()}</span></div></Field>;
}

export function NumberField({ label, ariaLabel = label, value, min, max, scale = 1, suffix = '', onChange }) {
  return <Field label={label}><IntegerInput ariaLabel={ariaLabel} value={value} min={min} max={max} scale={scale} suffix={suffix} onChange={onChange}/></Field>;
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
