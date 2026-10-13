import React from 'react';
import { FONTS, FONT_WEIGHTS, fontDefinition, nearestFace, workspaceFamilies, workspaceFontId } from '../../fonts.js';
import { Field } from '../controls.jsx';
import { useWorkspaceFonts } from '../workspace-fonts.js';

const familyLabel = group => `${group.family}${group.style === 'italic' ? ' Italic' : ''}`;
const groupValue = group => `workspace:${group.faces[0].id}`;

// Studio fonts first, then the admin-curated workspace library. A workspace layer stores the
// exact face it uses; choosing a family or weight switches to the matching face.
export function FontControls({ layer, onPatch }) {
  const { faces, loaded } = useWorkspaceFonts();
  const groups = workspaceFamilies(faces);
  const id = workspaceFontId(layer.font);
  const group = id ? groups.find(item => item.faces.some(face => face.id === id)) : null;
  const missing = Boolean(id && loaded && !group);
  const pickFace = face => onPatch(layer.id, { font: `workspace:${face.id}`, weight: face.weight });
  function pickFamily(value) {
    const workspace = groups.find(item => groupValue(item) === value);
    if (workspace) return pickFace(nearestFace(workspace.faces, layer.weight));
    const font = fontDefinition(value);
    if (font) onPatch(layer.id, { font: font.id, weight: font.weights.includes(layer.weight) ? layer.weight : font.weights[0] });
  }
  const weights = group ? group.faces.map(face => face.weight) : id ? [layer.weight] : fontDefinition(layer.font).weights;
  return <>
    <Field label="Font"><select aria-label="Font family" value={group ? groupValue(group) : layer.font ?? 'geist'} onChange={event => pickFamily(event.target.value)}>
      {FONTS.map(font => <option key={font.id} value={font.id}>{font.name}</option>)}
      {groups.length > 0 && <optgroup label="Workspace">{groups.map(item => <option key={item.key} value={groupValue(item)}>{familyLabel(item)} · {item.faces.map(face => face.weight).join(', ')}</option>)}</optgroup>}
      {id && !group && <option value={layer.font}>{loaded ? 'Missing workspace font' : 'Loading workspace fonts…'}</option>}
    </select></Field>
    {missing && <p className="helper font-missing" role="status">This layer’s workspace font is no longer in the library, so it renders in Geist. Choose another font.</p>}
    <Field label="Weight"><select aria-label="Font weight" value={layer.weight} disabled={Boolean(id && !group)} onChange={event => {
      const weight = Number(event.target.value);
      if (group) pickFace(group.faces.find(face => face.weight === weight));
      else onPatch(layer.id, { weight });
    }}>{weights.map(weight => <option key={weight} value={weight}>{FONT_WEIGHTS[weight] ?? weight}</option>)}</select></Field>
  </>;
}
