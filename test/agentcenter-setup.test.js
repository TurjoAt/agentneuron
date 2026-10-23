import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanAgentSetup, rulesForFile, splitGlobs } from '../src/agentcenter/setup.js';
import { parseFrontmatter } from '../src/agentcenter/frontmatter.js';

function mk(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-ac-'));
  for (const [p, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    fs.writeFileSync(path.join(root, p), c);
  }
  return root;
}

const FIX = {
  'CLAUDE.md': '# Root\n',
  'packages/web/CLAUDE.md': '# Web\n',
  '.claude/agents/reviewer.md': '---\nname: reviewer\ndescription: "Reviews code: carefully"\ntools: Read, Grep\nmodel: sonnet\n---\nBody',
  '.claude/skills/pdf/SKILL.md': '---\nname: pdf\ndescription: Make PDFs\n---\n# x',
  '.claude/skills/pdf/scripts/run.py': 'print(1)',
  '.claude/commands/ship/deploy.md': '---\ndescription: Deploy it\nargument-hint: [env]\n---\nGo',
  '.claude/rules/api.md': '---\npaths: src/api/**/*.ts\n---\nrule',
  '.claude/settings.json': JSON.stringify({ permissions: { allow: ['Bash(npm test)'], deny: ['Read(.env)'] }, hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'echo hi' }] }] } }),
  '.mcp.json': JSON.stringify({ mcpServers: { fs: { command: 'npx', args: ['-y', 'srv'], env: { TOKEN: 'sk-supersecretvalue1234567890' } } } }),
  'AGENTS.md': '# Agents\n',
  '.cursorrules': 'legacy',
  '.cursor/rules/ts.mdc': '---\ndescription: TS style\nglobs: **/*.ts,**/*.tsx\nalwaysApply: false\n---\nx',
  '.cursor/rules/all.mdc': '---\ndescription: Always\nalwaysApply: true\n---\nx',
  '.cursor/rules/ask.mdc': '---\ndescription: Use when writing SQL\nalwaysApply: false\n---\nx',
  '.cursor/mcp.json': JSON.stringify({ mcpServers: { a: { url: 'https://x.test/mcp' } } }),
  '.cursorignore': 'dist\n# c\nsecrets/\n',
  '.github/copilot-instructions.md': '# c',
  '.github/instructions/fe.instructions.md': '---\napplyTo: "**/*.tsx,**/*.css"\n---\nx',
  '.windsurf/rules/w.md': '---\ntrigger: always_on\n---\nx',
  'GEMINI.md': 'g',
  '.clinerules/a.md': 'x',
  '.roomodes': JSON.stringify({ customModes: [{ slug: 'docs', name: 'Docs', roleDefinition: 'writes docs' }] }),
  'CONVENTIONS.md': 'c', '.aider.conf.yml': 'read: CONVENTIONS.md',
  '.continue/rules/r.md': '---\nglobs: "**/*.py"\n---\nx',
  '.rules': 'zed', '.junie/guidelines.md': 'j',
  '.amazonq/rules/q.md': 'q',
  '.vscode/mcp.json': JSON.stringify({ servers: { v: { command: 'node' } } }),
  'node_modules/x/CLAUDE.md': 'ignored',
};

test('frontmatter parser handles lists, quotes, booleans', () => {
  const { data } = parseFrontmatter('---\na: "x: y"\nb: [one, "two"]\nc: true\nd:\n  - p\n  - q\n---\nbody');
  assert.equal(data.a, 'x: y');
  assert.deepEqual(data.b, ['one', 'two']);
  assert.equal(data.c, true);
  assert.deepEqual(data.d, ['p', 'q']);
});

test('splitGlobs keeps braces intact', () => {
  assert.deepEqual(splitGlobs('**/*.{ts,tsx}, src/**'), ['**/*.{ts,tsx}', 'src/**']);
});

