import React from 'react';
import { FORMATS, FORMAT_LABELS, linkFormats, resetFormat, switchFormat, unlinkFormats } from '../../project.js';
import { Field } from '../controls.jsx';
import './linked-formats.css';

export function FormatVersionsControls({ project, onChangeProject }) {
  const master = project.linkedFormats?.master;
  return <div className="linked-format-controls">
    <Field label="Aspect ratio"><div className="segmented canvas-formats" role="group" aria-label="Aspect ratio">
      {Object.keys(FORMATS).map(format => <button type="button" key={format} aria-pressed={project.format === format} className={project.format === format ? 'selected' : ''} onClick={() => onChangeProject(switchFormat(project, format))}>{FORMAT_LABELS[format]}</button>)}
    </div></Field>
    <div className="linked-formats-status">
      <label className="check-field"><input type="checkbox" checked={Boolean(master)} onChange={event => onChangeProject(event.target.checked ? linkFormats(project) : unlinkFormats(project))}/>Linked formats</label>
      {master && <span className="linked-formats-master">Master · {FORMAT_LABELS[master]}</span>}
    </div>
    {master && <button type="button" className="outline-button" disabled={project.format === master} onClick={() => onChangeProject(resetFormat(project))}>Reset from master</button>}
  </div>;
}
