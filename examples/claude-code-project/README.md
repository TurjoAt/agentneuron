# Example: Claude Code project

A small fictional "Acme Billing API" repository with the files a Claude Code project typically accumulates. Use it to see what AgentNeuron shows without pointing it at your own code. Nothing here runs; the `src/` files are stubs.

```sh
npx agentneuron examples/claude-code-project
# or, from a clone of this repository:
node dist/agentneuron.mjs examples/claude-code-project
```

Then open http://127.0.0.1:4747.

## What to look at

| Page | What you will see |
|---|---|
| Overview | 18 tracked files (10 for Claude Code, 8 generic), health score 94 (A) with two warnings |
| Graph | `CLAUDE.md` at the centre with three `@imports` (`docs/guides/*.md`), ADR links, skill resources (`template.md`) |
| Context | Choose directory `src/billing`, tool `claude`: the chain is `CLAUDE.md` plus the three imported guides, with a token total. This is what Claude Code loads when working there |
| Health | Two deliberate `missing-path` warnings in `docs/guides/runbook.md` (a deleted worker file and a deleted guide). Open an issue to see the hint |
| Tasks | `TODO.md` as a board: `[/]` is In progress, `[ ]` To do, `[x]` Done. Metadata is parsed: `!high` priority, `#api` labels, `@due(2026-11-05)` dates (see Calendar and Timeline), `@maria` assignees, sub-checklists. A `TODO:` comment in `docs/guides/runbook.md` is listed as a read-only task |
| Tasks > Decisions | The two ADRs in `docs/adr/` with status and date |
| Agents > Tools | Claude Code detected: 2 agents, 2 skills, 2 commands, 10 permission rules, 2 hooks, 1 MCP server |
| Agents > Rules for file | Pick `src/billing/tax.ts` to see which instructions apply |
| Agents > MCP | The `agentneuron` server declared in `.mcp.json` (with `exec` enabled you can test it) |
| Project | Stack detection is minimal here (no `package.json`); this example is about the AI files |

`.claude/settings.json` shows up as a config file: permissions (allow, deny, ask) and hooks (`PostToolUse`, `Stop`) are listed on the Agents page. With `--enable exec` (these files decide which commands tools may run) you can edit them from the UI (`agents.permissions.update`, `agents.hooks.update`).

## Try the CLI

```sh
npx agentneuron status examples/claude-code-project
npx agentneuron lint examples/claude-code-project        # exit code 0: warnings only
npx agentneuron lint --json examples/claude-code-project
```

## Things to try

1. Fix the runbook warnings and watch the score rise live.
2. Add a link like `[security](docs/guides/security.md)` to `CLAUDE.md` to create a `broken-link` error (exit code 1 for `lint`), then remove it.
3. Run with `--enable edit` and create an agent from the Agents > Templates page.
