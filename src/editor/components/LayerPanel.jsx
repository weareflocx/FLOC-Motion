import React from 'react';
import { DotsNine, ArrowDown, ArrowUp, Circle, GearSix, ImageSquare, Images, MusicNotes, Plus, Sparkle, Stack, TextT } from '@phosphor-icons/react';
import { LayerList } from './LayerList.jsx';
import { MediaLibrary } from './MediaLibrary.jsx';
import { IconButton } from '../controls.jsx';

const layerIcons = { background: ImageSquare, carousel: Images, text: TextT, logo: Sparkle, music: MusicNotes, media: ImageSquare, model: Circle, effect: DotsNine };

// Composition output and layout settings live in the inspector while nothing is selected.
export function LayerPanel({ project, selected, selection, leftTab, uploading, onSelectLayer, onSetLeftTab, onPatch, onOpenAdd, onRemoveLayer, onMoveLayer, onDropLayer, onDuplicateLayer, onPlaceAsset }) {
  const layer = project.layers.find(item => item.id === selected);
  return <aside className="left-panel panel"><div className="tabs"><button className={leftTab === 'layers' ? 'selected' : ''} onClick={() => onSetLeftTab('layers')}><Stack size={15}/>Layers</button><button className={leftTab === 'media' ? 'selected' : ''} onClick={() => onSetLeftTab('media')}><Images size={15}/>Media</button></div>
    {leftTab === 'layers' ? <><div className="section-heading"><h2>Composition</h2><div className="layer-heading-actions"><span>{project.layers.length} layers</span><IconButton label="Move layer forward" onClick={() => onMoveLayer(1)} disabled={!layer || layer.locked || layer.type === 'background' || project.layers.at(-1)?.id === selected}><ArrowUp size={15}/></IconButton><IconButton label="Move layer backward" onClick={() => onMoveLayer(-1)} disabled={!layer || layer.locked || layer.type === 'background' || project.layers[project.layers.findIndex(item => item.id === selected) - 1]?.type === 'background' || project.layers[0]?.id === selected}><ArrowDown size={15}/></IconButton><IconButton label="Composition settings" aria-pressed={!selection.length} onClick={() => onSelectLayer(null)}><GearSix size={15}/></IconButton></div></div><LayerList project={project} selected={selected} selection={selection} icons={layerIcons} onSelect={onSelectLayer} onPatch={onPatch} onMove={onMoveLayer} onDrop={onDropLayer} onDuplicate={onDuplicateLayer} onRemove={onRemoveLayer}/><button className="outline-button add-layer" disabled={uploading} onClick={onOpenAdd}><Plus size={16}/>Add layer</button></>
      : <MediaLibrary project={project} layer={selection.length === 1 ? layer : null} onPlace={onPlaceAsset}/>}
  </aside>;
}
