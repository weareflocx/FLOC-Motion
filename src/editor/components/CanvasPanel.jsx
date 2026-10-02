import React from 'react';
import { ArrowCounterClockwise, Cube } from '@phosphor-icons/react';
import { FORMATS, SHADERS, TEMPLATES } from '../../project.js';
import { IconButton } from '../controls.jsx';
import { Stage } from '../Stage.jsx';

export function CanvasPanel({ project, carousel, history, ready, positionPreview, time, playing, onError, onReady, onChangeName, onUndo, selected, onSelect, onPatch, onPreview }) {
  return <section className="center-panel"><div className="canvas-toolbar"><div><input aria-label="Project name" className="project-name" maxLength={100} value={project.name} onChange={event => onChangeName(event.target.value)}/><span className="helper">COMPOSITION / {TEMPLATES.find(template => template.id === carousel.template).name.toUpperCase()}</span></div><div className="canvas-meta"><span>{FORMATS[project.format].join(' × ')}</span><IconButton label="Undo last edit" disabled={!history.length} onClick={onUndo}><ArrowCounterClockwise size={17}/></IconButton></div></div><div className="preview-wrap"><Stage selected={selected} onSelect={onSelect} onPatch={onPatch} onPreview={onPreview} project={project} positionPreview={positionPreview} time={time} playing={playing} onError={onError} onReady={onReady}/>{!ready && <div className="preview-loading">Preparing composition…</div>}</div><div className="preview-caption" title="Drag text/logo freely; Alt snaps to grid. Arrows: 1 px; Shift: 10 px. Drag cards for X/Y or the ring for Z. Wheel changes size. Escape cancels."><span><Cube size={14}/>Real-time WebGL preview</span><span>{SHADERS.find(shader => shader.id === carousel.shader).name} / {project.fps} FPS</span></div></section>;
}
