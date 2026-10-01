import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function runtimeConfig(env = process.env) {
  const port = Number(env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  let publicOrigin = null;
  if (env.FLOC_PUBLIC_ORIGIN) {
    const url = new URL(env.FLOC_PUBLIC_ORIGIN);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('FLOC_PUBLIC_ORIGIN must be an HTTP(S) origin without a path.');
    publicOrigin = url.origin;
  }
  return { port, publicOrigin, host: publicOrigin ? '0.0.0.0' : '127.0.0.1', data: path.resolve(env.FLOC_DATA_DIR || path.join(root, '.data')) };
}
export function requestOrigin(host, config) {
  if (!host) return null;
  let url;
  try { url = new URL(`http://${host}`); } catch { return null; }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
  if (config.publicOrigin && url.host === new URL(config.publicOrigin).host) return config.publicOrigin;
  if (['127.0.0.1', 'localhost'].includes(url.hostname)) return url.origin;
  return null;
}
