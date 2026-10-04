import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadAssets } from '../src/editor/upload-assets.js';

test('asset uploads preserve file order, encoded names, body and fallback content type', async () => {
  const original = globalThis.fetch, requests = [];
  const files = [{ name: 'card #1.png', type: 'image/png' }, { name: 'sound track.wav', type: '' }];
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return new Response(JSON.stringify({ id: String(requests.length), name: options.body.name }), { status: 200 }); };
  try {
    const assets = await uploadAssets(files);
    assert.deepEqual(assets.map(asset => asset.id), ['1', '2']);
    assert.equal(requests[0].url, '/api/assets?name=card%20%231.png');
    assert.equal(requests[0].options.body, files[0]);
    assert.equal(requests[0].options.headers['Content-Type'], 'image/png');
    assert.equal(requests[1].options.headers['Content-Type'], 'application/octet-stream');
  } finally { globalThis.fetch = original; }
});

test('asset upload stops after the first failure and retains the server error', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ error: 'Invalid image file.' }), { status: 400 }); };
  try {
    await assert.rejects(uploadAssets([{ name: 'invalid.png' }, { name: 'later.png' }]), /Invalid image file/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
