import React from 'react';
import { DEFAULT_TEXT_STYLE } from '../../text-style.js';
import { Field, NumberField, Range, Section } from '../controls.jsx';

export function TypographyControls({ layer, onPatch }) {
  const style = { ...DEFAULT_TEXT_STYLE, ...layer };
  return <Section title="Typography" detail={`${style.textAlign} · line ${Math.round(style.lineHeight * 100)}%`}>
    <Range label="Line height" value={style.lineHeight} min={0.5} max={3} step={0.05} onChange={lineHeight => onPatch(layer.id, { lineHeight })}/>
    <NumberField scale={1000} label="Tracking (1/1000 em)" value={style.letterSpacing} min={-0.15} max={0.5} step={0.005} onChange={letterSpacing => onPatch(layer.id, { letterSpacing })}/>
    <Field label="Alignment"><div className="segmented" role="group" aria-label="Text alignment">
      {['left', 'center', 'right'].map(textAlign => <button type="button" key={textAlign} aria-pressed={style.textAlign === textAlign} className={style.textAlign === textAlign ? 'selected' : ''} onClick={() => onPatch(layer.id, { textAlign })}>{textAlign}</button>)}
    </div></Field>
  </Section>;
}
