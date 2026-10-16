import React from 'react';
import { NumberField } from '../controls.jsx';
import { clipEndLimit } from '../../editor-controls.js';

export function TimelineTimingControls({ project, layer, sourceDuration, onPatch, onFocus }) {
  const span = Math.max(0.01, layer.end - layer.start);
  const maximumSpan = Math.max(0.01, clipEndLimit(layer, project.duration, sourceDuration) - layer.start);
  return <fieldset className="track-timing-fields" disabled={layer.locked} aria-label={`Timing for ${layer.name} (milliseconds)`} onFocus={onFocus}>
    <NumberField scale={1000} suffix="ms" label="Start" value={layer.start} min={0} max={Math.max(0, project.duration - span)} step={0.01} onChange={start => onPatch(layer.id, { start, end: Math.min(project.duration, start + span) })}/>
    <NumberField scale={1000} suffix="ms" label="Duration" value={span} min={0.01} max={maximumSpan} step={0.01} onChange={duration => onPatch(layer.id, { end: Math.min(clipEndLimit(layer, project.duration, sourceDuration), layer.start + Math.max(0.01, duration)) })}/>
  </fieldset>;
}
