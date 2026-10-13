import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function runtimeConfig(env = process.env) {
  const port = Number(env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  const publicOrigins = [];
  for (const value of (env.FLOC_PUBLIC_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean)) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('FLOC_PUBLIC_ORIGIN must be an HTTP(S) origin without a path.');
    if (publicOrigins.some(origin => new URL(origin).host === url.host && origin !== url.origin)) throw new Error('FLOC_PUBLIC_ORIGIN must use one protocol per host.');
    publicOrigins.push(url.origin);
  }
  const publicOrigin = publicOrigins[0] || null;
  return { port, publicOrigin, publicOrigins, host: publicOrigin ? '0.0.0.0' : '127.0.0.1', data: path.resolve(env.FLOC_DATA_DIR || path.join(root, '.data')) };
}
export function requestOrigin(host, config) {
  if (!host) return null;
  let url;
  try { url = new URL(`http://${host}`); } catch { return null; }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
  const publicOrigin = config.publicOrigins.find(origin => url.host === new URL(origin).host);
  if (publicOrigin) return publicOrigin;
  if (['127.0.0.1', 'localhost'].includes(url.hostname)) return url.origin;
  return null;
}
