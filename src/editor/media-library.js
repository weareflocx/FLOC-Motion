// Workspace media library: what an uploaded asset is and where it can be used. Editor-only, so it
// stays outside the renderer engine fingerprint.
import { FORMATS, PROJECT_LIMITS, carouselImages, fileLayer, validAsset } from '../project.js';

export const ASSET_KINDS = { image: 'Image', gif: 'GIF', video: 'Video', audio: 'Audio', model: '3D model' };
export const LIBRARY_FILTERS = [['all', 'All'], ['image', 'Images'], ['video', 'Video'], ['audio', 'Audio'], ['model', '3D']];
// Library items dragged onto the canvas, timeline or carousel card list carry this payload type.
export const ASSET_DRAG_TYPE = 'application/x-floc-asset';

export function assetKind(src) {
  const ext = /\.([a-z0-9]+)$/i.exec(src)?.[1].toLowerCase();
  if (['mp3', 'wav', 'm4a', 'ogg'].includes(ext)) return 'audio';
  if (ext === 'glb') return 'model';
  if (ext === 'gif') return 'gif';
  if (['mp4', 'webm'].includes(ext)) return 'video';
  return 'image';
}

export const fallbackAssetName = file => `${ASSET_KINDS[assetKind(file)]} ${file.slice(0, 8)}`;

export function matchesLibrary(asset, filter, query = '') {
  const kind = assetKind(asset.src);
  if (filter !== 'all' && filter !== kind && !(filter === 'video' && kind === 'gif')) return false;
  return asset.name.toLowerCase().includes(query.trim().toLowerCase());
}

const VISUAL = ['image', 'gif', 'video'];
const SOURCE_KINDS = { media: VISUAL, logo: ['image'], background: ['image', 'video'], music: ['audio'], model: ['model'] };
export const isVisualAsset = asset => VISUAL.includes(assetKind(asset.src));

// The use the selected layer offers: carousels take cards, other file layers a new source.
export function assetUse(asset, layer, project) {
  if (!layer || layer.locked) return null;
  const kind = assetKind(asset.src);
  if (layer.type === 'carousel') return VISUAL.includes(kind) && carouselImages(project, layer).length < PROJECT_LIMITS.maxImages ? 'cards' : null;
  return SOURCE_KINDS[layer.type]?.includes(kind) && layer.src !== asset.src ? 'source' : null;
}

export const sourcePatch = (layer, asset) => ({ src: asset.src, ...(layer.type === 'background' ? { mode: assetKind(asset.src) === 'video' ? 'video' : 'image' } : {}) });
// Card IDs are unique per carousel, so a reused asset gets a fresh one.
export const cardFromAsset = (asset, id) => ({ id, src: asset.src, name: asset.name.slice(0, 200) });

// Replacing an entry keeps its identity and creates an owned list for legacy
// carousels that still borrow project.images; other carousels remain untouched.
export function replaceCardImages(project, layerId, cardId, asset) {
  const layer = project.layers.find(item => item.id === layerId && item.type === 'carousel');
  if (!layer) throw new Error('This carousel no longer exists.');
  if (layer.locked) throw new Error('Unlock the carousel before replacing a card.');
  const images = carouselImages(project, layer);
  if (!images.some(image => image.id === cardId)) throw new Error('This card no longer exists.');
  if (!asset || !validAsset(asset.src, false) || !isVisualAsset(asset) || typeof asset.name !== 'string') throw new Error('Choose an image, GIF or video.');
  return images.map(image => image.id === cardId ? cardFromAsset(asset, image.id) : image);
}
// Every asset source the composition shows: layer sources and all carousel cards.
export const projectSources = project => new Set(project.layers.flatMap(layer => [layer, ...(layer.type === 'carousel' ? carouselImages(project, layer) : [])]).map(item => item.src).filter(Boolean));

const round = value => Math.round(Math.max(-1000, Math.min(1000, value)) * 10) / 10;
// A new layer for an asset. Canvas points use percentages plus image height / width;
// audio timeline drops use `time` in composition seconds without changing the source offset.
export function assetLayer(asset, project, id, point) {
  const layer = fileLayer(asset, project.duration, id);
  if (layer.type === 'music' && Number.isFinite(point?.time)) {
    const start = Math.max(0, Math.min(project.duration - 1 / project.fps, Math.round(point.time * project.fps) / project.fps));
    return { ...layer, start };
  }
  if (!point || layer.type === 'music') return layer;
  const [width, height] = FORMATS[project.format];
  const aspect = layer.type === 'model' ? 1 : point.aspect > 0 ? point.aspect : 1;
  return { ...layer, x: round(point.x - layer.size / 2), y: round(point.y - layer.size * aspect * width / height / 2) };
}
