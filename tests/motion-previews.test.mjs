import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TEMPLATES } from '../src/project.js';
import { CATALOG } from '../src/catalog.js';

for (const [collection, items] of [['template', TEMPLATES], ['preset', CATALOG]]) test(`every registered ${collection} ships a local MP4 sample and JPEG poster`, async () => {
  for (const template of items) {
    const video = await readFile(new URL(`../public/${collection}-previews/${template.id}.mp4`, import.meta.url));
    const poster = await readFile(new URL(`../public/${collection}-previews/${template.id}.jpg`, import.meta.url));
    assert.equal(video.toString('ascii', 4, 8), 'ftyp', `${template.id}: MP4 container`);
    assert.ok(video.includes(Buffer.from('mdat')), `${template.id}: video media data`);
    assert.ok(video.length > 1000, `${template.id}: non-empty sample`);
    assert.equal(poster.readUInt16BE(0), 0xffd8, `${template.id}: JPEG poster`);
  }
});

test('preview visibility notices identify existing catalog recipes', async () => {
  const notices = JSON.parse(await readFile(new URL('../src/catalog/preview-visibility.json', import.meta.url)));
  for (const [id, message] of Object.entries(notices)) {
    assert.ok(CATALOG.some(item => item.id === id), `Unknown preset: ${id}`);
    assert.ok(typeof message === 'string' && message.length > 0, `Missing visibility explanation: ${id}`);
  }
});
