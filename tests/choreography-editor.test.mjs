import test from 'node:test';
import assert from 'node:assert/strict';
import { choreographyPatch } from '../src/editor/choreography-edit.js';
import { updatePlacementPreview } from '../src/editor/placement-preview.js';
import { captureState, evaluateChoreography } from '../src/choreography.js';
import { demoProject, patchLayer, validateProject } from '../src/project.js';

function animatedProject() {
  let project = validateProject(demoProject());
  let layer = project.layers.find(item => item.id === 'headline');
  project = patchLayer(project, layer.id, { choreography: captureState(layer, 0, project.fps, { x: 10, size: 24 }, 'first') });
  layer = project.layers.find(item => item.id === 'headline');
  return patchLayer(project, layer.id, { choreography: captureState(layer, 2, project.fps, { x: 70, size: 96 }, 'last') });
}

test('canvas or inspector edits capture the displayed pose without changing the base layer', () => {
  const project = animatedProject(), layer = project.layers.find(item => item.id === 'headline');
  const edited = choreographyPatch(layer, { x: 50, text: 'Edited' }, 1, project.fps);
  const next = patchLayer(project, layer.id, edited).layers.find(item => item.id === layer.id);
  assert.equal(next.x, layer.x);
  assert.equal(next.size, layer.size);
  assert.equal(next.text, 'Edited');
  assert.equal(next.choreography.length, 3);
  assert.equal(evaluateChoreography(next, 1).x, 50);
  assert.equal(evaluateChoreography(next, 1).size, 60);
  assert.deepEqual(next.choreography[0], layer.choreography[0]);
  assert.deepEqual(next.choreography[2], layer.choreography[1]);
});

test('editing an existing state preserves its ID and transition, and static edits stay static', () => {
  const project = animatedProject(), layer = project.layers.find(item => item.id === 'headline');
  const edited = choreographyPatch(layer, { opacity: 0.25 }, 2, project.fps);
  assert.equal(edited.choreography.length, 2);
  assert.equal(edited.choreography[1].id, 'last');
  assert.equal(edited.choreography[1].easing, layer.choreography[1].easing);
  assert.equal(edited.choreography[1].values.opacity, 0.25);
  assert.deepEqual(choreographyPatch({ ...layer, choreography: [] }, { size: 80 }, 1, project.fps), { size: 80 });
  const direct = { choreography: [], opacity: 0.5 };
  assert.equal(choreographyPatch(layer, direct, 1, project.fps), direct);
});

test('state changes preserve decoded assets and live preview resources', () => {
  const project = animatedProject(), layer = project.layers.find(item => item.id === 'headline');
  const next = patchLayer(project, layer.id, choreographyPatch(layer, { x: 45, opacity: 0.6 }, 1, project.fps));
  let updated;
  const scene = { updateLayers(layers) { updated = layers; } };
  assert.equal(updatePlacementPreview({ project, scene }, next), true);
  assert.equal(updated, next.layers);
  const resourceChange = patchLayer(next, 'carousel', { shader: 'wave' });
  assert.equal(updatePlacementPreview({ project: next, scene }, resourceChange), false);
});
