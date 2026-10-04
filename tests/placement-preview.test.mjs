import test from 'node:test';
import assert from 'node:assert/strict';
import { updatePlacementPreview } from '../src/editor/placement-preview.js';
import { demoProject, validateProject, patchLayer, fileLayer } from '../src/project.js';

test('moving and resizing video preserves the scene and all media resources', () => {
  const project = demoProject();
  project.layers.push({ id: 'video', type: 'media', src: '/video.mp4', x: 10, y: 20, size: 30 });
  const updates = [];
  const scene = { updateLayers: layers => updates.push(layers) };
  const current = { project, scene };
  const next = structuredClone(project);
  Object.assign(next.layers.at(-1), { x: 40, y: 50, size: 60 });
  assert.equal(updatePlacementPreview(current, next), true);
  assert.equal(current.scene, scene);
  assert.equal(updates[0], next.layers);
  next.layers.at(-1).src = '/replacement.mp4';
  assert.equal(updatePlacementPreview(current, next), false);
  assert.equal(updates.length, 1);
});

test('resource and structural changes still require a rebuilt scene', () => {
  const project = demoProject();
  const current = { project, scene: { updateLayers() { assert.fail('must rebuild'); } } };
  for (const change of [p => p.layers.reverse(), p => p.layers[0].color = '#abcdef', p => p.layers.find(l => l.type === 'carousel').shader = 'wave']) {
    const next = structuredClone(project); change(next);
    assert.equal(updatePlacementPreview(current, next), false);
  }
});

test('content field names preserve the preview while changed content rebuilds it', () => {
  const project = validateProject(demoProject());
  const updates = [];
  const current = { project, scene: { updateLayers: layers => updates.push(layers) } };
  const next = structuredClone(project);
  for (const layer of next.layers) {
    if (['text', 'carousel', 'music'].includes(layer.type)) layer.contentField = `${layer.type} content`;
  }
  assert.equal(updatePlacementPreview(current, next), true);
  assert.equal(updates[0], next.layers);
  current.project = next;
  const renamed = structuredClone(next);
  renamed.layers.find(layer => layer.type === 'text').contentField = 'Weekly title';
  assert.equal(updatePlacementPreview(current, renamed), true);
  const changed = structuredClone(renamed);
  changed.layers.find(layer => layer.type === 'text').text = 'New content';
  assert.equal(updatePlacementPreview(current, changed), false);
});

for (const type of ['text', 'logo', 'media', 'model', 'carousel']) {
  test(`${type} placement edits reuse the current scene with validated values`, () => {
    const input = demoProject();
    if (['media', 'model'].includes(type)) input.layers.push(fileLayer({ name: type, src: type === 'model' ? '/assets/00000000-0000-4000-8000-000000000001.glb' : '/demo/poster-1.svg' }, input.duration, 'added'));
    let project = validateProject(input);
    const id = project.layers.find(l => l.type === type).id;
    let updated;
    const current = { project, scene: { updateLayers(layers) { updated = layers; } } };
    const fields = ['x', 'y', 'size', ...(['model', 'carousel'].includes(type) ? ['tilt', 'yaw', 'roll'] : [])];
    for (const field of fields) {
      const layer = project.layers.find(l => l.id === id);
      const next = patchLayer(project, id, { [field]: layer[field] + (type === 'carousel' && field === 'size' ? 0.1 : 1) });
      assert.equal(updatePlacementPreview(current, next), true, field);
      assert.equal(updated, next.layers);
      current.project = project = next;
    }
  });
}
