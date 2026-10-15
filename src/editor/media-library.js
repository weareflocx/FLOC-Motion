// Workspace media library: what an uploaded asset is and where it can be used. Editor-only, so it
// stays outside the renderer engine fingerprint (server/renderer-version.mjs skips src/editor).
import { FORMATS, PROJECT_LIMITS, carouselImages, fileLayer } from '../project.js';

export const ASSET_KINDS = { image: 'Image', gif: 'GIF', video: 'Video', audio: 'Audio', model: '3D model' };
export const LIBRARY_FILTERS = [['all', 'All'], ['image', 'Images'], ['video', 'Video'], ['audio', 'Audio'], ['model', '3D']];
// Library items dragged onto the canvas or the carousel card list carry this payload type.
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
// Every asset source the composition shows: layer sources and all carousel cards.
export const projectSources = project => new Set(project.layers.flatMap(layer => [layer, ...(layer.type === 'carousel' ? carouselImages(project, layer) : [])]).map(item => item.src).filter(Boolean));

const round = value => Math.round(Math.max(-1000, Math.min(1000, value)) * 10) / 10;
// A new layer for an asset. With a drop point (canvas percentages), the visual is centered on
// it; `aspect` is the asset's height / width, known from its library thumbnail.
export function assetLayer(asset, project, id, point) {
  const layer = fileLayer(asset, project.duration, id);
  if (!point || layer.type === 'music') return layer;
  const [width, height] = FORMATS[project.format];
  const aspect = layer.type === 'model' ? 1 : point.aspect > 0 ? point.aspect : 1;
  return { ...layer, x: round(point.x - layer.size / 2), y: round(point.y - layer.size * aspect * width / height / 2) };
}
