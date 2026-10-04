import React from 'react';
import { DEFAULT_TEXT_STYLE, TEXT_REVEALS } from '../../text-style.js';
import { Field, NumberField, Range, Section } from '../controls.jsx';

export function TypographyControls({ layer, onPatch }) {
  const style = { ...DEFAULT_TEXT_STYLE, ...layer };
  return <Section title="Typography">
    <Range label="Line height" value={style.lineHeight} min={0.5} max={3} step={0.05} onChange={lineHeight => onPatch(layer.id, { lineHeight })}/>
    <NumberField label="Letter spacing (em)" value={style.letterSpacing} min={-0.15} max={0.5} step={0.005} onChange={letterSpacing => onPatch(layer.id, { letterSpacing })}/>
    <Field label="Alignment"><div className="segmented" role="group" aria-label="Text alignment">
      {['left', 'center', 'right'].map(textAlign => <button type="button" key={textAlign} aria-pressed={style.textAlign === textAlign} className={style.textAlign === textAlign ? 'selected' : ''} onClick={() => onPatch(layer.id, { textAlign })}>{textAlign}</button>)}
    </div></Field>
    <Field label="Reveal"><select aria-label="Text reveal" value={style.reveal} onChange={event => onPatch(layer.id, { reveal: event.target.value })}>
      {TEXT_REVEALS.map(reveal => <option key={reveal.id} value={reveal.id}>{reveal.name}</option>)}
    </select></Field>
    {style.reveal !== 'none' && <NumberField label="Reveal duration (s)" value={style.revealDuration} min={0} max={5} step={0.05} onChange={revealDuration => onPatch(layer.id, { revealDuration })}/>}
  </Section>;
}
