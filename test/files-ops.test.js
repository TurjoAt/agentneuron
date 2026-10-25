import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmp, put, read, makeApi } from './files-util.js';

test('raw + save: atomic write, history, store update, conflict 409', async () => {
  const r = tmp();
  put(r, 'CLAUDE.md', '# Hi\n');
  const { ctx, api } = await makeApi(r);
  const raw = (await api('GET', '/api/file/raw?path=CLAUDE.md')).body;
  assert.equal(raw.content, '# Hi\n');
  assert.ok(raw.hash);
  const events = [];
  ctx.store.on('event', (e) => events.push(e));
  const ok = await api('POST', '/api/file/save', { path: 'CLAUDE.md', content: '# Hi\nmore\n', baseHash: raw.hash });
  assert.equal(ok.status, 200);
  assert.equal(read(r, 'CLAUDE.md'), '# Hi\nmore\n');
  assert.equal(events.length, 1);
  assert.equal(ctx.store.contents.get('CLAUDE.md'), '# Hi\nmore\n');
  assert.ok(ctx.store.history.list('CLAUDE.md').length >= 2);
  assert.deepEqual(fs.readdirSync(r).filter((f) => f.endsWith('.tmp')), []);
  // stale baseHash
  const c = await api('POST', '/api/file/save', { path: 'CLAUDE.md', content: 'mine', baseHash: raw.hash });
  assert.equal(c.status, 409);
  assert.equal(c.body.conflict, true);
  assert.equal(c.body.current, '# Hi\nmore\n');
  assert.equal(c.body.currentHash, ok.body.hash);
  assert.equal(read(r, 'CLAUDE.md'), '# Hi\nmore\n');
  // missing baseHash on existing file is a conflict too
  assert.equal((await api('POST', '/api/file/save', { path: 'CLAUDE.md', content: 'x' })).status, 409);
});

test('path safety and permission gating', async () => {
  const r = tmp();
  put(r, 'a.md', 'x');
  const outside = tmp();
  put(outside, 'secret.md', 'top secret');
  fs.symlinkSync(outside, path.join(r, 'link'));
  fs.symlinkSync(path.join(outside, 'secret.md'), path.join(r, 'evil.md'));
  const { api } = await makeApi(r);
  for (const p of ['/etc/passwd', '../x.md', 'a/../../x.md', 'a\0.md', 'link/secret.md', 'evil.md', '.agentneuron/board.json', '.git/config']) {
    const res = await api('GET', `/api/file/raw?path=${encodeURIComponent(p)}`);
    assert.ok(res.status >= 400, p);
    const s = await api('POST', '/api/file/save', { path: p, content: 'x', baseHash: 'h' });
    assert.ok(s.status >= 400, p);
  }
  assert.equal(fs.readFileSync(path.join(outside, 'secret.md'), 'utf8'), 'top secret');
  const ro = await makeApi(r, { edit: false });
  assert.equal((await ro.api('POST', '/api/file/save', { path: 'a.md', content: 'y', baseHash: 'z' })).status, 403);
  assert.equal((await ro.api('GET', '/api/file/raw?path=a.md')).status, 200);
});

test('create: plain, no overwrite, template 501 when module missing', async () => {
  const r = tmp();
  put(r, 'exists.md', 'x');
  const { api } = await makeApi(r);
  const c = await api('POST', '/api/file/create', { path: 'docs/new.md', content: '# New\n' });
  assert.equal(c.status, 200);
  assert.equal(read(r, 'docs/new.md'), '# New\n');
  assert.equal((await api('POST', '/api/file/create', { path: 'exists.md', content: 'y' })).status, 409);
  assert.equal(read(r, 'exists.md'), 'x');
  const t = await api('POST', '/api/file/create', { path: 'x.md', template: 'adr', vars: {} });
  assert.ok([200, 404, 501].includes(t.status));
});

