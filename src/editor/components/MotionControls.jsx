import React from 'react';
import { DEFAULT_MOTION, MOTION_CURVES, motionBaseline, motionEase, smoothProgress } from '../../motion-timing.js';
import { Field, NumberField, Range, Section } from '../controls.jsx';

export function MotionControls({ layer, count, onPatch }) {
  const motion = layer.motion ?? DEFAULT_MOTION;
  const baseline = layer.motionBaseline ?? motionBaseline(layer);
  const change = patch => onPatch(layer.id, { motion: { ...motion, ...patch } });
  const label = MOTION_CURVES.find(([id]) => id === motion.curve)[1];
  const native = t => layer.template === 'flip' && motion.mode === 'continuous' ? smoothProgress(t) : t;
  const points = Array.from({ length: 101 }, (_, i) => {
    const t = i / 100;
    return `${i ? 'L' : 'M'}${12 + t * 176},${110 - motionEase(t, motion, native(t)) * 86}`;
  }).join(' ');
  const cycle = (motion.action + motion.pause) * Math.max(1, count);
  const reset = () => onPatch(layer.id, { motion: { ...baseline.motion }, speed: baseline.speed, loopDuration: baseline.loopDuration });
  return <>
    <Section title="Rhythm">
      <Field label="Playback"><div className="segmented" role="group" aria-label="Rhythm mode">{[['continuous', 'Continuous'], ['steps', 'Actions']].map(([id, name]) => <button type="button" key={id} className={motion.mode === id ? 'selected' : ''} aria-pressed={motion.mode === id} onClick={() => change({ mode: id })}>{name}</button>)}</div></Field>
      {motion.mode === 'steps' ? <>
        <div className="two-fields"><NumberField scale={1000} suffix="ms" label="Action" value={motion.action} min={0.05} max={30} step={0.05} onChange={action => change({ action })}/><NumberField scale={1000} suffix="ms" label="Pause" value={motion.pause} min={0} max={30} step={0.05} onChange={pause => change({ pause })}/></div>
        <p className="helper">Cycle: <span className="motion-cycle">{Number(cycle.toFixed(2))}s</span> · {Math.max(1, count)} cards</p>
        <Field label="Direction"><select aria-label="Motion direction" value={Math.sign(layer.speed)} onChange={e => onPatch(layer.id, { speed: Number(e.target.value) * (Math.abs(layer.speed) || 18) })}><option value={1}>Forward</option><option value={-1}>Reverse</option><option value={0}>Paused</option></select></Field>
      </> : <>
        <Field label="Timing"><select aria-label="Motion timing" value={layer.loopDuration > 0 ? 'duration' : 'speed'} onChange={event => onPatch(layer.id, { loopDuration: event.target.value === 'duration' ? 6 : 0 })}><option value="speed">Speed</option><option value="duration">Loop duration</option></select></Field>{layer.loopDuration > 0 ? <><NumberField scale={1000} suffix="ms" label="Loop duration" value={layer.loopDuration} min={0.1} max={60} step={0.1} onChange={loopDuration => onPatch(layer.id, { loopDuration })}/><Field label="Direction"><select aria-label="Motion direction" value={Math.sign(layer.speed)} onChange={event => onPatch(layer.id, { speed: Number(event.target.value) * (Math.abs(layer.speed) || 18) })}><option value={1}>Forward</option><option value={-1}>Reverse</option><option value={0}>Paused</option></select></Field></> : <Range label="Speed" value={layer.speed} min={-90} max={90} suffix="°/s" onChange={speed => onPatch(layer.id, { speed })}/>}

      </>}
      {layer.template === 'flip' && <Range label="Transition turn" value={layer.transitionTurn} min={0} max={360} step={15} suffix="°" onChange={transitionTurn => onPatch(layer.id, { transitionTurn })}/>}
    </Section>
    <Section title="Character">
      <svg className="motion-curve" viewBox="0 0 200 136" role="img" aria-label={`${label} progress curve at ${Math.round(motion.intensity * 100)} percent intensity`}>
        <path className="motion-curve-axis" d="M12 18V110H188"/>
        <path className="motion-curve-reference" d="M12 110L188 24"/>
        <path className="motion-curve-path" d={points}/>
        <text x="12" y="130">Time</text><text x="188" y="130" textAnchor="end">Progress</text>
      </svg>
      <div className="motion-curves" role="group" aria-label="Progress curves">{MOTION_CURVES.map(([id, name]) => <button type="button" key={id} aria-pressed={motion.curve === id} onClick={() => change({ curve: id })}>{name}</button>)}</div>
      <Range label="Curve intensity" value={motion.intensity * 100} min={0} max={100} suffix="%" onChange={value => change({ intensity: value / 100 })}/>

      <button type="button" className="outline-button" onClick={reset}>Reset motion</button>

    </Section>
  </>;
}
