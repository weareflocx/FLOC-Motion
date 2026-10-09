import { isIP } from 'node:net';

export const BODY_IDLE_TIMEOUT_MS = 15000;
export const HEADERS_TIMEOUT_MS = 15000;
export const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
export const KEEP_ALIVE_TIMEOUT_MS = 5000;

const failure = (message, status) => Object.assign(new Error(message), { status });
const normalizeAddress = value => String(value || '').replace(/^::ffff:/, '');

export function clientAddress(req, config) {
  if (config.publicOrigin) {
    const value = Array.isArray(req.headers['fly-client-ip']) ? req.headers['fly-client-ip'][0] : req.headers['fly-client-ip'];
    if (isIP(value || '')) return normalizeAddress(value);
  }
  return normalizeAddress(req.socket.remoteAddress) || 'unknown';
}

export async function requestBody(req, limit = 2e6, { idleTimeoutMs = BODY_IDLE_TIMEOUT_MS } = {}) {
  let size = 0, timer;
  const chunks = [];
  const reset = () => { clearTimeout(timer); timer = setTimeout(() => req.destroy(failure('Request body timed out.', 408)), idleTimeoutMs); };
  try {
    reset();
    for await (const chunk of req) {
      reset(); size += chunk.length;
      if (size > limit) throw failure(`Request body exceeds ${limit} bytes.`, 413);
      chunks.push(chunk);
    }
  } finally { clearTimeout(timer); }
  return Buffer.concat(chunks);
}
export function configureHttpServer(server, { headersTimeout = HEADERS_TIMEOUT_MS, requestTimeout = REQUEST_TIMEOUT_MS, keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS, socketTimeout = REQUEST_TIMEOUT_MS } = {}) {
  server.headersTimeout = headersTimeout;
  server.requestTimeout = requestTimeout;
  server.keepAliveTimeout = keepAliveTimeout;
  server.setTimeout(socketTimeout);
  return server;
}
