import React, { useRef, useState } from 'react';
import { Images } from '@phosphor-icons/react';
import { MOTION_VARIANTS } from '../../carousel-motion.js';
import { FontControls } from './FontControls.jsx';
import { PROJECT_LIMITS, TEMPLATES, carouselImages } from '../../project.js';
import { PresetBrowser } from './PresetBrowser.jsx';
import { MotionControls } from './MotionControls.jsx';
import { LayerFadeControls } from './LayerFadeControls.jsx';
import { EffectControls } from './EffectControls.jsx';
import { TemplateFieldControls } from './TemplateFieldControls.jsx';
import { BackgroundControls } from './BackgroundControls.jsx';
import { TextRevealControls, TypographyControls } from './TypographyControls.jsx';
import { OrientationControl } from '../OrientationControl.jsx';
import { Color, Field, NumberField, Range, Section, SectionScope } from '../controls.jsx';
import { SelectionSummary } from './SelectionSummary.jsx';
import { ModelControls } from './ModelControls.jsx';
import { ProjectControls } from './ProjectControls.jsx';
import { LayerHeader } from './LayerHeader.jsx';
import { CardList } from './CardList.jsx';
import { SpatialControls } from './SpatialControls.jsx';
import { ReplaceCardDialog } from './ReplaceCardDialog.jsx';

const CARD_RATIOS = [[9 / 16, '9:16'], [0.8, '4:5'], [1 / 1.14, '7:8'], [1, '1:1'], [4 / 3, '4:3'], [16 / 9, '16:9']];
const FIT_OPTIONS = [['height', 'Each image · same height'], ['width', 'Each image · same width']];
// Layers whose pose can be keyframed in the timeline.
const KEYFRAMED = ['text', 'logo', 'media', 'model', 'carousel', 'effect'];
const playsSource = layer => layer.type === 'music' || (layer.type === 'media' && /\.(mp4|webm|gif)$/i.test(layer.src));

// Fixed ratios crop every card to one shape; per-image fits keep each image's
// proportions. Window Push only has a window ratio.
function CardRatioField({ layer, onPatch }) {
  const windowPush = layer.template === 'window-push';
  const label = windowPush ? 'Window ratio' : 'Card ratio';
  const perImage = !windowPush && FIT_OPTIONS.some(([fit]) => fit === layer.cardFit);
  const choose = value => onPatch(layer.id, value.startsWith('fit:') ? { cardFit: value.slice(4) } : { ...(!windowPush && { cardFit: 'fixed' }), cardAspect: Number(value) });
  return <Field label={label}><select className="card-ratio-select" aria-label={label} value={perImage ? `fit:${layer.cardFit}` : layer.cardAspect} onChange={event => choose(event.target.value)}>
    {!windowPush && FIT_OPTIONS.map(([fit, name]) => <option key={fit} value={`fit:${fit}`}>{name}</option>)}
    {CARD_RATIOS.map(([ratio, name]) => <option key={ratio} value={ratio}>{name}</option>)}
    {!CARD_RATIOS.some(([ratio]) => ratio === layer.cardAspect) && <option value={layer.cardAspect}>Custom</option>}
  </select></Field>;
}

