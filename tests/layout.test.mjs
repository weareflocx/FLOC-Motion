import test from 'node:test';
import assert from 'node:assert/strict';
import { alignmentPlacement, constrainPlacement, DEFAULT_LAYOUT, fitsSafeArea, safeArea, spacingGuides } from '../src/layout.js';
import { demoProject, patchLayer, validateProject } from '../src/project.js';
import { nudgePlacement } from '../src/editor-controls.js';

const layout = { ...DEFAULT_LAYOUT, enabled: true, marginX: 8, marginY: 10 };

test('legacy compositions retain their positions and do not enable margins on load', () => {
  const raw = demoProject(); delete raw.layout;
  const before = structuredClone(raw), p = validateProject(raw);
  assert.deepEqual(p.layers.map(l => [l.x, l.y]), before.layers.map(l => [l.x ?? (l.type === 'background' ? 0 : undefined), l.y ?? (l.type === 'background' ? 0 : undefined)]));
  assert.deepEqual(p.layout, DEFAULT_LAYOUT);
  assert.deepEqual(raw, before);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))), p);
});

test('layout settings reject malformed input and round-trip through layer edits', () => {
  for (const invalid of [null, [], {}, { ...layout, enabled: 1 }, { ...layout, guides: 'yes' }, { ...layout, marginX: -1 }, { ...layout, marginY: 26 }, { ...layout, marginX: NaN }, { ...layout, code: 'invalid' }]) {
    assert.throws(() => validateProject({ ...demoProject(), layout: invalid }));
  }
  const p = validateProject({ ...demoProject(), layout });
  assert.deepEqual(patchLayer(p, 'logo', { size: 12 }).layout, layout);
  assert.deepEqual(p.layers.find(l => l.type === 'carousel'), validateProject(demoProject()).layers.find(l => l.type === 'carousel'));
});

test('safe margins contain the whole element and preserve subpixel movement', () => {
  assert.deepEqual(safeArea(layout), { x: 8, y: 10, width: 84, height: 80 });
  assert.deepEqual(constrainPlacement(-20, 95, 20, 30, layout), { x: 8, y: 60 });
  assert.deepEqual(constrainPlacement(95, -20, 20, 30, layout), { x: 72, y: 10 });
  assert.deepEqual(constrainPlacement(23.456789, 40.123456, 20, 30, layout), { x: 23.456789, y: 40.123456 });
  assert.equal(fitsSafeArea({ width: 84, height: 80 }, layout), true);
  assert.equal(fitsSafeArea({ width: 85, height: 80 }, layout), false);
  assert.equal(fitsSafeArea({ width: 20, height: 81 }, layout), false);
  assert.deepEqual(constrainPlacement(0, 95, 20, 30, DEFAULT_LAYOUT), { x: 0, y: 70 });
  assert.deepEqual(nudgePlacement({ x: 8, y: 60 }, -1, 1, [1920, 1080], { width: 20, height: 30 }, 10, layout), { x: 8, y: 60 });
});

test('smart alignment snaps only nearby edges and centers, without escaping margins', () => {
  const bounds = { width: 20, height: 10 }, tolerance = { x: .5, y: .5 };
  const center = alignmentPlacement({ x: 39.8, y: 44.7 }, bounds, [], layout, tolerance);
  assert.deepEqual([center.x, center.y], [40, 45]);
  assert.deepEqual(center.guides, [{ axis: 'x', value: 50 }, { axis: 'y', value: 50 }]);
  const custom = alignmentPlacement({ x: 23.1, y: 31.2 }, bounds, [], layout, tolerance);
  assert.deepEqual(custom, { x: 23.1, y: 31.2, guides: [] });
  const aligned = alignmentPlacement({ x: 30.2, y: 31.2 }, bounds, [{ x: 30, y: 70, width: 15, height: 10 }], layout, tolerance);
  assert.equal(aligned.x, 30);
  const edge = alignmentPlacement({ x: 71.8, y: 20 }, bounds, [], layout, tolerance);
  assert.equal(edge.x, 72);
  assert(edge.x + bounds.width <= 92);
});

test('spacing guides measure nearest neighbors on the same axis and ignore overlaps', () => {
  const rect = { x: 40, y: 40, width: 10, height: 10 };
  const gaps = spacingGuides(rect, [{ x: 20, y: 42, width: 10, height: 5 }, { x: 60, y: 45, width: 10, height: 5 }, { x: 35, y: 39, width: 10, height: 10 }, { x: 52, y: 70, width: 5, height: 5 }], layout);
  assert.deepEqual(gaps.filter(g => g.axis === 'x').map(g => [g.start, g.end]), [[30, 40], [50, 60]]);
  assert.deepEqual(gaps.filter(g => g.axis === 'y').map(g => [g.start, g.end]), [[10, 40], [50, 90]]);
});
