import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, validateProject, patchLayer, reorderLayer, duplicateLayer } from '../src/project.js';
import { stageMarkup } from '../src/scene.js';
import { createTools } from '../src/webmcp.js';

test('legacy layers migrate unlocked and reject invalid lock states without mutation', () => {
  const raw = demoProject(); const p = validateProject(raw);
  assert.ok(p.layers.every(l => l.locked === false)); assert.equal(raw.layers[0].locked, undefined);
  for (const invalid of ['true', 1, null]) {
    const input = demoProject(); input.layers[0].locked = invalid;
    assert.throws(() => validateProject(input), /lock must be a boolean/);
  }
});
test('locked content and timing cannot be patched, but visibility and unlocking remain available', () => {
  const p = patchLayer(demoProject(), 'headline', { locked: true });
  assert.throws(() => patchLayer(p, 'headline', { text: 'accident' }), /Unlock/);
  assert.throws(() => patchLayer(p, 'headline', { start: 1 }), /Unlock/);
  assert.throws(() => patchLayer(p, 'headline', { locked: false, size: 80 }), /Unlock/);
  const hidden = patchLayer(p, 'headline', { visible: false }); assert.equal(hidden.layers.find(l => l.id === 'headline').visible, false);
  const unlocked = patchLayer(p, 'headline', { locked: false });
  assert.equal(patchLayer(unlocked, 'headline', { name: 'Title' }).layers.find(l => l.id === 'headline').name, 'Title');
  assert.equal(stageMarkup(p), stageMarkup(validateProject(demoProject())));
});
test('drag order matches front-to-back list while preserving identities and source', () => {
  const p = validateProject(demoProject());
  const moved = reorderLayer(p, 'headline', 'logo', 'above');
  assert.ok(moved.layers.findIndex(l => l.id === 'headline') > moved.layers.findIndex(l => l.id === 'logo'));
  const back = reorderLayer(moved, 'headline', 'background', 'below'); assert.equal(back.layers[0].id, 'headline');
  assert.equal(p.layers[0].id, 'background'); assert.equal(new Set(back.layers.map(l => l.id)).size, p.layers.length);
  assert.throws(() => reorderLayer(patchLayer(p, 'headline', { locked: true }), 'headline', 'logo'), /Unlock/);
  assert.throws(() => reorderLayer(p, 'missing', 'logo'), /not found/);
});
test('duplication preserves media and timing, inserts above the source, respects singleton and layer limits', () => {
  const p = validateProject(demoProject());
  const copied = duplicateLayer(p, 'headline', 'headline-copy');
  const index = copied.layers.findIndex(l => l.id === 'headline');
  const copy = copied.layers[index + 1]; assert.equal(copy.id, 'headline-copy'); assert.equal(copy.name, 'Headline copy'); assert.equal(copy.text, p.layers[index].text); assert.equal(copy.start, p.layers[index].start);
  assert.equal(p.layers.length, 6); assert.equal(duplicateLayer(p, 'logo', 'logo-copy').layers.find(l => l.id === 'logo-copy').src, p.layers.find(l => l.id === 'logo').src);
  for (const id of ['carousel', 'background', 'music']) assert.throws(() => duplicateLayer(p, id, `${id}-copy`), /Only text and logo/);
  assert.throws(() => duplicateLayer(p, 'headline', 'logo'), /unique/);
  let full = p; for (let i = 0; i < 14; i++) full = duplicateLayer(full, 'headline', `copy-${i}`);
  assert.throws(() => duplicateLayer(full, 'headline', 'over-limit'), /20 layers/);
});
test('agent updates obey the same layer lock', async () => {
  const p = patchLayer(demoProject(), 'carousel', { locked: true });
  const tools = createTools({ get: () => p, change() { throw new Error('Should not mutate'); }, audit() {} });
  await assert.rejects(() => tools.find(t => t.name === 'floc_update_layer').execute({ id: 'carousel', patch: { speed: 20 } }), /Unlock/);
});
