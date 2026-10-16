import React, { useCallback, useSyncExternalStore } from 'react';
import { MODEL_ENVIRONMENTS, MODEL_GLASS_SHADERS, MODEL_LIGHTING_PRESETS, MODEL_MATERIAL_FAMILIES, MODEL_MATERIAL_MODES, MODEL_MATERIAL_PRESETS, MODEL_REFRACTION_SAMPLES, MODEL_REFRACTION_RESOLUTIONS, MODEL_SHADERS, MODEL_STYLE_RANGES, MODEL_TONE_MAPPINGS, normalizeModelStyle, applyLightingPreset, applyModelPreset, selectedLightingPreset, selectedModelPreset } from '../../model-style.js';
import { getModelMetadata, subscribeModelMetadata } from '../../model-metadata.js';
import { OrientationControl } from '../OrientationControl.jsx';
import { Color, Field, NumberField, Range, Section } from '../controls.jsx';
import { ModelMotionControls } from './ModelMotionControls.jsx';
import { SpatialControls } from './SpatialControls.jsx';

const names = { original: 'Original', tint: 'Tint', replace: 'Replace', standard: 'Standard', toon: 'Toon', fresnel: 'Fresnel', wireframe: 'Wireframe', glass: 'Glass', crystal: 'Studio glass', refractive: 'Refractive glass' };
const environmentNames = { none: 'None', studio: 'Classic room', softbox: 'Studio softboxes', stage: 'Dark stage', sunset: 'Sunset sky', neon: 'Neon tubes' };
const toneNames = { none: 'None (classic)', neutral: 'Neutral', agx: 'AgX (soft)' };
const serverMetadata = () => null;

