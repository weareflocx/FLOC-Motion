import React from 'react';
import { DATA_FLOW_INTEGERS, DATA_FLOW_RANGES, normalizeDataFlowStyle } from '../../data-flow-style.js';
import { OrientationControl } from '../OrientationControl.jsx';
import { Color, NumberField, Range, Section } from '../controls.jsx';
import { SpatialControls } from './SpatialControls.jsx';

export function DataFlowControls({ layer, onPatch, rightTab = 'composition' }) {
  const style = normalizeDataFlowStyle(layer.flowStyle);
  const patch = changes => onPatch(layer.id, { flowStyle: { ...style, ...changes } });
  const range = (key, label, options = {}) => <Range key={key} label={label} value={style[key]} min={DATA_FLOW_RANGES[key][0]} max={DATA_FLOW_RANGES[key][1]} step={DATA_FLOW_INTEGERS.includes(key) ? 1 : 0.01} scale={1} decimals={DATA_FLOW_INTEGERS.includes(key) ? 0 : 2} {...options} onChange={value => patch(key === 'spread' ? { spread: value, pinchWidth: Math.min(style.pinchWidth, value) } : { [key]: value })}/>;
  if (rightTab === 'animation') return <Section title="Flow motion" defaultOpen>
    {range('speed', 'Overall speed', { suffix: ' ×' })}
    {range('flowSpeed', 'Structure flow', { step: 1, suffix: ' units/s' })}
    {range('particleSpeed', 'Pulse flow', { step: 1, suffix: ' units/s' })}
    {range('travelSpeed', 'View travel', { step: 1, suffix: ' units/s' })}
    <p className="helper">Zero overall speed freezes the simulation. Negative speeds reverse motion. The seed and elapsed time keep preview and export consistent.</p>
  </Section>;
  return <>
    <Section title="Fibers" defaultOpen detail={`${style.fiberCount} fibers · ${style.samples} samples`}>
      {range('fiberCount', 'Fiber count')}
      {range('samples', 'Detail samples')}
      {range('nodeDistance', 'Node distance', { step: 1, suffix: ' units' })}
      {range('pinchSharpness', 'Pinch sharpness')}
      {range('spread', 'Bundle spread', { step: 1, suffix: ' units' })}
      {range('pinchWidth', 'Pinch width', { max: Math.min(DATA_FLOW_RANGES.pinchWidth[1], style.spread), suffix: ' units' })}
      {range('noise', 'Noise', { suffix: ' units' })}
      <NumberField label="Seed" value={style.seed} min={DATA_FLOW_RANGES.seed[0]} max={DATA_FLOW_RANGES.seed[1]} onChange={seed => patch({ seed })}/>
    </Section>
    <Section title="Lines and pulses">
      <Color label="Line color" value={style.lineColor} onChange={lineColor => patch({ lineColor })}/>
      {range('lineOpacity', 'Line opacity')}
      {range('lineWidth', 'Line width', { suffix: ' px' })}
      <Color label="Pulse color" value={style.particleColor} onChange={particleColor => patch({ particleColor })}/>
      {range('particleCount', 'Pulse count')}
      {range('particleSize', 'Pulse size', { suffix: ' px' })}
      <p className="helper">Transparent outside the fibers and pulses. For the reference look, choose a dark Background; adding Data flow does not change it.</p>
    </Section>
    <Section title="Glow">
      {range('glowStrength', 'Glow strength')}
      {range('glowRadius', 'Glow radius')}
      {range('fog', 'Distance fog', { step: 0.0001, decimals: 4 })}
      <p className="helper">Soft local halos belong to this layer only. Distance fog fades the fibers, not the background.</p>
    </Section>
    <Section title="Transform" detail={`X ${Math.round(layer.x)} · Y ${Math.round(layer.y)} · ${Math.round(layer.size)}%`}>
      <SpatialControls layer={layer} onPatch={onPatch}/>
      <NumberField label="Position X" value={layer.x} min={-1000} max={1000} step={0.1} suffix="%" onChange={x => onPatch(layer.id, { x })}/>
      <NumberField label="Position Y" value={layer.y} min={-1000} max={1000} step={0.1} suffix="%" onChange={y => onPatch(layer.id, { y })}/>
      <Range label="Size" value={layer.size} min={2} max={500} suffix="%" onChange={size => onPatch(layer.id, { size })}/>
      {layer.space === 'flat' && range('perspective', 'Perspective', { step: 1, suffix: '°' })}
      <OrientationControl key={layer.id} layer={layer} onCommit={fields => onPatch(layer.id, fields)}/>
    </Section>
  </>;
}
