import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, validateProject } from '../src/project.js';
import { executablePath, openGoldenSession, PARITY_TOLERANCE } from '../scripts/golden-frames.mjs';

// Each text moves in its own band so frame pixels can be attributed by row.
const text = (id, y, entry, values = {}) => ({ id, type: 'text', name: id, visible: true, locked: false, start: 0, end: 4, space: 'flat', text: id.toUpperCase(), x: 8, y, size: 72, width: 70,
  color: '#ffffff', font: 'druk-wide', weight: 900, fadeIn: 0, fadeOut: 0, roll: 0, entry: { direction: 'up', amount: 6, duration: 1.2, character: 'smooth', ...entry }, ...values });
function project(layers) {
  const base = validateProject(demoProject());
  return validateProject({ ...base, name: 'Text motion', duration: 4, layout: { ...base.layout, enabled: false }, layers: [{ ...base.layers[0], start: 0, end: 4, color: '#000000' }, ...layers] });
}
const fixtures = () => [
  { id: 'text-entries', times: [0, .5, 1.5], project: project([
    text('rise', 4, { motion: 'rise', character: 'weighted', duration: 1 }, { fadeIn: 1 }),
    text('slide', 22, { motion: 'slide', direction: 'right', amount: 12, character: 'elastic' }, { fadeIn: .6 }),
    text('reveal', 40, { motion: 'reveal', direction: 'up', amount: 8 }),
    text('turned', 58, { motion: 'reveal', direction: 'right', amount: 10 }, { roll: 12 }),
    text('scale', 76, { motion: 'scale', amount: 40, character: 'precise' }, { fadeIn: .6 })]) },
  { id: 'text-exits', times: [2.4, 3.2, 3.6], project: project([
    { ...text('mirror', 10, { motion: 'reveal', direction: 'left', amount: 10 }), exit: { mirror: true, duration: 1.5 } },
    { ...text('leave', 50, { motion: 'none' }), fadeOut: .8, exit: { mirror: false, motion: 'slide', direction: 'up', amount: 10, duration: 1.5, character: 'weighted' } }]) }
];

test('text entry and exit movement match between preview and the real export, frame by frame', { skip: !executablePath && 'Chrome is required', timeout: 240000 }, async t => {
  const session = await openGoldenSession({ lanes: 1 }); t.after(() => session.close());
  const frames = await session.captureAll(fixtures());
  for (const [id, samples] of Object.entries(frames)) for (const sample of samples) {
    const comparison = await session.compare(sample.preview, sample.exported, PARITY_TOLERANCE);
    assert.ok(comparison.ok, `${id} ${sample.time}: ${comparison.summary}`);
  }
  // Movement is visible: frames during entry and exit differ from the resting frame.
  for (const [id, [first, , rest]] of Object.entries({ 'text-entries': frames['text-entries'], 'text-exits': [frames['text-exits'][2], null, frames['text-exits'][0]] })) {
    const moved = await session.compare(first.exported, rest.exported, { channel: 32, ratio: 0 });
    assert.ok(moved.ratio > .01, `${id} moves: ${moved.summary}`);
  }
});
