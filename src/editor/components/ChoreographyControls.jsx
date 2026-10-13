import React from 'react';
import { Diamond, Trash } from '@phosphor-icons/react';
import { capturedProperties, captureState, moveState, stateAtTime } from '../../choreography.js';
import { EASINGS, EASING_GROUPS, easeProgress, isCubicBezier } from '../../easing.js';
import { IconButton, NumberField } from '../controls.jsx';

export const supportsChoreography = layer => ['text', 'logo', 'carousel', 'media', 'model', 'effect'].includes(layer?.type);
const formatTime = time => `${Number(time).toFixed(2)} s`;
const CUSTOM_EASING = [0.25, 0.1, 0.25, 1];
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
// Progress 0 and 1 sit inside the box, leaving room for overshoot.
const easingPath = easing => Array.from({ length: 49 }, (_, i) => {
  const t = i / 48;
  return `${i ? 'L' : 'M'}${(6 + t * 60).toFixed(1)} ${(34 - easeProgress(easing, t) * 22).toFixed(1)}`;
}).join('');

export function ChoreographyControls({ project, layer, time = 0, onPatch, onSeek }) {
  if (!supportsChoreography(layer)) return null;
  const states = layer.choreography ?? [];
  const fps = project.fps;
  const selected = stateAtTime(layer, time, fps);
  const insideClip = time >= layer.start && time <= layer.end;
  const outsideCount = states.filter(state => state.time > layer.end - layer.start).length;
  const custom = Array.isArray(selected?.easing);

  // Saving captures every property this layer can animate, including effect amounts.
  function saveState() {
    const at = selected ? layer.start + selected.time : time;
    onPatch(layer.id, { choreography: captureState(layer, at, fps, {}, undefined, { all: true }) });
  }

  function changeTime(absoluteTime) {
    const choreography = moveState(layer, selected.id, absoluteTime - layer.start, fps);
    const moved = choreography.find(state => state.id === selected.id);
    onPatch(layer.id, { choreography });
    if (moved) onSeek(layer.start + moved.time);
  }

  const setEasing = easing => onPatch(layer.id, { choreography: states.map(state => state.id === selected.id ? { ...state, easing } : state) });

  function commitBezier(event) {
    const input = event.currentTarget, parts = input.value.split(',').map(part => part.trim());
    const values = parts.map(Number);
    if (parts.length !== 4 || !parts.every(part => DECIMAL.test(part)) || !isCubicBezier(values)) { input.setAttribute('aria-invalid', 'true'); return; }
    input.removeAttribute('aria-invalid');
    if (values.some((value, i) => value !== selected.easing[i])) setEasing(values);
  }

  return <div className="timeline-choreography-controls" role="group" aria-label="Choreography">
    <fieldset className="timeline-edit-fields" disabled={layer.locked}>
      <NumberField scale={100} suffix="%" label="Opacity" value={layer.opacity ?? 1} min={0} max={1} step={0.01} onChange={opacity => onPatch(layer.id, { opacity })}/>
      <button type="button" className="outline-button timeline-save-state" disabled={!insideClip || (!selected && states.length >= 32)} onClick={saveState}><Diamond size={15} aria-hidden="true"/>{selected ? 'Update state' : 'Save state'}</button>
    </fieldset>
    <label className="timeline-state-picker" title="Select any state, including overlapping markers"><span>State</span><select aria-label="Choreography state" value={selected?.id ?? ''} disabled={!states.length} onChange={event => {
      const state = states.find(item => item.id === event.target.value);
      if (state) onSeek(layer.start + state.time);
    }}>
      <option value="" disabled>{states.length ? `${states.length} states · Select` : 'No states'}</option>
      {states.map((state, index) => <option key={state.id} value={state.id}>{index + 1} · {formatTime(layer.start + state.time)}</option>)}
    </select></label>
    {selected && <fieldset className="timeline-edit-fields" disabled={layer.locked}>
      <NumberField scale={1000} suffix="ms" label="State time" value={layer.start + selected.time} min={layer.start} max={layer.end} step={1 / fps} onChange={changeTime}/>
      <label className="timeline-state-picker"><span>Easing</span><select aria-label="Transition into state" value={custom ? 'custom' : selected.easing} onChange={event => setEasing(event.target.value === 'custom' ? CUSTOM_EASING : event.target.value)}>
        {EASING_GROUPS.map(group => <optgroup key={group} label={group}>{EASINGS.filter(easing => easing.group === group).map(easing => <option key={easing.id} value={easing.id}>{easing.name}</option>)}</optgroup>)}
        <optgroup label="Custom"><option value="custom">Cubic bézier</option></optgroup>
      </select></label>
      <IconButton label={`Remove state at ${formatTime(layer.start + selected.time)}`} onClick={() => onPatch(layer.id, { choreography: states.filter(state => state.id !== selected.id) })}><Trash size={15} aria-hidden="true"/></IconButton>
      <div className="timeline-easing">
        <svg className="timeline-easing-curve" viewBox="0 0 72 44" role="img" aria-label="Transition curve into this state"><path className="timeline-easing-axis" d="M6 34H66M6 12H66"/><path className="timeline-easing-path" d={easingPath(selected.easing)}/></svg>
        {custom && <label className="timeline-state-picker"><span>Bézier</span><input key={`${selected.id}:${selected.easing.join()}`} aria-label="Custom cubic bézier" title="x1, y1, x2, y2. Both x values between 0 and 1." defaultValue={selected.easing.join(', ')} spellCheck={false} onBlur={commitBezier} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitBezier(event); } }}/></label>}
      </div>
    </fieldset>}
    {selected && <p className="timeline-controls-note">Holds {capturedProperties(selected).join(', ')}.</p>}
    {outsideCount > 0 && <p className="timeline-controls-note">{outsideCount} {outsideCount === 1 ? 'state is' : 'states are'} beyond this layer’s duration. Extend the duration to include {outsideCount === 1 ? 'it' : 'them'}.</p>}
  </div>;
}
