import React, { useEffect, useRef } from 'react';
import { DISTRIBUTE_LAYOUTS, DISTRIBUTE_ORDERS, DISTRIBUTE_ORIENTATIONS } from '../distribute.js';
import { Field, NumberField, Range } from '../controls.jsx';

const listed = layers => layers.map(layer => `${layer.name} (${layer.reason})`).join(', ');

// One-time Line/Grid/Circle/Arc placement of the multi-selection. Picking a layout or
// changing a setting previews on the canvas; Apply commits one undoable change.
// `distribution` comes from useDistribution. Unmounting ends the preview.
export function DistributeControls({ distribution }) {
  const { available, movable, excluded, settings, active, plan, change, apply, cancel } = distribution;
  const cancelRef = useRef(cancel); cancelRef.current = cancel;
  useEffect(() => () => cancelRef.current?.(), []);
  const layout = settings.layout, options = settings[layout];
  const set = (key, value) => change({ [layout]: { [key]: value } });
  const ring = layout === 'circle' || layout === 'arc';
  const notice = excluded.length > 0 && <p className="helper">Left in place: {listed(excluded)}.</p>;
  if (!available) return <>
    <p className="helper">Distribute needs two or more unlocked layers on the canvas.</p>
    {notice}
  </>;
  return <div className="distribute-controls">
    <Field label="Layout"><div className="segmented" role="group" aria-label="Distribution layout">
      {Object.entries(DISTRIBUTE_LAYOUTS).map(([id, { label }]) => <button type="button" key={id} aria-pressed={active && layout === id} className={active && layout === id ? 'selected' : ''} onClick={() => change({ layout: id })}>{label}</button>)}
    </div></Field>
    {!active && <p className="helper">Pick a layout to preview it on the canvas.</p>}
    {active && <>
      {layout === 'line' && <>
        <Range label="Angle" value={options.angle} min={-180} max={180} suffix="°" onChange={value => set('angle', value)}/>
        <Range label="Spacing" value={options.spacing} min={0} max={50} scale={1} decimals={1} suffix="%" onChange={value => set('spacing', value)}/>
      </>}
      {layout === 'grid' && <>
        <NumberField label="Columns" value={options.columns ?? Math.ceil(Math.sqrt(movable))} min={1} max={movable} onChange={value => set('columns', value)}/>
        <div className="two-fields">
          <NumberField label="Column gap (%)" value={options.gapX} min={0} max={50} step={.5} onChange={value => set('gapX', value)}/>
          <NumberField label="Row gap (%)" value={options.gapY} min={0} max={50} step={.5} onChange={value => set('gapY', value)}/>
        </div>
      </>}
      {ring && <>
        <Range label="Radius" value={options.radius ?? plan?.radius ?? 15} min={1} max={150} scale={1} decimals={1} suffix="%" onChange={value => set('radius', value)}/>
        <Range label={layout === 'arc' ? 'Start angle' : 'First position'} value={options.startAngle} min={-360} max={360} suffix="°" onChange={value => set('startAngle', value)}/>
        {layout === 'arc' && <Range label="End angle" value={options.endAngle} min={-360} max={360} suffix="°" onChange={value => set('endAngle', value)}/>}
        <Field label="Orientation"><select aria-label="Distribution orientation" value={options.orientation} onChange={event => set('orientation', event.target.value)}>
          {DISTRIBUTE_ORIENTATIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select></Field>
      </>}
      <Field label="Order"><select aria-label="Distribution order" value={settings.order} onChange={event => change({ order: event.target.value })}>
        {DISTRIBUTE_ORDERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></Field>
      {plan?.center && <div className="two-fields">
        <NumberField label="Center X (%)" value={plan.center.x} min={-100} max={200} step={.1} onChange={x => change({ center: { x, y: plan.center.y } })}/>
        <NumberField label="Center Y (%)" value={plan.center.y} min={-100} max={200} step={.1} onChange={y => change({ center: { x: plan.center.x, y } })}/>
      </div>}
      <label className="check-field"><input type="checkbox" checked={settings.safeArea} onChange={event => change({ safeArea: event.target.checked })}/>Keep inside safe area</label>
      {plan && !plan.fits && <p className="helper">Larger than the safe area; kept centered in it.</p>}
      {plan?.limited?.length > 0 && <p className="helper">{plan.limited.map(layer => layer.name).join(', ')} reached {plan.limited.length === 1 ? 'its' : 'their'} position limit, so the spacing breaks there. Reduce the spacing or radius.</p>}
    </>}
    {notice}
    {active && <div className="selection-actions">
      <button type="button" className="outline-button" onClick={apply}>Apply</button>
      <button type="button" className="outline-button" onClick={cancel}>Cancel</button>
    </div>}
  </div>;
}
