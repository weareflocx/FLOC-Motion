import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STRENGTH, EASINGS, easeProgress, legacyCurve } from '../src/easing.js';

const N = 4000;
const STRENGTHS = [0, 0.1, 0.25, 0.5, 0.75, 1];
const sample = (id, s) => Array.from({ length: N + 1 }, (_, i) => easeProgress(id, i / N, s));
// Mean speed over the last 0.1 % of the step, in moves per step (linear is 1).
const endSpeed = (id, s) => (1 - easeProgress(id, 1 - 1e-3, s)) / 1e-3;
const near = (actual, expected, epsilon, label) => assert.ok(Math.abs(actual - expected) <= epsilon, `${label}: ${actual} ≠ ${expected} ± ${epsilon}`);
// Turning points that stand more than `visible` of the move away from the target.
function swings(values, visible) {
  let count = 0;
  for (let i = 1; i < values.length - 1; i++) {
    const [a, b, c] = values.slice(i - 1, i + 2);
    if (((b > a && b >= c) || (b < a && b <= c)) && Math.abs(b - 1) > visible) count++;
  }
  return count;
}
const firstArrival = values => values.findIndex(value => value >= 1) / N;

test('every curve starts at 0, lands exactly on 1, is finite and deterministic at every strength', () => {
  assert.deepEqual(EASINGS.map(easing => easing.id), ['linear', 'ease-in-out', 'ease-in', 'ease-out', 'back', 'bounce', 'spring']);
  for (const { id } of EASINGS) for (const s of STRENGTHS) {
    assert.equal(easeProgress(id, 0, s), 0);
    assert.equal(easeProgress(id, 1, s), 1);
    const values = sample(id, s);
    assert.ok(values.every(Number.isFinite), `${id} at ${s}`);
    assert.deepEqual(sample(id, s), values, `${id} at ${s} is deterministic`);
    assert.ok(values.every(value => value >= -1e-12), `${id} at ${s} never moves backwards past the start`);
  }
  // Out-of-range input and strength are clamped; choreography uses the default strength.
  assert.equal(easeProgress('back', 1.4, 0.5), 1);
  assert.equal(easeProgress('back', 0.3, 7), easeProgress('back', 0.3, 1));
  for (const { id } of EASINGS) assert.equal(easeProgress(id, 0.37), easeProgress(id, 0.37, DEFAULT_STRENGTH));
});

test('all curves except Linear and Ease in arrive at rest', () => {
  for (const id of ['back', 'bounce', 'spring']) for (const s of STRENGTHS) assert.ok(Math.abs(endSpeed(id, s)) <= 0.05, `${id} at ${s}: ${endSpeed(id, s)}`);
  // The eases are linear at strength 0 and come to rest once they have a shape.
  for (const id of ['ease-in-out', 'ease-out']) for (const s of [0.25, 0.5, 0.75, 1]) assert.ok(endSpeed(id, s) <= 0.05, `${id} at ${s}`);
  // Ease in ends at full speed by design: power p = 1 + 4s.
  for (const s of STRENGTHS) near(endSpeed('ease-in', s), 1 + 4 * s, 0.01 * (1 + 4 * s), `ease-in end speed at ${s}`);
  near(endSpeed('linear', 0.5), 1, 1e-9, 'linear');
});

test('the eases run from linear (s = 0) through cubic (0.5) to quintic (1), monotonically', () => {
  for (const id of ['linear', 'ease-in-out', 'ease-in', 'ease-out']) for (const t of [0.1, 0.37, 0.5, 0.9]) near(easeProgress(id, t, 0), t, 1e-12, `${id} at s = 0`);
  for (const t of [0.1, 0.37, 0.5, 0.9]) {
    near(easeProgress('ease-in', t, 0.5), t ** 3, 1e-12, 'cubic ease-in');
    near(easeProgress('ease-out', t, 1), 1 - (1 - t) ** 5, 1e-12, 'quintic ease-out');
    near(easeProgress('ease-in-out', t, 0.5) + easeProgress('ease-in-out', 1 - t, 0.5), 1, 1e-12, 'ease-in-out is symmetric');
    near(easeProgress('linear', t, 0.9), t, 0, 'linear has no strength');
  }
  for (const id of ['linear', 'ease-in-out', 'ease-in', 'ease-out']) for (const s of STRENGTHS) {
    const values = sample(id, s);
    assert.ok(values.every((value, i) => i === 0 || value >= values[i - 1]), `${id} at ${s} is monotonic`);
    assert.ok(values.every(value => value <= 1), `${id} at ${s} never passes the target`);
  }
});

