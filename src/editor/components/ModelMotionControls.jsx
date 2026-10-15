import React from 'react';
import { MODEL_MOTIONS, MODEL_MOTION_AXES, MODEL_STYLE_RANGES, resetModelMotion } from '../../model-style.js';
import { Field, NumberField, Range, Section } from '../controls.jsx';
import { RhythmControls, CharacterControls } from './MotionTimingControls.jsx';

const motionNames = { none: 'None', spin: 'Spin', rock: 'Rock', float: 'Float', pulse: 'Pulse' };
const autoAxes = { spin: 'Y', rock: 'Z', float: 'Y', pulse: 'X / Y / Z' };

export function ModelMotionControls({ style, onChange }) {
  const motion = style.motionTiming;
  const steps = motion.mode === 'steps';
  const spin = style.motion === 'spin';
  const changeTiming = changes => onChange({
    ...style,
    motionTiming: { ...motion, ...changes },
    ...(changes.mode === 'steps' ? { motionSpeed: Math.sign(style.motionSpeed) } : {})
  });
  const direction = <Field label="Direction"><select aria-label="Motion direction" value={Math.sign(style.motionSpeed)} onChange={event => onChange({ ...style, motionSpeed: Number(event.target.value) * (steps ? 1 : Math.abs(style.motionSpeed) || 1) })}><option value={1}>Forward</option><option value={-1}>Reverse</option><option value={0}>Paused</option></select></Field>;
  const cycle = (motion.action + motion.pause) * (spin ? style.motionSteps : 1);
  return <>
    <Section title="Automatic motion">
      <Field label="Automatic motion"><select aria-label="Automatic motion" value={style.motion} onChange={event => onChange({ ...style, motion: event.target.value })}>{MODEL_MOTIONS.map(value => <option key={value} value={value}>{motionNames[value]}</option>)}</select></Field>
      {style.motion !== 'none' && <>
        <Field label="Axis"><select aria-label="Motion axis" value={style.motionAxis} onChange={event => onChange({ ...style, motionAxis: event.target.value })}>{MODEL_MOTION_AXES.map(axis => <option key={axis} value={axis}>{axis === 'auto' ? `Auto · ${autoAxes[style.motion]}` : axis.toUpperCase()}</option>)}</select></Field>
        <p className="helper">X tilts or moves horizontally, Y turns or moves vertically, and Z rolls or moves in depth. Pulse scales the selected axis; Auto scales all three.</p>
        {!spin && <Range label="Motion amplitude" value={style.motionAmplitude} min={MODEL_STYLE_RANGES.motionAmplitude[0]} max={MODEL_STYLE_RANGES.motionAmplitude[1]} step={0.01} scale={100} onChange={motionAmplitude => onChange({ ...style, motionAmplitude })}/>}
      </>}
      <p className="helper">Automatic motion adds to the authored pose independently of embedded clips.</p>
    </Section>
    {style.motion !== 'none' && <>
      <RhythmControls motion={motion} onChange={changeTiming} actionSummary={<>
        {spin && <NumberField label="Steps per turn" value={style.motionSteps} min={1} max={24} onChange={motionSteps => onChange({ ...style, motionSteps })}/>}
        <p className="helper">{spin ? `${Number((360 / style.motionSteps).toFixed(2))}° per action · Turn cycle: ` : 'Cycle: '}<span className="motion-cycle">{Math.round(cycle * 1000)} ms</span></p>
      </>}>
        {!steps && <>
          <Range label="Motion cycle duration" value={style.motionDuration} min={MODEL_STYLE_RANGES.motionDuration[0]} max={MODEL_STYLE_RANGES.motionDuration[1]} suffix="s" scale={1000} onChange={motionDuration => onChange({ ...style, motionDuration })}/>
          <Range label="Speed multiplier" value={Math.abs(style.motionSpeed)} min={0} max={MODEL_STYLE_RANGES.motionSpeed[1]} step={0.01} scale={100} onChange={magnitude => onChange({ ...style, motionSpeed: magnitude * (Math.sign(style.motionSpeed) || 1) })}/>
        </>}
        {direction}
        <p className="helper">{steps ? 'Each action is followed by a pause. Direction controls the turn or oscillation; Paused holds the rest pose.' : '100% is normal speed. Duration is one cycle at normal speed; Paused holds the rest pose.'}</p>
      </RhythmControls>
      <CharacterControls motion={motion} onChange={changeTiming} onReset={() => onChange(resetModelMotion(style))}/>
    </>}
  </>;
}
