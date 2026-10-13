// Template content fields: a layer declares `contentField: { id, label, required, maxLength? }`.
// The field type follows from the layer type; `id` is stable and unique within a project.
export const CONTENT_PROPERTIES = Object.freeze({ text: 'text', carousel: 'images', logo: 'src', media: 'src', music: 'src' });
export const CONTENT_LABEL_LIMIT = 60;
export const CONTENT_ID_LIMIT = 60;
export const TEXT_CONTENT_LIMIT = 500;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const fail = message => { throw new Error(message); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function contentFields(project) {
  return project.layers.filter(layer => Object.hasOwn(CONTENT_PROPERTIES, layer.type) && record(layer.contentField));
}

// Slug of a label, e.g. "Main headline" → "main-headline"; never empty.
export function contentFieldSlug(label) {
  const slug = String(label).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, CONTENT_ID_LIMIT - 4).replace(/-+$/, '');
  return slug || 'field';
}

// First free id for a label: "headline", then "headline-2", "headline-3"…
export function uniqueContentFieldId(label, used) {
  const base = contentFieldSlug(label);
  let id = base;
  for (let suffix = 2; used.has(id); suffix++) id = `${base}-${suffix}`;
  return id;
}

// Validates one declaration and returns its canonical copy (unknown keys dropped).
export function normalizeContentField(field, type) {
  if (!record(field)) fail('Invalid content field.');
  const { id, label, required = false, maxLength } = field;
  if (typeof id !== 'string' || id.length > CONTENT_ID_LIMIT || !ID_PATTERN.test(id)) fail('Invalid content field ID.');
  if (typeof label !== 'string' || CONTROL.test(label) || !label.trim() || label.trim().length > CONTENT_LABEL_LIMIT) fail('Invalid content field name.');
  if (typeof required !== 'boolean') fail('Content field required must be true or false.');
  const next = { id, label: label.trim(), required };
  if (maxLength !== undefined) {
    if (type !== 'text') fail('Only text fields accept a maximum length.');
    if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > TEXT_CONTENT_LIMIT) fail(`Maximum length must be a whole number from 1 to ${TEXT_CONTENT_LIMIT}.`);
    next.maxLength = maxLength;
  }
  return next;
}

// The layer patch for an editor declaration: an empty label removes the field;
// an existing field keeps its id when renamed.
export function contentFieldPatch(project, layerId, { label = '', required = false, maxLength } = {}) {
  const layer = project.layers.find(item => item.id === layerId);
  if (!layer) fail('Layer not found.');
  if (!String(label).trim()) return { contentField: null };
  const used = new Set(contentFields(project).filter(item => item.id !== layerId).map(item => item.contentField.id));
  const id = record(layer.contentField) ? layer.contentField.id : uniqueContentFieldId(label, used);
  return { contentField: { id, label: String(label).trim(), required: Boolean(required), ...(layer.type === 'text' && maxLength !== undefined && maxLength !== '' ? { maxLength: Number(maxLength) } : {}) } };
}

export function contentValue(project, layer) {
  const property = CONTENT_PROPERTIES[layer.type];
  return property === 'images' ? layer.images ?? project.images : layer[property];
}

// Value problems a form must resolve before applying: empty required values and text over maxLength.
export function contentFieldIssues(project, layer) {
  const field = layer.contentField, value = contentValue(project, layer), issues = [];
  const empty = layer.type === 'carousel' ? !value?.length : layer.type === 'text' ? !String(value ?? '').trim() : !value;
  if (field.required && empty) issues.push({ kind: 'required', message: `${field.label} is required.` });
  if (layer.type === 'text' && field.maxLength !== undefined && String(value ?? '').length > field.maxLength) issues.push({ kind: 'maxLength', message: `${field.label} is longer than ${field.maxLength} characters.` });
  return issues;
}

export function contentIssues(project) {
  return contentFields(project).flatMap(layer => contentFieldIssues(project, layer).map(issue => ({ ...issue, layerId: layer.id, fieldId: layer.contentField.id })));
}
