import React from 'react';
import { DEFAULT_LAYOUT } from '../../layout.js';
import { NumberField, Section } from '../controls.jsx';

export function LayoutControls({ project, onChange }) {
  const layout = project.layout ?? DEFAULT_LAYOUT;
  const change = patch => onChange({ ...project, layout: { ...layout, ...patch } });
  return <Section title="Layout">
    <label className="check-field"><input type="checkbox" checked={layout.enabled} onChange={e => change({ enabled: e.target.checked })}/>Use safe margins</label>
    {layout.enabled && <div className="two-fields"><NumberField label="Horizontal margin (%)" value={layout.marginX} min={0} max={25} step={.5} onChange={marginX => change({ marginX })}/><NumberField label="Vertical margin (%)" value={layout.marginY} min={0} max={25} step={.5} onChange={marginY => change({ marginY })}/></div>}
    <label className="check-field"><input type="checkbox" checked={layout.guides} onChange={e => change({ guides: e.target.checked })}/>Show smart guides</label>
    <p className="helper">Margins contain text and logos in preview and export. The carousel stays free. Guides show alignment and nearby spacing; they are never exported.</p>
  </Section>;
}
