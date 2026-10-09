import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter, once } from 'node:events';
import { clientAddress, configureHttpServer, requestBody } from '../server/http-boundary.mjs';

const request = ({ headers = {}, remoteAddress = '127.0.0.1' } = {}) => ({ headers, socket: { remoteAddress } });

test('Fly client identity is trusted only in public mode and spoofed forwarding is ignored locally', () => {
  assert.equal(clientAddress(request({ headers: { 'fly-client-ip': '203.0.113.8', 'x-forwarded-for': '198.51.100.5' }, remoteAddress: '127.0.0.1' }), { publicOrigin: null }), '127.0.0.1');
  assert.equal(clientAddress(request({ headers: { 'fly-client-ip': '203.0.113.8' }, remoteAddress: 'fdaa::1' }), { publicOrigin: 'https://studio.example' }), '203.0.113.8');
  assert.equal(clientAddress(request({ headers: { 'fly-client-ip': 'not-an-ip' }, remoteAddress: '::ffff:127.0.0.1' }), { publicOrigin: 'https://studio.example' }), '127.0.0.1');
});

test('request bodies enforce size and inactivity limits and clear their timer', async () => {
  class Body extends EventEmitter {
    constructor(chunks = []) { super(); this.chunks = chunks; }
    destroy(error) { this.error = error; this.emit('error', error); }
    async *[Symbol.asyncIterator]() { if (!this.chunks.length) await new Promise((resolve, reject) => this.once('error', reject)); else yield* this.chunks; }
  }
  const large = new Body([Buffer.from('123456')]);
  await assert.rejects(requestBody(large, 5, { idleTimeoutMs: 20 }), error => error.status === 413);
  const idle = new Body();
  await assert.rejects(requestBody(idle, 10, { idleTimeoutMs: 10 }), error => error.status === 408);
  assert.equal(idle.error.status, 408);
});

test('HTTP server timeout configuration is explicit and overridable', async t => {
  const server = configureHttpServer(http.createServer((req, res) => res.end('ok')), { headersTimeout: 40, requestTimeout: 50, keepAliveTimeout: 60, socketTimeout: 70 });
  t.after(() => server.close()); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  assert.deepEqual([server.headersTimeout, server.requestTimeout, server.keepAliveTimeout, server.timeout], [40, 50, 60, 70]);
});
