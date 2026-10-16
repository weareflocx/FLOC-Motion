import React from 'react';
import { SCENE_DEPTH_RANGE, SPATIAL_LAYER_TYPES } from '../../scene-settings.js';
import { Field, NumberField } from '../controls.jsx';

export function SpatialControls({ layer, onPatch }) {
  if (!SPATIAL_LAYER_TYPES.includes(layer.type)) return null;
  return <>
    <Field label="Presentation"><select aria-label="Presentation" value={layer.space ?? 'spatial'} onChange={event => onPatch(layer.id, { space: event.target.value })}><option value="flat">Flat</option><option value="spatial">Spatial</option></select></Field>
    <NumberField label="Depth" value={layer.z ?? 0} min={SCENE_DEPTH_RANGE[0]} max={SCENE_DEPTH_RANGE[1]} step={0.1} suffix="%" onChange={z => onPatch(layer.id, { z })}/>
  </>;
}
