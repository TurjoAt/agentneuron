import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmp, put, read, makeCtx } from './files-util.js';
import { createRouter } from '../src/server/router.js';
import compilerRoutes from '../src/server/routes/compiler.js';
import { planImport, applyImport, loadRules, generateContext, planCompile } from '../src/compiler/index.js';
import { parseJsonc } from '../src/compiler/generate.js';
import { runMcpServer } from '../src/mcp/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, '../src/cli.js');
const run = (args, cwd) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 30000, cwd });

async function api(root, { edit = true } = {}) {
  const ctx = await makeCtx(root, { edit });
  const router = createRouter();
  await compilerRoutes(router, ctx);
  return async (method, url, body) => {
    const u = new URL(url, 'http://x');
    const route = router.match(method, u.pathname);
    if (!route) throw new Error(`no route ${method} ${u.pathname}`);
    if (!ctx.can(route.level, 'admin')) return { status: 403, body: { error: 'forbidden' } };
    try { return { status: 200, body: await route.fn({ q: u.searchParams, body: body || {}, ctx, role: 'admin' }) }; } catch (e) { return { status: e.status || 500, body: { error: e.message } }; }
  };
}

test('import: sections become rules, identical rules across tools are merged, nothing is overwritten', async () => {
  const root = tmp();
  const shared = '- Use TypeScript strict mode everywhere.\n- Prefer named exports over default exports.';
  put(root, 'AGENTS.md', `# Proj\n\nIntro line.\n\n## Code style\n\n${shared}\n\n## Pull requests\n\n- Keep PRs small and focused.\n`);
  put(root, 'CLAUDE.md', `@AGENTS.md\n\n## Style\n\n${shared}\n\n## Claude only\n\n- Use /review before PRs.\n`);
  put(root, 'GEMINI.md', `## Code style\n\n${shared.replace(/\n/g, '\r\n')}\n`);
  put(root, '.cursor/rules/ts.mdc', '---\ndescription: TS rules\nglobs: src/**/*.ts\nalwaysApply: false\n---\n# TypeScript\n\n- No any.\n');
  put(root, '.github/instructions/api.instructions.md', '---\napplyTo: "src/api/**"\n---\n- Validate input.\n');
  put(root, 'pkg/web/CLAUDE.md', '## Web\n\n- Use Svelte 5 runes.\n');
  put(root, '.agentneuron/rules/existing.md', '---\ntitle: PRs\n---\n- Keep PRs small and focused.\n');
  const ctx = await makeCtx(root);
  const plan = planImport(ctx);
  const by = Object.fromEntries(plan.rules.map((r) => [r.slug, r]));
  assert.deepEqual(Object.keys(by).sort(), ['api', 'claude-only', 'code-style', 'proj', 'ts', 'web']);
  assert.deepEqual(by['code-style'].tools, ['claude', 'codex', 'gemini'], 'identical rule in 3 tools is one rule');
  assert.deepEqual(by.proj.tools, ['claude', 'codex'], 'CLAUDE.md @imports AGENTS.md');
  assert.deepEqual(by.ts.scope, ['src/**/*.ts']);
  assert.match(by.ts.content, /alwaysApply: false/);
  assert.deepEqual(by.api.scope, ['src/api/**']);
  assert.deepEqual(by.web.scope, ['pkg/web/**']);
  assert.ok(plan.skipped.some((s) => s.reason === 'already a source rule'));
  assert.ok(plan.duplicates.length >= 2);
  const r = applyImport(ctx, plan);
  assert.equal(r.created.length, plan.rules.length);
  const { rules, invalid } = loadRules(root, ctx.config);
  assert.deepEqual(invalid, []);
  assert.equal(rules.length, plan.rules.length + 1);
  assert.equal(rules.find((x) => x.slug === 'code-style').body, shared);
  // second import: everything is already a source rule; existing files untouched
  const again = planImport(await makeCtx(root));
  assert.equal(again.rules.length, 0);
  assert.equal(applyImport(ctx, plan).errors.length, plan.rules.length);
  // the imported rules compile back into each tool
  const c = planCompile(await makeCtx(root));
  assert.ok(c.outputs.some((o) => o.path === 'pkg/web/CLAUDE.md'));
});

