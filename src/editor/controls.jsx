import React, { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export function Field({ label, children, value }) {
  return <div className="field"><div className="field-label"><span>{label}</span>{value !== undefined && <output>{value}</output>}</div>{children}</div>;
}

// Manual numeric entry in display units (value × scale). Whole numbers by default; `decimals`
// allows that many fraction digits (a comma also works as the separator).
function IntegerInput({ ariaLabel, value, min, max, scale = 1, decimals = 0, suffix = '', onChange }) {
  const [draft, setDraft] = useState(null);
  const [invalid, setInvalid] = useState(false);
  const dirty = useRef(false);
  const factor = 10 ** decimals;
  const lower = Math.ceil(min * scale * factor - 1e-7) / factor, upper = Math.floor(max * scale * factor + 1e-7) / factor;
  const display = String(Math.round(value * scale * factor) / factor || 0);
  const hint = `Enter a ${decimals ? `number with up to ${decimals} decimal${decimals > 1 ? 's' : ''}` : 'whole number'} between ${lower} and ${upper}${suffix ? ` ${suffix}` : ''}.`;
  const pattern = decimals ? new RegExp(`^[+-]?\\d+(?:\\.\\d{1,${decimals}})?$`) : /^[+-]?\d+$/;
  useEffect(() => { dirty.current = false; setDraft(null); setInvalid(false); }, [value, min, max, scale, ariaLabel]);
  function commit(event) {
    if (!dirty.current) return;
    const typed = event.currentTarget.value.trim(), text = decimals ? typed.replace(',', '.') : typed, number = Number(text);
    if (!pattern.test(text) || !Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER || number < lower || number > upper) {
      setInvalid(true);
      return;
    }
    dirty.current = false;
    setDraft(null); setInvalid(false);
    const next = number / scale || 0;
    if (next !== value) onChange(next);
  }
  return <span className="numeric-field">
    <input aria-label={ariaLabel} aria-description={hint} type="text" inputMode={decimals ? 'decimal' : 'numeric'} value={draft ?? display} aria-invalid={invalid || undefined} title={hint}
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

// `step` (in value units) finer than one display unit lets manual entry accept decimals, e.g.
// 0.5 % margins; coarser steps keep whole numbers.
export function NumberField({ label, ariaLabel = label, value, min, max, step = 1, scale = 1, suffix = '', onChange }) {
  const unitStep = step * scale;
  const decimals = unitStep < 1 ? Math.min(3, String(Number(unitStep.toFixed(6))).split('.')[1]?.length ?? 0) : 0;
  return <Field label={label}><IntegerInput ariaLabel={ariaLabel} value={value} min={min} max={max} scale={scale} decimals={decimals} suffix={suffix} onChange={onChange}/></Field>;
}

// Inspector sections are an accordion: opening one folds the others in the same scope (layer
// type and inspector tab, the composition settings or a multi-selection). Each folded section
// shows its title and a short state summary. Until a person picks one, the scope's main section
// starts open; the choice (or none) is remembered per scope in this browser.
export const SectionScope = createContext('');
const SECTION_STORAGE = 'floc.editor.openSections';
const sectionListeners = new Set();
let openSections;
function storedSections() {
  if (!openSections) {
    try { const value = JSON.parse(globalThis.localStorage?.getItem(SECTION_STORAGE) ?? '{}'); openSections = value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { openSections = {}; }
  }
  return openSections;
}
function chooseSection(scope, title) {
  openSections = { ...storedSections(), [scope]: title };
  try { globalThis.localStorage?.setItem(SECTION_STORAGE, JSON.stringify(openSections)); } catch {}
  sectionListeners.forEach(listener => listener());
}
const subscribeSections = listener => { sectionListeners.add(listener); return () => sectionListeners.delete(listener); };
export function Section({ title, children, defaultOpen = false, detail }) {
  const scope = useContext(SectionScope);
  const chosen = useSyncExternalStore(subscribeSections, () => storedSections()[scope], () => undefined);
  const open = chosen === undefined ? defaultOpen : chosen === title;
  function toggle(event) {
    const next = event.currentTarget.open;
    if (next !== open) chooseSection(scope, next ? title : null);
  }
  // Folded content stays mounted, so in-progress numeric drafts survive folding.
  return <details className="property-section collapsible-section" open={open} onToggle={toggle}><summary><h3>{title}</h3>{detail && <span>{detail}</span>}</summary>{children}</details>;
}

export function IconButton({ label, children, ...props }) {
  return <button type="button" className="icon-button" aria-label={label} title={label} {...props}>{children}</button>;
}

export function Modal({ children, onClose, labelledBy }) {
  const ref = useRef();
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="modal-backdrop" aria-labelledby={labelledBy} onCancel={e => { if (e.target !== e.currentTarget) return; e.preventDefault(); onClose(); }}>{children}</dialog>;
}
