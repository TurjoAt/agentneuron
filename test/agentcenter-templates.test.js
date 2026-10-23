import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listTemplates, renderTemplate } from '../src/agentcenter/templates.js';
import { parseFrontmatter } from '../src/agentcenter/frontmatter.js';

test('at least 14 templates, unique ids, required ones present', () => {
  const l = listTemplates();
  assert.ok(l.length >= 14);
  assert.equal(new Set(l.map((t) => t.id)).size, l.length);
  for (const id of ['claude-md', 'agents-md', 'gemini-md', 'cursor-rule', 'copilot-instructions', 'claude-skill', 'claude-agent', 'claude-command', 'adr', 'plan', 'prd', 'todo', 'decision-log', 'session-handoff', 'readme']) {
    assert.ok(l.find((t) => t.id === id), id);
  }
});

test('every template renders with defaults without leftover placeholders', () => {
  for (const t of listTemplates()) {
    const r = renderTemplate(t.id);
    assert.ok(r.path && !r.path.includes('{{'), t.id);
    assert.ok(r.content.length > 100 && !r.content.includes('{{'), t.id);
    assert.ok(!r.path.startsWith('/') && !r.path.includes('..'));
    assert.ok(Array.isArray(t.vars) && t.description && t.category && t.tool);
  }
});

test('vars are substituted and paths slugged', () => {
  const s = renderTemplate('claude-skill', { name: 'My Cool Skill!', description: 'Does: things. Use when needed.' });
  assert.equal(s.path, '.claude/skills/my-cool-skill/SKILL.md');
  const { data } = parseFrontmatter(s.content);
  assert.equal(data.name, 'my-cool-skill');
  assert.equal(data.description, 'Does: things. Use when needed.');
  const a = renderTemplate('claude-agent', { name: 'sec-audit' });
  const fm = parseFrontmatter(a.content).data;
  assert.equal(fm.name, 'sec-audit');
  assert.ok(fm.description && fm.tools && fm.model);
  const c = renderTemplate('cursor-rule', { name: 'py', globs: '**/*.py', always_apply: 'true' });
  assert.equal(c.path, '.cursor/rules/py.mdc');
  const cf = parseFrontmatter(c.content).data;
  assert.equal(cf.alwaysApply, true);
  assert.equal(cf.globs, '**/*.py');
  assert.equal(renderTemplate('adr', { number: '0007', title: 'Use Redis' }).path, 'docs/adr/0007-use-redis.md');
  assert.equal(renderTemplate('copilot-path-instructions', {}).path, '.github/instructions/frontend.instructions.md');
  assert.match(renderTemplate('claude-md', { project: 'Acme' }).content, /^# Acme/);
  assert.throws(() => renderTemplate('nope'), /Unknown template/);
});
