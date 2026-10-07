import React from 'react';
import { NumberField } from './controls.jsx';

export function OrientationControl({ layer, onCommit }) {
  const spatial = ['carousel', 'model'].includes(layer.type);
  const axes = spatial ? ['tilt', 'yaw', 'roll'] : ['roll'];
  return <details className="orientation-control">
    <summary>{spatial ? 'Orientation' : 'Rotation'}<span>{axes.map(axis => `${Math.round(layer[axis] ?? 0)}°`).join(' / ')}</span></summary>
    <div className="orientation-fields">
      {axes.map(axis => <NumberField key={axis} label={`Orientation ${{ tilt: 'X', yaw: 'Y', roll: 'Z' }[axis]} (°)`} value={layer[axis] ?? 0} min={axis === 'tilt' && layer.type === 'carousel' ? -65 : -180} max={axis === 'tilt' && layer.type === 'carousel' ? 65 : 180} onChange={number => onCommit({ [axis]: number })}/>)}
      <button type="button" className="text-button" onClick={() => onCommit(spatial ? { tilt: 0, yaw: 0, roll: 0 } : { roll: 0 })}>Reset {spatial ? 'orientation' : 'rotation'}</button>
    </div>
  </details>;
}
