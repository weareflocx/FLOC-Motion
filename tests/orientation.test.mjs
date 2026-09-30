import test from 'node:test';
import assert from 'node:assert/strict';
import { dragOrientation, wrapDegrees } from '../src/orientation.js';
import { demoProject, validateProject, patchLayer } from '../src/project.js';

test('old projects gain neutral Y orientation without changing X/Z or input', () => {
  const project = demoProject();
  delete project.layers[1].yaw;
  const migrated = validateProject(project);
  assert.equal(migrated.layers[1].yaw, 0);
  assert.equal(project.layers[1].yaw, undefined);
  assert.equal(migrated.layers[1].tilt, project.layers[1].tilt);
  assert.equal(migrated.layers[1].roll, project.layers[1].roll);
  assert.equal(patchLayer(migrated, 'carousel', { yaw: 120, roll: 170 }).layers[1].yaw, 120);
  assert.throws(() => patchLayer(migrated, 'carousel', { yaw: NaN }));
  assert.throws(() => patchLayer(migrated, 'carousel', { yaw: 181 }));
});

test('sphere gestures clamp tilt, wrap Y/Z and do not mutate initial orientation', () => {
  const initial = { tilt: 10, yaw: 170, roll: -175 };
  assert.deepEqual(dragOrientation(initial, 0.2, 1), { tilt: 65, yaw: -154, roll: -175 });
  assert.deepEqual(dragOrientation(initial, 1, 1, -20), { tilt: 10, yaw: 170, roll: 165 });
  assert.deepEqual(initial, { tilt: 10, yaw: 170, roll: -175 });
  assert.equal(wrapDegrees(360), 0);
});
