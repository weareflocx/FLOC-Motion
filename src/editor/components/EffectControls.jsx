import React from 'react';
import { ArrowDown, ArrowUp, LinkSimple, LinkSimpleBreak, Trash } from '@phosphor-icons/react';
import { EFFECTS, EFFECT_LAYER_TYPES, MAX_EFFECTS, newEffect } from '../../effects.js';
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

// Appearance: the layer's opacity (passed as children) followed by its ordered effect stack.
export function EffectControls({ layer, onPatch, children }) {
  if (!EFFECT_LAYER_TYPES.includes(layer.type)) return null;
  const effects = layer.effects ?? [];
  const update = (index, patch) => onPatch(layer.id, { effects: effects.map((effect, i) => i === index ? { ...effect, ...patch } : effect) });
  const move = (index, delta) => {
    const next = [...effects];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    onPatch(layer.id, { effects: next });
  };
  const scope = layer.type === 'effect' ? layer.effectScope === 'below' ? 'Below layers' : 'Overlay' : 'Layer';
  const add = type => onPatch(layer.id, { effects: [...effects, newEffect(type, effects.length)] });
  const percent = (label, effect, index) => <Range label="Amount" ariaLabel={`${label} amount ${index + 1}`} value={effect.amount * 100} min={0} max={100} suffix="%" onChange={amount => update(index, { amount: amount / 100 })}/>;
  const fraction = (label, ariaLabel, effect, key, index) => <Range label={label} ariaLabel={`${ariaLabel} ${index + 1}`} value={effect[key] * 100} min={0} max={100} suffix="%" onChange={value => update(index, { [key]: value / 100 })}/>;
  return <Section title="Appearance" defaultOpen={layer.type === 'effect'} detail={`${Math.round((layer.opacity ?? 1) * 100)}% · ${effects.length ? `${effects.length} effect${effects.length === 1 ? '' : 's'}` : 'No effects'}`}>
    {children}
    {layer.type === 'effect' && <Field label="Scope"><select aria-label="Effect scope" value={layer.effectScope ?? 'overlay'} onChange={event => onPatch(layer.id, { effectScope: event.target.value })}>
      <option value="below">Below layers</option>
      <option value="overlay" disabled={effects.some(effect => effect.type !== 'noise')}>Texture overlay</option>
    </select></Field>}
    {effects.map((effect, index) => <EffectRow key={`${index}:${effect.type}`} name={EFFECTS.find(item => item.id === effect.type)?.name} scope={scope} label={`${effect.type} ${index + 1}`} enabled={effect.enabled} onToggle={enabled => update(index, { enabled })}
      onRemove={() => onPatch(layer.id, { effects: effects.filter((_, i) => i !== index) })} removeDisabled={layer.type === 'effect' && effects.length === 1}
      moveControls={effects.length > 1 && <><IconButton label={`Move ${effect.type} ${index + 1} earlier`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={13}/></IconButton><IconButton label={`Move ${effect.type} ${index + 1} later`} disabled={index === effects.length - 1} onClick={() => move(index, 1)}><ArrowDown size={13}/></IconButton></>}>
      {effect.type === 'blur' && <>
        <Field label="Mode"><div className="segmented" role="group" aria-label={`Blur mode ${index + 1}`}>{['uniform', 'progressive'].map(mode => <button type="button" key={mode} aria-pressed={effect.mode === mode} className={effect.mode === mode ? 'selected' : ''} onClick={() => update(index, { mode })}>{mode === 'uniform' ? 'Uniform' : 'Progressive'}</button>)}</div></Field>
        <Range label="Radius" ariaLabel={`Blur radius ${index + 1}`} value={effect.amount} min={0} max={48} suffix="px" onChange={amount => update(index, { amount })}/>
        {effect.mode === 'progressive' && <Field label="Blur towards"><select aria-label={`Blur direction ${index + 1}`} value={effect.direction} onChange={event => update(index, { direction: event.target.value })}>{['bottom', 'top', 'right', 'left'].map(direction => <option key={direction} value={direction}>{direction[0].toUpperCase() + direction.slice(1)}</option>)}</select></Field>}
      </>}
      {effect.type === 'monochrome' && <Range label="Intensity" ariaLabel={`Monochrome intensity ${index + 1}`} value={effect.amount * 100} min={0} max={100} suffix="%" onChange={amount => update(index, { amount: amount / 100 })}/>}
      {effect.type === 'duotone' && <>
        {percent('Duotone', effect, index)}
        <Color label="Shadow color" value={effect.shadow} onChange={shadow => update(index, { shadow })}/>
        <Color label="Highlight color" value={effect.highlight} onChange={highlight => update(index, { highlight })}/>
      </>}
      {effect.type === 'chromatic' && <>
        {percent('Chromatic split', effect, index)}
        <label className="check-field"><input type="checkbox" checked={effect.animated} onChange={event => update(index, { animated: event.target.checked })}/>Animate</label>
      </>}
      {effect.type === 'wave' && <>
        {percent('Liquid wave', effect, index)}
        {fraction('Size', 'Liquid wave size', effect, 'size', index)}
        <Range label="Speed" ariaLabel={`Liquid wave speed ${index + 1}`} value={effect.speed} min={0} max={2} step={0.05} onChange={speed => update(index, { speed })}/>
      </>}
      {effect.type === 'halftone' && <>
        {percent('Halftone', effect, index)}
        {fraction('Dot size', 'Halftone dot size', effect, 'size', index)}
      </>}
      {effect.type === 'dithering' && <>
        {percent('Dithering', effect, index)}
        {fraction('Pixel size', 'Dithering pixel size', effect, 'size', index)}
        <Range label="Color steps" ariaLabel={`Dithering color steps ${index + 1}`} value={effect.steps} min={1} max={7} step={1} onChange={steps => update(index, { steps: Math.round(steps) })}/>
      </>}
      {effect.type === 'fluted-glass' && <>
        {percent('Fluted glass', effect, index)}
        {fraction('Rib width', 'Fluted glass rib width', effect, 'size', index)}
        {fraction('Distortion', 'Fluted glass distortion', effect, 'distortion', index)}
      </>}
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
      {EFFECTS.filter(effect => layer.type !== 'effect' || layer.effectScope === 'below' || effect.id === 'noise').map(effect => <option key={effect.id} value={effect.id} disabled={effects.length >= MAX_EFFECTS}>{effect.name}</option>)}
    </select>
  </Section>;
}
