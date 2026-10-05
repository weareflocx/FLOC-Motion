import React from 'react';
import { Diamond, Trash } from '@phosphor-icons/react';
import { CHOREOGRAPHY_EASINGS, captureState, moveState, stateAtTime } from '../../choreography.js';
import { IconButton, NumberField } from '../controls.jsx';

export const supportsChoreography = layer => ['text', 'logo', 'carousel', 'media', 'model', 'effect'].includes(layer?.type);
const formatTime = time => `${Number(time).toFixed(2)} s`;

export function ChoreographyControls({ project, layer, time = 0, onPatch, onSeek }) {
  if (!supportsChoreography(layer)) return null;
  const states = layer.choreography ?? [];
  const fps = project.fps;
  const selected = stateAtTime(layer, time, fps);
  const insideClip = time >= layer.start && time <= layer.end;
  const outsideCount = states.filter(state => state.time > layer.end - layer.start).length;

  function saveState() {
    const at = selected ? layer.start + selected.time : time;
    onPatch(layer.id, { choreography: captureState(layer, at, fps) });
  }

  function changeTime(absoluteTime) {
    const choreography = moveState(layer, selected.id, absoluteTime - layer.start, fps);
    const moved = choreography.find(state => state.id === selected.id);
    onPatch(layer.id, { choreography });
    if (moved) onSeek(layer.start + moved.time);
  }

  return <div className="timeline-choreography-controls" role="group" aria-label="Choreography">
    <fieldset className="timeline-edit-fields" disabled={layer.locked}>
      <NumberField label="Opacity" value={Number((layer.opacity ?? 1).toFixed(4))} min={0} max={1} step={0.01} onChange={opacity => onPatch(layer.id, { opacity })}/>
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
      <NumberField label="State time (s)" value={Number((layer.start + selected.time).toFixed(4))} min={layer.start} max={layer.end} step={1 / fps} onChange={changeTime}/>
      <label className="timeline-state-picker"><span>Easing</span><select aria-label="Transition into state" value={selected.easing} onChange={event => onPatch(layer.id, { choreography: states.map(state => state.id === selected.id ? { ...state, easing: event.target.value } : state) })}>{CHOREOGRAPHY_EASINGS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <IconButton label={`Remove state at ${formatTime(layer.start + selected.time)}`} onClick={() => onPatch(layer.id, { choreography: states.filter(state => state.id !== selected.id) })}><Trash size={15} aria-hidden="true"/></IconButton>
    </fieldset>}
    {outsideCount > 0 && <p className="timeline-controls-note">{outsideCount} {outsideCount === 1 ? 'state is' : 'states are'} beyond this layer’s duration. Extend the duration to include {outsideCount === 1 ? 'it' : 'them'}.</p>}
  </div>;
}
