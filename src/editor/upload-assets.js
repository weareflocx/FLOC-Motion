import { request } from './request.js';
export const MAX_ASSET_BYTES = 75e6;

export function validateUploadFiles(files) {
  const oversized = files.find(file => file.size > MAX_ASSET_BYTES);
  if (oversized) throw new Error(`${oversized.name} exceeds the 75 MB file limit.`);
  return files;
}

export async function uploadAssets(files) {
  validateUploadFiles(files);
  const assets = [];
  for (const file of files) {
    assets.push(await request(`/api/assets?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file
    }));
  }
  return assets;
}
