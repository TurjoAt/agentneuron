import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { startServer, networkUrls } from '../src/server/app.js';
import { loadConfig } from '../src/core/config.js';

const project = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-port-')); fs.writeFileSync(path.join(d, 'CLAUDE.md'), '# P\n'); return d; };
const occupy = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => resolve(s)); });

test('a busy port moves to the next free one, strictPort fails instead', async () => {
  const blocker = await occupy();
  const busy = blocker.address().port;
  const root = project();
  try {
    const srv = await startServer(loadConfig(root, { port: busy }));
    try {
      assert.notEqual(srv.port, busy);
      assert.equal(srv.requestedPort, busy);
      assert.ok(srv.ctx.url.endsWith(`:${srv.port}/`));
    } finally { await srv.close(); }
    await assert.rejects(startServer(loadConfig(root, { port: busy, strictPort: true })), { code: 'EADDRINUSE' });
  } finally { blocker.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('networkUrls lists real interfaces for 0.0.0.0 only', () => {
  const ifaces = {
    lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    eth0: [{ family: 'IPv4', address: '203.0.113.7', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }, { family: 'IPv6', address: '2001:db8::5', internal: false }],
    docker0: [{ family: 'IPv4', address: '172.17.0.1', internal: false }],
    'br-abc': [{ family: 4, address: '172.18.0.1', internal: false }],
  };
  assert.deepEqual(networkUrls('0.0.0.0', 4747, ifaces), ['http://203.0.113.7:4747/']);
  assert.deepEqual(networkUrls('::', 4747, ifaces), ['http://203.0.113.7:4747/', 'http://[2001:db8::5]:4747/']);
  assert.deepEqual(networkUrls('127.0.0.1', 4747, ifaces), []);
});
