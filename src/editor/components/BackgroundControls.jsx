import React, { useEffect, useRef } from 'react';
import { UploadSimple } from '@phosphor-icons/react';
import { PROCEDURAL_BACKGROUNDS, drawBackgroundPreview, proceduralDefaults } from '../../backgrounds.js';
import { PATTERN_SCALE } from '../../project-limits.js';
import { textureLayout, TEXTURE_LAYOUT_LIMITS } from '../../texture-layout.js';
import { Color, Field, NumberField, Range } from '../controls.jsx';
import './visual-language.css';

const SOURCES = [['color', 'Solid'], ['image', 'Image'], ['video', 'Video'], ['procedural', 'Procedural']];

function contrastingInk(settings) {
  if (settings.patternColor.toLowerCase() !== settings.color.toLowerCase()) return settings.patternColor;
  const luma = [0.2126, 0.7152, 0.0722].reduce((sum, weight, i) => sum + weight * parseInt(settings.color.slice(1 + i * 2, 3 + i * 2), 16), 0);
  return luma > 140 ? '#171919' : '#ffffff';
}

function BackgroundPreview({ layer, pattern, aspect }) {
  const canvas = useRef(null);
  // The inspector shows values at the playhead; tiles preview exactly those.
  useEffect(() => {
    const settings = { ...proceduralDefaults(layer), ...layer, choreography: undefined, pattern: pattern.id };
    if (pattern.source) settings.patternColor = contrastingInk(settings);
    if (pattern.source && !PROCEDURAL_BACKGROUNDS.find(item => item.id === layer.pattern)?.source) settings.textureLayout = 'adaptive';
    drawBackgroundPreview(canvas.current, settings, aspect);
  }, [layer.color, layer.patternColor, layer.patternScale, layer.patternIntensity, layer.patternSpeed, layer.patternSeed, layer.patternVignette, layer.patternGrain,
    layer.patternLoop, layer.patternDirection, layer.patternFocusX, layer.patternFocusY, layer.patternAccent, layer.patternAccentAmount, layer.start, layer.end, pattern.id,
    layer.textureLayout, layer.textureDistribution, layer.textureDensity, layer.textureColumns, layer.textureRows, layer.textureElementSize, layer.textureMargin, aspect]);
  return <canvas ref={canvas} width={144} height={81} aria-hidden="true"/>;
}

