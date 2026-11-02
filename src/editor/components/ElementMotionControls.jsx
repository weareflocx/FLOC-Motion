import React from 'react';
import { DEFAULT_ELEMENT_MOTION, normalizeElementMotion, supportsElementMotion } from '../../element-motion.js';
import { Field, Range, Section } from '../controls.jsx';

const OPERATORS = [['float', 'Float'], ['spin', 'Spin Z'], ['pulse', 'Pulse']];

export function ElementMotionControls({ layer, onPatch }) {
  if (!supportsElementMotion(layer)) return null;
  const motion = layer.elementMotion ? normalizeElementMotion(layer.elementMotion) : DEFAULT_ELEMENT_MOTION;
  const active = OPERATORS.filter(([key]) => motion[key].enabled);
  function patch(key, fields) {
    onPatch(layer.id, { elementMotion: normalizeElementMotion({ ...motion, [key]: { ...motion[key], ...fields } }) });
  }
  return <Section title="Continuous" defaultOpen detail={active.length ? `${active.length} active · ${active.map(([, label]) => label).join(' + ')}` : 'None active'}>
    <p className="helper">Move the whole element. Internal animation stays independent. Distance uses the composition’s short side; Spin Z rotates in the composition plane.</p>
    {OPERATORS.map(([key, label]) => <React.Fragment key={key}>
      <label className="check-field"><input type="checkbox" aria-label={`Enable ${label}`} checked={motion[key].enabled} onChange={event => patch(key, { enabled: event.target.checked })}/>{label}</label>
      {motion[key].enabled && <fieldset className="layer-properties">
        {key === 'float' && <>
          <Field label="Axis"><select aria-label="Float axis" value={motion.float.axis} onChange={event => patch(key, { axis: event.target.value })}><option value="x">X</option><option value="y">Y</option></select></Field>
          <Range label="Distance" ariaLabel="Float distance" value={motion.float.amplitude} min={0} max={25} scale={1} decimals={1} suffix="%" onChange={amplitude => patch(key, { amplitude })}/>
        </>}
        {key === 'pulse' && <Range label="Amplitude" ariaLabel="Pulse amplitude" value={motion.pulse.amplitude} min={0} max={0.5} scale={100} suffix="%" onChange={amplitude => patch(key, { amplitude })}/>}
        <Range label="Period" ariaLabel={`${label} period`} value={motion[key].duration} min={0.1} max={120} scale={1000} suffix="ms" onChange={duration => patch(key, { duration })}/>
        <Range label="Phase" ariaLabel={`${label} phase`} value={motion[key].phase} min={0} max={1} scale={100} suffix="%" onChange={phase => patch(key, { phase })}/>
        <Field label="Direction"><select aria-label={`${label} direction`} value={motion[key].direction} onChange={event => patch(key, { direction: Number(event.target.value) })}><option value={1}>Forward</option><option value={-1}>Reverse</option><option value={0}>Paused</option></select></Field>
      </fieldset>}
    </React.Fragment>)}
  </Section>;
}
