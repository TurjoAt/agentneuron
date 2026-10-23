import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmp, put, read, makeApi } from './files-util.js';

async function issuesOf(ctx, rule) {
  return (await ctx.analysis()).issues.filter((i) => i.rule === rule);
}

test('fixes: broken-link repoints, edit-gated, 404 for unknown issue', async () => {
  const r = tmp();
  put(r, 'README.md', '# R\nSee [guide](docs/guid.md)\n');
  put(r, 'docs/guide.md', '# Guide\n');
  const { ctx, api } = await makeApi(r);
  const [iss] = await issuesOf(ctx, 'broken-link');
  assert.ok(iss);
  const f = await api('GET', `/api/fixes?issue=${encodeURIComponent(iss.id)}`);
  assert.equal(f.status, 200);
  assert.ok(f.body.length >= 1);
  assert.equal(f.body[0].id, 'repoint:docs/guide.md');
  assert.equal(f.body[0].edits[0].path, 'README.md');
  assert.equal((await api('GET', '/api/fixes?issue=nope')).status, 404);
  const ro = await makeApi(r, { edit: false });
  assert.equal((await ro.api('POST', '/api/fixes/apply', { issue: iss.id, fix: f.body[0].id })).status, 403);
  const ap = await api('POST', '/api/fixes/apply', { issue: iss.id, fix: f.body[0].id });
  assert.equal(ap.status, 200);
  assert.match(read(r, 'README.md'), /\(docs\/guide\.md\)/);
});

test('fixes: empty-file goes to trash, orphan gets linked from README', async () => {
  const r = tmp();
  put(r, 'README.md', '# R\n\n## Docs\n\n- [a](a.md)\n');
  put(r, 'a.md', '# A\nsome content here\n');
  put(r, 'docs/lonely.md', '# Lonely\nnobody links here\n');
  put(r, 'empty.md', '');
  const { ctx, api } = await makeApi(r);
  const [e] = await issuesOf(ctx, 'empty-file');
  assert.ok(e, "empty-file issue"); {
    const f = (await api('GET', `/api/fixes?issue=${encodeURIComponent(e.id)}`)).body;
    assert.equal(f[0].id, 'trash');
    assert.equal((await api('POST', '/api/fixes/apply', { issue: e.id, fix: 'trash' })).status, 200);
    assert.equal(fs.existsSync(path.join(r, e.path)), false);
    assert.equal((await api('GET', '/api/trash')).body.length, 1);
  }
  const orph = (await issuesOf(ctx, 'orphan')).find((i) => i.path === 'docs/lonely.md');
  assert.ok(orph, "orphan issue"); {
    const f = (await api('GET', `/api/fixes?issue=${encodeURIComponent(orph.id)}`)).body;
    assert.ok(f.length >= 1);
    await api('POST', '/api/fixes/apply', { issue: orph.id, fix: f[0].id });
    assert.match(read(r, 'README.md'), /docs\/lonely\.md/);
  }
});

test('fixes: secret replaced by env reference', async () => {
  const r = tmp();
  put(r, 'CLAUDE.md', '# C\nAPI_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCD\n');
  const { ctx, api } = await makeApi(r);
  const [s] = await issuesOf(ctx, 'secret');
  assert.ok(s, 'secret issue detected');
  const f = (await api('GET', `/api/fixes?issue=${encodeURIComponent(s.id)}`)).body;
  assert.equal(f.length, 1);
  await api('POST', '/api/fixes/apply', { issue: s.id, fix: f[0].id });
  assert.match(read(r, 'CLAUDE.md'), /\$\{API_KEY\}/);
  assert.doesNotMatch(read(r, 'CLAUDE.md'), /sk-ant/);
});
