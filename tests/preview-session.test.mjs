import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewSession } from '../src/editor/preview-session.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const loading = [], activated = [], disposed = [], errors = [];
  const session = createPreviewSession({
    prepare(project) { return new Promise((resolve, reject) => loading.push({ project, reject, resolve: () => resolve({ project, scene: { dispose() { disposed.push(project); } } }) })); },
    activate(next) { activated.push(next.project); }, onError(error) { errors.push(error.message); }
  });
  return { session, loading, activated, disposed, errors };
}
test('preview keeps the active scene until the newest queued edit is ready', async () => {
  const h = harness(); h.session.request('initial'); h.loading[0].resolve(); await tick();
  h.session.request('first edit'); h.session.request('second edit'); h.session.request('latest edit');
  assert.equal(h.loading.length, 2); assert.equal(h.session.current.project, 'initial');
  h.loading[1].resolve(); await tick();
  assert.equal(h.loading[2].project, 'latest edit'); assert.deepEqual(h.disposed, ['first edit']);
  h.loading[2].resolve(); await tick();
  assert.deepEqual(h.activated, ['initial', 'latest edit']); assert.deepEqual(h.disposed, ['first edit', 'initial']);
  h.session.dispose(); assert.deepEqual(h.disposed, ['first edit', 'initial', 'latest edit']);
});
test('failed replacements preserve the previous preview and report the error', async () => {
  const h = harness(); h.session.request('initial'); h.loading[0].resolve(); await tick();
  h.session.request('broken'); h.loading[1].reject(new Error('decode failed')); await tick();
  assert.equal(h.session.current.project, 'initial'); assert.deepEqual(h.errors, ['decode failed']);
  h.session.dispose();
});
test('unmount disposes in-flight scenes without activating them', async () => {
  const h = harness(); h.session.request('initial'); h.session.dispose(); h.loading[0].resolve(); await tick();
  assert.deepEqual(h.activated, []); assert.deepEqual(h.disposed, ['initial']);
});
