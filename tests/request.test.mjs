import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from '../src/editor/request.js';

test('request releases renderer pairing flows when the server does not respond', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
    });
    await assert.rejects(request('/api/renderers/pair', { method: 'POST', timeoutMs: 10 }), error => {
      assert.equal(error.code, 'ETIMEDOUT');
      assert.equal(error.message, 'Request timed out after 10 ms.');
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('request leaves ordinary calls unchanged when no timeout is requested', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{"ok":true}', { status: 200 });
    assert.deepEqual(await request('/api/health'), { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
