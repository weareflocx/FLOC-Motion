import React from 'react';
import { MOTION_CURVES, motionEase } from '../../motion-timing.js';
import { EASINGS } from '../../easing.js';
import { Field, NumberField, Range, Section } from '../controls.jsx';

export function RhythmControls({ motion, onChange, children, actionSummary }) {
  return <Section title="Rhythm" defaultOpen detail={motion.mode === 'steps' ? `Actions · ${Math.round(motion.action * 1000)} / ${Math.round(motion.pause * 1000)} ms` : 'Continuous'}>
    <Field label="Playback"><div className="segmented" role="group" aria-label="Rhythm mode">{[['continuous', 'Continuous'], ['steps', 'Actions']].map(([id, name]) => <button type="button" key={id} className={motion.mode === id ? 'selected' : ''} aria-pressed={motion.mode === id} onClick={() => onChange({ mode: id })}>{name}</button>)}</div></Field>
    {motion.mode === 'steps' && <>
      <div className="two-fields"><NumberField scale={1000} suffix="ms" label="Action" value={motion.action} min={0.05} max={30} onChange={action => onChange({ action })}/><NumberField scale={1000} suffix="ms" label="Pause" value={motion.pause} min={0} max={30} onChange={pause => onChange({ pause })}/></div>
      {actionSummary}
    </>}
    {children}
  </Section>;
}

export function CharacterControls({ motion, onChange, onReset, evaluateProgress = t => motionEase(t, motion, t) }) {
  const label = MOTION_CURVES.find(([id]) => id === motion.curve)[1];
  const strength = EASINGS.find(easing => easing.id === motion.curve)?.strength;
  const points = Array.from({ length: 101 }, (_, i) => {
    const t = i / 100;
    return `${i ? 'L' : 'M'}${12 + t * 176},${110 - evaluateProgress(t) * 86}`;
  }).join(' ');
  return <Section title="Character" detail={strength ? `${label} · ${Math.round(motion.intensity * 100)}%` : label}>
    <svg className="motion-curve" viewBox="0 0 200 136" role="img" aria-label={strength ? `${label} progress curve at ${Math.round(motion.intensity * 100)} percent ${strength.label.toLowerCase()}` : `${label} progress curve`}>
      <path className="motion-curve-axis" d="M12 18V110H188"/>
      <path className="motion-curve-reference" d="M12 110L188 24"/>
      <path className="motion-curve-path" d={points}/>
      <text x="12" y="130">Time</text><text x="188" y="130" textAnchor="end">Progress</text>
    </svg>
    <div className="motion-curves" role="group" aria-label="Progress curves">{MOTION_CURVES.map(([id, name]) => <button type="button" key={id} aria-pressed={motion.curve === id} onClick={() => onChange({ curve: id })}>{name}</button>)}</div>
    {strength && <>
      <Range label={strength.label} ariaLabel={`Curve ${strength.label.toLowerCase()}`} value={motion.intensity * 100} min={0} max={100} suffix="%" onChange={value => onChange({ intensity: value / 100 })}/>
      <p className="helper">{strength.help}</p>
    </>}
    <button type="button" className="outline-button" onClick={onReset}>Reset motion</button>
  </Section>;
}
