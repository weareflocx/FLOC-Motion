import React, { useEffect, useState } from 'react';
import { CONTENT_PROPERTIES } from '../../template-content.js';
import { Field, Section } from '../controls.jsx';

export function TemplateFieldControls({ layer, onPatch }) {
  const [name, setName] = useState(layer.contentField ?? '');
  useEffect(() => setName(layer.contentField ?? ''), [layer.id, layer.contentField]);
  if (!Object.hasOwn(CONTENT_PROPERTIES, layer.type)) return null;
  return <Section title="Template field"><Field label="Field name"><input aria-label="Content field name" maxLength={60} placeholder="Not exposed" value={name} onChange={event => setName(event.target.value)} onBlur={() => onPatch(layer.id, { contentField: name })} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}/></Field></Section>;
}
