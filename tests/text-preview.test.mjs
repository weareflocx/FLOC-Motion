import test from 'node:test';
import assert from 'node:assert/strict';
import { updateTextPreview } from '../src/editor/text-preview.js';
import { demoProject } from '../src/project.js';

test('typing updates only text nodes and preserves media nodes', () => {
  const project = demoProject();
  const layer = project.layers.find(layer => layer.type === 'text');
  const node = { dataset: { flocLayer: layer.id }, textContent: layer.text };
  const canvas = { dataset: { flocLayer: 'carousel' } };
  let refreshedLayers;
  const current = { project, scene: { updateLayers(layers) { refreshedLayers = layers; } }, node: { querySelectorAll: () => [node, canvas] } };
  const next = structuredClone(project);
  next.layers.find(item => item.id === layer.id).text = '<b>New text</b>\nSecond line';
  assert.equal(updateTextPreview(current, next), true);
  assert.equal(node.textContent, '<b>New text</b>\nSecond line');
  assert.equal(refreshedLayers, next.layers);
  assert.deepEqual(canvas, { dataset: { flocLayer: 'carousel' } });
  next.layers.find(item => item.id === layer.id).size += 1;
  assert.equal(updateTextPreview(current, next), false);
});
