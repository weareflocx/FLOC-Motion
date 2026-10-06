import React, { useState } from 'react';
import { DotsNine, ImageSquare, Images, Plus, Sparkle, TextT, UploadSimple, X } from '@phosphor-icons/react';
import { carouselImages } from '../../project.js';
import { IconButton, Modal } from '../controls.jsx';
import { CarouselCreationDialog } from './CarouselCreationDialog.jsx';

const visualFiles = '.png,.jpg,.jpeg,.webp,.gif,.avif,.svg,.mp4,.webm';
const imageFiles = '.png,.jpg,.jpeg,.webp,.avif,.svg';
const allFiles = `${visualFiles},.mp3,.wav,.m4a,.ogg,.glb`;
const audioFiles = '.mp3,.wav,.m4a,.ogg';
export function AddLayerDialog({ project, initialTarget = 'layers', uploading, onClose, onPick, onAddText, onAddLayer }) {
  const [creatingCarousel, setCreatingCarousel] = useState(false);
  const cards = initialTarget.startsWith('cards:');
  const existing = project.layers.find(layer => layer.id === (cards ? initialTarget.slice(6) : initialTarget));
  const adding = initialTarget === 'layers';
  const full = project.layers.length >= 20;
  const accept = adding ? allFiles : cards || existing?.type === 'media' ? visualFiles : existing?.type === 'music' ? audioFiles : existing?.type === 'model' ? '.glb' : existing?.type === 'background' ? `${imageFiles},.mp4,.webm` : imageFiles;
  function chooseFiles() { onPick(initialTarget, accept, adding || cards); onClose(); }
  function create(type) { if (type === 'text') onAddText(); else onAddLayer(type); onClose(); }
  const options = adding ? [
    { id: 'files', Icon: UploadSimple, label: 'Import media layers · image, SVG, video, audio or GLB', action: chooseFiles, disabled: full },
    { id: 'text', Icon: TextT, label: 'Add text layer', action: () => create('text'), disabled: full },
    { id: 'carousel', Icon: Images, label: 'Add carousel', action: () => setCreatingCarousel(true), disabled: full },
    { id: 'background', Icon: ImageSquare, label: 'Add background layer', action: () => create('background'), disabled: full },
    { id: 'effect', Icon: DotsNine, label: 'Add adjustment layer · effects on layers below', action: () => create('effect'), disabled: full },
    { id: 'logo', Icon: Sparkle, label: 'Add studio mark', action: () => create('logo'), disabled: full }
  ] : [{ id: 'source', Icon: cards ? Images : UploadSimple, label: cards ? 'Choose carousel cards · images, SVG or video' : `Choose source for ${existing?.name ?? 'layer'}`, action: chooseFiles, disabled: cards ? !existing || existing.locked || carouselImages(project, existing).length >= 24 : !existing || existing.locked }];
  if (creatingCarousel) return <CarouselCreationDialog project={project} onClose={onClose} onCreate={layer => onAddLayer('carousel', layer)}/>;
  return <Modal onClose={onClose} labelledBy="add-layer-heading"><section className="modal add-layer-modal">
    <div className="modal-heading"><Plus size={22}/><IconButton label="Close add layer dialog" onClick={onClose}><X size={19}/></IconButton></div>
    <h2 id="add-layer-heading">{adding ? 'Add layer' : cards ? 'Add carousel cards' : 'Replace source'}</h2>
    {!adding && existing && <p className="helper">{existing.name}</p>}
    <div className="add-layer-options" aria-label={adding ? 'Layer types' : 'Choose files'}>{options.map(({ id, Icon, label, action, disabled }) => <button key={id} className="add-layer-option" title={label} aria-label={label} disabled={uploading || disabled} onClick={action}><Icon size={48} weight="light" aria-hidden="true"/></button>)}</div>
  </section></Modal>;
}