// Model Design (rightTab 'composition') and Motion ('animation') sections. Controls that do
// not apply to the current mode or shader are hidden rather than disabled.
export function ModelControls({ layer, onPatch, rightTab = 'composition' }) {
  const subscribe = useCallback(listener => subscribeModelMetadata(layer.src, listener), [layer.src]);
  const snapshot = useCallback(() => getModelMetadata(layer.src), [layer.src]);
  const metadata = useSyncExternalStore(subscribe, snapshot, serverMetadata);
  const style = normalizeModelStyle(layer.modelStyle);
  const patchStyle = changes => onPatch(layer.id, { modelStyle: { ...style, ...changes } });
  const range = (key, label, options = {}) => <Range label={label} value={style[key]} min={MODEL_STYLE_RANGES[key][0]} max={MODEL_STYLE_RANGES[key][1]} step={0.01} scale={100} {...options} onChange={value => patchStyle({ [key]: value })}/>;
  const select = (key, label, values) => <Field label={label}><select aria-label={label} value={style[key]} onChange={event => patchStyle({ [key]: event.target.value })}>{values.map(value => <option key={value} value={value}>{names[value]}</option>)}</select></Field>;
  const quality = (key, label, values) => <Field label={label}><select aria-label={label} value={style[key]} onChange={event => patchStyle({ [key]: Number(event.target.value) })}>{values.map(value => <option key={value} value={value}>{value}</option>)}</select></Field>;
  const clips = metadata?.clips ?? [];
  const missingClip = metadata !== null && style.animationClip >= 0 && !clips.some(clip => clip.index === style.animationClip) && (clips.length > 0 || style.animationClip > 0);
  const clipActive = metadata !== null && clips.some(clip => clip.index === style.animationClip);
  const replacement = style.mode === 'replace';
  const glass = MODEL_GLASS_SHADERS.includes(style.shader);
  const refractive = style.shader === 'refractive';
  const pbr = replacement && !refractive && (['standard', 'fresnel'].includes(style.shader) || glass);
  const reflects = !['toon', 'wireframe'].includes(style.shader);
  const lighting = selectedLightingPreset(style);
  const details = [style.clearcoat > 0 && style.clearcoatRoughness > 0 && 'Soft coat', style.anisotropy > 0 && 'Brushed', style.sheen > 0 && 'Sheen', style.iridescence > 0 && 'Iridescent film'].filter(Boolean);

  if (rightTab !== 'composition') return <>
    <ModelMotionControls style={style} onChange={modelStyle => onPatch(layer.id, { modelStyle })}/>
    <Section title="Embedded animation" detail={style.animationClip < 0 ? 'None' : clipActive ? (clips.find(clip => clip.index === style.animationClip).name || `Clip ${style.animationClip + 1}`).slice(0, 24) : metadata === null ? 'Loading' : 'No clip'}>
      <Field label="Embedded clip"><select aria-label="Embedded clip" value={style.animationClip} disabled={metadata !== null && clips.length === 0 && !missingClip} onChange={event => patchStyle({ animationClip: Number(event.target.value) })}>
        <option value={-1}>None</option>
        {metadata === null && style.animationClip >= 0 && <option value={style.animationClip} disabled>Loading selected clip…</option>}
        {metadata !== null && clips.length === 0 && style.animationClip === 0 && <option value={0}>No embedded animation</option>}
        {missingClip && <option value={style.animationClip} disabled>Missing clip {style.animationClip + 1}</option>}
        {clips.map(clip => <option key={clip.index} value={clip.index}>{clip.index + 1}: {(clip.name || 'Unnamed clip').slice(0, 80)} · {clip.duration.toFixed(2)} s</option>)}
      </select></Field>
      {metadata === null && <p className="helper" role="status">Loading clips. Choose None if the preview cannot load.</p>}
      {metadata !== null && clips.length === 0 && <p className="helper">No embedded animation; use Automatic motion.</p>}
      {missingClip && <p className="helper" role="alert">The selected clip is missing. Choose another clip or None.</p>}
      {clipActive && <>
        {range('animationSpeed', 'Embedded clip speed')}
        <NumberField scale={1000} suffix="ms" label="Source offset" value={layer.offset} min={0} max={3600} onChange={offset => onPatch(layer.id, { offset })}/>
        <label className="check-field"><input type="checkbox" checked={layer.loop} onChange={event => onPatch(layer.id, { loop: event.target.checked })}/>Loop embedded clip</label>
      </>}
    </Section>
  </>;

  return <>
    <Section title="Transform" detail={`X ${Math.round(layer.x)} · Y ${Math.round(layer.y)} · ${Math.round(layer.size)}%`}>
      <SpatialControls layer={layer} onPatch={onPatch}/>
      <Range label="Position X" value={layer.x} min={Math.min(-100, layer.x)} max={Math.max(100, layer.x)} onChange={x => onPatch(layer.id, { x })}/>
      <Range label="Position Y" value={layer.y} min={Math.min(-100, layer.y)} max={Math.max(100, layer.y)} onChange={y => onPatch(layer.id, { y })}/>
      <Range label="Size" value={layer.size} min={2} max={500} suffix="%" onChange={size => onPatch(layer.id, { size })}/>
      <OrientationControl key={layer.id} layer={layer} open onCommit={fields => onPatch(layer.id, fields)}/>
      <p className="helper">Shift-drag on the canvas turns the model about the screen.</p>
    </Section>
    <Section title="Object framing" detail={`${style.framing === 'fit' ? 'Fit motion' : 'Fixed'} · ${Math.round(style.zoom * 100)}%`}>
      <Field label="Framing"><select aria-label="Framing" value={style.framing} onChange={event => patchStyle({ framing: event.target.value })}><option value="fit">Fit motion</option><option value="fixed">Fixed</option></select></Field>
      {range('zoom', 'Zoom')}
      {layer.space === 'flat' && range('perspective', 'Perspective', { step: 1, scale: 1, suffix: '°' })}
      <p className="helper">{style.framing === 'fit' ? 'Keeps every rotation and motion inside the object frame at 100%.' : 'Uses a fixed object frame; motion may reach past its edges.'}</p>
    </Section>
    <Section title="Material" defaultOpen detail={MODEL_MATERIAL_PRESETS.find(preset => preset.id === selectedModelPreset(style))?.name ?? 'Custom'}>
      <Field label="Material preset"><select aria-label="Material preset" value={selectedModelPreset(style)} onChange={event => onPatch(layer.id, { modelStyle: applyModelPreset(style, event.target.value) })}>
        <option value="custom" disabled>Custom</option>
        {MODEL_MATERIAL_FAMILIES.map(([family, label]) => <optgroup key={family} label={label}>{MODEL_MATERIAL_PRESETS.filter(preset => preset.family === family).map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</optgroup>)}
      </select></Field>
      {select('mode', 'Material mode', MODEL_MATERIAL_MODES)}
      {style.mode !== 'original' && <Color label="Material color" value={style.color} onChange={color => patchStyle({ color })}/>}
      {select('shader', 'Surface shader', MODEL_SHADERS)}
      {!replacement && !refractive && <p className="helper">Original and Tint keep the imported surface; choose Replace to edit it.</p>}
      {refractive && range('roughness', 'Roughness')}
      {pbr && <>
        {range('roughness', 'Roughness')}
        {range('metalness', 'Metalness')}
        {range('clearcoat', 'Clearcoat')}
        {range('iridescence', 'Iridescence')}
        <details className="orientation-control surface-details" open={details.length > 0}>
          <summary>Surface details<span>{details.join(' · ') || 'None'}</span></summary>
          {range('clearcoatRoughness', 'Clearcoat roughness')}
          {range('anisotropy', 'Brushed')}
          {range('anisotropyRotation', 'Brush direction', { step: 1, scale: 1, suffix: '°' })}
          {range('sheen', 'Sheen')}
          <Color label="Sheen color" value={style.sheenColor} onChange={sheenColor => patchStyle({ sheenColor })}/>
          {range('sheenRoughness', 'Sheen roughness')}
          {range('iridescenceIOR', 'Film index ×100', { scale: 100, suffix: ' ' })}
          <Range label="Film thinnest" value={style.iridescenceThicknessMin} min={MODEL_STYLE_RANGES.iridescenceThicknessMin[0]} max={MODEL_STYLE_RANGES.iridescenceThicknessMin[1]} suffix=" nm" onChange={value => patchStyle({ iridescenceThicknessMin: value, iridescenceThicknessMax: Math.max(value, style.iridescenceThicknessMax) })}/>
          <Range label="Film thickest" value={style.iridescenceThicknessMax} min={MODEL_STYLE_RANGES.iridescenceThicknessMax[0]} max={MODEL_STYLE_RANGES.iridescenceThicknessMax[1]} suffix=" nm" onChange={value => patchStyle({ iridescenceThicknessMax: value, iridescenceThicknessMin: Math.min(value, style.iridescenceThicknessMin) })}/>
          <p className="helper">Brushing and a flowing film need model UV coordinates.</p>
        </details>
      </>}
      {replacement && !refractive && style.shader !== 'wireframe' && <>
        <Color label="Emissive color" value={style.emissive} onChange={emissive => patchStyle({ emissive })}/>
        {range('emissiveIntensity', 'Emissive intensity')}
      </>}
      {glass && <>
        {range('ior', 'Refractive index ×100', { scale: 100, suffix: ' ' })}
        {style.shader === 'glass' ? range('glassOpacity', 'Glass body', { suffix: '%' }) : range('dispersion', 'Dispersion', { suffix: '%' })}
        {refractive && <>
          {range('refractionThickness', 'Thickness', { suffix: '%' })}
          {quality('refractionSamples', 'Refraction samples', MODEL_REFRACTION_SAMPLES)}
          {quality('refractionResolution', 'Refraction resolution', MODEL_REFRACTION_RESOLUTIONS)}
        </>}
        <p className="helper">{refractive ? 'Bends and blurs the actual layers below; higher sample counts and resolutions cost more.' : style.shader === 'glass' ? 'Shows the layers below without bending them.' : 'Refracts its own environment and is opaque.'}</p>
      </>}
      {style.shader === 'toon' && range('toonSteps', 'Toon steps', { step: 1, scale: 1 })}
      {style.shader === 'fresnel' && <>
        <Color label="Fresnel color" value={style.fresnelColor} onChange={fresnelColor => patchStyle({ fresnelColor })}/>
        {range('fresnelIntensity', 'Fresnel intensity')}
        {range('fresnelPower', 'Fresnel power', { step: 1, scale: 1 })}
      </>}
      {metadata?.unlit && !refractive && <p className="helper">Unlit source materials stay unlit in Original and Tint.</p>}
      {((pbr && style.metalness >= .5) || (glass && !refractive)) && style.environment === 'none' && <p className="helper">{glass ? 'Glass' : 'Metal'} needs a Lighting environment, such as Studio, to reflect.</p>}
    </Section>
    <Section title="Lighting" detail={MODEL_LIGHTING_PRESETS.find(preset => preset.id === lighting)?.name ?? 'Custom'}>
      <Field label="Lighting preset"><select aria-label="Lighting preset" value={lighting} onChange={event => onPatch(layer.id, { modelStyle: applyLightingPreset(style, event.target.value) })}>
        <option value="custom" disabled>Custom</option>
        {MODEL_LIGHTING_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
      </select></Field>
      <Field label="Reflection environment"><select aria-label="Reflection environment" value={style.environment} onChange={event => patchStyle({ environment: event.target.value })}>{MODEL_ENVIRONMENTS.map(id => <option key={id} value={id}>{environmentNames[id]}</option>)}</select></Field>
      {style.environment !== 'none' && (reflects ? <>
        {range('environmentIntensity', 'Environment intensity')}
        {range('environmentRotation', 'Environment rotation', { step: 1, scale: 1, suffix: '°' })}
      </> : <p className="helper">Toon and Wireframe ignore the environment.</p>)}
      <Field label="Tone mapping"><select aria-label="Tone mapping" value={style.toneMapping} onChange={event => patchStyle({ toneMapping: event.target.value })}>{MODEL_TONE_MAPPINGS.map(id => <option key={id} value={id}>{toneNames[id]}</option>)}</select></Field>
      {style.toneMapping !== 'none' && range('exposure', 'Exposure')}
      {style.shader === 'wireframe' ? <p className="helper">Wireframe is unlit.</p> : <>
        {range('ambientIntensity', 'Ambient intensity')}
        {range('keyIntensity', 'Key intensity')}
        <Color label="Key color" value={style.keyColor} onChange={keyColor => patchStyle({ keyColor })}/>
        {range('fillIntensity', 'Fill intensity')}
        <Color label="Fill color" value={style.fillColor} onChange={fillColor => patchStyle({ fillColor })}/>
        {range('rimIntensity', 'Rim intensity')}
        <Color label="Rim color" value={style.rimColor} onChange={rimColor => patchStyle({ rimColor })}/>
        {range('lightRotation', 'Light rig rotation', { step: 1, scale: 1, suffix: '°' })}
      </>}
    </Section>
  </>;
}