export function BackgroundControls({ layer, uploading, onPatch, onPick, aspect = 1 }) {
  const settings = { ...proceduralDefaults(layer), ...layer };
  const { controls = [], accent, source } = PROCEDURAL_BACKGROUNDS.find(pattern => pattern.id === settings.pattern) ?? {};
  const layout = source ? textureLayout(settings.pattern, settings, aspect) : null;
  function selectPattern(pattern) {
    const patch = { pattern: pattern.id };
    if (pattern.source) {
      const ink = contrastingInk(settings);
      if (ink !== settings.patternColor) patch.patternColor = ink;
      if (!source) patch.textureLayout = 'adaptive';
    }
    onPatch(layer.id, patch);
  }
  function selectSource(mode) {
    const mediaType = mode === 'video' ? /\.(mp4|webm)$/i : mode === 'image' ? /\.(png|jpe?g|webp|gif|avif|svg)$/i : null;
    onPatch(layer.id, { mode, ...(mediaType && layer.src && !mediaType.test(layer.src) ? { src: '' } : {}) });
  }
  return <div className="property-section background-controls">
    <div className="segmented background-source-options" role="group" aria-label="Background source">
      {SOURCES.map(([mode, label]) => <button type="button" key={mode} aria-pressed={layer.mode === mode} className={layer.mode === mode ? 'selected' : ''} onClick={() => selectSource(mode)}>{label}</button>)}
    </div>
    <Color label="Base color" value={layer.color} onChange={color => onPatch(layer.id, { color })}/>
    {layer.mode === 'procedural' && <>
      <Color label="Pattern color" value={settings.patternColor} onChange={patternColor => onPatch(layer.id, { patternColor })}/>
      <Color label="Accent color" value={settings.patternAccent} onChange={patternAccent => onPatch(layer.id, { patternAccent })}/>
      <Range label={accent === 'layer' ? 'Accent layer' : 'Accent'} value={settings.patternAccentAmount} min={0} max={1} step={0.05} onChange={patternAccentAmount => onPatch(layer.id, { patternAccentAmount })}/>
      {[['Procedural patterns', false], ['Textures.dev · MIT', true]].map(([label, textures]) => <div key={label}>
        <p className="helper">{label}</p>
        <div className="procedural-background-list" role="group" aria-label={label}>
          {PROCEDURAL_BACKGROUNDS.filter(pattern => Boolean(pattern.source) === textures).map(pattern => <button type="button" key={pattern.id} className={`procedural-background-option${settings.pattern === pattern.id ? ' selected' : ''}`} aria-label={`${pattern.name} background`} title={pattern.name} aria-pressed={settings.pattern === pattern.id} onClick={() => selectPattern(pattern)}>
            <BackgroundPreview layer={settings} pattern={pattern} aspect={aspect}/><span>{pattern.name}</span>
          </button>)}
        </div>
      </div>)}
      {source && <p className="helper">Automatic, seeded motion replaces the pointer so seeking and export match. <a href="/licenses/textures-dev.txt" target="_blank" rel="noreferrer">MIT credits</a></p>}
      {source && <>
        <Field label="Layout"><select aria-label="Texture layout" value={settings.textureLayout} onChange={event => onPatch(layer.id, { textureLayout: event.target.value })}>
          <option value="adaptive">Adaptive · fill canvas</option><option value="fit">Fit all</option><option value="original">Original artwork</option>
        </select></Field>
        {layout ? <>
          <Field label="Distribution"><select aria-label="Texture distribution" value={settings.textureDistribution} onChange={event => onPatch(layer.id, {
            textureDistribution: event.target.value, ...(event.target.value === 'manual' ? { textureColumns: layout.columns, textureRows: layout.rows } : {})
          })}><option value="auto">Auto · density</option><option value="manual">Manual · rows and columns</option></select></Field>
          {settings.textureDistribution === 'manual' ? <>
            <NumberField label="Columns" value={settings.textureColumns} min={TEXTURE_LAYOUT_LIMITS.count[0]} max={TEXTURE_LAYOUT_LIMITS.count[1]} onChange={textureColumns => onPatch(layer.id, { textureColumns })}/>
            <NumberField label="Rows" value={settings.textureRows} min={TEXTURE_LAYOUT_LIMITS.count[0]} max={TEXTURE_LAYOUT_LIMITS.count[1]} onChange={textureRows => onPatch(layer.id, { textureRows })}/>
          </> : <Range label="Density" value={settings.textureDensity} min={TEXTURE_LAYOUT_LIMITS.density[0]} max={TEXTURE_LAYOUT_LIMITS.density[1]} step={.05} onChange={textureDensity => onPatch(layer.id, { textureDensity })}/>}
          <p className="helper" aria-live="polite">{layout.columns} columns × {layout.rows} rows · {layout.columns * layout.rows} elements</p>
          <Range label="Element size" value={settings.textureElementSize} min={TEXTURE_LAYOUT_LIMITS.elementSize[0]} max={TEXTURE_LAYOUT_LIMITS.elementSize[1]} step={.05} onChange={textureElementSize => onPatch(layer.id, { textureElementSize })}/>
          {settings.textureLayout === 'fit'
            ? <><Range label="Margin" value={settings.textureMargin} min={TEXTURE_LAYOUT_LIMITS.margin[0]} max={TEXTURE_LAYOUT_LIMITS.margin[1]} step={.01} onChange={textureMargin => onPatch(layer.id, { textureMargin })}/>
              <p className="helper">Fits the complete pattern with fixed room for motion. No animated reframing.</p></>
            : <p className="helper">Follows the composition aspect ratio, not the editor size. Edge elements may be cropped.</p>}
        </> : <p className="helper">Preserves the original artwork and crop. Choose Adaptive or Fit all to edit the distribution.</p>}
      </>}
      {(!source || settings.textureLayout !== 'fit') && <Range label={source ? 'Texture zoom' : 'Pattern scale'} value={settings.patternScale} min={PATTERN_SCALE.min} max={PATTERN_SCALE.max} step={0.05} onChange={patternScale => onPatch(layer.id, { patternScale })}/>}
      <Range label="Pattern intensity" value={settings.patternIntensity} min={0} max={1} step={0.05} onChange={patternIntensity => onPatch(layer.id, { patternIntensity })}/>
      <Range label="Pattern speed" value={settings.patternSpeed} min={-2} max={2} step={0.05} onChange={patternSpeed => onPatch(layer.id, { patternSpeed })}/>
      <label className="check-field"><input type="checkbox" checked={settings.patternLoop} onChange={event => onPatch(layer.id, { patternLoop: event.target.checked })}/>Seamless loop</label>
      {settings.patternLoop && <p className="helper">Motion repeats exactly every {Number((layer.end - layer.start).toFixed(2))} s, the layer's duration. Speed rounds to whole cycles.</p>}
      {controls.includes('direction') && <Range label="Direction" value={settings.patternDirection} min={0} max={360} step={1} suffix="°" onChange={patternDirection => onPatch(layer.id, { patternDirection })}/>}
      {controls.includes('focus') && <>
        <Range label="Focus X" value={settings.patternFocusX} min={0} max={100} step={1} suffix="%" onChange={patternFocusX => onPatch(layer.id, { patternFocusX })}/>
        <Range label="Focus Y" value={settings.patternFocusY} min={0} max={100} step={1} suffix="%" onChange={patternFocusY => onPatch(layer.id, { patternFocusY })}/>
      </>}
      <NumberField label="Pattern seed" value={settings.patternSeed} min={0} max={65535} onChange={patternSeed => { if (Number.isInteger(patternSeed)) onPatch(layer.id, { patternSeed }); }}/>
      <Range label="Vignette" value={settings.patternVignette} min={0} max={1} step={0.05} onChange={patternVignette => onPatch(layer.id, { patternVignette })}/>
      <Range label="Grain overlay" value={settings.patternGrain} min={0} max={1} step={0.05} onChange={patternGrain => onPatch(layer.id, { patternGrain })}/>
    </>}
    {['image', 'video'].includes(layer.mode) && <>
      <button type="button" className="outline-button" disabled={uploading} onClick={() => onPick(layer.id, layer.mode === 'video' ? 'video/mp4,video/webm' : 'image/png,image/jpeg,image/webp,image/avif')}><UploadSimple size={15}/>{layer.src ? 'Replace media' : `Upload ${layer.mode}`}</button>
      {layer.src && <p className="helper">Media loaded</p>}
      <Field label="Fit"><select aria-label="Background fit" value={layer.fit} onChange={event => onPatch(layer.id, { fit: event.target.value })}><option value="cover">Fill / crop</option><option value="contain">Fit inside</option></select></Field>
      {layer.mode === 'video' && <>
        <NumberField scale={1000} suffix="ms" label="Source offset" value={layer.offset} min={0} max={3600} step={0.1} onChange={offset => onPatch(layer.id, { offset })}/>
        <label className="check-field"><input type="checkbox" checked={layer.loop} onChange={event => onPatch(layer.id, { loop: event.target.checked })}/>Loop video</label>
      </>}
    </>}
  </div>;
}
