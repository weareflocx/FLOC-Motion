// Batch variants: one row per output, one column per template content field.
// Rows hold complete values (initialized from the template), so a row is exactly what it produces.
import { carouselImages, patchTemplateContent, switchFormat, validAsset, validateProject } from './project.js';
import { CONTENT_PROPERTIES, TEXT_CONTENT_LIMIT, contentFieldIssues, contentFields } from './template-content.js';

export const BATCH_ROW_LIMIT = 50;
export const NAME_LIMIT = 100;
const fail = message => { throw new Error(message); };
const fold = value => String(value).trim().toLowerCase();
const ASSET_TYPES = {
  logo: /\.(png|jpe?g|webp|gif|avif|svg)$/i,
  media: /\.(png|jpe?g|webp|gif|avif|svg|mp4|webm)$/i,
  carousel: /\.(png|jpe?g|webp|gif|avif|svg|mp4|webm)$/i,
  music: /\.(mp3|wav|m4a|ogg)$/i
};
export const acceptsAsset = (type, src) => Boolean(ASSET_TYPES[type]?.test(src));

export function batchColumns(project) {
  return contentFields(project).map(layer => ({ ...layer.contentField, type: layer.type, layerId: layer.id }));
}

// Formats a batch can export: every linked format, or the template's own format.
export const batchFormats = project => project.linkedFormats ? Object.keys(project.linkedFormats.layouts) : [project.format];

export function templateValues(project) {
  return Object.fromEntries(contentFields(project).map(layer => [layer.contentField.id,
    layer.type === 'carousel' ? structuredClone(carouselImages(project, layer)) : layer[CONTENT_PROPERTIES[layer.type]]]));
}

export const batchRow = (project, key, name = '') => ({ key, name, values: templateValues(project) });

// Assets referenced anywhere in the workspace, with the names people gave them.
export function workspaceAssets(projects) {
  const assets = new Map();
  const add = (src, name) => { if (validAsset(src, false) && !assets.has(src)) assets.set(src, { src, name: String(name || src.split('/').pop()) }); };
  for (const project of projects) {
    for (const image of project.images ?? []) add(image.src, image.name);
    for (const layer of project.layers ?? []) {
      for (const image of layer.images ?? []) add(image.src, image.name);
      if (layer.src) add(layer.src, layer.name);
    }
  }
  return [...assets.values()];
}

