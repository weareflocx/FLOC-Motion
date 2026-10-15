import React from 'react';
import { Copy, Eye, EyeSlash, LockSimple, LockSimpleOpen, Trash } from '@phosphor-icons/react';
import { groupFlagValue } from '../selection.js';
import { Section } from '../controls.jsx';
import { ArrangeControls } from './ArrangeControls.jsx';

// Inspector for two or more selected layers: arrangement and group actions.
export function SelectionSummary({ layers, canAlign, canDistribute, canDuplicate, onArrange, onToggleLock, onToggleVisibility, onDuplicate, onRemove }) {
  const lock = groupFlagValue(layers, 'locked'), show = groupFlagValue(layers, 'visible');
  const locked = layers.filter(layer => layer.locked).length;
  return <aside className="right-panel panel selection-summary" aria-label="Selected layers">
    <div className="section-heading"><h2>{layers.length} layers selected</h2></div>
    <ul className="selection-summary-list">{[...layers].reverse().map(layer => <li key={layer.id}><span>{layer.name}</span>{layer.locked && <LockSimple size={12} aria-label="Locked"/>}{!layer.visible && <EyeSlash size={12} aria-label="Hidden"/>}</li>)}</ul>
    {locked > 0 && <p className="helper">{locked === 1 ? 'The locked layer keeps its place' : `${locked} locked layers keep their place`} and settings until unlocked.</p>}
    <Section title="Arrange" defaultOpen>
      <ArrangeControls className="selection-arrange" target="selection" canAlign={canAlign} canDistribute={canDistribute} onArrange={onArrange}/>
      {!canDistribute && <p className="helper">Distribute needs three or more unlocked layers on the canvas.</p>}
    </Section>
    <Section title="Selection" defaultOpen>
      <div className="selection-actions">
        <button type="button" className="outline-button" onClick={onToggleVisibility}>{show ? <Eye size={15}/> : <EyeSlash size={15}/>}{show ? 'Show all' : 'Hide all'}</button>
        <button type="button" className="outline-button" onClick={onToggleLock}>{lock ? <LockSimple size={15}/> : <LockSimpleOpen size={15}/>}{lock ? 'Lock all' : 'Unlock all'}</button>
        <button type="button" className="outline-button" disabled={!canDuplicate} onClick={onDuplicate}><Copy size={15}/>Duplicate</button>
        <button type="button" className="outline-button danger" disabled={locked === layers.length} onClick={onRemove}><Trash size={15}/>Delete</button>
      </div>
    </Section>
  </aside>;
}
