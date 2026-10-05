import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, fileLayer, patchLayer, validateProject, linkFormats, switchFormat } from '../src/project.js';
import { captureState, evaluateChoreography } from '../src/choreography.js';

test('every visual layer accepts rotation, with bounds and lock enforcement', () => {
  let project = demoProject();
  project.layers.push(fileLayer({ name: 'Image', src: '/demo/poster-1.svg' }, 12, 'image'));
  project.layers.push(fileLayer({ name: 'Model', src: '/assets/00000000-0000-4000-8000-000000000001.glb' }, 12, 'model'));
  project = validateProject(project);
  for (const layer of project.layers.filter(l => l.type !== 'music')) {
    const rotated = patchLayer(project, layer.id, { roll: 45 });
    assert.equal(rotated.layers.find(l => l.id === layer.id).roll, 45);
    for (const roll of [NaN, Infinity, -181, 181, '45']) assert.throws(() => patchLayer(project, layer.id, { roll }));
    assert.throws(() => patchLayer(patchLayer(project, layer.id, { locked: true }), layer.id, { roll: 45 }), /Unlock/);
  }
  assert.throws(() => patchLayer(project, 'music', { roll: 45 }), /Unknown layer property/);
});

test('legacy states acquire neutral rotation and rotation seeks deterministically', () => {
  const input = demoProject(), layer = input.layers.find(l => l.id === 'headline');
  layer.choreography = [
    { id: 'a', time: 0, easing: 'linear', values: { x: 10, y: 10, size: 48, opacity: 1 } },
    { id: 'b', time: 4, easing: 'linear', values: { x: 30, y: 30, size: 48, opacity: 1 } }
  ];
  const project = validateProject(input), normalized = project.layers.find(l => l.id === 'headline');
  assert.equal(normalized.roll, 0);
  assert(normalized.choreography.every(state => state.values.roll === 0));
  assert.equal(layer.choreography[0].values.roll, undefined);
  const animated = { ...normalized, choreography: captureState(normalized, 4, 24, { roll: 90 }) };
  assert.equal(evaluateChoreography(animated, 2).roll, 45);
  assert.equal(evaluateChoreography(animated, 0).roll, 0);
  assert.equal(evaluateChoreography(animated, 4).roll, 90);
  assert.equal(evaluateChoreography(animated, 2).roll, 45);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
});

test('rotation and background placement remain local to linked formats', () => {
  let project = linkFormats(validateProject(demoProject()));
  project = switchFormat(project, 'portrait');
  project = patchLayer(project, 'headline', { roll: -30 });
  project = patchLayer(project, 'background', { x: -10, y: 15, roll: 25 });
  const square = switchFormat(project, 'square');
  assert.equal(square.layers.find(l => l.id === 'headline').roll, 0);
  assert.equal(square.layers.find(l => l.id === 'background').x, 0);
  const portrait = switchFormat(square, 'portrait');
  assert.equal(portrait.layers.find(l => l.id === 'headline').roll, -30);
  assert.equal(portrait.layers.find(l => l.id === 'background').x, -10);
  assert.equal(portrait.layers.find(l => l.id === 'background').roll, 25);
});
