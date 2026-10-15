import React, { useCallback, useSyncExternalStore } from 'react';
import { UploadSimple } from '@phosphor-icons/react';
import { MODEL_ENVIRONMENTS, MODEL_GLASS_SHADERS, MODEL_LIGHTING_PRESETS, MODEL_MATERIAL_FAMILIES, MODEL_MATERIAL_MODES, MODEL_MATERIAL_PRESETS, MODEL_SHADERS, MODEL_STYLE_RANGES, MODEL_TONE_MAPPINGS, normalizeModelStyle, applyLightingPreset, applyModelPreset, selectedLightingPreset, selectedModelPreset } from '../../model-style.js';
import { getModelMetadata, subscribeModelMetadata } from '../../model-metadata.js';
import { OrientationControl } from '../OrientationControl.jsx';
import { Color, Field, NumberField, Range, Section } from '../controls.jsx';
import { ModelMotionControls } from './ModelMotionControls.jsx';

const names = { original: 'Original', tint: 'Tint', replace: 'Replace', standard: 'Standard', toon: 'Toon', fresnel: 'Fresnel', wireframe: 'Wireframe', glass: 'Glass', crystal: 'Studio glass' };
const environmentNames = { none: 'None', studio: 'Classic room', softbox: 'Studio softboxes', stage: 'Dark stage', sunset: 'Sunset sky', neon: 'Neon tubes' };
const toneNames = { none: 'None (classic)', neutral: 'Neutral', agx: 'AgX (soft)' };
const serverMetadata = () => null;

