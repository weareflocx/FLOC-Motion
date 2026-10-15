import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadAssets } from '../src/editor/upload-assets.js';


test('asset uploads reject oversized files before making a request', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{}'); };
  try {
    await assert.rejects(uploadAssets([{ name: 'huge.mp4', size: 75e6 + 1 }]), /75 MB/);
    assert.equal(calls, 0);
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

test('upload limits reject the entire selection before sending an earlier valid file', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{}'); };
  try {
    await assert.rejects(uploadAssets([
      new File(['valid'], 'first.glb'),
      new File(['other'], 'second.png')
    ], { maxFiles: 1, limitMessage: 'Use up to 12 layers.' }), /Use up to 12 layers/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('model replacement rejects unrelated media, multiple models and empty selection before upload', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{}'); };
  try {
    for (const files of [
      [new File(['image'], 'texture.png')],
      [new File(['model'], 'first.glb'), new File(['model'], 'second.glb')],
      []
    ]) {
      await assert.rejects(uploadAssets(files, { maxFiles: 1, modelOnly: true }), /Choose one GLB or OBJ model/);
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('all original file sizes are checked before model parsing or count restrictions', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{}'); };
  try {
    await assert.rejects(uploadAssets([
      new File(['mtllib missing.mtl\n'], 'broken.obj'),
      { name: 'huge.png', size: 75e6 + 1 }
    ], { maxFiles: 0 }), /huge\.png exceeds the 75 MB/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('a missing OBJ companion prevents uploading earlier ordinary media', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{}'); };
  try {
    await assert.rejects(uploadAssets([
      new File(['image'], 'first.png'),
      new File(['mtllib missing.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'], 'broken.obj')
    ]), /missing\.mtl/i);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('OBJ materials count as one upload, preserve its display name and reject extra replacement media', async () => {
  const originalFetch = globalThis.fetch, originalReader = globalThis.FileReader;
  const requests = [];
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }, error => { this.error = error; this.onerror?.(error); });
    }
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ id: String(requests.length), name: options.body.name, src: `/assets/${options.body.name}` }));
  };
  const obj = new File(['mtllib triangle.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl red\nf 1 2 3\n'], 'triangle.obj');
  const mtl = new File(['newmtl red\nKd 1 0 0\n'], 'triangle.mtl');
  try {
    const assets = await uploadAssets([mtl, obj], { maxFiles: 1, modelOnly: true });
    assert.equal(requests.length, 1);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].name, 'triangle.obj');
    const bytes = new Uint8Array(await requests[0].options.body.arrayBuffer());
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'glTF');

    requests.length = 0;
    const unrelated = new File(['image'], 'unrelated.png', { type: 'image/png' });
    await assert.rejects(uploadAssets([obj, mtl, unrelated], { maxFiles: 1, modelOnly: true }), /Choose one GLB or OBJ model/);
    assert.equal(requests.length, 0);

    const mixed = await uploadAssets([unrelated, mtl, obj], { maxFiles: 2 });
    assert.deepEqual(mixed.map(asset => asset.name), ['unrelated.png', 'triangle.obj']);
    assert.equal(requests.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalReader === undefined) delete globalThis.FileReader;
    else globalThis.FileReader = originalReader;
  }
});
