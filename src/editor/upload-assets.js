import { request } from './request.js';
import { prepareModelImports } from './model-import.js';
export const MAX_ASSET_BYTES = 75e6;
// The media library refreshes after any upload, wherever it started.
const uploadListeners = new Set();
export function onAssetsUploaded(listener) { uploadListeners.add(listener); return () => uploadListeners.delete(listener); }

export function validateUploadFiles(files) {
  const oversized = files.find(file => file.size > MAX_ASSET_BYTES);
  if (oversized) throw new Error(`${oversized.name} exceeds the 75 MB file limit.`);
  return files;
}

export async function uploadAssets(files, { maxFiles, modelOnly = false, limitMessage } = {}) {
  validateUploadFiles(files);
  const prepared = await prepareModelImports(files, { maxBytes: MAX_ASSET_BYTES });
  validateUploadFiles(prepared.map(({ file }) => file));
  if (modelOnly && (prepared.length !== 1 || !/\.glb$/i.test(prepared[0].file.name))) {
    throw new Error('Choose one GLB or OBJ model with its declared MTL and textures.');
  }
  if (maxFiles !== undefined && prepared.length > maxFiles) {
    throw new Error(limitMessage || `Choose up to ${maxFiles} files.`);
  }
  const assets = [];
  for (const { file, name } of prepared) {
    const asset = await request(`/api/assets?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file
    });
    assets.push(name === file.name ? asset : { ...asset, name });
  }
  uploadListeners.forEach(listener => listener(assets));
  return assets;
}
