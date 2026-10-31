import React, { useState } from 'react';
import { ArrowLeft, DotsNine, Images, Plus, Shapes, SlidersHorizontal, SquaresFour, Sparkle, TextT, UploadSimple, X } from '@phosphor-icons/react';
import { PROJECT_LIMITS, carouselImages } from '../../project.js';
import { MODEL_SHAPES } from '../../model-shapes.js';
import { IconButton, Modal } from '../controls.jsx';
import { CarouselCreationDialog } from './CarouselCreationDialog.jsx';
import { MODEL_IMPORT_ACCEPT } from '../model-import.js';
import { RadialLayerMenu } from './RadialLayerMenu.jsx';

const visualFiles = '.png,.jpg,.jpeg,.webp,.gif,.avif,.svg,.mp4,.webm';
const imageFiles = '.png,.jpg,.jpeg,.webp,.avif,.svg';
const audioFiles = '.mp3,.wav,.m4a,.ogg';
export const allFiles = `${visualFiles},${audioFiles},${MODEL_IMPORT_ACCEPT}`;

function Option({ Icon, label, description, disabled, onClick }) {
  return <button type="button" className="add-layer-option" disabled={disabled} onClick={onClick}>
    <Icon size={24} weight="light" aria-hidden="true"/>
    <span><strong>{label}</strong><small>{description}</small></span>
  </button>;
}

function ShapeChoices({ onChoose }) {
  return <div className="shape-choices">{MODEL_SHAPES.map(shape => <button key={shape.id} type="button" className="shape-choice" onClick={() => onChoose(shape)}>
    <img src={shape.preview} alt="" width={240} height={240} loading="lazy" draggable={false}/>
    <span>{shape.name}</span>
  </button>)}</div>;
}

// Both entry points share the same actions; source replacement keeps its file filters.
export function AddLayerDialog({ project, initialTarget = 'layers', origin, uploading, onClose, onPick, onAddText, onAddLayer, onOpenMedia, onPlaceAsset }) {
  const [creatingCarousel, setCreatingCarousel] = useState(false);
  const [choosingShape, setChoosingShape] = useState(false);
  const cards = initialTarget.startsWith('cards:');
  const existing = project.layers.find(layer => layer.id === (cards ? initialTarget.slice(6) : initialTarget));
  const adding = initialTarget === 'layers';
  const full = project.layers.length >= PROJECT_LIMITS.maxLayers;
  const choose = (accept, multiple) => { onPick(initialTarget, accept, multiple); onClose(); };
  const create = type => { if (type === 'text') onAddText(); else onAddLayer(type); onClose(); };
  const media = () => { onOpenMedia(); onClose(); };
  const placeShape = shape => { onPlaceAsset({ src: shape.src, name: shape.name }); onClose(); };
  if (creatingCarousel) return <CarouselCreationDialog project={project} onClose={onClose} onCreate={layer => onAddLayer('carousel', layer)}/>;
  if (choosingShape) return <Modal onClose={onClose} labelledBy="add-shape-heading"><section className="modal add-layer-modal">
    <div className="modal-heading"><IconButton label="Back" onClick={() => setChoosingShape(false)}><ArrowLeft size={19}/></IconButton><IconButton label="Close sculpture dialog" onClick={onClose}><X size={19}/></IconButton></div>
    <h2 id="add-shape-heading">{adding ? 'Add sculpture' : 'Replace with sculpture'}</h2>
    <p className="helper">Built-in 3D sculptures for glass, metal and other materials. Style them like any model in Design and Motion.</p>
    <ShapeChoices onChoose={placeShape}/>
  </section></Modal>;
  let body;
  if (adding) {
    const disabled = uploading || full;
    const options = [
      { id: 'import', Icon: UploadSimple, label: 'Import', description: 'Image, video, audio or 3D model', disabled, onClick: () => choose(allFiles, true) },
      { id: 'media', Icon: SquaresFour, label: 'Media', description: 'Reuse a file already in the workspace', disabled: full, onClick: media },
      { id: 'text', Icon: TextT, label: 'Text', description: 'A headline or caption', disabled, onClick: () => create('text') },
      { id: 'carousel', Icon: Images, label: 'Carousel', description: 'Animated cards from images or video', disabled, onClick: () => setCreatingCarousel(true) },
      { id: 'dataflow', Icon: DotsNine, label: 'Data flow', description: 'Procedural fibers and pulses', disabled, onClick: () => create('dataflow') },
      { id: 'effect', Icon: SlidersHorizontal, label: 'Adjustment', description: 'Effects on the layers below', disabled, onClick: () => create('effect') },
      { id: 'sculpture', Icon: Shapes, label: 'Sculpture', description: 'Choose a built-in 3D sculpture', disabled, onClick: () => setChoosingShape(true) },
      { id: 'logo', Icon: Sparkle, label: 'Studio mark', description: 'The studio logo', disabled, onClick: () => create('logo') }
    ];
    const blockedReason = full ? `Layer limit reached (${PROJECT_LIMITS.maxLayers}). Remove a layer to add another.` : uploading ? 'Import in progress. Media is still available.' : '';
    if (origin) return <RadialLayerMenu origin={origin} options={options} blockedReason={blockedReason} onClose={onClose}/>;
    body = <>
      {blockedReason && <p className="helper" role="status">{blockedReason}</p>}
      <h3 className="add-layer-group">Import & reuse</h3>
      <div className="add-layer-options">{options.slice(0, 2).map(option => <Option key={option.id} {...option}/>)}</div>
      <h3 className="add-layer-group">Create</h3>
      <div className="add-layer-options">{options.slice(2).map(option => <Option key={option.id} {...option}/>)}</div>
    </>;
  } else {
    const blocked = !existing || existing.locked || (cards && carouselImages(project, existing).length >= PROJECT_LIMITS.maxImages);
    const accept = cards || existing?.type === 'media' ? visualFiles : existing?.type === 'music' ? audioFiles : existing?.type === 'model' ? MODEL_IMPORT_ACCEPT : existing?.type === 'background' ? `${imageFiles},.mp4,.webm` : imageFiles;
    const kinds = cards ? 'Images, SVG, GIF or video' : existing?.type === 'model' ? 'GLB, or OBJ with its MTL and textures' : existing?.type === 'music' ? 'MP3, WAV, M4A or OGG' : existing?.type === 'logo' ? 'PNG, JPG, WebP, AVIF or SVG' : 'Image or video';
    body = <div className="add-layer-options add-layer-replace">
      <Option Icon={UploadSimple} label="Upload" description={kinds} disabled={uploading || blocked} onClick={() => choose(accept, cards || existing?.type === 'model')}/>
      <Option Icon={SquaresFour} label="From Media" description="Use a file already in the workspace" disabled={blocked} onClick={media}/>
      {existing?.type === 'model' && <Option Icon={Shapes} label="Sculpture" description="A built-in 3D sculpture" disabled={blocked} onClick={() => setChoosingShape(true)}/>}
    </div>;
  }
  return <Modal onClose={onClose} labelledBy="add-layer-heading"><section className="modal add-layer-modal">
    <div className="modal-heading"><Plus size={22}/><IconButton label="Close add layer dialog" onClick={onClose}><X size={19}/></IconButton></div>
    <h2 id="add-layer-heading">{adding ? 'Add layer' : cards ? 'Add carousel cards' : 'Replace source'}</h2>
    {!adding && existing && <p className="helper">{existing.name}</p>}
    {body}
  </section></Modal>;
}
