import React from 'react';
import { DEFAULT_MOTION, motionBaseline, motionEase, sweepProgress } from '../../motion-timing.js';
import { smoothProgress } from '../../easing.js';
import { Field, NumberField, Range } from '../controls.jsx';
import { RhythmControls, CharacterControls } from './MotionTimingControls.jsx';

export function MotionControls({ layer, count, onPatch }) {
  const motion = layer.motion ?? DEFAULT_MOTION;
  const baseline = layer.motionBaseline ?? motionBaseline(layer);
  const change = patch => onPatch(layer.id, { motion: { ...motion, ...patch } });
  const evaluateProgress = t => {
    const native = layer.template === 'window-push' ? 1 - (1 - t) ** 3 : layer.template === 'flip' && motion.mode === 'continuous' ? smoothProgress(t) : t;
    return layer.template === 'sweep-reveal' ? sweepProgress(t, motion) : motionEase(t, motion, native);
  };
  const cycle = (motion.action + motion.pause) * Math.max(1, count);
  const reset = () => onPatch(layer.id, { motion: { ...baseline.motion }, speed: baseline.speed, loopDuration: baseline.loopDuration });
  return <>
    <RhythmControls motion={motion} onChange={change} actionSummary={<p className="helper">Cycle: <span className="motion-cycle">{Number(cycle.toFixed(2))}s</span> · {Math.max(1, count)} cards</p>}>
      {motion.mode === 'steps' ? <>
        <Field label="Direction"><select aria-label="Motion direction" value={Math.sign(layer.speed)} onChange={e => onPatch(layer.id, { speed: Number(e.target.value) * (Math.abs(layer.speed) || 18) })}><option value={1}>Forward</option><option value={-1}>Reverse</option><option value={0}>Paused</option></select></Field>
      </> : <>
        <Field label="Timing"><select aria-label="Motion timing" value={layer.loopDuration > 0 ? 'duration' : 'speed'} onChange={event => onPatch(layer.id, { loopDuration: event.target.value === 'duration' ? 6 : 0 })}><option value="speed">Speed</option><option value="duration">Loop duration</option></select></Field>{layer.loopDuration > 0 ? <><NumberField scale={1000} suffix="ms" label="Loop duration" value={layer.loopDuration} min={0.1} max={60} step={0.1} onChange={loopDuration => onPatch(layer.id, { loopDuration })}/><Field label="Direction"><select aria-label="Motion direction" value={Math.sign(layer.speed)} onChange={event => onPatch(layer.id, { speed: Number(event.target.value) * (Math.abs(layer.speed) || 18) })}><option value={1}>Forward</option><option value={-1}>Reverse</option><option value={0}>Paused</option></select></Field></> : <Range label="Speed" value={layer.speed} min={-90} max={90} suffix="°/s" onChange={speed => onPatch(layer.id, { speed })}/>}

      </>}
      {layer.template === 'flip' && <Range label="Transition turn" value={layer.transitionTurn} min={0} max={360} step={15} suffix="°" onChange={transitionTurn => onPatch(layer.id, { transitionTurn })}/>}
      {layer.template === 'zoom-through' && <Range label="Entry rotation" value={layer.zoomRotation ?? 0} min={-180} max={180} step={5} suffix="°" onChange={zoomRotation => onPatch(layer.id, { zoomRotation })}/>}
      {layer.template === 'stack-shuffle' && <Range label="Exit rotation" value={layer.shuffleRotation ?? 28} min={-180} max={180} step={1} suffix="°" onChange={shuffleRotation => onPatch(layer.id, { shuffleRotation })}/>}
    </RhythmControls>
    <CharacterControls motion={motion} onChange={change} onReset={reset} evaluateProgress={evaluateProgress}/>
  </>;
}
