import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { demoProject, linkFormats, switchFormat, patchLayer, validateProject } from '../src/project.js';
import { createTools } from '../src/webmcp.js';
import { sceneUpdatePlan } from '../src/scene-update.js';
import { createTemplateStore } from '../server/template-store.mjs';
import { prepareComposition } from '../server/export.mjs';

test('agent output switching restores linked framing while sharing content and timing', async () => {
  let project = linkFormats(demoProject());
  project = patchLayer(switchFormat(project, 'portrait'), 'headline', { x: 17, y: 13, size: 34 });
  project = switchFormat(project, 'square');
  let saves = 0, confirmations = 0;
  const tools = createTools({ get: () => project, set: value => { project = value; }, save: async () => saves++, audit() {}, requestExport() { confirmations++; } });
  const output = tools.find(tool => tool.name === 'floc_set_output');
  await output.execute({ format: 'portrait', duration: 15, fps: 30 });
  assert.equal(project.format, 'portrait');
  assert.equal(project.duration, 15);
  assert.equal(project.fps, 30);
  assert.deepEqual(['x', 'y', 'size'].map(key => project.layers.find(layer => layer.id === 'headline')[key]), [17, 13, 34]);
  assert(project.layers.every(layer => layer.end === 15));
  await tools.find(tool => tool.name === 'floc_update_layer').execute({ id: 'headline', patch: { text: 'Shared agent title' } });
  await output.execute({ format: 'square' });
  assert.equal(project.layers.find(layer => layer.id === 'headline').text, 'Shared agent title');
  assert.equal(project.layers.find(layer => layer.id === 'headline').size, 48);
  assert.equal(saves, 3);
  assert.equal(confirmations, 0);
  await tools.find(tool => tool.name === 'floc_request_export').execute({});
  assert.equal(confirmations, 1);
});

test('linked placement and text edits retain preview resources but format changes do not', () => {
  const project = linkFormats(demoProject());
  const moved = patchLayer(project, 'headline', { x: 15, size: 56 });
  assert.deepEqual(sceneUpdatePlan(project, moved), { effects: false });
  const typed = patchLayer(moved, 'headline', { text: 'Linked title' });
  assert.deepEqual(sceneUpdatePlan(moved, typed), { effects: false });
  assert.equal(sceneUpdatePlan(typed, switchFormat(typed, 'portrait')), null);
});

test('saved compositions retain all linked corrections and export the active version', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'floc-linked-boundaries-'));
  try {
    let project = linkFormats(demoProject());
    project = patchLayer(switchFormat(project, 'landscape'), 'headline', { x: 12, y: 18, size: 33 });
    const store = createTemplateStore(folder);
    const entry = await store.create({ name: 'Linked recap', tags: [], project });
    const [saved] = await createTemplateStore(folder).list();
    assert.equal(saved.id, entry.id);
    assert.deepEqual(saved.project, validateProject(project));
    assert.equal(switchFormat(saved.project, 'square').layers.find(layer => layer.id === 'headline').size, 48);
    const before = structuredClone(saved.project);
    const output = path.join(folder, 'export');
    await prepareComposition(saved.project, output);
    const input = JSON.parse(await readFile(path.join(output, 'render-input.json'), 'utf8'));
    assert.deepEqual(input.project, before);
    assert.equal(input.project.format, 'landscape');
    const html = await readFile(path.join(output, 'index.html'), 'utf8');
    assert.match(html, /data-width="1920" data-height="1080"/);
    assert.match(html, /left:12%;top:18%/);
    assert.deepEqual(saved.project, before);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
