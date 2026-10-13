export const FONTS = [
  { id: 'geist', name: 'Geist', family: 'Geist', weights: [400, 600, 700, 800] },
  { id: 'druk-wide', name: 'Druk Wide', family: 'Druk Wide', weights: [900] },
  { id: 'geist-mono', name: 'Geist Mono', family: 'Geist Mono', weights: [500, 700] }
];
export const FONT_WEIGHTS = { 100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Heavy' };
export const fontDefinition = id => FONTS.find(font => font.id === (id ?? 'geist'));
export const FONT_FILES = FONTS.flatMap(font => font.weights.map(weight => ({ family: font.family, weight, file: font.id === 'druk-wide' ? 'druk-wide-heavy.woff2' : `${font.id}-${weight}.woff2` })));
export const fontFaceCss = prefix => FONT_FILES.map(font => `@font-face{font-family:"${font.family}";font-style:normal;font-weight:${font.weight};src:url("${prefix}${font.file}") format("woff2");font-display:block}`).join('');

// Workspace fonts are uploaded by admins. A text layer references one face as `workspace:<id>`.
// Preview and export alias that face as `floc-workspace-<id>`, declared with every face of the
// same family and style, so CSS font matching picks the nearest available weight and a face
// missing from the library falls back to Geist.
const FACE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const WORKSPACE_FONT_PREFIX = 'workspace:';
export const FONT_FILE_TYPES = {
  woff2: { format: 'woff2', mime: 'font/woff2' },
  woff: { format: 'woff', mime: 'font/woff' },
  otf: { format: 'opentype', mime: 'font/otf' },
  ttf: { format: 'truetype', mime: 'font/ttf' }
};
export const FONT_STYLES = ['normal', 'italic'];
export const MAX_FONT_FAMILY_LENGTH = 64;
export const workspaceFontId = font => typeof font === 'string' && font.startsWith(WORKSPACE_FONT_PREFIX) && FACE_ID.test(font.slice(WORKSPACE_FONT_PREFIX.length)) ? font.slice(WORKSPACE_FONT_PREFIX.length) : null;
export const workspaceFontFamily = id => `floc-workspace-${id}`;
// CSS family to load or check; stageMarkup uses fontStack so a missing workspace face renders in Geist.
export const fontFamily = font => { const id = workspaceFontId(font); return id ? workspaceFontFamily(id) : fontDefinition(font).family; };
export const fontStack = font => workspaceFontId(font) ? `${fontFamily(font)},Geist` : fontFamily(font);
export const fontWeightValid = weight => Number.isInteger(weight) && weight >= 100 && weight <= 900 && weight % 100 === 0;
// Validation has no font library: any well-formed workspace id is accepted with a CSS weight.
export const textFontValid = (font, weight) => workspaceFontId(font) ? fontWeightValid(weight) : Boolean(fontDefinition(font)?.weights.includes(weight));
export const workspaceFontFile = face => `${face.id}.${face.ext}`;

export function normalizeFontFamily(value) {
  const family = typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
  if (!family || family.length > MAX_FONT_FAMILY_LENGTH || /[\u0000-\u001f\u007f"\\<>]/.test(family)) throw new Error(`Font family names need 1–${MAX_FONT_FAMILY_LENGTH} characters without quotes, backslashes or angle brackets.`);
  return family;
}

// Face descriptors travel with export jobs to renderers, so they are validated before use.
export function validateFontFaces(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > 500) throw new Error('Invalid workspace font list.');
  return input.map(face => {
    if (!face || typeof face !== 'object' || !FACE_ID.test(face.id) || !Object.hasOwn(FONT_FILE_TYPES, face.ext) || !fontWeightValid(face.weight) || !FONT_STYLES.includes(face.style)) throw new Error('Invalid workspace font.');
    return { id: face.id, family: normalizeFontFamily(face.family), weight: face.weight, style: face.style, ext: face.ext };
  });
}

export function workspaceFontFaceCss(faces, url) {
  return faces.flatMap(face => faces.filter(other => other.family === face.family && other.style === face.style)
    .map(other => `@font-face{font-family:"${workspaceFontFamily(face.id)}";font-style:normal;font-weight:${other.weight};src:url("${url(other)}") format("${FONT_FILE_TYPES[other.ext].format}");font-display:block}`)).join('');
}

// Every workspace face id named by a `font` field, including linked-format overrides.
export function workspaceFontReferences(value, output = new Set()) {
  if (Array.isArray(value)) value.forEach(item => workspaceFontReferences(item, output));
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    if (key === 'font' && workspaceFontId(item)) output.add(workspaceFontId(item));
    else if (item && typeof item === 'object') workspaceFontReferences(item, output);
  }
  return output;
}

// The faces a project needs: each referenced face with its family and style siblings.
export function facesForProject(project, faces) {
  const ids = workspaceFontReferences(project);
  const used = faces.filter(face => ids.has(face.id));
  return faces.filter(face => used.some(item => item.family === face.family && item.style === face.style));
}

// Selector groups: one entry per family and style, faces ordered by weight.
export function workspaceFamilies(faces) {
  const groups = new Map();
  for (const face of faces) {
    const key = `${face.family}\u0000${face.style}`;
    if (!groups.has(key)) groups.set(key, { key, family: face.family, style: face.style, faces: [] });
    groups.get(key).faces.push(face);
  }
  return [...groups.values()].map(group => ({ ...group, faces: group.faces.sort((a, b) => a.weight - b.weight) }))
    .sort((a, b) => a.family.localeCompare(b.family) || FONT_STYLES.indexOf(a.style) - FONT_STYLES.indexOf(b.style));
}
export const nearestFace = (faces, weight) => faces.reduce((best, face) => Math.abs(face.weight - weight) < Math.abs(best.weight - weight) ? face : best);
