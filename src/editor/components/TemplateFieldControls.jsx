import React, { useEffect, useState } from 'react';
import { CONTENT_PROPERTIES, TEXT_CONTENT_LIMIT, contentFieldPatch } from '../../template-content.js';
import { Field, Section } from '../controls.jsx';

// Declares a layer as a template content field. Its ID is assigned once and survives renames.
export function TemplateFieldControls({ project, layer, onPatch }) {
  const field = layer.contentField;
  const [name, setName] = useState(field?.label ?? '');
  const [limit, setLimit] = useState(field?.maxLength ?? '');
  useEffect(() => { setName(field?.label ?? ''); setLimit(field?.maxLength ?? ''); }, [layer.id, field?.label, field?.maxLength]);
  if (!Object.hasOwn(CONTENT_PROPERTIES, layer.type)) return null;
  const commit = (changes = {}) => {
    const next = { label: name, required: field?.required ?? false, maxLength: limit === '' ? undefined : Number(limit), ...changes };
    onPatch(layer.id, contentFieldPatch(project, layer.id, next));
  };
  const blurOnEnter = event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } };
  return <Section title="Template field">
    <Field label="Field name"><input aria-label="Content field name" maxLength={60} placeholder="Not exposed" value={name} onChange={event => setName(event.target.value)} onBlur={() => commit()} onKeyDown={blurOnEnter}/></Field>
    {field && <>
      <label className="check-field"><input type="checkbox" checked={field.required} onChange={event => commit({ required: event.target.checked })}/>Required</label>
      {layer.type === 'text' && <Field label="Maximum characters"><input aria-label="Maximum characters" type="number" min={1} max={TEXT_CONTENT_LIMIT} step={1} placeholder="No limit" value={limit} onChange={event => setLimit(event.target.value)} onBlur={() => commit()} onKeyDown={blurOnEnter}/></Field>}
      <p className="helper">Field ID <code>{field.id}</code></p>
    </>}
  </Section>;
}
