import React, { useCallback, useSyncExternalStore } from 'react';
import { MODEL_BASES, MODEL_ENVIRONMENTS, MODEL_GLASS, MODEL_LIGHTING_PRESETS, MODEL_LOOKS, MODEL_MATERIAL_FAMILIES, MODEL_MATERIAL_PRESETS, MODEL_REFRACTION_SAMPLES, MODEL_REFRACTION_RESOLUTIONS, MODEL_STYLE_RANGES, MODEL_TONE_MAPPINGS, normalizeModelStyle, applyLightingPreset, applyModelPreset, selectedLightingPreset, selectedModelPreset } from '../../model-style.js';
import { getModelMetadata, subscribeModelMetadata } from '../../model-metadata.js';
import { MORPHING_SPHERE_SRC, LIQUID_RIBBONS_SRC, MAGICAL_OCTAHEDRON_SRC } from '../../model-shapes.js';
import { OrientationControl } from '../OrientationControl.jsx';
import { Color, Field, NumberField, Range, Section } from '../controls.jsx';
import { ModelMotionControls } from './ModelMotionControls.jsx';
import { SpatialControls } from './SpatialControls.jsx';

const names = { imported: 'Imported', tinted: 'Tinted', custom: 'Custom', physical: 'Physical', toon: 'Toon', wireframe: 'Wireframe', none: 'None', 'see-through': 'See-through', refractive: 'Refractive', environment: 'Environment', holographic: 'Holographic', quantum: 'Quantum' };
const glassHelp = { 'see-through': 'Shows the layers below without bending them.', refractive: 'Bends and blurs the actual layers below; higher sample counts and resolutions cost more.', environment: 'Refracts its own reflection environment and is opaque.', holographic: 'Refracts its own reflection environment, not the layers below, and is opaque. No UV coordinates required. Speed is in cycles/s: zero freezes the bands and light sweep. Light sweep zero turns the sweep off; it uses the same speed as the bands.', quantum: 'Opaque crystal shell with a self-lit sampled interior, not transmission of the layers below. The bounded volume is an approximation, not exact internal mesh intersections. No UV coordinates required. Depth is relative to the normalized model extent; zero removes the interior. Speed zero freezes all procedural motion, including morphing. Crystal colors set the interior palette; Material color tints the result. The lighting environment affects shell reflections only.' };
const environmentNames = { none: 'None', studio: 'Classic room', softbox: 'Studio softboxes', holographic: 'Holographic studio', stage: 'Dark stage', sunset: 'Sunset sky', neon: 'Neon tubes' };
names.liquid = 'Liquid chrome';
glassHelp.liquid = 'Opaque reflection and transmission of its own environment only, not the layers below. Dispersion splits reflected colors; Transmission spread splits environment transmission. Reflectance above 1 is an artistic boost, not physical energy conservation.';
environmentNames.liquid = 'Liquid studio';
const toneNames = { none: 'None (classic)', neutral: 'Neutral', agx: 'AgX (soft)', aces: 'ACES filmic' };
const serverMetadata = () => null;

