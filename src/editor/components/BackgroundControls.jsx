import React, { useEffect, useRef } from 'react';
import { UploadSimple } from '@phosphor-icons/react';
import { DEFAULT_PROCEDURAL_BACKGROUND, PROCEDURAL_BACKGROUNDS, drawProceduralBackground } from '../../backgrounds.js';
import { Color, Field, NumberField, Range } from '../controls.jsx';
import './visual-language.css';

const SOURCES = [['color', 'Solid'], ['image', 'Image'], ['video', 'Video'], ['procedural', 'Procedural']];

function BackgroundPreview({ layer, pattern }) {
  const canvas = useRef(null);
  useEffect(() => {
    drawProceduralBackground(canvas.current, { ...DEFAULT_PROCEDURAL_BACKGROUND, ...layer, pattern: pattern.id }, 1);
  }, [layer.color, layer.patternColor, layer.patternScale, layer.patternIntensity, layer.patternSpeed, layer.patternSeed, pattern.id]);
  return <canvas ref={canvas} width={144} height={81} aria-hidden="true"/>;
}

export function BackgroundControls({ layer, uploading, onPatch, onPick }) {
  const settings = { ...DEFAULT_PROCEDURAL_BACKGROUND, ...layer };
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
      <div className="procedural-background-list" role="group" aria-label="Background pattern">
        {PROCEDURAL_BACKGROUNDS.map(pattern => <button type="button" key={pattern.id} className={`procedural-background-option${settings.pattern === pattern.id ? ' selected' : ''}`} aria-label={`${pattern.name} background`} title={pattern.name} aria-pressed={settings.pattern === pattern.id} onClick={() => onPatch(layer.id, { pattern: pattern.id })}>
          <BackgroundPreview layer={settings} pattern={pattern}/><span>{pattern.name}</span>
        </button>)}
      </div>
      <Range label="Pattern scale" value={settings.patternScale} min={0.25} max={4} step={0.05} onChange={patternScale => onPatch(layer.id, { patternScale })}/>
      <Range label="Pattern intensity" value={settings.patternIntensity} min={0} max={1} step={0.05} onChange={patternIntensity => onPatch(layer.id, { patternIntensity })}/>
      <Range label="Pattern speed" value={settings.patternSpeed} min={-2} max={2} step={0.05} onChange={patternSpeed => onPatch(layer.id, { patternSpeed })}/>
      <NumberField label="Pattern seed" value={settings.patternSeed} min={0} max={65535} onChange={patternSeed => { if (Number.isInteger(patternSeed)) onPatch(layer.id, { patternSeed }); }}/>
    </>}
    {['image', 'video'].includes(layer.mode) && <>
      <button type="button" className="outline-button" disabled={uploading} onClick={() => onPick(layer.id, layer.mode === 'video' ? 'video/mp4,video/webm' : 'image/png,image/jpeg,image/webp,image/avif')}><UploadSimple size={15}/>{layer.src ? 'Replace media' : `Upload ${layer.mode}`}</button>
      {layer.src && <p className="helper">Media loaded</p>}
      <Field label="Fit"><select aria-label="Background fit" value={layer.fit} onChange={event => onPatch(layer.id, { fit: event.target.value })}><option value="cover">Fill / crop</option><option value="contain">Fit inside</option></select></Field>
      {layer.mode === 'video' && <>
        <NumberField label="Video source offset" value={layer.offset} min={0} max={3600} step={0.1} onChange={offset => onPatch(layer.id, { offset })}/>
        <label className="check-field"><input type="checkbox" checked={layer.loop} onChange={event => onPatch(layer.id, { loop: event.target.checked })}/>Loop video</label>
      </>}
    </>}
  </div>;
}