test('generate: commands, stack, layout and conventions all cite their source; nothing invented', async () => {
  const root = tmp();
  put(root, 'package.json', JSON.stringify({ name: 'demo', description: 'Demo app.', type: 'module', packageManager: 'pnpm@9.0.0', engines: { node: '>=20' },
    workspaces: ['packages/*'], scripts: { dev: 'vite', build: 'vite build', test: 'vitest run', lint: 'eslint .', 'gen:icons': 'node scripts/icons.js', postinstall: 'x' },
    devDependencies: { vitest: '^2.1.0', typescript: '^5.6.0', svelte: '^5.0.0' } }));
  put(root, 'pnpm-lock.yaml', 'lockfileVersion: 9\n');
  put(root, 'tsconfig.json', '{\n  // comment\n  "compilerOptions": { "strict": true, /* x */ "paths": { "a/*": ["b/*"] }, },\n}\n');
  put(root, 'eslint.config.js', 'export default [];\n');
  put(root, '.editorconfig', 'root = true\n\n[*]\nindent_style = space\nindent_size = 2\n\n[*.md]\nindent_size = 4\n');
  put(root, 'src/main.ts', '');
  put(root, 'packages/ui/package.json', JSON.stringify({ name: '@demo/ui', description: 'Shared UI kit' }));
  put(root, 'weird/thing.txt', '');
  put(root, '.github/workflows/ci.yml', 'on: push\n');
  put(root, 'Makefile', 'test:\n\tpnpm test\nrelease:\n\techo\n');
  const g = await generateContext(root, { tool: 'agents' });
  assert.equal(g.path, 'AGENTS.md');
  const c = g.content;
  for (const l of c.split('\n').filter((x) => x.startsWith('- '))) assert.match(l, /<!-- from [^<>]+ -->$/, l);
  assert.match(c, /^# demo\n\nDemo app\. <!-- from package\.json#description -->/);
  assert.match(c, /- Install dependencies: `pnpm install` <!-- from pnpm-lock\.yaml -->/);
  assert.match(c, /- Test: `pnpm test` \(runs `vitest run`\) <!-- from package\.json#scripts\.test -->/);
  assert.match(c, /- `pnpm gen:icons`: runs `node scripts\/icons\.js` <!-- from package\.json#scripts\.gen:icons -->/);
  assert.ok(!c.includes('postinstall'));
  assert.match(c, /- `make test` <!-- from Makefile#test -->/);
  assert.ok(!c.includes('make release'));
  assert.match(c, /- Vitest 2\.1\.0 <!-- from package\.json#devDependencies -->/);
  assert.match(c, /- `packages\/`: Shared UI kit|- `packages\/`: workspace packages/);
  assert.match(c, /- `src\/`: source code \(1 file\) <!-- from directory name src\/ -->/);
  assert.match(c, /- `weird\/` \(1 file\) <!-- from file tree weird\/ -->/);
  assert.match(c, /TypeScript strict mode is on.* <!-- from tsconfig\.json#compilerOptions\.strict -->/);
  assert.match(c, /Lint with ESLint \(config: `eslint\.config\.js`\)/);
  assert.match(c, /- Indent with 2 spaces <!-- from \.editorconfig#\[\*\] -->/);
  assert.match(c, /Monorepo workspaces: `packages\/\*`/);
  assert.match(c, /CI runs `\.github\/workflows\/ci\.yml`/);
  assert.ok(!/Prettier|pytest|composer|cargo|artisan/i.test(c), 'nothing undetected');
  const mdc = await generateContext(root, { tool: 'cursor' });
  assert.match(mdc.content, /^---\ndescription: "Project overview, commands and conventions"\nglobs:\nalwaysApply: true\n---\n\n# demo/);
  await assert.rejects(generateContext(root, { tool: 'nope' }), /unknown tool/);
  assert.deepEqual(parseJsonc('{"a": "//not a comment", /* c */ "b": [1,],}'), { a: '//not a comment', b: [1] });
});

test('generate: shipped examples produce only cited lines', async () => {
  for (const ex of ['claude-code-project', 'multi-tool-project']) {
    const g = await generateContext(path.resolve(here, '../examples', ex));
    const lines = g.content.split('\n').filter((l) => l.startsWith('- '));
    assert.ok(lines.length > 0, ex);
    for (const l of lines) assert.match(l, /<!-- from [^<>]+ -->$/, `${ex}: ${l}`);
    assert.ok(!/## Commands/.test(g.content), `${ex} has no manifest, so no commands`);
  }
});

test('routes: read endpoints, edit-gated writes, slug validation, generate write never clobbers', async () => {
  const root = tmp();
  put(root, '.agentneuron/rules/style.md', '---\ntitle: Style\n---\n- Two spaces.\n');
  const ro = await api(root, { edit: false });
  assert.equal((await ro('GET', '/api/compiler/rules')).body.rules[0].slug, 'style');
  const pv = (await ro('GET', '/api/compiler/preview?tools=claude,cursor')).body;
  assert.deepEqual(pv.outputs.map((o) => `${o.action} ${o.path}`), ['create .cursor/rules/style.mdc', 'create CLAUDE.md']);
  assert.match(pv.outputs[1].content, /- Two spaces\./);
  assert.equal((await ro('GET', '/api/compiler/preview?tools=bogus')).status, 400);
  for (const [m, u] of [['POST', '/api/compiler/compile'], ['POST', '/api/compiler/merge-back'], ['POST', '/api/compiler/import'], ['POST', '/api/compiler/rule'], ['POST', '/api/compiler/generate/write']]) {
    assert.equal((await ro(m, u, {})).status, 403, u);
  }
  assert.ok(!fs.existsSync(path.join(root, 'CLAUDE.md')));

  const rw = await api(root);
  const c = await rw('POST', '/api/compiler/compile', { tools: ['claude'] });
  assert.deepEqual(c.body.written, ['CLAUDE.md']);
  assert.equal((await rw('GET', '/api/compiler/preview?tools=claude')).body.ok, true);
  for (const slug of ['../evil', 'Evil', 'a/b', 'con', '', null]) assert.equal((await rw('POST', '/api/compiler/rule', { slug, content: 'x' })).status, 400, String(slug));
  assert.equal((await rw('POST', '/api/compiler/rule', { slug: 'x', content: '<!-- agentneuron:end source=rules/a.md -->' })).status, 400);
  assert.equal((await rw('POST', '/api/compiler/rule', { slug: 'x', content: '---\nscope: ../**\n---\nb' })).status, 400);
  const created = await rw('POST', '/api/compiler/rule', { slug: 'new-rule', content: '---\ntitle: New\n---\nbody\n' });
  assert.equal(created.body.created, true);
  assert.equal((await rw('POST', '/api/compiler/rule', { slug: 'new-rule', content: 'other' })).status, 409);
  assert.equal((await rw('POST', '/api/compiler/rule', { slug: 'new-rule', content: 'other', baseHash: created.body.hash })).status, 200);
  assert.equal(read(root, '.agentneuron/rules/new-rule.md'), 'other');

  put(root, 'CLAUDE.md', read(root, 'CLAUDE.md').replace('- Two spaces.', '- Four spaces.'));
  const mb = await rw('POST', '/api/compiler/merge-back', { tools: ['claude'] });
  assert.deepEqual(mb.body.merged.map((m) => m.slug), ['style']);
  assert.match(read(root, '.agentneuron/rules/style.md'), /Four spaces/);
  assert.equal((await rw('GET', '/api/compiler/preview?tools=claude')).body.ok, true);

  put(root, 'package.json', JSON.stringify({ name: 'p', scripts: { test: 'node --test' } }));
  const gen = (await rw('GET', '/api/compiler/generate?tool=agents')).body;
  assert.equal(gen.exists, false);
  assert.ok(gen.items.every((i) => i.source));
  assert.equal((await rw('GET', '/api/compiler/generate?tool=../x')).status, 400);
  assert.equal((await rw('POST', '/api/compiler/generate/write', { tool: 'agents' })).body.created, true);
  assert.equal((await rw('POST', '/api/compiler/generate/write', { tool: 'agents' })).status, 409);
  put(root, 'AGENTS.md', 'mine\n');
  assert.equal((await rw('POST', '/api/compiler/generate/write', { tool: 'agents', overwrite: true, baseHash: 'stale' })).status, 409);
  assert.equal(read(root, 'AGENTS.md'), 'mine\n');
});

test('cli: compile --check / --dry-run / rules import / generate', () => {
  const root = tmp();
  put(root, 'AGENTS.md', '# P\n\n## Style\n\n- Use two spaces for indentation.\n');
  let r = run(['rules', 'import', '--dry-run', root]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\+ \.agentneuron\/rules\/style\.md/);
  assert.ok(!fs.existsSync(path.join(root, '.agentneuron/rules')));
  r = run(['rules', 'import', root]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(read(root, '.agentneuron/rules/style.md'), /title: "Style"/);
  r = run(['compile', root, '--check']);
  assert.equal(r.status, 1, 'AGENTS.md has no generated regions yet');
  r = run(['compile', root, '--dry-run', '--tools', 'codex']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /~ AGENTS\.md \(update\)[\s\S]*\+ <!-- agentneuron:begin source=rules\/style\.md/);
  assert.ok(!read(root, 'AGENTS.md').includes('agentneuron:begin'));
  assert.equal(run(['compile', root, '--tools', 'nope']).status, 1);
  r = run(['compile', root]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(run(['compile', root, '--check']).status, 0);
  r = run(['compile', root, '--check', '--json']);
  assert.equal(JSON.parse(r.stdout).ok, true);
  put(root, 'package.json', JSON.stringify({ name: 'cli-demo', scripts: { build: 'tsc' } }));
  r = run(['generate', root, '--tool', 'claude']);
  assert.match(r.stdout, /^# cli-demo/);
  assert.match(r.stdout, /`npm run build` \(runs `tsc`\) <!-- from package\.json#scripts\.build -->/);
  r = run(['generate', root, '--out']);
  assert.equal(r.status, 1, 'AGENTS.md exists: refuses without --force');
  r = run(['generate', root, '--tool', 'gemini', '--out']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(read(root, 'GEMINI.md'), /^# cli-demo/);
  assert.match(run(['help', 'compile']).stdout, /--merge-back/);
});

test('mcp: compile_preview is read-only', async () => {
  const root = tmp();
  put(root, '.agentneuron/rules/a.md', '---\ntitle: A\ntools: cursor\n---\nbody\n');
  const input = new PassThrough(), output = new PassThrough();
  const done = runMcpServer(root, {}, { input, output, noWatch: true });
  let buf = '';
  output.on('data', (d) => { buf += d; });
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'compile_preview', arguments: { diff: true } } })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'compile_preview', arguments: { tools: 'bogus' } } })}\n`);
  input.end();
  await done;
  const [a, b] = buf.trim().split('\n').map((l) => JSON.parse(l)).sort((x, y) => x.id - y.id);
  const data = JSON.parse(a.result.content[0].text);
  assert.deepEqual(data.outputs.map((o) => o.path), ['.cursor/rules/a.mdc']);
  assert.equal(b.result.isError, true);
  assert.ok(!fs.existsSync(path.join(root, '.cursor')));
});
