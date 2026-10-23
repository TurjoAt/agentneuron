// Templates for AI-context files. Stable API (used by S4 file.create and the UI gallery):
//   listTemplates() -> [{ id, name, category, tool, defaultPath, description, vars: [{ name, label, default }] }]
//   renderTemplate(id, vars) -> { path, content }
// Placeholders: {{var}}, {{var|q}} (YAML-safe scalar), {{var|slug}}. Content is plain text, no I/O.

const today = () => new Date().toISOString().slice(0, 10);

export function slugify(s) {
  return String(s ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'untitled';
}

function yamlScalar(v) {
  const s = String(v ?? '').replace(/\r?\n/g, ' ').trim();
  if (s === '') return '""';
  if (/^[A-Za-z0-9_./ ,()-]+$/.test(s) && !/^(true|false|null|yes|no|on|off|~|\d.*)$/i.test(s) && !/^[-?]/.test(s)) return s;
  return JSON.stringify(s);
}

const V = (name, label, def = '') => ({ name, label, default: def });
const PROJECT = V('project', 'Project name', 'my-project');
const DESC = V('description', 'One-line description', 'What this project does and who it is for.');

const T = [];
const add = (t) => T.push(t);

add({
  id: 'claude-md', name: 'CLAUDE.md', category: 'instructions', tool: 'claude', defaultPath: 'CLAUDE.md',
  description: 'Project memory for Claude Code: commands, architecture, conventions, guardrails. Keep it short; link out with @imports.',
  vars: [PROJECT, DESC, V('install_cmd', 'Install command', 'npm install'), V('dev_cmd', 'Dev command', 'npm run dev'),
    V('test_cmd', 'Test command', 'npm test'), V('lint_cmd', 'Lint command', 'npm run lint'), V('build_cmd', 'Build command', 'npm run build')],
  body: `# {{project}}

{{description}}

## Commands
- Install: \`{{install_cmd}}\`
- Dev server: \`{{dev_cmd}}\`
- Test: \`{{test_cmd}}\` (run a single test while iterating, the full suite before finishing)
- Lint / typecheck: \`{{lint_cmd}}\`
- Build: \`{{build_cmd}}\`

## Architecture
- Describe the 3-5 top-level directories and what lives in each.
- Name the entry points and the main data flow in one short paragraph.
- Link deeper docs instead of pasting them: @docs/architecture.md

## Conventions
- Follow the existing style of the surrounding code; do not reformat unrelated lines.
- Prefer small, focused changes with tests that fail before and pass after.
- Public behaviour changes need a note in the changelog / docs.

## Workflow
- Read the relevant files before editing; search before creating a new helper.
- Run the test and lint commands above before declaring a task done.
- Ask before: adding dependencies, changing schemas or migrations, deleting files.

## Never
- Commit secrets, \`.env\` files or credentials; use environment variables.
- Edit generated files or vendored code.
- Force-push or rewrite shared git history.

## Gotchas
- (Add the things that surprised you: flaky tests, required env vars, slow commands.)
`,
});

add({
  id: 'agents-md', name: 'AGENTS.md', category: 'instructions', tool: 'codex', defaultPath: 'AGENTS.md',
  description: 'Cross-tool agent instructions read by Codex, Cursor, Copilot, Jules, Zed, Aider and others (agents.md convention).',
  vars: [PROJECT, DESC, V('setup_cmd', 'Setup command', 'npm install'), V('test_cmd', 'Test command', 'npm test'), V('lint_cmd', 'Lint command', 'npm run lint')],
  body: `# AGENTS.md

{{description}}

## Setup
- \`{{setup_cmd}}\`

## Build, test, lint
- Test: \`{{test_cmd}}\`
- Lint / format: \`{{lint_cmd}}\`
- All checks must pass before you finish; fix failures instead of skipping tests.

## Project layout
- \`src/\` application code
- \`test/\` automated tests (mirror the \`src/\` structure)
- \`docs/\` human documentation

## Code style
- Match the conventions already used in the file you are editing.
- Keep functions small; add or update tests with every behaviour change.
- No new dependencies without a reason stated in the PR / commit message.

## Pull requests and commits
- Conventional commit subjects (\`feat:\`, \`fix:\`, \`docs:\`, \`chore:\`), imperative mood, under 72 characters.
- Describe what changed and why; list how you verified it.

## Security
- Never commit secrets or tokens. Read configuration from the environment.
- Do not run destructive commands (\`rm -rf\`, \`git reset --hard\`, database drops) without explicit confirmation.

## Nested instructions
Subdirectories may contain their own AGENTS.md; the closest one to the file you edit takes precedence.
`,
});

add({
  id: 'gemini-md', name: 'GEMINI.md', category: 'instructions', tool: 'gemini', defaultPath: 'GEMINI.md',
  description: 'Context file for Gemini CLI. Supports @file.md imports and hierarchical loading from subdirectories.',
  vars: [PROJECT, DESC, V('test_cmd', 'Test command', 'npm test')],
  body: `# {{project}} - Gemini context

{{description}}

## Working agreements
- Explain your plan briefly before making multi-file changes.
- Prefer editing existing files over creating new ones.
- Run \`{{test_cmd}}\` after changes and report the result.

## Tech stack
- Language / runtime: (fill in)
- Frameworks: (fill in)
- Package manager: (fill in)

## Style
- Follow the formatter and linter configuration in the repository.
- Write clear names; add comments only for non-obvious intent.

## Imports
Pull in shared guidance rather than duplicating it:
@AGENTS.md

## Boundaries
- Do not modify files under \`vendor/\`, \`dist/\` or generated directories.
- Never print or commit secrets.
`,
});

add({
  id: 'cursor-rule', name: 'Cursor rule (.mdc)', category: 'rules', tool: 'cursor', defaultPath: '.cursor/rules/{{name|slug}}.mdc',
  description: 'Project rule for Cursor with description / globs / alwaysApply frontmatter. Keep each rule focused and under ~500 lines.',
  vars: [V('name', 'Rule name', 'typescript-style'), V('description', 'When should this rule apply?', 'TypeScript coding conventions for this repository'),
    V('globs', 'File globs (comma separated, empty for none)', '**/*.ts,**/*.tsx'), V('always_apply', 'Always apply (true/false)', 'false')],
  body: `---
description: {{description|q}}
globs: {{globs}}
alwaysApply: {{always_apply}}
---

# {{name}}

## Rules
- Prefer explicit types on exported functions; infer locals.
- Use \`const\` by default; avoid \`any\` (use \`unknown\` and narrow).
- Keep modules small and single-purpose; co-locate tests as \`*.test.ts\`.

## Examples
Good:
\`\`\`ts
export function total(items: readonly Item[]): number {
  return items.reduce((sum, i) => sum + i.price, 0);
}
\`\`\`

## References
- Reference other files with @path/to/file.ts so they are attached when this rule triggers.
`,
});

add({
  id: 'copilot-instructions', name: 'Copilot repository instructions', category: 'instructions', tool: 'copilot', defaultPath: '.github/copilot-instructions.md',
  description: 'Repository-wide custom instructions for GitHub Copilot (chat, code review, coding agent).',
  vars: [PROJECT, DESC, V('test_cmd', 'Test command', 'npm test'), V('build_cmd', 'Build command', 'npm run build')],
  body: `# Copilot instructions for {{project}}

{{description}}

## Build and validate
- Build: \`{{build_cmd}}\`
- Test: \`{{test_cmd}}\`
- Always run the tests before proposing a change as complete.

## Coding guidelines
- Follow the existing code style and naming; do not introduce new patterns without need.
- Add or update unit tests for every behaviour change.
- Keep pull requests small and focused on one concern.

## Repository structure
- \`src/\` source, \`test/\` tests, \`docs/\` documentation, \`.github/\` workflows.

## Do not
- Add dependencies without justification.
- Commit secrets, tokens or generated artifacts.
- Edit files in \`dist/\`, \`build/\` or \`vendor/\`.
`,
});

add({
  id: 'copilot-path-instructions', name: 'Copilot path-specific instructions', category: 'rules', tool: 'copilot', defaultPath: '.github/instructions/{{name|slug}}.instructions.md',
  description: 'Scoped Copilot instructions applied to files matching applyTo globs.',
  vars: [V('name', 'Name', 'frontend'), V('apply_to', 'applyTo glob(s)', '**/*.tsx,**/*.css'), V('description', 'Description', 'Conventions for frontend components')],
  body: `---
applyTo: {{apply_to|q}}
description: {{description|q}}
---

# {{name}} instructions

- Use function components and hooks; no class components.
- Keep components under 150 lines; extract hooks for logic.
- Every interactive element must be keyboard accessible and have an accessible name.
- Co-locate tests next to the component and test behaviour, not implementation.
`,
});

add({
  id: 'claude-skill', name: 'Claude skill (SKILL.md)', category: 'skills', tool: 'claude', defaultPath: '.claude/skills/{{name|slug}}/SKILL.md',
  description: 'Agent Skill: a folder with SKILL.md (name + description frontmatter). Claude loads it on demand when the description matches the task.',
  vars: [V('name', 'Skill name (lowercase-hyphens)', 'pdf-report'), V('description', 'What it does and WHEN to use it', 'Generate a PDF report from structured data. Use when the user asks for a report, export or printable summary.'),
    V('allowed_tools', 'Allowed tools (optional)', 'Read, Write, Bash')],
  body: `---
name: {{name|slug}}
description: {{description|q}}
allowed-tools: {{allowed_tools}}
---

# {{name}}

## When to use
Use this skill when the request matches the description above. Do not use it for unrelated tasks.

## Instructions
1. Confirm the inputs you need (files, parameters). Ask if something is missing.
2. Follow the steps below in order; stop and report if a step fails.
3. Verify the result (open the output, run the checks) before reporting success.

## Steps
- Step one: gather the source data.
- Step two: transform it using the bundled scripts in this folder if present (\`scripts/\`).
- Step three: write the output to the agreed location and summarize what was produced.

## Resources
- Put long reference material in separate files next to this one (e.g. \`reference.md\`, \`examples.md\`) and link them here so they load only when needed.
- Put deterministic helpers in \`scripts/\` and call them instead of re-writing the logic.

## Output format
Return a short summary, the paths of created files and any follow-up the user must do.
`,
});

add({
  id: 'claude-agent', name: 'Claude subagent', category: 'agents', tool: 'claude', defaultPath: '.claude/agents/{{name|slug}}.md',
  description: 'Subagent definition with name / description / tools / model frontmatter; the body is its system prompt.',
  vars: [V('name', 'Agent name (lowercase-hyphens)', 'code-reviewer'),
    V('description', 'When should Claude delegate to it?', 'Expert code reviewer. Use proactively after code changes to review quality, security and tests.'),
    V('tools', 'Tools (comma separated)', 'Read, Grep, Glob, Bash'), V('model', 'Model (sonnet, opus, haiku or inherit)', 'sonnet')],
  body: `---
name: {{name|slug}}
description: {{description|q}}
tools: {{tools}}
model: {{model}}
---

You are a senior {{name}}. You work independently and report back a concise result.

## Process
1. Inspect the relevant changes (for example \`git diff\`) and the files around them.
2. Evaluate against the checklist below.
3. Report findings grouped by severity with file and line references.

## Checklist
- Correctness: logic errors, edge cases, error handling.
- Security: input validation, secrets, injection, unsafe defaults.
- Tests: new behaviour covered, no brittle assertions.
- Maintainability: naming, duplication, unnecessary complexity.

## Output
- **Critical** (must fix), **Warnings** (should fix), **Suggestions** (nice to have).
- Be specific: show the offending snippet and a suggested fix. Do not modify files unless asked.
`,
});

add({
  id: 'claude-command', name: 'Claude slash command', category: 'commands', tool: 'claude', defaultPath: '.claude/commands/{{name|slug}}.md',
  description: 'Custom slash command (/name) with description and argument-hint frontmatter; $ARGUMENTS holds the user input.',
  vars: [V('name', 'Command name', 'fix-issue'), V('description', 'Description', 'Investigate and fix a GitHub issue'),
    V('argument_hint', 'Argument hint', '[issue-number]'), V('allowed_tools', 'Allowed tools', 'Bash(git:*), Read, Edit')],
  body: `---
description: {{description|q}}
argument-hint: {{argument_hint|q}}
allowed-tools: {{allowed_tools|q}}
---

Work on: $ARGUMENTS

1. Read the issue / request and restate the goal in one sentence.
2. Find the relevant code; reproduce the problem or write a failing test first.
3. Implement the smallest change that fixes it.
4. Run the project's tests and linters; fix what you broke.
5. Summarize what changed, how you verified it, and any follow-ups.
`,
});

add({
  id: 'claude-rule', name: 'Claude rule (.claude/rules)', category: 'rules', tool: 'claude', defaultPath: '.claude/rules/{{name|slug}}.md',
  description: 'Modular Claude Code rule file; optional paths frontmatter scopes it to matching files.',
  vars: [V('name', 'Rule name', 'api-design'), V('paths', 'Path glob (empty = always)', 'src/api/**/*.ts')],
  body: `---
paths: {{paths|q}}
---

# {{name}}

- All endpoints validate input at the boundary and return typed errors.
- Use plural nouns for resources; keep handlers thin and move logic into services.
- Every new endpoint needs an integration test and an entry in the API docs.
`,
});

add({
  id: 'windsurf-rule', name: 'Windsurf rule', category: 'rules', tool: 'windsurf', defaultPath: '.windsurf/rules/{{name|slug}}.md',
  description: 'Windsurf (Cascade) workspace rule with a trigger (always_on, glob, model_decision, manual).',
  vars: [V('name', 'Rule name', 'project-conventions'), V('trigger', 'Trigger', 'always_on'), V('description', 'Description', 'Core conventions for this workspace')],
  body: `---
trigger: {{trigger}}
description: {{description|q}}
---

# {{name}}

- Keep changes minimal and consistent with the surrounding code.
- Run the test suite after each change and fix failures before continuing.
- Never expose secrets; read configuration from environment variables.
`,
});

add({
  id: 'adr', name: 'Architecture Decision Record', category: 'docs', tool: 'generic', defaultPath: 'docs/adr/{{number}}-{{title|slug}}.md',
  description: 'ADR (MADR style): context, decision, consequences, alternatives.',
  vars: [V('number', 'ADR number', '0001'), V('title', 'Decision title', 'Use PostgreSQL for primary storage'), V('status', 'Status', 'proposed'),
    V('date', 'Date', today()), V('deciders', 'Deciders', 'team')],
  body: `# {{number}}. {{title}}

- Status: {{status}}
- Date: {{date}}
- Deciders: {{deciders}}

## Context
What problem are we solving? What forces (technical, business, team) are at play?

## Decision
We will ... (state the decision in active voice).

## Consequences
- Positive: ...
- Negative / trade-offs: ...
- Follow-ups: ...

## Alternatives considered
1. Option A - why not.
2. Option B - why not.

## References
- Links to issues, discussions, benchmarks.
`,
});

add({
  id: 'plan', name: 'Implementation plan', category: 'docs', tool: 'generic', defaultPath: 'docs/plans/{{title|slug}}.md',
  description: 'Plan with goal, scope, milestones as checkboxes, risks and open questions.',
  vars: [V('title', 'Plan title', 'Feature rollout'), V('goal', 'Goal', 'Ship the feature behind a flag and validate with 10% of users.'), V('date', 'Date', today())],
  body: `# Plan: {{title}}

Created: {{date}} - Status: draft

## Goal
{{goal}}

## Scope
- In scope: ...
- Out of scope: ...

## Milestones
- [ ] 1. Design agreed and documented
- [ ] 2. Core implementation with tests
- [ ] 3. Integration and migration
- [ ] 4. Rollout and monitoring
- [ ] 5. Cleanup and docs

## Risks
| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| ...  | med        | high   | ...        |

## Open questions
- ...

## Verification
How will we know it works? List the commands, checks and metrics.
`,
});

add({
  id: 'prd', name: 'Product requirements (PRD)', category: 'docs', tool: 'generic', defaultPath: 'docs/prd/{{title|slug}}.md',
  description: 'PRD with problem, users, requirements, success metrics and non-goals.',
  vars: [V('title', 'Feature / product', 'Team dashboards'), V('owner', 'Owner', 'product'), V('date', 'Date', today())],
  body: `# PRD: {{title}}

Owner: {{owner}} - Date: {{date}} - Status: draft

## Problem
Who has the problem, how often, and what does it cost them today?

## Users and use cases
- As a ..., I want ..., so that ...

## Requirements
### Must have
- [ ] ...
### Should have
- [ ] ...
### Won't have (non-goals)
- ...

## Success metrics
- Primary: ...
- Guardrails: ...

## Design and technical notes
Links to mockups, ADRs and constraints.

## Rollout
Phases, flags, communication, rollback plan.

## Open questions
- ...
`,
});

add({
  id: 'todo', name: 'TODO list', category: 'tasks', tool: 'generic', defaultPath: 'TODO.md',
  description: 'Task list in the checkbox syntax agentneuron understands (- [ ], - [/], - [x], !priority, @due, #label).',
  vars: [PROJECT],
  body: `# TODO - {{project}}

## Now
- [/] Describe the task in progress !high #area
- [ ] Next task with a due date @due(${today()}) !med

## Next
- [ ] Task #label
- [ ] Task with sub-steps
  - [ ] sub-step one
  - [ ] sub-step two

## Later
- [ ] Idea worth keeping !low

## Done
- [x] Example completed task
`,
});

add({
  id: 'decision-log', name: 'Decision log', category: 'docs', tool: 'generic', defaultPath: 'docs/DECISIONS.md',
  description: 'Lightweight running log of decisions (date, decision, why, status) for projects that do not need full ADRs.',
  vars: [PROJECT, V('date', 'First entry date', today())],
  body: `# Decision log - {{project}}

Newest first. One entry per decision; supersede instead of editing history.

## {{date}} - Adopt a decision log
- Status: accepted
- Decision: record significant technical and product decisions here.
- Why: new contributors and AI agents need the reasoning, not just the code.
- Alternatives: full ADR per decision (heavier), no record (context lost).
`,
});

add({
  id: 'session-handoff', name: 'Session handoff', category: 'docs', tool: 'generic', defaultPath: 'docs/handoff/{{date}}-{{topic|slug}}.md',
  description: 'Notes for the next human or agent session: state, decisions, next steps, how to resume.',
  vars: [V('topic', 'Topic', 'work-in-progress'), V('date', 'Date', today())],
  body: `# Handoff: {{topic}} ({{date}})

## Goal
One sentence on what we are trying to achieve.

## Current state
- Done: ...
- In progress: ...
- Blocked: ...

## Key decisions made
- Decision - reason.

## Files touched
- \`path/to/file\` - what changed.

## Next steps
1. ...
2. ...

## How to resume
\`\`\`
git status
npm test
\`\`\`
Gotchas: ...
`,
});

add({
  id: 'readme', name: 'README', category: 'docs', tool: 'generic', defaultPath: 'README.md',
  description: 'Project README: what, quick start, usage, development, contributing, license.',
  vars: [PROJECT, DESC, V('install_cmd', 'Install command', 'npm install'), V('run_cmd', 'Run command', 'npm start'), V('test_cmd', 'Test command', 'npm test')],
  body: `# {{project}}

{{description}}

## Quick start
\`\`\`bash
{{install_cmd}}
{{run_cmd}}
\`\`\`

## Usage
Show the most common task with a copy-pasteable example.

## Development
\`\`\`bash
{{test_cmd}}
\`\`\`
See [CLAUDE.md](CLAUDE.md) / [AGENTS.md](AGENTS.md) for AI agent instructions.

## Project structure
- \`src/\` - source
- \`test/\` - tests
- \`docs/\` - documentation

## Contributing
Open an issue first for larger changes. Keep pull requests focused and tested.

## License
MIT (update as needed)
`,
});

const BY_ID = new Map(T.map((t) => [t.id, t]));

function resolveVars(t, vars) {
  const out = Object.create(null); // no prototype: {{constructor}} / {{__proto__}} resolve to ''
  for (const v of t.vars) out[v.name] = v.default;
  for (const [k, val] of Object.entries(vars && typeof vars === 'object' ? vars : {})) {
    if (val == null || typeof val === 'object') continue;
    if (!/^[A-Za-z_][\w]*$/.test(k) || k === '__proto__') continue;
    out[k] = String(val).slice(0, 4000);
  }
  return out;
}

/** A value used inside a file path: one safe segment, no separators, no dot-only/leading-dot names. */
function pathSegment(v) {
  const s = String(v ?? '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return s || 'untitled';
}

function fill(tpl, vars, forPath = false) {
  return tpl.replace(/\{\{\s*([A-Za-z_]\w*)\s*(?:\|\s*(q|slug)\s*)?\}\}/g, (_, name, filter) => {
    const v = vars[name] ?? '';
    if (filter === 'q') return yamlScalar(v);
    if (filter === 'slug') return slugify(v);
    return forPath ? pathSegment(v) : v;
  });
}

export function listTemplates() {
  return T.map((t) => ({
    id: t.id, name: t.name, category: t.category, tool: t.tool, defaultPath: t.defaultPath, description: t.description,
    vars: t.vars.map((v) => ({ name: v.name, label: v.label, default: v.default })),
  }));
}

export function renderTemplate(id, vars) {
  const t = BY_ID.get(id);
  if (!t) throw new Error(`Unknown template: ${id}`);
  const v = resolveVars(t, vars);
  const p = fill(t.defaultPath, v, true);
  // defence in depth: whatever the template produced must be a plain relative path inside the project
  if (!p || p.startsWith('/') || p.includes('\\') || p.includes('\0') || p.split('/').some((seg) => seg === '..' || seg === '' || seg === '.')) throw new Error('template produced an invalid path');
  return { path: p, content: fill(t.body, v) };
}
