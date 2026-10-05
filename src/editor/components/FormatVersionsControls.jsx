import React from 'react';
import { FORMATS, FORMAT_LABELS, linkFormats, resetFormat, switchFormat, unlinkFormats } from '../../project.js';
import { Field } from '../controls.jsx';
import './linked-formats.css';

export function FormatVersionsControls({ project, onChangeProject }) {
  const master = project.linkedFormats?.master;
  return <div className="linked-format-controls">
    <Field label="Aspect ratio"><div className="canvas-formats" role="group" aria-label="Aspect ratio">
      {Object.entries(FORMATS).map(([format, [width, height]]) => {
        const scale = 26 / Math.max(width, height);
        const frameWidth = width * scale;
        const frameHeight = height * scale;
        return <button type="button" key={format} className="canvas-format-option" aria-label={FORMAT_LABELS[format]} title={FORMAT_LABELS[format]} aria-pressed={project.format === format} onClick={() => onChangeProject(switchFormat(project, format))}>
          <svg className="canvas-format-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
            <rect x={(32 - frameWidth) / 2} y={(32 - frameHeight) / 2} width={frameWidth} height={frameHeight} rx="0.75"/>
          </svg>
        </button>;
      })}
    </div></Field>
    <div className="linked-formats-status">
      <label className="check-field"><input type="checkbox" checked={Boolean(master)} onChange={event => onChangeProject(event.target.checked ? linkFormats(project) : unlinkFormats(project))}/>Linked formats</label>
      {master && <span className="linked-formats-master">Master · {FORMAT_LABELS[master]}</span>}
    </div>
    {master && <button type="button" className="outline-button" disabled={project.format === master} onClick={() => onChangeProject(resetFormat(project))}>Reset from master</button>}
  </div>;
}