function CarouselDesign({ layer, images, uploading, cards, onPatch, onPick, onReplaceCard }) {
  const segmented = (label, key, options) => <Field label={label}><div className="segmented" role="group" aria-label={label}>{options.map(([value, name]) => <button key={value} aria-pressed={layer[key] === value} className={layer[key] === value ? 'selected' : ''} onClick={() => onPatch(layer.id, { [key]: value })}>{name}</button>)}</div></Field>;
  const radial = ['circular', 'sphere', 'spinner', 'wheel'].includes(layer.template);
  return <>
    <Section title="Cards" defaultOpen detail={`${layer.cardCount || images.length} cards`}>
      <CardList layer={layer} images={images} uploading={uploading} onMove={(from, to) => cards.onMove(layer.id, from, to)} onRemove={index => cards.onRemove(layer.id, index)} onAddAsset={asset => cards.onAddAsset(asset, `cards:${layer.id}`)} onReplace={onReplaceCard}/>
      <button className="outline-button" disabled={uploading || images.length >= PROJECT_LIMITS.maxImages} onClick={() => onPick(`cards:${layer.id}`)}><Images size={18}/>Upload cards</button>
      <Field label="Motion variant"><select aria-label="Motion variant" value={layer.motionVariant} onChange={event => onPatch(layer.id, { motionVariant: event.target.value })}><option value="default">Default</option>{MOTION_VARIANTS[layer.template].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
      <label className="check-field"><input type="checkbox" checked={layer.cardCount === 0} onChange={event => onPatch(layer.id, { cardCount: event.target.checked ? 0 : Math.max(1, images.length) })}/>Match media count</label>
      {layer.cardCount > 0 && <NumberField label="Card count" value={layer.cardCount} min={1} max={PROJECT_LIMITS.maxCardCount} onChange={value => onPatch(layer.id, { cardCount: value })}/>}
      <CardRatioField layer={layer} onPatch={onPatch}/>
      <Range label={layer.template === 'window-push' ? 'Window size' : 'Card size'} value={layer.size} min={0.5} max={2.5} step={0.05} onChange={value => onPatch(layer.id, { size: value })}/>
      {['circular', 'horizontal', 'flip', 'showcase', 'wheel'].includes(layer.template) && <Range label="Gap" value={layer.gap} min={0} max={1} step={0.02} onChange={value => onPatch(layer.id, { gap: value })}/>}
      {layer.template === 'window-push' && <>
        <Range label="Zoom" value={layer.windowZoom ?? 0.5} min={0} max={1} step={0.01} onChange={windowZoom => onPatch(layer.id, { windowZoom })}/>
        <Range label="Spacing" value={layer.windowSpacing ?? 0} min={0} max={160} suffix="px" onChange={windowSpacing => onPatch(layer.id, { windowSpacing })}/>
      </>}
      {layer.template === 'stack-shuffle' && <Range label="Stack spacing" value={layer.shuffleGap ?? 36} min={0} max={160} suffix="px" onChange={shuffleGap => onPatch(layer.id, { shuffleGap })}/>}
      {layer.template === 'circular' && ['default', 'wrapped'].includes(layer.motionVariant) && <Range label="Curvature" value={layer.curve} min={0} max={1} step={0.05} onChange={value => onPatch(layer.id, { curve: value })}/>}
      <Range label="Corner radius" value={layer.template === 'stack-shuffle' ? layer.shuffleCorner ?? 15 : layer.cornerRadius} min={0} max={100} suffix={layer.template === 'stack-shuffle' ? 'px' : '%'} onChange={value => onPatch(layer.id, layer.template === 'stack-shuffle' ? { shuffleCorner: value } : { cornerRadius: value })}/>
      {segmented('Card shape', 'cardShape', [['rounded', 'Rounded'], ['squircle', 'Squircle']])}
      {segmented('Front face', 'frontface', [['show', 'Show'], ['hide', 'Hide']])}
      {segmented('Back face', 'backface', [['show', 'Show'], ['hide', 'Hide']])}
    </Section>
    {radial && <Section title="Distribution" detail={layer.radius === 0 ? 'Auto radius' : `Radius ${Math.round(layer.radius * 100)}%`}>
      <label className="check-field"><input type="checkbox" checked={layer.radius === 0} onChange={event => onPatch(layer.id, { radius: event.target.checked ? 0 : 1 })}/>Auto radius</label>
      {layer.radius > 0 && <Range label="Radius" value={layer.radius} min={0.1} max={6} step={0.1} onChange={value => onPatch(layer.id, { radius: value })}/>}
      {layer.template === 'circular' && <Range label="Rear fade" value={layer.fade} min={0} max={1} step={0.05} onChange={value => onPatch(layer.id, { fade: value })}/>}
      <Range label="Edge stretch" value={layer.stretch ?? 0} min={0} max={1} step={0.05} onChange={stretch => onPatch(layer.id, { stretch })}/>
    </Section>}
    <Section title="Transform" detail={`X ${Math.round(layer.x)} · Y ${Math.round(layer.y)} · Z ${Math.round(layer.z ?? 0)}`}>
      <SpatialControls layer={layer} onPatch={onPatch}/>
      <Range label="Position X" value={layer.x} min={10} max={90} onChange={value => onPatch(layer.id, { x: value })}/>
      <Range label="Position Y" value={layer.y} min={10} max={90} onChange={value => onPatch(layer.id, { y: value })}/>
      {layer.space === 'flat' && <Range label="Perspective" value={layer.perspective ?? 38} min={15} max={75} suffix="°" onChange={perspective => onPatch(layer.id, { perspective })}/>}
      <OrientationControl key={layer.id} layer={layer} onCommit={fields => onPatch(layer.id, fields)}/>
    </Section>
  </>;
}

// Position, size and orientation share one Transform section on graphic layers.
function FlatTransform({ layer, onPatch, defaultOpen = false }) {
  const bounds = layer.type === 'text' ? [0, 95] : layer.type === 'background' ? [-100, 100] : [Math.min(-100, layer.x), Math.max(100, layer.x)];
  const boundsY = layer.type === 'text' ? [0, 95] : layer.type === 'background' ? [-100, 100] : [Math.min(-100, layer.y), Math.max(100, layer.y)];
  const sized = ['logo', 'media'].includes(layer.type);
  return <Section title="Transform" defaultOpen={defaultOpen} detail={`X ${Math.round(layer.x ?? 0)} · Y ${Math.round(layer.y ?? 0)}${sized ? ` · ${Math.round(layer.size)}%` : ''} · ${Math.round(layer.roll ?? 0)}°`}>
    <SpatialControls layer={layer} onPatch={onPatch}/>
    <Range label="Position X" value={layer.x ?? 0} min={bounds[0]} max={bounds[1]} onChange={x => onPatch(layer.id, { x })}/>
    <Range label="Position Y" value={layer.y ?? 0} min={boundsY[0]} max={boundsY[1]} onChange={y => onPatch(layer.id, { y })}/>
    {sized && <Range label="Size" value={layer.size} min={2} max={500} suffix="%" onChange={size => onPatch(layer.id, { size })}/>}
    <OrientationControl key={layer.id} layer={layer} onCommit={fields => onPatch(layer.id, fields)}/>
  </Section>;
}

function Design({ project, layer, images, uploading, cards, onPatch, onPick, onRemoveText, onReplaceCard }) {
  return <>
    {layer.type === 'carousel' && <CarouselDesign layer={layer} images={images} uploading={uploading} cards={cards} onPatch={onPatch} onPick={onPick} onReplaceCard={onReplaceCard}/>}
    {layer.type === 'background' && <><BackgroundControls layer={layer} uploading={uploading} onPatch={onPatch} onPick={onPick}/><FlatTransform layer={layer} onPatch={onPatch}/></>}
    {layer.type === 'text' && <>
      <Section title="Content" defaultOpen>
        <Field label="Text"><textarea aria-label="Layer text" maxLength={500} rows={4} value={layer.text} onChange={event => onPatch(layer.id, { text: event.target.value })}/></Field>
        <Range label="Font size" value={layer.size} min={12} max={180} onChange={value => onPatch(layer.id, { size: value })}/>
        <FontControls layer={layer} onPatch={onPatch}/>
        <Color label="Text color" value={layer.color} onChange={value => onPatch(layer.id, { color: value })}/>
        <Range label="Text width" value={layer.width} min={5} max={100} suffix="%" onChange={value => onPatch(layer.id, { width: value })}/>
      </Section>
      <TypographyControls layer={layer} onPatch={onPatch}/>
      <FlatTransform layer={layer} onPatch={onPatch}/>
    </>}
    {['logo', 'media'].includes(layer.type) && <FlatTransform layer={layer} onPatch={onPatch} defaultOpen/>}
    {layer.type === 'model' && <ModelControls layer={layer} onPatch={onPatch} rightTab="composition"/>}
    {layer.type === 'music' && <Section title="Soundtrack" defaultOpen detail={layer.src ? `${Math.round(layer.volume * 100)}%` : 'No source'}>
      <Range label="Volume" value={layer.volume} min={0} max={1} step={0.05} onChange={value => onPatch(layer.id, { volume: value })}/>
      {layer.src ? <button className="text-button" onClick={() => onPatch(layer.id, { src: '' })}>Remove music</button> : <p className="helper">Choose an MP3, WAV, M4A or OGG file.</p>}
    </Section>}
    {layer.type !== 'music' && <EffectControls layer={layer} onPatch={onPatch}>
      <Range label="Opacity" ariaLabel="Layer opacity" value={(layer.opacity ?? 1) * 100} min={0} max={100} suffix="%" onChange={opacity => onPatch(layer.id, { opacity: opacity / 100 })}/>
    </EffectControls>}
    <TemplateFieldControls key={`content-${layer.id}`} project={project} layer={layer} onPatch={onPatch}/>
    {layer.type === 'text' && <button className="text-button danger" onClick={() => onRemoveText(layer.id)}>Remove text layer</button>}
  </>;
}

function Motion({ layer, images, onPatch }) {
  const plays = playsSource(layer);
  const own = ['carousel', 'text', 'model'].includes(layer.type) || plays;
  return <>
    {layer.type === 'carousel' && <MotionControls layer={layer} count={layer.cardCount || images.length} onPatch={onPatch}/>}
    {layer.type === 'text' && <TextRevealControls layer={layer} onPatch={onPatch}/>}
    {layer.type === 'model' && <ModelControls layer={layer} onPatch={onPatch} rightTab="animation"/>}
    {plays && <Section title="Playback" defaultOpen detail={`From ${Math.round(layer.offset * 1000)} ms${layer.loop ? ' · Loop' : ''}`}>
      <NumberField scale={1000} suffix="ms" label="Source offset" value={layer.offset} min={0} max={3600} onChange={offset => onPatch(layer.id, { offset })}/>
      {layer.type === 'music' && <Range label="Fade in / out" value={layer.fade} min={0} max={5} step={0.1} suffix="s" onChange={value => onPatch(layer.id, { fade: value })}/>}
      <label className="check-field"><input type="checkbox" checked={layer.loop} onChange={event => onPatch(layer.id, { loop: event.target.checked })}/>Loop</label>
    </Section>}
    <LayerFadeControls layer={layer} defaultOpen={!own} onPatch={onPatch}/>
    {KEYFRAMED.includes(layer.type) && <p className="helper">Keyframe position, size, rotation and opacity in the timeline.</p>}
    {layer.type === 'background' && <p className="helper">Video playback and pattern speed are under Design.</p>}
  </>;
}

// `summary` holds SelectionSummary props while two or more layers are selected; with no
// selection the inspector edits the composition's output and layout (`settings`). A layer
// shows a common header, then Design (how it looks) and Motion (how it changes over time).
// `cards` edits a carousel's card list: onMove(layerId, from, to), onRemove(layerId, index)
// and onAddAsset(asset, target) for library items dropped on it.
export function InspectorPanel({ project, projectRef, layer, summary, settings, rightTab, uploading, cards, onSetRightTab, onPatch, onPick, onRemoveText }) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [replacingCard, setReplacingCard] = useState(null);
  const libraryButton = useRef(null);
  const images = carouselImages(project, layer?.type === 'carousel' ? layer : null);
  const currentTemplate = TEMPLATES.find(template => template.id === layer?.template);
  function closeLibrary() { setLibraryOpen(false); libraryButton.current?.focus(); }
  if (summary) return <SectionScope.Provider value="selection"><SelectionSummary {...summary}/></SectionScope.Provider>;
  if (!layer) return <aside className="right-panel panel"><SectionScope.Provider value="project"><ProjectControls {...settings}/></SectionScope.Provider></aside>;
  const tab = (id, label) => <button className={rightTab === id ? 'selected' : ''} aria-pressed={rightTab === id} onClick={() => onSetRightTab(id)}>{label}</button>;
  return <aside className="right-panel panel"><SectionScope.Provider value={`${layer.type}:${rightTab === 'composition' ? 'design' : 'motion'}`}>
    <div className="tabs">{tab('composition', 'Design')}{tab('animation', 'Motion')}</div>
    <LayerHeader layer={layer} uploading={uploading} onPatch={onPatch} onPick={onPick}/>
    {layer.locked && <p className="helper layer-lock-notice">This layer is locked. Unlock it to edit.</p>}
    <fieldset className="layer-properties" disabled={layer.locked} inert={layer.locked ? true : undefined}>
      {layer.type === 'carousel' && <div className="property-section"><button ref={libraryButton} className="library-launcher" onClick={() => setLibraryOpen(true)} aria-haspopup="dialog" aria-label="Change carousel"><span className="library-launcher-label"><Images size={20} aria-hidden="true"/><span><small>Template</small><strong>{currentTemplate?.name}</strong></span></span><span className="library-launcher-action">Change</span></button></div>}
      {rightTab === 'composition'
        ? <Design project={project} layer={layer} images={images} uploading={uploading} cards={cards} onPatch={onPatch} onPick={onPick} onRemoveText={onRemoveText} onReplaceCard={setReplacingCard}/>
        : <Motion layer={layer} images={images} onPatch={onPatch}/>}
    </fieldset>
    {libraryOpen && !layer.locked && layer.type === 'carousel' && <PresetBrowser key={layer.id} layer={layer} onApply={patch => onPatch(layer.id, patch)} onClose={closeLibrary}/>}
    {replacingCard !== null && layer.type === 'carousel' && <ReplaceCardDialog key={replacingCard} project={project} projectRef={projectRef} layerId={layer.id} cardId={replacingCard} onPatch={onPatch} onClose={() => setReplacingCard(null)}/>}
  </SectionScope.Provider></aside>;
}