// Model Design (rightTab 'composition') and Motion ('animation') sections. Controls that do
// not apply to the current base, look or glass are hidden rather than disabled.
export function ModelControls({ layer, onPatch, rightTab = 'composition' }) {
  const subscribe = useCallback(listener => subscribeModelMetadata(layer.src, listener), [layer.src]);
  const snapshot = useCallback(() => getModelMetadata(layer.src), [layer.src]);
  const metadata = useSyncExternalStore(subscribe, snapshot, serverMetadata);
  const style = normalizeModelStyle(layer.modelStyle);
  const patchStyle = changes => onPatch(layer.id, { modelStyle: { ...style, ...changes } });
  const range = (key, label, options = {}) => <Range label={label} value={style[key]} min={MODEL_STYLE_RANGES[key][0]} max={MODEL_STYLE_RANGES[key][1]} step={0.01} scale={100} {...options} onChange={value => patchStyle({ [key]: value })}/>;
  const select = (key, label, values, changes = value => ({ [key]: value })) => <Field label={label}><select aria-label={label} value={style[key]} onChange={event => patchStyle(changes(event.target.value))}>{values.map(value => <option key={value} value={value}>{names[value]}</option>)}</select></Field>;
  const quality = (key, label, values) => <Field label={label}><select aria-label={label} value={style[key]} onChange={event => patchStyle({ [key]: Number(event.target.value) })}>{values.map(value => <option key={value} value={value}>{value}</option>)}</select></Field>;
  const clips = metadata?.clips ?? [];
  const missingClip = metadata !== null && style.animationClip >= 0 && !clips.some(clip => clip.index === style.animationClip) && (clips.length > 0 || style.animationClip > 0);
  const clipActive = metadata !== null && clips.some(clip => clip.index === style.animationClip);
  const custom = style.base === 'custom';
  const morphing = layer.src === MORPHING_SPHERE_SRC;
  const liquidShape = layer.src === LIQUID_RIBBONS_SRC;
  const octahedron = layer.src === MAGICAL_OCTAHEDRON_SRC;
  const physical = style.look === 'physical';
  const glass = style.glass !== 'none';
  const octaVolume = octahedron && !custom && physical && !glass;
  const refractive = style.glass === 'refractive';
  const holographic = style.glass === 'holographic';
  const quantum = style.glass === 'quantum';
  const liquid = style.glass === 'liquid';
  const dedicatedSurface = refractive || holographic || quantum || liquid;
  const pbr = custom && physical && !dedicatedSurface;
  const lighting = selectedLightingPreset(style);
  const details = [style.clearcoat > 0 && style.clearcoatRoughness > 0 && 'Soft coat', style.anisotropy > 0 && 'Brushed', style.sheen > 0 && 'Sheen', style.iridescence > 0 && 'Iridescent film'].filter(Boolean);

  if (rightTab !== 'composition') return <>
    <ModelMotionControls style={style} onChange={modelStyle => onPatch(layer.id, { modelStyle })}/>
    {octahedron && <Section title="Shape animation" defaultOpen>
      {range('octaSpeed', 'Overall speed', { scale: 1, decimals: 2, suffix: ' ×' })}
      {range('octaRotation', 'Shape rotation', { scale: 1, decimals: 2, suffix: ' rad/s' })}
      {octaVolume && <>
        {range('octaEvolution', 'Interior evolution', { scale: 1, decimals: 2, suffix: ' ×' })}
        {range('octaColorSpeed', 'Color speed', { scale: 1, decimals: 2 })}
      </>}
      <p className="helper">Overall speed controls procedural rotation, interior evolution and color together. Zero freezes and negative values reverse each motion. Independent of Automatic motion and embedded clips.</p>
    </Section>}
    {morphing && <Section title="Shape animation">
      {range('morphSpeed', 'Morph speed', { scale: 1, decimals: 2, suffix: ' ×' })}
      <p className="helper">Zero freezes deformation and palette animation; negative values reverse them. Independent of Automatic motion, embedded clips and material animation.</p>
    </Section>}
    {liquidShape && <Section title="Shape animation">
      {range('liquidDuration', 'Liquid cycle', { scale: 1000, suffix: 's' })}
      {range('liquidEase', 'Liquid ease', { suffix: '%' })}
      {range('liquidSpeed', 'Liquid speed', { scale: 1, decimals: 2, suffix: ' ×' })}
      <p className="helper">Zero speed freezes the shape; negative values reverse it. Independent of Automatic motion, embedded clips and material animation.</p>
    </Section>}
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
    {morphing && <Section title="Shape" defaultOpen>
      {range('morphAmplitude', 'Deformation', { suffix: '%' })}
      {range('morphWarp', 'Warp strength', { suffix: '%' })}
      {range('morphFrequency', 'Warp frequency', { scale: 1, decimals: 2 })}
      {range('morphFalloff', 'Warp falloff', { scale: 1, decimals: 2 })}
      {range('morphDetail', 'Warp detail', { step: 1, scale: 1 })}
      {range('morphContrast', 'Noise contrast', { scale: 1, decimals: 2 })}
      {!custom && <>
        <Color label="Shape color 1" value={style.morphColor1} onChange={morphColor1 => patchStyle({ morphColor1 })}/>
        <Color label="Shape color 2" value={style.morphColor2} onChange={morphColor2 => patchStyle({ morphColor2 })}/>
        <Color label="Shape color 3" value={style.morphColor3} onChange={morphColor3 => patchStyle({ morphColor3 })}/>
        <Color label="Shape color 4" value={style.morphColor4} onChange={morphColor4 => patchStyle({ morphColor4 })}/>
      </>}
      <p className="helper">Original and Tinted use the animated shape palette. Custom materials replace its color while preserving deformation. Zero deformation makes a smooth sphere.</p>
    </Section>}
    {liquidShape && <Section title="Shape" defaultOpen>
      {range('liquidRadius', 'Outer radius', { scale: 1, decimals: 2 })}
      {range('liquidInnerRadius', 'Inner radius', { scale: 1, decimals: 2 })}
      {range('liquidThickness', 'Sheet thickness', { scale: 1, step: .001, decimals: 3 })}
      {range('liquidWarp', 'Fold strength', { suffix: '%' })}
      {range('liquidFrequency', 'Fold frequency', { scale: 1, decimals: 2 })}
      {range('liquidOpen', 'Open width', { scale: 1, decimals: 2 })}
      {range('liquidClosed', 'Closed width', { scale: 1, decimals: 2 })}
      {range('liquidDetail', 'Mesh resolution', { scale: 1, step: 1 })}
      <p className="helper">Two folded sheets with independent open and closed widths; either width may be larger. Higher mesh resolution costs more geometry work. Material changes preserve the shape.</p>
    </Section>}
    {octahedron && <Section title="Shape" defaultOpen>
      {range('octaRadius', 'Octahedron radius', { scale: 1, decimals: 2 })}
      {range('octaHeight', 'Octahedron height', { scale: 1, decimals: 2 })}
      {octaVolume && <>
        {range('octaSteps', 'Volume steps', { step: 1, scale: 1 })}
        {range('octaScale', 'Interior scale', { scale: 1, decimals: 2 })}
        {range('octaPath', 'Sample path', { scale: 1, step: .001, decimals: 3 })}
        {range('octaDensity', 'Interior density', { scale: 1, decimals: 2 })}
        {range('octaOpacity', 'Optical density', { suffix: '%' })}
        {range('octaOrb', 'Orb intensity', { scale: 1, decimals: 2 })}
        {range('octaEdge', 'Front edge', { scale: 1, step: .001, decimals: 3 })}
        {range('octaBackEdge', 'Back edge', { scale: 1, decimals: 2 })}
        <Color label="Interior tint" value={style.octaTint} onChange={octaTint => patchStyle({ octaTint })}/>
        <Color label="Front edge color" value={style.octaFrontColor} onChange={octaFrontColor => patchStyle({ octaFrontColor })}/>
        <Color label="Back edge color" value={style.octaBackColor} onChange={octaBackColor => patchStyle({ octaBackColor })}/>
      </>}
      <p className="helper">Original and Tinted reveal a self-lit interior clipped to the octahedron. Optical density controls internal accumulation, not background transmission: the body is opaque. Higher volume steps cost more rendering work. Other materials preserve the shape and replace the interior.</p>
    </Section>}
    <Section title="Material" defaultOpen={!morphing && !liquidShape && !octahedron} detail={MODEL_MATERIAL_PRESETS.find(preset => preset.id === selectedModelPreset(style))?.name ?? 'Custom'}>
      <Field label="Material preset"><select aria-label="Material preset" value={selectedModelPreset(style)} onChange={event => onPatch(layer.id, { modelStyle: applyModelPreset(style, event.target.value) })}>
        <option value="custom" disabled>Custom</option>
        {MODEL_MATERIAL_FAMILIES.map(([family, label]) => <optgroup key={family} label={label}>{MODEL_MATERIAL_PRESETS.filter(preset => preset.family === family).map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</optgroup>)}
      </select></Field>
      {select('base', 'Base surface', MODEL_BASES)}
      {style.base !== 'imported' && <Color label="Material color" value={style.color} onChange={color => patchStyle({ color })}/>}
      {/* Glass and edge glow exist only on the Physical look, so leaving it turns them off. */}
      {select('look', 'Look', MODEL_LOOKS, look => ({ look, ...(look !== 'physical' && { glass: 'none', fresnelIntensity: 0 }) }))}
      {physical && select('glass', 'Glass', MODEL_GLASS, value => ({ glass: value, ...(value !== 'none' && { fresnelIntensity: 0 }) }))}
      {!custom && !dedicatedSurface && !octaVolume && <p className="helper">Imported and Tinted keep the imported finish; choose Custom to edit it.</p>}
      {dedicatedSurface && range('roughness', 'Roughness')}
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
      {custom && !dedicatedSurface && style.look !== 'wireframe' && <>
        <Color label="Emissive color" value={style.emissive} onChange={emissive => patchStyle({ emissive })}/>
        {range('emissiveIntensity', 'Emissive intensity')}
      </>}
      {glass && <>
        {range('ior', 'Refractive index ×100', { scale: 100, suffix: ' ' })}
        {style.glass === 'see-through' ? range('glassOpacity', 'Glass body', { suffix: '%' }) : range('dispersion', 'Dispersion', { suffix: '%' })}
        {refractive && <>
          {range('refractionThickness', 'Thickness', { suffix: '%' })}
          {quality('refractionSamples', 'Refraction samples', MODEL_REFRACTION_SAMPLES)}
          {quality('refractionResolution', 'Refraction resolution', MODEL_REFRACTION_RESOLUTIONS)}
        </>}
        {liquid && <>
          <Color label="Liquid tint" value={style.liquidTint} onChange={liquidTint => patchStyle({ liquidTint })}/>
          {range('liquidReflectance', 'Reflectance', { scale: 1, decimals: 2 })}
          {range('liquidIorSpread', 'Transmission spread', { scale: 1, decimals: 2 })}
          <button type="button" className="outline-button" onClick={() => onPatch(layer.id, { modelStyle: applyLightingPreset(style, 'liquid-studio') })}>Use liquid lighting</button>
        </>}
        {holographic && <>
          <p className="helper">The reference look uses a dark Holographic studio with white, blue and pink highlights and ACES filmic tone mapping. Apply its lighting without changing your material or motion.</p>
          <button type="button" className="outline-button" onClick={() => onPatch(layer.id, { modelStyle: applyLightingPreset(style, 'holographic-studio') })}>Use reference lighting</button>
          {range('holographicIntensity', 'Holographic intensity', { suffix: '%' })}
          {range('holographicScale', 'Band density', { scale: 1, decimals: 2 })}
          {range('holographicSpeed', 'Holographic speed', { scale: 1, decimals: 2, suffix: ' cycles/s' })}
          {range('holographicSweep', 'Light sweep', { scale: 1, decimals: 2 })}
        </>}
        {quantum && <>
          {range('quantumIntensity', 'Crystal intensity', { suffix: '%' })}
          {range('quantumScale', 'Crystal complexity', { scale: 1, decimals: 2 })}
          {range('quantumDepth', 'Crystal depth', { suffix: '%' })}
          {range('quantumSpeed', 'Crystal speed', { scale: 1, decimals: 2, suffix: ' ×' })}
          {range('quantumMorphSpeed', 'Crystal morph speed', { scale: 1, decimals: 2, suffix: ' ×' })}
          {range('quantumRim', 'Crystal rim', { scale: 1, decimals: 2 })}
          <Color label="Crystal color 1" value={style.quantumColor1} onChange={quantumColor1 => patchStyle({ quantumColor1 })}/>
          <Color label="Crystal color 2" value={style.quantumColor2} onChange={quantumColor2 => patchStyle({ quantumColor2 })}/>
          <Color label="Crystal color 3" value={style.quantumColor3} onChange={quantumColor3 => patchStyle({ quantumColor3 })}/>
        </>}
        <p className="helper">{glassHelp[style.glass]}</p>
      </>}
      {style.look === 'toon' && range('toonSteps', 'Toon steps', { step: 1, scale: 1 })}
      {physical && !glass && !octaVolume && <>
        {range('fresnelIntensity', 'Edge glow')}
        {style.fresnelIntensity > 0 && <>
          <Color label="Edge glow color" value={style.fresnelColor} onChange={fresnelColor => patchStyle({ fresnelColor })}/>
          {range('fresnelPower', 'Edge glow power', { step: 1, scale: 1 })}
        </>}
      </>}
      {metadata?.unlit && !dedicatedSurface && <p className="helper">Unlit source materials stay unlit on Imported and Tinted bases.</p>}
      {((pbr && style.metalness >= .5) || (glass && !refractive && !quantum)) && style.environment === 'none' && <p className="helper">{glass ? 'Glass' : 'Metal'} needs a Lighting environment, such as Studio, to reflect.</p>}
    </Section>
    {!octaVolume && <Section title="Lighting" detail={MODEL_LIGHTING_PRESETS.find(preset => preset.id === lighting)?.name ?? 'Custom'}>
      <Field label="Lighting preset"><select aria-label="Lighting preset" value={lighting} onChange={event => onPatch(layer.id, { modelStyle: applyLightingPreset(style, event.target.value) })}>
        <option value="custom" disabled>Custom</option>
        {MODEL_LIGHTING_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
      </select></Field>
      <Field label="Reflection environment"><select aria-label="Reflection environment" value={style.environment} onChange={event => patchStyle({ environment: event.target.value })}>{MODEL_ENVIRONMENTS.map(id => <option key={id} value={id}>{environmentNames[id]}</option>)}</select></Field>
      {style.environment !== 'none' && (physical ? <>
        {range('environmentIntensity', 'Environment intensity')}
        {range('environmentRotation', 'Environment rotation', { step: 1, scale: 1, suffix: '°' })}
      </> : <p className="helper">Toon and Wireframe ignore the environment.</p>)}
      <Field label="Tone mapping"><select aria-label="Tone mapping" value={style.toneMapping} onChange={event => patchStyle({ toneMapping: event.target.value })}>{MODEL_TONE_MAPPINGS.map(id => <option key={id} value={id}>{toneNames[id]}</option>)}</select></Field>
      {style.toneMapping !== 'none' && range('exposure', 'Exposure')}
      {style.look === 'wireframe' ? <p className="helper">Wireframe is unlit.</p> : <>
        {range('ambientIntensity', 'Ambient intensity')}
        {range('keyIntensity', 'Key intensity')}
        <Color label="Key color" value={style.keyColor} onChange={keyColor => patchStyle({ keyColor })}/>
        {range('fillIntensity', 'Fill intensity')}
        <Color label="Fill color" value={style.fillColor} onChange={fillColor => patchStyle({ fillColor })}/>
        {range('rimIntensity', 'Rim intensity')}
        <Color label="Rim color" value={style.rimColor} onChange={rimColor => patchStyle({ rimColor })}/>
        {range('lightRotation', 'Light rig rotation', { step: 1, scale: 1, suffix: '°' })}
      </>}
    </Section>}
  </>;
}
