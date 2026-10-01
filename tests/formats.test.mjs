import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMATS, FORMAT_LABELS, demoProject, validateProject } from '../src/project.js';
import { stageMarkup } from '../src/scene.js';
import { createTools } from '../src/webmcp.js';

test('3:4 and 4:3 canvas formats validate and share exact render dimensions', () => {
  for (const [format, width, height, label] of [['portrait34', 1080, 1440, '3 : 4'], ['landscape43', 1440, 1080, '4 : 3']]) {
    const p = validateProject({ ...demoProject(), format });
    assert.deepEqual(FORMATS[p.format], [width, height]);
    assert.equal(FORMAT_LABELS[format], label);
    assert.ok(stageMarkup(p).includes(`width="${width}" height="${height}"`));
    assert.equal(validateProject(JSON.parse(JSON.stringify(p))).format, format);
  }
  assert.deepEqual(FORMATS.square, [1080, 1080]);
  assert.deepEqual(FORMATS.portrait, [1080, 1920]);
  assert.deepEqual(FORMATS.landscape, [1920, 1080]);
});
test('agents discover and select both new canvas formats through shared validation', async () => {
  let p = demoProject(); let saves = 0;
  const tool = createTools({ get: () => p, set: value => { p = value; }, save: async () => { saves++; }, audit: () => {} }).find(tool => tool.name === 'floc_set_output');
  for (const format of ['portrait34', 'landscape43']) {
    assert.ok(tool.inputSchema.properties.format.enum.includes(format));
    await tool.execute({ format }); assert.equal(p.format, format);
  }
  assert.equal(saves, 2);
});
