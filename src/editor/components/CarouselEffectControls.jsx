import React from 'react';
import { CAROUSEL_EFFECTS } from '../../project.js';
import { Field, Range, Section } from '../controls.jsx';

export function CarouselEffectControls({ layer, onPatch }) {
  return <Section title="Carousel effects">
    <Field label="Effect"><select aria-label="Carousel layer effect" value={layer.layerEffect ?? 'none'} onChange={event => onPatch(layer.id, { layerEffect: event.target.value })}>
      {CAROUSEL_EFFECTS.map(effect => <option key={effect.id} value={effect.id}>{effect.name}</option>)}
    </select></Field>
    {layer.layerEffect && layer.layerEffect !== 'none' && <>
      <Range label="Effect mix" value={layer.layerEffectIntensity} min={0} max={1} step={0.05} onChange={value => onPatch(layer.id, { layerEffectIntensity: value })}/>
      {layer.layerEffect === 'halftone' && <Range label="Dot size" value={layer.halftoneSize} min={0} max={1} step={0.01} onChange={value => onPatch(layer.id, { halftoneSize: value })}/>}
      {layer.layerEffect === 'dithering' && <>
        <Range label="Pixel size" value={layer.ditheringSize} min={0} max={1} step={0.01} onChange={value => onPatch(layer.id, { ditheringSize: value })}/>
        <Range label="Color steps" value={layer.ditheringSteps} min={1} max={7} step={1} onChange={value => onPatch(layer.id, { ditheringSteps: value })}/>
      </>}
      {layer.layerEffect === 'fluted-glass' && <>
        <Range label="Rib width" value={layer.glassSize} min={0} max={1} step={0.01} onChange={value => onPatch(layer.id, { glassSize: value })}/>
        <Range label="Distortion" value={layer.glassDistortion} min={0} max={1} step={0.01} onChange={value => onPatch(layer.id, { glassDistortion: value })}/>
      </>}
    </>}

  </Section>;
}
