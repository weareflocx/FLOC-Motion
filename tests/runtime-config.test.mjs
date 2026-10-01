import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeConfig, requestOrigin } from '../server/runtime-config.mjs';

test('local remains the default, including production without public opt-in', () => {
  const c = runtimeConfig({ NODE_ENV: 'production' });
  assert.equal(c.host, '127.0.0.1'); assert.equal(c.port, 4317);
  assert.equal(requestOrigin('localhost:4317', c), 'http://localhost:4317');
  assert.equal(requestOrigin('127.0.0.1:4317', c), 'http://127.0.0.1:4317');
  assert.equal(requestOrigin('floc-motion.fly.dev', c), null);
});
test('public mode binds all interfaces, uses HTTPS origin and rejects unrelated hosts', () => {
  const c = runtimeConfig({ PORT: '8080', FLOC_PUBLIC_ORIGIN: 'https://floc-motion.fly.dev', FLOC_DATA_DIR: '/data' });
  assert.equal(c.host, '0.0.0.0'); assert.equal(c.port, 8080); assert.equal(c.data, '/data');
  assert.equal(requestOrigin('floc-motion.fly.dev', c), 'https://floc-motion.fly.dev');
  for (const host of ['floc-motion.fly.dev.evil.test', 'other.fly.dev', undefined, 'user@floc-motion.fly.dev', 'floc-motion.fly.dev/path']) assert.equal(requestOrigin(host, c), null);
});
test('invalid public origin and ports fail explicitly', () => {
  for (const PORT of ['abc', '-1', '65536', '1.2']) assert.throws(() => runtimeConfig({ PORT }), /PORT/);
  for (const origin of ['ftp://floc-motion.fly.dev', 'https://user:pass@floc-motion.fly.dev', 'https://floc-motion.fly.dev/app', 'https://floc-motion.fly.dev?x=1']) assert.throws(() => runtimeConfig({ FLOC_PUBLIC_ORIGIN: origin }));
});
