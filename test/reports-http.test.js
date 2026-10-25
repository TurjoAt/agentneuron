import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/core/config.js';
import { startServer } from '../src/server/app.js';

const TOKEN = 'rep-view-token';
const SECRET = 'sk-ant-' + 'Zx8cVb1nM0Qw3rTy7uIo9pAs2dFg4hJk6l';
let root, srv, base;

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-rexp-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'Weird Name/../x' }));
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), `# P\n\nkey: ${SECRET}\n- [ ] one\n`);
  srv = await startServer(loadConfig(root, { port: 0, token: TOKEN }));
  base = `http://127.0.0.1:${srv.port}`;
});
after(async () => {
  await srv.close();
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
  catch (e) { if (process.platform !== 'win32' || !['EBUSY', 'EPERM'].includes(e.code)) throw e; }
});

const get = (q) => fetch(`${base}/api/reports/export?${q}`, { headers: { authorization: `Bearer ${TOKEN}` } });

test('GET /api/reports/export: formats, headers, masking', async () => {
  const want = { csv: ['text/csv', 'csv'], md: ['text/markdown', 'md'], html: ['text/html', 'html'], json: ['application/json', 'json'], ai: ['text/markdown', 'ai.md'], llm: ['text/markdown', 'ai.md'] };
  for (const [f, [type, ext]] of Object.entries(want)) {
    const r = await get(`format=${f}&include=content`);
    assert.equal(r.status, 200, f);
    assert.ok(r.headers.get('content-type').startsWith(type), `${f}: ${r.headers.get('content-type')}`);
    const cd = r.headers.get('content-disposition');
    assert.match(cd, new RegExp(`^attachment; filename="agentneuron-report-[a-z0-9._-]+-\\d{4}-\\d\\d-\\d\\d_\\d{4}-\\d\\d-\\d\\d\\.${ext.replace('.', '\\.')}"$`), cd);
    assert.ok(!/[/\\"]/.test(cd.slice(cd.indexOf('"') + 1, -1)), cd);
    const body = await r.text();
    assert.ok(!body.includes(SECRET), `${f} leaked secret`);
    assert.ok(!body.includes(root), `${f} leaked root`);
    if (f === 'json') assert.equal(JSON.parse(body).schema, 'agentneuron.report/v1');
    if (f === 'ai') { assert.match(body, /^---\nschema: "agentneuron\.report\/v1"/); assert.match(body, /### CLAUDE\.md/); }
  }
  assert.equal((await get('format=pdf')).status, 400);
  assert.equal((await fetch(`${base}/api/reports/export?format=json`)).status, 401);
});
