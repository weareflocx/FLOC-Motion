import React from 'react';
import { ArrowCounterClockwise, ArrowClockwise } from '@phosphor-icons/react';
import { FORMATS } from '../../project.js';
import { IconButton } from '../controls.jsx';
import { Stage } from '../Stage.jsx';

export function CanvasPanel({ project, carousel, history, future, ready, positionPreview, time, playing, onError, onReady, onChangeName, onUndo, onRedo, selected, onSelect, onPatch, onPreview }) {
  return <section className="center-panel"><div className="canvas-toolbar"><div><input aria-label="Project name" className="project-name" maxLength={100} value={project.name} onChange={event => onChangeName(event.target.value)}/></div><div className="canvas-meta"><span>{FORMATS[project.format].join(' × ')}</span><IconButton label="Undo last edit (⌘/Ctrl+Z)" disabled={!history.length} onClick={onUndo}><ArrowCounterClockwise size={17}/></IconButton><IconButton label="Redo last edit (⌘/Ctrl+Shift+Z)" disabled={!future.length} onClick={onRedo}><ArrowClockwise size={17}/></IconButton></div></div><div className="preview-wrap"><Stage selected={selected} onSelect={onSelect} onPatch={onPatch} onPreview={onPreview} project={project} positionPreview={positionPreview} time={time} playing={playing} onError={onError} onReady={onReady}/>{!ready && <div className="preview-loading">Preparing composition…</div>}</div></section>;
}
