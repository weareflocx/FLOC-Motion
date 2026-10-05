import React from 'react';
import { NumberField } from '../controls.jsx';

export function TimelineTimingControls({ project, layer, onPatch }) {
  const span = layer.end - layer.start;
  return <fieldset className="timeline-edit-fields" disabled={layer.locked} aria-label="Layer timing">
    <NumberField label="Start (s)" value={layer.start} min={0} max={layer.end - 0.01} step={0.1} onChange={start => onPatch(layer.id, { start })}/>
    <NumberField label="End (s)" value={layer.end} min={layer.start + 0.01} max={project.duration} step={0.1} onChange={end => onPatch(layer.id, { end })}/>
    <NumberField label="Duration (s)" value={Number(span.toFixed(4))} min={0.01} max={Number((project.duration - layer.start).toFixed(4))} step={0.01} onChange={duration => onPatch(layer.id, { end: Math.min(project.duration, layer.start + duration) })}/>
    {layer.fadeIn !== undefined && <>
      <NumberField label="Fade in (s)" value={layer.fadeIn} min={0} max={Math.min(5, Math.max(0, span - layer.fadeOut))} step={0.05} onChange={fadeIn => onPatch(layer.id, { fadeIn })}/>
      <NumberField label="Fade out (s)" value={layer.fadeOut} min={0} max={Math.min(5, Math.max(0, span - layer.fadeIn))} step={0.05} onChange={fadeOut => onPatch(layer.id, { fadeOut })}/>
    </>}
    {layer.type === 'text' && <label className="check-field"><input type="checkbox" checked={layer.rise} onChange={event => onPatch(layer.id, { rise: event.target.checked })}/>Rise during fades</label>}
  </fieldset>;
}
