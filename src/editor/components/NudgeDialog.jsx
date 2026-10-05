import React from 'react';
import { X } from '@phosphor-icons/react';
import { IconButton, Modal, NumberField } from '../controls.jsx';

export function NudgeDialog({ value, onChange, onClose }) {
  return <Modal onClose={onClose} labelledBy="nudge-title">
    <div className="nudge-dialog">
      <div className="nudge-heading"><h2 id="nudge-title">Nudge amount</h2><IconButton label="Close nudge amount" onClick={onClose}><X size={20}/></IconButton></div>
      <NumberField label="Small nudge" value={value.small} min={1} max={1000} suffix="px" onChange={small => onChange({ ...value, small })}/>
      <NumberField label="Big nudge" value={value.big} min={1} max={1000} suffix="px" onChange={big => onChange({ ...value, big })}/>
      <p className="helper">Arrow keys · Shift + arrow keys</p>
    </div>
  </Modal>;
}
