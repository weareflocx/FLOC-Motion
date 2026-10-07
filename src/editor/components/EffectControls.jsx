import React from 'react';
import { ArrowDown, ArrowUp, LinkSimple, LinkSimpleBreak, Trash } from '@phosphor-icons/react';
import { EFFECTS, EFFECT_LAYER_TYPES, newEffect } from '../../effects.js';
import { CAROUSEL_EFFECTS, SHADERS } from '../../project.js';
import { Color, Field, IconButton, NumberField, Range, Section } from '../controls.jsx';
import './effects.css';

function EffectRow({ name, scope, label = name, enabled, onToggle, onRemove, removeDisabled, moveControls, children }) {
  return <details className="effect-row">
    <summary><span>{name}</span><span className="effect-scope">{scope}</span><span className="effect-actions" onClick={event => event.stopPropagation()}>
      {onToggle && <input aria-label={`Enable ${label}`} type="checkbox" checked={enabled} onChange={event => onToggle(event.target.checked)}/>}
      {moveControls}
      <IconButton label={`Remove ${label}`} disabled={removeDisabled} onClick={onRemove}><Trash size={14}/></IconButton>
    </span></summary>
    {children}
  </details>;
}

export function EffectControls({ layer, onPatch }) {
  if (!EFFECT_LAYER_TYPES.includes(layer.type)) return null;
  const effects = layer.effects ?? [];
  const update = (index, patch) => onPatch(layer.id, { effects: effects.map((effect, i) => i === index ? { ...effect, ...patch } : effect) });
  const move = (index, delta) => {
    const next = [...effects];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    onPatch(layer.id, { effects: next });
  };
  const scope = layer.type === 'effect' ? layer.effectScope === 'below' ? 'Below layers' : 'Overlay' : 'Layer';
  function add(value) {
    const [target, type] = value.split(':');
    if (target === 'cards') onPatch(layer.id, { shader: type });
    else if (target === 'carousel') onPatch(layer.id, { layerEffect: type });
    else onPatch(layer.id, { effects: [...effects, newEffect(type, effects.length)] });
  }
  return <Section title="Effects">
    {layer.type === 'effect' && <Field label="Scope"><select aria-label="Effect scope" value={layer.effectScope ?? 'overlay'} onChange={event => onPatch(layer.id, { effectScope: event.target.value })}>
      <option value="below">Below layers</option>
      <option value="overlay" disabled={effects.some(effect => effect.type !== 'noise')}>Texture overlay</option>
    </select></Field>}
    {layer.type === 'carousel' && layer.shader !== 'none' && <EffectRow name={SHADERS.find(effect => effect.id === layer.shader)?.name} scope="Cards" onRemove={() => onPatch(layer.id, { shader: 'none' })}>
      <Field label="Effect"><select aria-label="Card effect" value={layer.shader} onChange={event => onPatch(layer.id, { shader: event.target.value })}>{SHADERS.filter(effect => effect.id !== 'none').map(effect => <option key={effect.id} value={effect.id}>{effect.name}</option>)}</select></Field>
      <Range label="Intensity" ariaLabel="Card effect intensity" value={layer.intensity} min={0} max={1} step={0.05} onChange={intensity => onPatch(layer.id, { intensity })}/>
      {layer.shader === 'duotone' && <Color label="Shader tint" value={layer.tint} onChange={tint => onPatch(layer.id, { tint })}/>}
    </EffectRow>}
    {layer.type === 'carousel' && layer.layerEffect && layer.layerEffect !== 'none' && <EffectRow name={CAROUSEL_EFFECTS.find(effect => effect.id === layer.layerEffect)?.name} scope="Layer" onRemove={() => onPatch(layer.id, { layerEffect: 'none' })}>
      <Field label="Effect"><select aria-label="Carousel finish" value={layer.layerEffect} onChange={event => onPatch(layer.id, { layerEffect: event.target.value })}>{CAROUSEL_EFFECTS.filter(effect => effect.id !== 'none').map(effect => <option key={effect.id} value={effect.id}>{effect.name}</option>)}</select></Field>
      <Range label="Intensity" ariaLabel="Carousel effect intensity" value={layer.layerEffectIntensity} min={0} max={1} step={0.05} onChange={layerEffectIntensity => onPatch(layer.id, { layerEffectIntensity })}/>
      {layer.layerEffect === 'halftone' && <Range label="Dot size" value={layer.halftoneSize} min={0} max={1} step={0.01} onChange={halftoneSize => onPatch(layer.id, { halftoneSize })}/>}
      {layer.layerEffect === 'dithering' && <><Range label="Pixel size" value={layer.ditheringSize} min={0} max={1} step={0.01} onChange={ditheringSize => onPatch(layer.id, { ditheringSize })}/><Range label="Color steps" value={layer.ditheringSteps} min={1} max={7} onChange={ditheringSteps => onPatch(layer.id, { ditheringSteps })}/></>}
      {layer.layerEffect === 'fluted-glass' && <><Range label="Rib width" value={layer.glassSize} min={0} max={1} step={0.01} onChange={glassSize => onPatch(layer.id, { glassSize })}/><Range label="Distortion" value={layer.glassDistortion} min={0} max={1} step={0.01} onChange={glassDistortion => onPatch(layer.id, { glassDistortion })}/></>}
    </EffectRow>}
    {effects.map((effect, index) => <EffectRow key={`${index}:${effect.type}`} name={EFFECTS.find(item => item.id === effect.type)?.name} scope={scope} label={`${effect.type} ${index + 1}`} enabled={effect.enabled} onToggle={enabled => update(index, { enabled })}
      onRemove={() => onPatch(layer.id, { effects: effects.filter((_, i) => i !== index) })} removeDisabled={layer.type === 'effect' && effects.length === 1}
      moveControls={effects.length > 1 && <><IconButton label={`Move ${effect.type} ${index + 1} earlier`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={13}/></IconButton><IconButton label={`Move ${effect.type} ${index + 1} later`} disabled={index === effects.length - 1} onClick={() => move(index, 1)}><ArrowDown size={13}/></IconButton></>}>
      {effect.type === 'blur' && <>
        <Field label="Mode"><div className="segmented" role="group" aria-label={`Blur mode ${index + 1}`}>{['uniform', 'progressive'].map(mode => <button type="button" key={mode} aria-pressed={effect.mode === mode} className={effect.mode === mode ? 'selected' : ''} onClick={() => update(index, { mode })}>{mode === 'uniform' ? 'Uniform' : 'Progressive'}</button>)}</div></Field>
        <Range label="Radius" ariaLabel={`Blur radius ${index + 1}`} value={effect.amount} min={0} max={48} suffix="px" onChange={amount => update(index, { amount })}/>
        {effect.mode === 'progressive' && <Field label="Blur towards"><select aria-label={`Blur direction ${index + 1}`} value={effect.direction} onChange={event => update(index, { direction: event.target.value })}>{['bottom', 'top', 'right', 'left'].map(direction => <option key={direction} value={direction}>{direction[0].toUpperCase() + direction.slice(1)}</option>)}</select></Field>}
      </>}
      {effect.type === 'monochrome' && <Range label="Intensity" ariaLabel={`Monochrome intensity ${index + 1}`} value={effect.amount * 100} min={0} max={100} suffix="%" onChange={amount => update(index, { amount: amount / 100 })}/>}
      {effect.type === 'optical-warp' && <>
        <Range label="Intensity" ariaLabel={`Optical warp intensity ${index + 1}`} value={effect.amount * 100} min={0} max={100} suffix="%" onChange={amount => update(index, { amount: amount / 100 })}/>
        <Field label="Axis"><select aria-label={`Optical warp axis ${index + 1}`} value={effect.axis} onChange={event => update(index, { axis: event.target.value })}><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option></select></Field>
        <Range label="Center" ariaLabel={`Optical warp center ${index + 1}`} value={effect.center * 100} min={10} max={90} suffix="%" onChange={center => update(index, { center: center / 100 })}/>
      </>}
      {effect.type === 'noise' && <>
      <Field label="Mode"><div className="segmented" role="group" aria-label="Noise mode">{['mono', 'duo', 'multi'].map(mode => <button type="button" key={mode} aria-pressed={effect.mode === mode} className={effect.mode === mode ? 'selected' : ''} onClick={() => update(index, { mode })}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}</div></Field>
      <Field label="Noise size"><div className="noise-size">
        <NumberField scale={100} suffix="%" label="X" ariaLabel="Noise size X" value={effect.sizeX} min={0.5} max={32} step={0.5} onChange={sizeX => update(index, { sizeX, ...(effect.linked ? { sizeY: sizeX } : {}) })}/>
        <IconButton label="Link noise size" aria-pressed={effect.linked} onClick={() => update(index, { linked: !effect.linked, ...(!effect.linked ? { sizeY: effect.sizeX } : {}) })}>{effect.linked ? <LinkSimple size={16}/> : <LinkSimpleBreak size={16}/>}</IconButton>
        <NumberField scale={100} suffix="%" label="Y" ariaLabel="Noise size Y" value={effect.sizeY} min={0.5} max={32} step={0.5} onChange={sizeY => update(index, { sizeY, ...(effect.linked ? { sizeX: sizeY } : {}) })}/>
      </div></Field>
      <Range label="Density" ariaLabel="Noise density" value={effect.density * 100} min={0} max={100} suffix="%" onChange={density => update(index, { density: density / 100 })}/>
      <Range label="Opacity" ariaLabel="Noise opacity" value={effect.opacity * 100} min={0} max={100} suffix="%" onChange={opacity => update(index, { opacity: opacity / 100 })}/>
      {effect.mode !== 'multi' && <Color label="Noise color" value={effect.color1} onChange={color1 => update(index, { color1 })}/>}
      {effect.mode === 'duo' && <Color label="Second noise color" value={effect.color2} onChange={color2 => update(index, { color2 })}/>}
      <label className="check-field"><input type="checkbox" checked={effect.animated} onChange={event => update(index, { animated: event.target.checked })}/>Animate noise</label>
      </>}
    </EffectRow>)}
    <select className="add-effect" aria-label="Add effect" value="" onChange={event => add(event.target.value)}>
      <option value="" disabled>＋ Add effect</option>
      <optgroup label={scope}>{EFFECTS.filter(effect => layer.type !== 'effect' || layer.effectScope === 'below' || effect.id === 'noise').map(effect => <option key={effect.id} value={`layer:${effect.id}`} disabled={effects.length >= 8}>{effect.name}</option>)}</optgroup>
      {layer.type === 'carousel' && <>
        <optgroup label="Carousel finish">{CAROUSEL_EFFECTS.filter(effect => effect.id !== 'none').map(effect => <option key={effect.id} value={`carousel:${effect.id}`} disabled={layer.layerEffect !== 'none'}>{effect.name}</option>)}</optgroup>
        <optgroup label="Cards">{SHADERS.filter(effect => effect.id !== 'none').map(effect => <option key={effect.id} value={`cards:${effect.id}`} disabled={layer.shader !== 'none'}>{effect.name}</option>)}</optgroup>
      </>}
    </select>
  </Section>;
}
