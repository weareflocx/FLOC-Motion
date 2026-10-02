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

export function validateExportSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid export settings.');
  const { quality = 'high', resolution = '1080p' } = input;
  if (!EXPORT_QUALITIES.some(item => item.id === quality)) throw new Error('Unknown export quality.');
  if (!EXPORT_RESOLUTIONS.some(item => item.id === resolution)) throw new Error('Unknown export resolution.');
  return { quality, resolution };
}

export function exportDimensions(format, resolution) {
  const dimensions = FORMATS[format];
  const preset = EXPORT_RESOLUTIONS.find(item => item.id === resolution);
  if (!dimensions || !preset) throw new Error('Unknown export dimensions.');
  return dimensions.map(value => value * preset.scale);
}
