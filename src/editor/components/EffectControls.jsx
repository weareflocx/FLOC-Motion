import React from 'react';
import { ArrowDown, ArrowUp, LinkSimple, LinkSimpleBreak, Plus, Trash } from '@phosphor-icons/react';
import { DEFAULT_NOISE, EFFECT_LAYER_TYPES } from '../../effects.js';
import { Color, Field, IconButton, NumberField, Range, Section } from '../controls.jsx';
import './effects.css';

export function EffectControls({ layer, onPatch }) {
  if (!EFFECT_LAYER_TYPES.includes(layer.type)) return null;
  const effects = layer.effects ?? [];
  const update = (index, patch) => onPatch(layer.id, { effects: effects.map((effect, i) => i === index ? { ...effect, ...patch } : effect) });
  const move = (index, delta) => {
    const next = [...effects];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    onPatch(layer.id, { effects: next });
  };
  return <Section title="Effects">
    {effects.map((effect, index) => <details className="noise-effect" key={index} open>
      <summary><span>Noise</span><span className="noise-effect-actions" onClick={event => event.stopPropagation()}>
        <input aria-label={`Enable noise ${index + 1}`} type="checkbox" checked={effect.enabled} onChange={event => update(index, { enabled: event.target.checked })}/>
        {effects.length > 1 && <><IconButton label={`Move noise ${index + 1} earlier`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={13}/></IconButton><IconButton label={`Move noise ${index + 1} later`} disabled={index === effects.length - 1} onClick={() => move(index, 1)}><ArrowDown size={13}/></IconButton></>}
        <IconButton label={`Remove noise ${index + 1}`} disabled={layer.type === 'effect' && effects.length === 1} onClick={() => onPatch(layer.id, { effects: effects.filter((_, i) => i !== index) })}><Trash size={14}/></IconButton>
      </span></summary>
      <Field label="Mode"><div className="segmented" role="group" aria-label="Noise mode">{['mono', 'duo', 'multi'].map(mode => <button type="button" key={mode} aria-pressed={effect.mode === mode} className={effect.mode === mode ? 'selected' : ''} onClick={() => update(index, { mode })}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}</div></Field>
      <Field label="Noise size"><div className="noise-size">
        <NumberField label="X" ariaLabel="Noise size X" value={effect.sizeX} min={0.5} max={32} step={0.5} onChange={sizeX => update(index, { sizeX, ...(effect.linked ? { sizeY: sizeX } : {}) })}/>
        <IconButton label="Link noise size" aria-pressed={effect.linked} onClick={() => update(index, { linked: !effect.linked, ...(!effect.linked ? { sizeY: effect.sizeX } : {}) })}>{effect.linked ? <LinkSimple size={16}/> : <LinkSimpleBreak size={16}/>}</IconButton>
        <NumberField label="Y" ariaLabel="Noise size Y" value={effect.sizeY} min={0.5} max={32} step={0.5} onChange={sizeY => update(index, { sizeY, ...(effect.linked ? { sizeX: sizeY } : {}) })}/>
      </div></Field>
      <Range label="Density" ariaLabel="Noise density" value={effect.density * 100} min={0} max={100} suffix="%" onChange={density => update(index, { density: density / 100 })}/>
      <Range label="Opacity" ariaLabel="Noise opacity" value={effect.opacity * 100} min={0} max={100} suffix="%" onChange={opacity => update(index, { opacity: opacity / 100 })}/>
      {effect.mode !== 'multi' && <Color label="Noise color" value={effect.color1} onChange={color1 => update(index, { color1 })}/>}
      {effect.mode === 'duo' && <Color label="Second noise color" value={effect.color2} onChange={color2 => update(index, { color2 })}/>}
      <label className="check-field"><input type="checkbox" checked={effect.animated} onChange={event => update(index, { animated: event.target.checked })}/>Animate noise</label>
    </details>)}
    <button type="button" className="outline-button" disabled={effects.length >= 8} onClick={() => onPatch(layer.id, { effects: [...effects, { ...DEFAULT_NOISE, seed: (42 + effects.length * 997) % 65536 }] })}><Plus size={15}/>Add noise</button>
  </Section>;
}