test('rename rewrites md links, relative dirs, wiki, @imports, mentions; dryRun', async () => {
  const r = tmp();
  put(r, 'README.md', '# R\nSee [plan](docs/plan.md#goals) and `docs/plan.md` plus docs/plan.md.\nImport @docs/plan.md here. [[plan]] and [[docs/plan]].\n');
  put(r, 'docs/guide.md', '# G\n[up](../README.md) [p](plan.md) [p2](./plan.md "t") ![i](<plan.md>)\n');
  put(r, 'docs/plan.md', '# Plan\n[back](../README.md) [g](guide.md)\n');
  put(r, 'docs/other.md', 'no links here docs/plan.md.bak and xdocs/plan.md\n');
  const { ctx, api } = await makeApi(r);
  const dry = await api('POST', '/api/file/rename', { from: 'docs/plan.md', to: 'plans/roadmap.md', dryRun: true });
  assert.equal(dry.status, 200);
  assert.ok(dry.body.rewritten.length >= 3);
  assert.ok(fs.existsSync(path.join(r, 'docs/plan.md')));
  const res = await api('POST', '/api/file/rename', { from: 'docs/plan.md', to: 'plans/roadmap.md' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(!fs.existsSync(path.join(r, 'docs/plan.md')));
  const readme = read(r, 'README.md');
  assert.match(readme, /\[plan\]\(plans\/roadmap\.md#goals\)/);
  assert.match(readme, /`plans\/roadmap\.md` plus plans\/roadmap\.md\./);
  assert.match(readme, /@plans\/roadmap\.md here/);
  assert.match(readme, /\[\[roadmap\]\] and \[\[plans\/roadmap\]\]/);
  const guide = read(r, 'docs/guide.md');
  assert.match(guide, /\[p\]\(\.\.\/plans\/roadmap\.md\)/);
  assert.match(guide, /\[p2\]\(\.\.\/plans\/roadmap\.md "t"\)/);
  assert.match(guide, /!\[i\]\(<\.\.\/plans\/roadmap\.md>\)/);
  assert.match(guide, /\[up\]\(\.\.\/README\.md\)/);
  const moved = read(r, 'plans/roadmap.md');
  assert.match(moved, /\[back\]\(\.\.\/README\.md\)/);
  assert.match(moved, /\[g\]\(\.\.\/docs\/guide\.md\)/);
  assert.equal(read(r, 'docs/other.md'), 'no links here docs/plan.md.bak and xdocs/plan.md\n');
  assert.ok(ctx.store.files.has('plans/roadmap.md'));
  assert.ok(!ctx.store.files.has('docs/plan.md'));
  // no link broke
  const a = await ctx.analysis();
  assert.equal(a.issues.filter((i) => i.rule === 'broken-link').length, 0);
  // destination exists, same path
  assert.equal((await api('POST', '/api/file/rename', { from: 'README.md', to: 'docs/guide.md' })).status, 409);
  assert.equal((await api('POST', '/api/file/rename', { from: 'README.md', to: '../out.md' })).status, 400);
});

test('rename directory moves everything and rewrites links; rewriteLinks=false leaves text', async () => {
  const r = tmp();
  put(r, 'README.md', '[a](docs/a.md) [b](docs/sub/b.md)\n');
  put(r, 'docs/a.md', '[b](sub/b.md) [r](../README.md)\n');
  put(r, 'docs/sub/b.md', '[a](../a.md)\n');
  const { api } = await makeApi(r);
  const res = await api('POST', '/api/file/rename', { from: 'docs', to: 'guides' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(read(r, 'README.md'), '[a](guides/a.md) [b](guides/sub/b.md)\n');
  assert.equal(read(r, 'guides/a.md'), '[b](sub/b.md) [r](../README.md)\n');
  assert.equal(read(r, 'guides/sub/b.md'), '[a](../a.md)\n');
  const r2 = tmp();
  put(r2, 'README.md', '[a](a.md)\n');
  put(r2, 'a.md', 'x');
  const m = await makeApi(r2);
  await m.api('POST', '/api/file/rename', { from: 'a.md', to: 'b.md', rewriteLinks: false });
  assert.equal(read(r2, 'README.md'), '[a](a.md)\n');
});

test('trash cycle: delete, list, restore, purge (danger gated)', async () => {
  const r = tmp();
  put(r, 'docs/x.md', 'hello');
  const { ctx, api } = await makeApi(r);
  const d = await api('POST', '/api/file/delete', { path: 'docs/x.md' });
  assert.equal(d.status, 200);
  assert.ok(!fs.existsSync(path.join(r, 'docs/x.md')));
  assert.ok(!ctx.store.files.has('docs/x.md'));
  const list = (await api('GET', '/api/trash')).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].path, 'docs/x.md');
  put(r, 'docs/x.md', 'blocker');
  assert.equal((await api('POST', '/api/trash/restore', { id: d.body.id })).status, 409);
  fs.unlinkSync(path.join(r, 'docs/x.md'));
  assert.equal((await api('POST', '/api/trash/restore', { id: d.body.id })).status, 200);
  assert.equal(read(r, 'docs/x.md'), 'hello');
  assert.ok(ctx.store.files.has('docs/x.md'));
  assert.equal((await api('GET', '/api/trash')).body.length, 0);
  const d2 = await api('POST', '/api/file/delete', { path: 'docs/x.md' });
  assert.equal((await api('POST', '/api/trash/purge', { id: d2.body.id })).status, 403); // danger disabled
  assert.equal((await api('POST', '/api/trash/restore', { id: '../..' })).status, 400);
  ctx.config.actions.danger = true;
  assert.equal((await api('POST', '/api/trash/purge', { id: d2.body.id })).status, 200);
  assert.equal((await api('GET', '/api/trash')).body.length, 0);
});

test('replace: literal, regex, case, word, preview vs apply, paths', async () => {
  const r = tmp();
  put(r, 'a.md', 'Foo foo FOO food\nprice $5 (x)\n');
  put(r, 'b.md', 'foo here\n');
  const { api } = await makeApi(r);
  let p = (await api('GET', '/api/replace/preview?q=foo&replace=bar')).body;
  assert.equal(p.length, 2);
  assert.equal(p[0].after, 'bar bar bar bard');
  p = (await api('GET', '/api/replace/preview?q=foo&replace=bar&case=1')).body;
  assert.equal(p.find((x) => x.path === 'a.md').after, 'Foo bar FOO bard');
  p = (await api('GET', '/api/replace/preview?q=foo&replace=bar&word=1&paths=a.md')).body;
  assert.equal(p.length, 1);
  assert.equal(p[0].after, 'bar bar bar food');
  p = (await api('GET', '/api/replace/preview?q=(%5Cw%2B)%20%5C(x%5C)&replace=%24%241%20%241&regex=1')).body;
  assert.equal(p[0].after, 'price $$1 5');
  p = (await api('GET', '/api/replace/preview?q=%245&replace=%24%26%26')).body;
  assert.equal(p[0].after, 'price $&& (x)');
  assert.equal((await api('GET', '/api/replace/preview?q=(&regex=1')).status, 400);
  assert.equal((await api('GET', '/api/replace/preview?q=a*&regex=1')).status, 400);
  const ap = await api('POST', '/api/replace/apply', { q: 'foo', replace: 'bar', paths: ['a.md'] });
  assert.deepEqual(ap.body.changed, [{ path: 'a.md', count: 4 }]);
  assert.equal(read(r, 'a.md'), 'bar bar bar bard\nprice $5 (x)\n');
  assert.equal(read(r, 'b.md'), 'foo here\n');
  assert.equal((await api('POST', '/api/replace/apply', { q: 'x', paths: ['/etc/passwd'] })).status, 400);
});

test('links resolve, backlinks, bookmarks, annotations re-anchor', async () => {
  const r = tmp();
  put(r, 'README.md', '# R\n[g](docs/guide.md)\nline A\nline B\n');
  put(r, 'docs/guide.md', '# G\n');
  put(r, 'docs/plan.md', '# P\n');
  const { ctx, api } = await makeApi(r);
  let res = (await api('GET', '/api/links/resolve?from=docs/plan.md&target=guide.md')).body;
  assert.equal(res.path, 'docs/guide.md');
  res = (await api('GET', '/api/links/resolve?from=README.md&target=docs/guide')).body;
  assert.equal(res.path, 'docs/guide.md');
  res = (await api('GET', '/api/links/resolve?from=README.md&target=docs/gide.md')).body;
  assert.equal(res.path, null);
  assert.ok(res.candidates.includes('docs/guide.md'));
  const bl = (await api('GET', '/api/backlinks?path=docs/guide.md')).body;
  assert.equal(bl.length, 1);
  assert.equal(bl[0].from, 'README.md');

  await api('POST', '/api/bookmarks', { path: 'README.md', label: 'Home' });
  await api('POST', '/api/bookmarks', { path: 'README.md' });
  let b = (await api('GET', '/api/bookmarks')).body;
  assert.equal(b.length, 1);
  assert.equal(b[0].label, 'Home');
  await api('POST', '/api/bookmarks/remove', { path: 'README.md' });
  assert.equal((await api('GET', '/api/bookmarks')).body.length, 0);
  assert.equal((await api('POST', '/api/bookmarks', { path: '../x' })).status, 400);

  const a = (await api('POST', '/api/annotations', { path: 'README.md', line: 4, text: 'check B' })).body;
  assert.equal(a.anchor, 'line B');
  assert.equal(a.author, 'admin');
  // edit the file: insert lines above
  const raw = (await api('GET', '/api/file/raw?path=README.md')).body;
  await api('POST', '/api/file/save', { path: 'README.md', content: '# R\nnew1\nnew2\n[g](docs/guide.md)\nline A\nline B\n', baseHash: raw.hash });
  let list = (await api('GET', '/api/annotations?path=README.md')).body;
  assert.equal(list[0].line, 6);
  assert.ok(!list[0].stale);
  const raw2 = (await api('GET', '/api/file/raw?path=README.md')).body;
  await api('POST', '/api/file/save', { path: 'README.md', content: '# R\n', baseHash: raw2.hash });
  list = (await api('GET', '/api/annotations?path=README.md')).body;
  assert.equal(list[0].stale, true);
  assert.equal((await api('POST', '/api/annotations/resolve', { id: a.id })).body.resolved, true);
  await api('POST', '/api/annotations/remove', { id: a.id });
  assert.equal((await api('GET', '/api/annotations')).body.length, 0);
  assert.equal((await api('POST', '/api/annotations', { path: 'README.md', line: 99, text: 'x' })).status, 400);
  void ctx;
});

test('case-only rename: plain rename on case-sensitive FS, two-step on case-insensitive, 409 for real targets', async () => {
  // case-sensitive (Linux): an ordinary rename, links rewritten
  const r = tmp();
  put(r, 'README.md', 'see [n](notes.md)\n');
  put(r, 'notes.md', 'n\n');
  const { ctx, api } = await makeApi(r);
  const res = await api('POST', '/api/file/rename', { from: 'notes.md', to: 'Notes.md' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(fs.readdirSync(r).includes('Notes.md') && !fs.readdirSync(r).includes('notes.md'));
  assert.equal(read(r, 'README.md'), 'see [n](Notes.md)\n');
  assert.ok(ctx.store.files.has('Notes.md') && !ctx.store.files.has('notes.md'));

  // simulated case-insensitive FS: lstat of a missing name falls back to a case-insensitive match
  const r2 = tmp();
  put(r2, 'README.md', 'see [n](notes.md)\n');
  put(r2, 'notes.md', 'n\n');
  put(r2, 'other.md', 'o\n');
  const m = await makeApi(r2);
  const { lstatSync, renameSync } = fs;
  const renames = [];
  fs.lstatSync = function (p, ...rest) {
    try { return lstatSync.call(this, p, ...rest); } catch (e) {
      const hit = (() => { try { return fs.readdirSync(path.dirname(p)).find((n) => n.toLowerCase() === path.basename(p).toLowerCase()); } catch { return null; } })();
      if (!hit) throw e;
      return lstatSync.call(this, path.join(path.dirname(p), hit), ...rest);
    }
  };
  fs.renameSync = function (a, b) { renames.push([path.basename(a), path.basename(b)]); return renameSync.call(this, a, b); };
  try {
    assert.equal((await m.api('POST', '/api/file/rename', { from: 'notes.md', to: 'other.md' })).status, 409);
    assert.equal((await m.api('POST', '/api/file/rename', { from: 'notes.md', to: 'OTHER.md' })).status, 409); // case alias of a different file
    const ok = await m.api('POST', '/api/file/rename', { from: 'notes.md', to: 'Notes.md' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  } finally { fs.lstatSync = lstatSync; fs.renameSync = renameSync; }
  const moves = renames.filter(([a, b]) => !b.endsWith('.tmp') && !a.endsWith('.tmp'));
  assert.equal(moves.length, 2); // via a temporary name
  assert.match(moves[0][1], /^\.notes\.md\.[0-9a-f]+\.rename$/);
  assert.deepEqual([moves[0][0], moves[1][1]], ['notes.md', 'Notes.md']);
  assert.ok(fs.readdirSync(r2).includes('Notes.md') && !fs.readdirSync(r2).some((n) => n.endsWith('.rename')));
  assert.equal(read(r2, 'README.md'), 'see [n](Notes.md)\n');
  assert.ok(m.ctx.store.files.has('Notes.md') && !m.ctx.store.files.has('notes.md'));

  // two entries that differ only by case (hard links on a case-sensitive FS) are distinct: 409
  const r3 = tmp();
  put(r3, 'a.md', 'x\n');
  if (!fs.existsSync(path.join(r3, 'A.MD'))) { // only possible on a case-sensitive FS
    fs.linkSync(path.join(r3, 'a.md'), path.join(r3, 'A.md'));
    const m3 = await makeApi(r3);
    assert.equal((await m3.api('POST', '/api/file/rename', { from: 'a.md', to: 'A.md' })).status, 409);
  }
});

test('isCaseAlias: only a same-dir, same-entry, case-only difference', async () => {
  const { isCaseAlias } = await import('../src/files/ops.js');
  const r = tmp();
  put(r, 'docs/a.md', 'x');
  const a = path.join(r, 'docs', 'a.md');
  assert.equal(isCaseAlias(a, a), false);
  assert.equal(isCaseAlias(a, path.join(r, 'docs', 'b.md')), false);
  assert.equal(isCaseAlias(a, path.join(r, 'DOCS', 'A.md')), false); // parent dir differs
  // on a case-sensitive FS the other casing doesn't exist; on a case-insensitive one it is the same entry
  assert.equal(isCaseAlias(a, path.join(r, 'docs', 'A.md')), fs.existsSync(path.join(r, 'docs', 'A.md')));
});
