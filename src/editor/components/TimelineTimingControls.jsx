import React from 'react';
import { NumberField } from '../controls.jsx';

export function TimelineTimingControls({ project, layer, onPatch, onFocus }) {
  const span = Math.max(0.01, layer.end - layer.start);
  return <fieldset className="track-timing-fields" disabled={layer.locked} aria-label={`Timing for ${layer.name} (seconds)`} onFocus={onFocus}>
    <NumberField label="Start" value={Number(layer.start.toFixed(4))} min={0} max={Math.max(0, project.duration - span)} step={0.01} onChange={start => onPatch(layer.id, { start, end: Math.min(project.duration, start + span) })}/>
    <NumberField label="Duration" value={Number(span.toFixed(4))} min={0.01} max={Number((project.duration - layer.start).toFixed(4))} step={0.01} onChange={duration => onPatch(layer.id, { end: Math.min(project.duration, layer.start + duration) })}/>
  </fieldset>;
}
