import React from 'react';
import { Diamond, Trash } from '@phosphor-icons/react';
import { CHOREOGRAPHY_EASINGS, captureState, moveState, stateAtTime } from '../../choreography.js';
import { Field, IconButton, NumberField, Range, Section } from '../controls.jsx';
import '../choreography.css';

const VISUAL_LAYERS = ['text', 'logo', 'carousel', 'media', 'model'];
const formatTime = time => `${Number(time).toFixed(2)} s`;

export function ChoreographyControls({ project, layer, time = 0, onPatch, onSeek }) {
  if (!VISUAL_LAYERS.includes(layer.type)) return null;
  const states = layer.choreography ?? [];
  const fps = project.fps;
  const selected = stateAtTime(layer, time, fps);
  const insideClip = time >= layer.start && time <= layer.end;

  function saveState() {
    const at = selected ? layer.start + selected.time : time;
    onPatch(layer.id, { choreography: captureState(layer, at, fps) });
  }

  function selectState(state) {
    onSeek(layer.start + state.time);
  }

  function changeTime(absoluteTime) {
    const choreography = moveState(layer, selected.id, absoluteTime - layer.start, fps);
    const moved = choreography.find(state => state.id === selected.id);
    onPatch(layer.id, { choreography });
    if (moved) selectState(moved);
  }

  return <Section title="Choreography">
    <Range label="Opacity" value={layer.opacity ?? 1} min={0} max={1} step={0.01} onChange={opacity => onPatch(layer.id, { opacity })}/>
    <div className="choreography-actions">
      <button type="button" className="outline-button" disabled={!insideClip || (!selected && states.length >= 32)} onClick={saveState}><Diamond size={15} aria-hidden="true"/>{selected ? 'Update state' : 'Save state'}</button>
      <span className="choreography-count" aria-label={`${states.length} of 32 states`}>{states.length} / 32</span>
    </div>
    {states.length > 0 && <div className="choreography-states" role="group" aria-label="Choreography states">
      {states.map(state => <button key={state.id} type="button" aria-pressed={selected?.id === state.id} aria-label={`State at ${formatTime(layer.start + state.time)}`} onClick={() => selectState(state)}><Diamond size={11} weight={selected?.id === state.id ? 'fill' : 'regular'} aria-hidden="true"/>{formatTime(layer.start + state.time)}</button>)}
    </div>}
    {selected && <div className="choreography-state-fields">
      <div className="choreography-state-time"><NumberField label="Time (s)" value={Number((layer.start + selected.time).toFixed(4))} min={layer.start} max={layer.end} step={1 / fps} onChange={changeTime}/><IconButton label={`Remove state at ${formatTime(layer.start + selected.time)}`} onClick={() => onPatch(layer.id, { choreography: states.filter(state => state.id !== selected.id) })}><Trash size={15} aria-hidden="true"/></IconButton></div>
      <Field label="Transition into state"><select aria-label="Transition into state" value={selected.easing} onChange={event => onPatch(layer.id, { choreography: states.map(state => state.id === selected.id ? { ...state, easing: event.target.value } : state) })}>{CHOREOGRAPHY_EASINGS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
    </div>}
  </Section>;
}
