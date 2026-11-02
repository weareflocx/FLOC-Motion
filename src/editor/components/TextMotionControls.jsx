import React from 'react';
import { easeProgress } from '../../easing.js';
import { DEFAULT_TEXT_ENTRY, DEFAULT_TEXT_EXIT, TEXT_CHARACTERS, TEXT_DIRECTIONS, TEXT_MOTION_PRESETS, TEXT_MOTION_RANGES, textMotionPreset, textMotionPresetPatch } from '../../text-motion.js';
import { Field, NumberField, Range, Section } from '../controls.jsx';
import './text-motion.css';

const SIDES = { entry: { title: 'Entry', fade: 'fadeIn', otherFade: 'fadeOut', defaults: DEFAULT_TEXT_ENTRY }, exit: { title: 'Exit', fade: 'fadeOut', otherFade: 'fadeIn', defaults: DEFAULT_TEXT_EXIT } };
const DIRECTED = ['slide', 'reveal'];
const ms = seconds => `${Math.round(seconds * 1000)} ms`;
const spec = (layer, side) => ({ ...SIDES[side].defaults, ...layer[side] });
const moves = value => value.motion !== 'none';

// A small progress curve per character: time runs right, progress up; overshoot shows.
function curvePath(easing) {
  return Array.from({ length: 25 }, (_, i) => {
    const t = i / 24;
    return `${i ? 'L' : 'M'}${(2 + t * 28).toFixed(1)} ${(17 - easeProgress(easing, t) * 12).toFixed(1)}`;
  }).join('');
}

export function textMotionSummary(layer, side) {
  const preset = textMotionPreset(layer, side), own = spec(layer, side);
  if (preset === 'mirror') return `Mirrored · ${ms(moves(spec(layer, 'entry')) ? own.duration : layer.fadeOut)}`;
  if (preset === 'none') return 'None';
  if (preset === 'fade') return `Fade · ${ms(layer[SIDES[side].fade])}`;
  return `${TEXT_MOTION_PRESETS.find(item => item.id === preset).name} · ${ms(own.duration)}`;
}

function Segmented({ label, options, value, onChange }) {
  return <div className="segmented" role="group" aria-label={label}>
    {options.map(([id, name, extra]) => <button type="button" key={id} aria-pressed={value === id} className={value === id ? 'selected' : ''} title={name} onClick={() => onChange(id)}>{extra}{name}</button>)}
  </div>;
}

// Duration, tied fade and fade fields shared by the movement presets and the mirrored exit.
function TimingFields({ layer, side, value, onPatch }) {
  const { title, fade, otherFade } = SIDES[side];
  const span = Math.max(0, layer.end - layer.start);
  const tied = Math.abs(layer[fade] - value.duration) < 1e-6;
  return <div className="two-fields">
    <NumberField scale={1000} suffix="ms" label="Duration" ariaLabel={`${title} duration`} value={value.duration} min={TEXT_MOTION_RANGES.duration[0]} max={Math.min(TEXT_MOTION_RANGES.duration[1], span)} step={0.05}
      onChange={duration => onPatch(layer.id, { [side]: { duration }, ...(tied && { [fade]: Math.min(duration, Math.max(0, span - layer[otherFade])) }) })}/>
    <NumberField scale={1000} suffix="ms" label="Fade" ariaLabel={`${title} fade`} value={layer[fade]} min={0} max={Math.max(0, span - layer[otherFade])} step={0.05} onChange={value => onPatch(layer.id, { [fade]: value })}/>
  </div>;
}

function FadeField({ layer, side, onPatch }) {
  const { title, fade, otherFade } = SIDES[side];
  const span = Math.max(0, layer.end - layer.start);
  return <NumberField scale={1000} suffix="ms" label="Fade duration" ariaLabel={`${title} fade`} value={layer[fade]} min={0} max={Math.max(0, span - layer[otherFade])} step={0.05} onChange={value => onPatch(layer.id, { [fade]: value })}/>;
}

// Hovering or focusing a preset previews it on the canvas; clicking applies it.
function PresetGrid({ layer, side, current, onPatch, onPreview }) {
  const title = SIDES[side].title;
  const end = () => onPreview(layer.id, side, null);
  return <div className="text-motion-presets" role="group" aria-label={`${title} preset`}>
    {TEXT_MOTION_PRESETS.map(preset => <button type="button" key={preset.id} aria-pressed={current === preset.id} className={current === preset.id ? 'selected' : ''}
      onPointerEnter={() => onPreview(layer.id, side, preset.id)} onPointerLeave={end} onFocus={() => onPreview(layer.id, side, preset.id)} onBlur={end}
      onClick={() => { end(); onPatch(layer.id, textMotionPresetPatch(layer, side, preset.id)); }}>{preset.name}</button>)}
  </div>;
}

function MovementControls({ layer, side, onPatch, onPreview }) {
  const { title } = SIDES[side];
  const value = spec(layer, side), current = textMotionPreset(layer, side);
  const set = fields => onPatch(layer.id, { [side]: fields });
  const scale = value.motion === 'scale';
  const [min, max] = scale ? TEXT_MOTION_RANGES.scale : TEXT_MOTION_RANGES.distance;
  return <>
    <PresetGrid layer={layer} side={side} current={current} onPatch={onPatch} onPreview={onPreview}/>
    {current === 'fade' && <FadeField layer={layer} side={side} onPatch={onPatch}/>}
    {moves(value) && <>
      <TimingFields layer={layer} side={side} value={value} onPatch={onPatch}/>
      {DIRECTED.includes(value.motion) && <Field label="Direction"><Segmented label={`${title} direction`} value={value.direction} options={TEXT_DIRECTIONS.map(id => [id, id])} onChange={direction => set({ direction })}/></Field>}
      <Range label={scale ? 'Scale' : 'Distance'} ariaLabel={`${title} ${scale ? 'scale' : 'distance'}`} value={value.amount} min={min} max={max} scale={1} decimals={1} suffix="%" onChange={amount => set({ amount })}/>
      <Field label="Character"><Segmented label={`${title} character`} value={value.character} onChange={character => set({ character })}
        options={TEXT_CHARACTERS.map(item => [item.id, item.name, <svg key="curve" className="text-motion-curve" viewBox="0 0 32 20" aria-hidden="true"><path d={curvePath(item.easing)}/></svg>])}/></Field>
    </>}
  </>;
}

// Text entry and exit: a movement preset plus the side's opacity fade. A mirrored exit
// plays the entry movement backwards over its own duration.
export function TextEntryControls({ layer, onPatch, onPreview = () => {} }) {
  return <Section title="Entry" defaultOpen detail={textMotionSummary(layer, 'entry')}>
    <MovementControls layer={layer} side="entry" onPatch={onPatch} onPreview={onPreview}/>
  </Section>;
}

export function TextExitControls({ layer, onPatch, onPreview = () => {} }) {
  const exit = spec(layer, 'exit'), entryMoves = moves(spec(layer, 'entry'));
  return <Section title="Exit" detail={textMotionSummary(layer, 'exit')}>
    <label className="check-field"><input type="checkbox" aria-label="Same as entry, reversed" checked={exit.mirror} onChange={event => onPatch(layer.id, { exit: { mirror: event.target.checked } })}/>Same as entry, reversed</label>
    {exit.mirror
      ? entryMoves ? <TimingFields layer={layer} side="exit" value={exit} onPatch={onPatch}/> : <FadeField layer={layer} side="exit" onPatch={onPatch}/>
      : <MovementControls layer={layer} side="exit" onPatch={onPatch} onPreview={onPreview}/>}
  </Section>;
}
