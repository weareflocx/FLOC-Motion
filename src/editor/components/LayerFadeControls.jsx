import React from 'react';
import { NumberField, Section } from '../controls.jsx';

export function LayerFadeControls({ layer, onPatch }) {
  if (layer.fadeIn === undefined) return null;
  const span = layer.end - layer.start;
  return <Section title="Entry & exit">
    <div className="two-fields">
      <NumberField scale={1000} suffix="ms" label="Fade in" value={layer.fadeIn} min={0} max={Math.max(0, span - layer.fadeOut)} step={0.05} onChange={fadeIn => onPatch(layer.id, { fadeIn })}/>
      <NumberField scale={1000} suffix="ms" label="Fade out" value={layer.fadeOut} min={0} max={Math.max(0, span - layer.fadeIn)} step={0.05} onChange={fadeOut => onPatch(layer.id, { fadeOut })}/>
    </div>
    {layer.type === 'text' && <label className="check-field"><input type="checkbox" checked={layer.rise} onChange={event => onPatch(layer.id, { rise: event.target.checked })}/>Rise during fades</label>}
  </Section>;
}
