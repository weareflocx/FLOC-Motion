import { FORMATS } from './project.js';

export const EXPORT_QUALITIES = [
  { id: 'draft', label: 'Draft', description: 'Quick review. Smaller files with more compression.' },
  { id: 'standard', label: 'Standard', description: 'Balanced detail, file size and render time.' },
  { id: 'high', label: 'High', description: 'Best detail with less compression. Larger files and slower encoding.' }
];
export const EXPORT_RESOLUTIONS = [
  { id: '1080p', label: '1080p', scale: 1 },
  { id: '2160p', label: '2160p / 4K', scale: 2 }
];
// `alpha` formats can drop background layers and keep a transparent page.
export const EXPORT_FORMATS = [
  { id: 'mp4', label: 'MP4 · H.264', name: 'MP4', file: 'video.mp4', extension: 'mp4', mime: 'video/mp4' },
  { id: 'mov', label: 'MOV · ProRes 4444', name: 'MOV', file: 'video.mov', extension: 'mov', mime: 'video/quicktime', alpha: true },
  { id: 'png', label: 'PNG sequence (.zip)', name: 'PNG sequence', file: 'frames.zip', extension: 'zip', mime: 'application/zip', alpha: true }
];
// Jobs stored before formats existed are MP4.
export const exportFormat = (id = 'mp4') => EXPORT_FORMATS.find(item => item.id === id);

export function validateExportSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid export settings.');
  const { quality = 'high', resolution = '1080p', format = 'mp4', transparent = false } = input;
  if (!EXPORT_QUALITIES.some(item => item.id === quality)) throw new Error('Unknown export quality.');
  if (!EXPORT_RESOLUTIONS.some(item => item.id === resolution)) throw new Error('Unknown export resolution.');
  if (!EXPORT_FORMATS.some(item => item.id === format)) throw new Error('Unknown export format.');
  if (typeof transparent !== 'boolean') throw new Error('Transparency must be true or false.');
  if (transparent && !exportFormat(format).alpha) throw new Error('Transparent exports require MOV or PNG sequence.');
  return { quality, resolution, format, transparent };
}

export function exportDimensions(format, resolution) {
  const dimensions = FORMATS[format];
  const preset = EXPORT_RESOLUTIONS.find(item => item.id === resolution);
  if (!dimensions || !preset) throw new Error('Unknown export dimensions.');
  return dimensions.map(value => value * preset.scale);
}
