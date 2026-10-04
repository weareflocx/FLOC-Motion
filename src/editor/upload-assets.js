import { request } from './request.js';

export async function uploadAssets(files) {
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