// CSV (RFC 4180 quoting) or TSV when the first line holds a tab, as spreadsheets paste.
export function parseDelimited(text) {
  const source = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const delimiter = source.split('\n', 1)[0].includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (source[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (c === '"' && !cell.trim()) { cell = ''; quoted = true; }
    else if (c === delimiter) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (quoted) fail('A quoted value is not closed.');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(cells => cells.some(value => value.trim()));
}

function resolveAsset(text, assets) {
  const value = text.trim();
  if (!value) return '';
  return assets.find(asset => asset.src === value)?.src ?? assets.find(asset => fold(asset.name) === fold(value))?.src ?? value;
}

// Header cells name the output column ("Name"/"Output name") or a field by ID or label.
// Without a header row, columns are the output name followed by the text fields in order.
export function rowsFromTable(project, text, { assets = [], key = index => `row-${index + 1}` } = {}) {
  const table = parseDelimited(text);
  if (!table.length) fail('Paste at least one row.');
  const columns = batchColumns(project);
  const resolve = cell => {
    const value = fold(cell);
    const byId = columns.find(column => column.id === value);
    if (byId) return byId;
    const byLabel = columns.filter(column => fold(column.label) === value);
    if (byLabel.length > 1) fail(`Column “${cell.trim()}” matches several fields. Use its ID instead.`);
    if (byLabel.length) return byLabel[0];
    return ['name', 'output name', 'output', 'composition', 'composition name'].includes(value) ? 'name' : null;
  };
  const head = table[0].map(cell => cell.trim() ? resolve(cell) : undefined);
  const header = head.some(Boolean);
  let mapping;
  if (header) {
    const unknown = table[0].find((cell, index) => cell.trim() && !head[index]);
    if (unknown) fail(`Unknown column “${unknown.trim()}”. Use “Name”, a field label or a field ID.`);
    const seen = new Set();
    for (const target of head.filter(Boolean)) {
      const id = target === 'name' ? 'name' : target.id;
      if (seen.has(id)) fail(`Column “${target === 'name' ? 'Name' : target.label}” appears twice.`);
      seen.add(id);
    }
    mapping = head;
  } else {
    mapping = ['name', ...columns.filter(column => column.type === 'text')];
    if (table.some(cells => cells.length > mapping.length)) fail('Rows have more columns than the template has text fields. Add a header row naming each column.');
  }
  const body = header ? table.slice(1) : table;
  if (!body.length) fail('Paste at least one row below the header.');
  if (body.length > BATCH_ROW_LIMIT) fail(`Use up to ${BATCH_ROW_LIMIT} rows.`);
  return body.map((cells, index) => {
    const row = batchRow(project, key(index));
    mapping.forEach((target, column) => {
      // A row shorter than the header keeps the template's values for the cells it lacks.
      if (!target || cells[column] === undefined) return;
      const cell = cells[column];
      if (target === 'name') row.name = cell.trim();
      else if (target.type === 'text') row.values[target.id] = cell;
      else if (target.type === 'carousel') row.values[target.id] = cell.split('|').map(part => part.trim()).filter(Boolean).map((part, card) => {
        const src = resolveAsset(part, assets);
        return { id: `card-${card + 1}`, src, name: assets.find(asset => asset.src === src)?.name ?? part };
      });
      else row.values[target.id] = resolveAsset(cell, assets);
    });
    return row;
  });
}

// The saved/exported project for one row, optionally in one of the template's linked formats.
export function variantProject(template, row, format) {
  let project = validateProject({ ...template, name: row.name.trim() });
  for (const layer of contentFields(project)) project = patchTemplateContent(project, layer.id, row.values[layer.contentField.id]);
  return format && format !== project.format ? switchFormat(project, format) : project;
}

const fieldSources = (type, value) => type === 'carousel' ? (value ?? []).map(image => image.src) : type === 'text' || !value ? [] : [value];
export const batchSources = (template, rows) => [...new Set(rows.flatMap(row => batchColumns(template).flatMap(column => fieldSources(column.type, row.values[column.id]))))];

// Everything but text layout, which needs a browser: see editor/text-overflow.js.
export function reviewRows(template, rows, { missingAssets = new Set(), overflow = new Map() } = {}) {
  const names = new Map();
  for (const row of rows) names.set(fold(row.name), (names.get(fold(row.name)) ?? 0) + 1);
  const columns = batchColumns(template);
  return rows.map(row => {
    const issues = [], name = row.name.trim();
    if (!name) issues.push({ kind: 'name', message: 'Output name is required.' });
    else if (name.length > NAME_LIMIT) issues.push({ kind: 'name', message: `Output name must be ${NAME_LIMIT} characters or fewer.` });
    else if (names.get(fold(name)) > 1) issues.push({ kind: 'duplicate', message: `Another row is also named “${name}”.` });
    let blocked = false;
    for (const column of columns) {
      const value = row.values[column.id], layer = template.layers.find(item => item.id === column.layerId);
      for (const issue of contentFieldIssues(template, { ...layer, [CONTENT_PROPERTIES[column.type]]: value })) issues.push({ ...issue, fieldId: column.id });
      if (column.type === 'text' && String(value ?? '').length > TEXT_CONTENT_LIMIT) { blocked = true; issues.push({ kind: 'maxLength', fieldId: column.id, message: `${column.label} is longer than ${TEXT_CONTENT_LIMIT} characters.` }); }
      for (const src of fieldSources(column.type, value)) {
        const problem = !validAsset(src, false) ? `“${src}” is not an uploaded asset.` : !acceptsAsset(column.type, src) ? `“${src.split('/').pop()}” is not a supported ${column.type === 'music' ? 'audio' : column.type === 'logo' ? 'image' : 'image or video'} file.` : missingAssets.has(src) ? `“${src.split('/').pop()}” is missing from the workspace.` : '';
        if (problem) { blocked = true; issues.push({ kind: 'asset', fieldId: column.id, message: `${column.label}: ${problem}` }); }
      }
    }
    // Anything else validation rejects surfaces with its own message.
    if (!blocked && !issues.some(issue => issue.kind === 'name')) {
      try { variantProject(template, row); } catch (error) { issues.push({ kind: 'invalid', message: error.message }); }
    }
    issues.push(...(overflow.get(row.key) ?? []));
    return { key: row.key, issues };
  });
}