export function ModelControls({ layer, uploading, onPatch, onPick, rightTab = 'composition' }) {
  const subscribe = useCallback(listener => subscribeModelMetadata(layer.src, listener), [layer.src]);
  const snapshot = useCallback(() => getModelMetadata(layer.src), [layer.src]);
  const metadata = useSyncExternalStore(subscribe, snapshot, serverMetadata);
  const style = normalizeModelStyle(layer.modelStyle);
  const patchStyle = changes => onPatch(layer.id, { modelStyle: { ...style, ...changes } });
  const range = (key, label, options = {}) => <Range label={label} value={style[key]} min={MODEL_STYLE_RANGES[key][0]} max={MODEL_STYLE_RANGES[key][1]} step={0.01} scale={100} {...options} onChange={value => patchStyle({ [key]: value })}/>;
  const select = (key, label, values) => <Field label={label}><select aria-label={label} value={style[key]} onChange={event => patchStyle({ [key]: event.target.value })}>{values.map(value => <option key={value} value={value}>{names[value]}</option>)}</select></Field>;
  const clips = metadata?.clips ?? [];
  const missingClip = metadata !== null && style.animationClip >= 0 && !clips.some(clip => clip.index === style.animationClip) && (clips.length > 0 || style.animationClip > 0);
  const clipActive = metadata !== null && clips.some(clip => clip.index === style.animationClip);
  const replacement = style.mode === 'replace';
  const glass = MODEL_GLASS_SHADERS.includes(style.shader);
  const pbr = replacement && (['standard', 'fresnel'].includes(style.shader) || glass);
  const lighting = selectedLightingPreset(style);
  const details = [style.clearcoat > 0 && style.clearcoatRoughness > 0 && 'Soft coat', style.anisotropy > 0 && 'Brushed', style.sheen > 0 && 'Sheen', style.iridescence > 0 && 'Iridescent film'].filter(Boolean);

  return <>
    {rightTab === 'composition' ? <>
    <Section title="3D model">
      <button type="button" className="outline-button" disabled={uploading} onClick={() => onPick(layer.id)}><UploadSimple size={15}/>Replace file</button>
      <p className="helper">Select OBJ with its declared MTL and textures for one 3D layer. GLB is preserved.</p>
    </Section>
    <Section title="Transform">
      <Range label="Position X" value={layer.x} min={Math.min(-100, layer.x)} max={Math.max(100, layer.x)} onChange={x => onPatch(layer.id, { x })}/>
      <Range label="Position Y" value={layer.y} min={Math.min(-100, layer.y)} max={Math.max(100, layer.y)} onChange={y => onPatch(layer.id, { y })}/>
      <Range label="Size" value={layer.size} min={2} max={500} suffix="%" onChange={size => onPatch(layer.id, { size })}/>
      <OrientationControl key={layer.id} layer={layer} open onCommit={fields => onPatch(layer.id, fields)}/>
      <p className="helper">Shift-drag turns the model about the screen; the rotation handle rolls it toward you.</p>
    </Section>
    <Section title="Camera" collapsible detail={`${style.framing === 'fit' ? 'Fit motion' : 'Fixed'} · ${Math.round(style.zoom * 100)}%`}>
      <Field label="Framing"><select aria-label="Framing" value={style.framing} onChange={event => patchStyle({ framing: event.target.value })}><option value="fit">Fit motion</option><option value="fixed">Fixed</option></select></Field>
      {range('zoom', 'Zoom')}
      {range('perspective', 'Perspective', { step: 1, scale: 1, suffix: '°' })}
      <p className="helper">{style.framing === 'fit' ? 'Fit motion keeps every rotation, the automatic motion and the selected embedded clip inside the layer at 100% zoom. Higher zoom may crop.' : 'Fixed keeps the earlier camera; rotation and motion may reach past the layer edges.'} Wider perspective exaggerates depth.</p>
    </Section>
    <Section title="Material">
      <Field label="Material preset"><select aria-label="Material preset" value={selectedModelPreset(style)} onChange={event => onPatch(layer.id, { modelStyle: applyModelPreset(style, event.target.value) })}>
        <option value="custom" disabled>Custom</option>
        {MODEL_MATERIAL_FAMILIES.map(([family, label]) => <optgroup key={family} label={label}>{MODEL_MATERIAL_PRESETS.filter(preset => preset.family === family).map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</optgroup>)}
      </select></Field>
      {select('mode', 'Material mode', MODEL_MATERIAL_MODES)}
      <p className="helper">Original preserves imported materials. Tint multiplies their base color and keeps maps. Replace uses a new material without imported base maps.</p>
      <fieldset className="layer-properties" disabled={style.mode === 'original'}><Color label="Material color" value={style.color} onChange={color => patchStyle({ color })}/></fieldset>
      {select('shader', 'Surface shader', MODEL_SHADERS)}
      <fieldset className="layer-properties" disabled={!pbr}>
        {range('roughness', 'Roughness')}
        {range('metalness', 'Metalness')}
        {range('clearcoat', 'Clearcoat')}
        {range('iridescence', 'Iridescence')}
      </fieldset>
      <details className="orientation-control surface-details" open={details.length > 0}>
        <summary>Surface details<span>{details.join(' · ') || 'None'}</span></summary>
        <fieldset className="layer-properties" disabled={!pbr}>
          {range('clearcoatRoughness', 'Clearcoat roughness')}
          {range('anisotropy', 'Brushed')}
          {range('anisotropyRotation', 'Brush direction', { step: 1, scale: 1, suffix: '°' })}
          {range('sheen', 'Sheen')}
          <Color label="Sheen color" value={style.sheenColor} onChange={sheenColor => patchStyle({ sheenColor })}/>
          {range('sheenRoughness', 'Sheen roughness')}
          {range('iridescenceIOR', 'Film index ×100', { scale: 100, suffix: ' ' })}
          <Range label="Film thinnest" value={style.iridescenceThicknessMin} min={MODEL_STYLE_RANGES.iridescenceThicknessMin[0]} max={MODEL_STYLE_RANGES.iridescenceThicknessMin[1]} suffix=" nm" onChange={value => patchStyle({ iridescenceThicknessMin: value, iridescenceThicknessMax: Math.max(value, style.iridescenceThicknessMax) })}/>
          <Range label="Film thickest" value={style.iridescenceThicknessMax} min={MODEL_STYLE_RANGES.iridescenceThicknessMax[0]} max={MODEL_STYLE_RANGES.iridescenceThicknessMax[1]} suffix=" nm" onChange={value => patchStyle({ iridescenceThicknessMax: value, iridescenceThicknessMin: Math.min(value, style.iridescenceThicknessMin) })}/>
        </fieldset>
        <p className="helper">Brushed stretches reflections along the surface. Sheen adds a soft fabric glow at grazing angles. Iridescence colors come from a thin film: its index and thickness set the hues, and a range between thinnest and thickest makes them flow across the surface. Brushing and flowing film need a model with UV coordinates; without them, brushing is ignored and the film keeps its thickest value.</p>
      </details>
      <fieldset className="layer-properties" disabled={!replacement || style.shader === 'wireframe'}>
        <Color label="Emissive color" value={style.emissive} onChange={emissive => patchStyle({ emissive })}/>
        {range('emissiveIntensity', 'Emissive intensity')}
      </fieldset>
      {!replacement && <p className="helper">Surface overrides are available in Replace mode; Original and Tint keep imported surface properties.</p>}
      {replacement && !pbr && <p className="helper">Toon and Wireframe do not use PBR surface properties. Wireframe does not use emissive lighting.</p>}
      {glass && <>
        {range('ior', 'Refractive index ×100', { scale: 100, suffix: ' ' })}
        {style.shader === 'glass' ? range('glassOpacity', 'Glass body', { suffix: '%' }) : range('dispersion', 'Dispersion', { suffix: '%' })}
        <p className="helper">{style.shader === 'glass'
          ? 'Glass shows the layers below through its tinted body; a higher refractive index makes the edges more reflective and opaque. It does not bend or blur those layers.'
          : 'Studio glass refracts its own reflection environment, not the layers below, and is opaque. Dark stage, Sunset or Neon give it the most contrast; dispersion splits the light into colors.'}</p>
      </>}
      {style.shader === 'toon' && range('toonSteps', 'Toon steps', { step: 1, scale: 1 })}
      {style.shader === 'fresnel' && <>
        <Color label="Fresnel color" value={style.fresnelColor} onChange={fresnelColor => patchStyle({ fresnelColor })}/>
        {range('fresnelIntensity', 'Fresnel intensity')}
        {range('fresnelPower', 'Fresnel power', { step: 1, scale: 1 })}
      </>}
      {metadata?.unlit && <p className="helper">This source includes unlit materials. Original or Tint with Standard preserves their unlit appearance; surface shaders may adapt them to a lit material.</p>}
      {((pbr && style.metalness >= .5) || glass) && style.environment === 'none' && <p className="helper">{glass ? 'Glass' : 'Metal'} reflects its surroundings. Choose a Lighting preset with an environment, such as Studio, to see it.</p>}
    </Section>
    <Section title="Lighting" collapsible defaultOpen={false} detail={MODEL_LIGHTING_PRESETS.find(preset => preset.id === lighting)?.name ?? 'Custom'}>
      <Field label="Lighting preset"><select aria-label="Lighting preset" value={lighting} onChange={event => onPatch(layer.id, { modelStyle: applyLightingPreset(style, event.target.value) })}>
        <option value="custom" disabled>Custom</option>
        {MODEL_LIGHTING_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
      </select></Field>
      <Field label="Reflection environment"><select aria-label="Reflection environment" value={style.environment} onChange={event => patchStyle({ environment: event.target.value })}>{MODEL_ENVIRONMENTS.map(id => <option key={id} value={id}>{environmentNames[id]}</option>)}</select></Field>
      <fieldset className="layer-properties" disabled={style.environment === 'none' || ['toon', 'wireframe'].includes(style.shader)}>
        {range('environmentIntensity', 'Environment intensity')}
        {range('environmentRotation', 'Environment rotation', { step: 1, scale: 1, suffix: '°' })}
      </fieldset>
      <p className="helper">Environments are generated locally, not ray-traced reflections between objects. Toon and Wireframe do not reflect the environment. Intensity uses percentages: 100% is a multiplier of 1.</p>
      {metadata?.unlit && !replacement && style.shader === 'standard' && <p className="helper">Unlit source surfaces do not respond to lights or environment reflections. Lit surfaces in the same model still respond.</p>}
      <Field label="Tone mapping"><select aria-label="Tone mapping" value={style.toneMapping} onChange={event => patchStyle({ toneMapping: event.target.value })}>{MODEL_TONE_MAPPINGS.map(id => <option key={id} value={id}>{toneNames[id]}</option>)}</select></Field>
      {range('exposure', 'Exposure')}
      <p className="helper">Neutral and AgX roll bright light off smoothly instead of clipping it to flat white; AgX is softer and less saturated. None keeps the classic look.</p>
      <fieldset className="layer-properties" disabled={style.shader === 'wireframe'}>
        {range('ambientIntensity', 'Ambient intensity')}
        {range('keyIntensity', 'Key intensity')}
        <Color label="Key color" value={style.keyColor} onChange={keyColor => patchStyle({ keyColor })}/>
        {range('fillIntensity', 'Fill intensity')}
        <Color label="Fill color" value={style.fillColor} onChange={fillColor => patchStyle({ fillColor })}/>
        {range('rimIntensity', 'Rim intensity')}
        <Color label="Rim color" value={style.rimColor} onChange={rimColor => patchStyle({ rimColor })}/>
        {range('lightRotation', 'Light rig rotation', { step: 1, scale: 1, suffix: '°' })}
      </fieldset>
    </Section>
    </> : <>
    <ModelMotionControls style={style} onChange={modelStyle => onPatch(layer.id, { modelStyle })}/>
    <Section title="Embedded animation">
      <Field label="Embedded clip"><select aria-label="Embedded clip" value={style.animationClip} disabled={metadata !== null && clips.length === 0 && !missingClip} onChange={event => patchStyle({ animationClip: Number(event.target.value) })}>
        <option value={-1}>None</option>
        {metadata === null && style.animationClip >= 0 && <option value={style.animationClip} disabled>Loading selected clip…</option>}
        {metadata !== null && clips.length === 0 && style.animationClip === 0 && <option value={0}>No embedded animation</option>}
        {missingClip && <option value={style.animationClip} disabled>Missing clip {style.animationClip + 1}</option>}
        {clips.map(clip => <option key={clip.index} value={clip.index}>{clip.index + 1}: {(clip.name || 'Unnamed clip').slice(0, 80)} · {clip.duration.toFixed(2)} s</option>)}
      </select></Field>
      {metadata === null && <p className="helper" role="status">Clip availability is not known yet. Choose None to disable embedded animation if the preview cannot load.</p>}
      {metadata !== null && clips.length === 0 && <p className="helper">This model has no embedded animation. Choose Automatic motion to animate its pose.</p>}
      {missingClip && <p className="helper" role="alert">The selected embedded clip is missing from this model. Choose an available clip or None.</p>}
      <fieldset className="layer-properties" disabled={!clipActive}>
        {range('animationSpeed', 'Embedded clip speed')}
        <NumberField scale={1000} suffix="ms" label="Source offset" value={layer.offset} min={0} max={3600} onChange={offset => onPatch(layer.id, { offset })}/>
        <label className="check-field"><input type="checkbox" checked={layer.loop} onChange={event => onPatch(layer.id, { loop: event.target.checked })}/>Loop embedded clip</label>
      </fieldset>
    </Section>
    </>}
  </>;
}