test('Back overshoots 25 % × strength once, then settles; at 0 it is a cubic ease-out', () => {
  for (const t of [0.1, 0.5, 0.8]) near(easeProgress('back', t, 0), 1 - (1 - t) ** 3, 1e-9, 'back at s = 0');
  for (const s of STRENGTHS) {
    const values = sample('back', s), peak = values.indexOf(Math.max(...values));
    near(Math.max(...values) - 1, 0.25 * s, 1e-4, `back overshoot at ${s}`);
    // Rises to a single peak, then falls straight back to the target.
    assert.ok(values.every((value, i) => i === 0 || (i <= peak ? value >= values[i - 1] : value <= values[i - 1] + 1e-12)), `back at ${s} is unimodal`);
  }
});

test('Bounce falls onto the target and rebounds with decaying height, never passing it', () => {
  for (const s of STRENGTHS) {
    const values = sample('bounce', s);
    assert.ok(values.every(value => value <= 1), `bounce at ${s} never passes the target`);
    // The fall is a monotonic ease-in that first touches the target at (1 − e) / (1 + e).
    const e = Math.sqrt(0.05 + 0.25 * s), contact = (1 - e) / (1 + e);
    near(easeProgress('bounce', contact, s), 1, 1e-12, `first contact at ${s}`);
    near(easeProgress('bounce', contact / 2, s), 0.25, 1e-12, `quadratic fall at ${s}`);
    // Rebound heights: the lows between contacts.
    const lows = [];
    for (let i = Math.ceil(contact * N) + 1; i < N; i++) if (values[i] < values[i - 1] && values[i] <= values[i + 1]) lows.push(1 - values[i]);
    near(lows[0], 0.05 + 0.25 * s, 0.002, `first rebound at ${s}`);
    assert.ok(lows.every((low, i) => i === 0 || low < lows[i - 1]), `rebounds decay at ${s}`);
    const visible = lows.filter(low => low >= 0.01).length;
    assert.ok(s < 0.5 ? visible >= 1 : visible >= 2 && visible <= 3, `bounce at ${s}: ${visible} visible rebounds`);
  }
});

test('Spring first reaches the target at 35–50 % of the step, swings 5–25 % past it and settles', () => {
  for (const s of STRENGTHS) {
    const values = sample('spring', s);
    const arrival = firstArrival(values);
    assert.ok(arrival >= 0.35 && arrival <= 0.5, `spring at ${s} arrives at ${arrival}`);
    near(Math.max(...values) - 1, 0.05 + 0.2 * s, 0.002, `spring overshoot at ${s}`);
    const visible = swings(values, 0.005);
    assert.ok(visible >= 1 && visible <= 3, `spring at ${s}: ${visible} visible swings`);
    // Released from rest: it starts slowly before it accelerates.
    assert.ok(easeProgress('spring', 0.02, s) < 0.02, `spring at ${s} starts from rest`);
  }
  assert.ok(swings(sample('spring', 1), 0.005) > swings(sample('spring', 0), 0.005), 'more springiness wobbles longer');
});

test('legacy curve names convert to the closest current curve and strength', () => {
  const cases = [
    ['smooth', 0.5, 'ease-in-out', 0.175], ['natural', 1, 'ease-in-out', 0.35], ['slow', 1, 'ease-in-out', 0.5],
    ['ease-in', 0.5, 'ease-in', 0.125], ['ease-out', 1, 'ease-out', 0.25], ['glide', 1, 'ease-out', 0.5], ['vive', 0.5, 'ease-out', 0.5],
    ['back', 0.5, 'back', 0.2], ['bounce', 0.4, 'bounce', 0.4], ['elastic', 0.5, 'spring', 0.5], ['linear', 0.5, 'linear', 0.5],
    ['original', 0.5, 'native', 0.5], ['unknown', 0.3, 'native', 0.3], ['smooth', 0, 'native', 0.5]
  ];
  for (const [name, intensity, curve, strength] of cases) assert.deepEqual(legacyCurve(name, intensity), { curve, intensity: strength }, `${name} at ${intensity}`);
});