test('scanAgentSetup detects all tools and capabilities', () => {
  const root = mk(FIX);
  const s = scanAgentSetup(root, { includeGlobal: false });
  const t = Object.fromEntries(s.tools.map((x) => [x.id, x]));
  assert.equal(s.tools.length, 13);
  for (const id of ['claude', 'codex', 'cursor', 'copilot', 'windsurf', 'gemini', 'cline', 'roo', 'aider', 'continue', 'zed', 'junie', 'amazonq']) assert.ok(t[id].detected, id);
  const c = t.claude.capabilities;
  assert.equal(c.instructions.count, 2); // node_modules ignored
  assert.equal(c.agents.items[0].name, 'reviewer');
  assert.equal(c.agents.items[0].description, 'Reviews code: carefully');
  assert.deepEqual(c.agents.items[0].tools, ['Read', 'Grep']);
  assert.equal(c.agents.items[0].model, 'sonnet');
  assert.equal(c.skills.items[0].name, 'pdf');
  assert.ok(c.skills.items[0].files.includes('.claude/skills/pdf/scripts/run.py'));
  assert.equal(c.commands.items[0].name, 'ship:deploy');
  assert.equal(c.commands.items[0].argumentHint, '[env]');
  assert.equal(c.permissions.count, 2);
  assert.equal(c.hooks.count, 1);
  assert.equal(c.mcp.count, 1);
  assert.equal(c.rules.count, 1);
  const cur = t.cursor.capabilities;
  assert.equal(cur.rules.count, 3);
  assert.equal(cur.mcp.count, 1);
  assert.equal(cur.ignore.items[0].patterns, 2);
  assert.equal(t.roo.capabilities.agents.items[0].name, 'docs');
  assert.equal(t.copilot.capabilities.mcp.items[0].name, 'v');
  assert.equal(t.copilot.capabilities.rules.items[0].globs.length, 2);
  assert.ok(s.totals.toolsDetected >= 13);
  // env values never exposed
  assert.ok(!JSON.stringify(s).includes('supersecret'));
});

test('includeGlobal reads ~/.claude', () => {
  const home = mk({ '.claude/CLAUDE.md': 'g', '.claude/settings.json': JSON.stringify({ permissions: { allow: ['Read'] } }), '.claude/projects/x/y.md': 'skip' });
  const root = mk({ 'README.md': 'x' });
  const s = scanAgentSetup(root, { home, includeGlobal: true });
  const cl = s.tools.find((x) => x.id === 'claude');
  assert.ok(cl.files.some((f) => f.scope === 'global' && f.path === '~/.claude/CLAUDE.md'));
  assert.equal(cl.capabilities.permissions.count, 1);
  const s2 = scanAgentSetup(root, { home, includeGlobal: false });
  assert.equal(s2.tools.find((x) => x.id === 'claude').detected, false);
});

test('rulesForFile resolves hierarchy, globs, always and description', () => {
  const root = mk(FIX);
  const setup = scanAgentSetup(root);
  const r = rulesForFile(root, 'packages/web/src/app.tsx', setup);
  const has = (tool, p, reason) => r.some((x) => x.tool === tool && x.path === p && x.reason === reason);
  assert.ok(has('claude', 'CLAUDE.md', 'always'));
  assert.ok(has('claude', 'packages/web/CLAUDE.md', 'hierarchy'));
  assert.ok(has('cursor', '.cursor/rules/ts.mdc', 'glob'));
  assert.ok(has('cursor', '.cursor/rules/all.mdc', 'always'));
  assert.ok(has('cursor', '.cursor/rules/ask.mdc', 'description'));
  assert.ok(has('copilot', '.github/instructions/fe.instructions.md', 'glob'));
  assert.ok(has('windsurf', '.windsurf/rules/w.md', 'always'));
  assert.ok(!r.some((x) => x.path === '.claude/rules/api.md'));
  assert.ok(!r.some((x) => x.path === '.continue/rules/r.md'));
  const r2 = rulesForFile(root, 'src/api/users.ts', setup);
  assert.ok(r2.some((x) => x.path === '.claude/rules/api.md' && x.reason === 'glob'));
  assert.ok(r2.some((x) => x.path === '.cursor/rules/ts.mdc' && x.glob === '**/*.ts'));
  assert.ok(!r2.some((x) => x.path === 'packages/web/CLAUDE.md'));
  assert.deepEqual(rulesForFile(root, '../etc/passwd', setup), []);
});
