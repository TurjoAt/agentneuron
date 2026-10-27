# Agent brief

The **Agent brief** view (`#/brief`) and the matching CLI commands and MCP tools help an agent pick up work, avoid known mistakes, get the right context for a task and diagnose an error. Everything is computed locally and deterministically from what AgentNeuron already reads: Claude Code / Codex sessions of this project, the task board, git history, test/build runs, checkpoints, context files and accepted lessons. Nothing calls a model, and every item cites its evidence.

| Tab | CLI | MCP tool | What it gives |
|---|---|---|---|
| Resume | `agentneuron resume` | `get_resume_brief` | Resume brief of a session or task |
| Warnings | `agentneuron preflight` | `preflight_check` | Warnings for a command or files about to be edited |
| Context pack | `agentneuron pack` | `get_context_pack` | The most relevant files, tests, rules and facts for a task, within a token budget |
| Bug detective | `agentneuron debug` | `get_debug_report` | Ranked hypotheses for an error, stack trace or the last failing run |

## Resume brief

A resume brief summarises a session (default: the latest one) or a board task (all sessions that touched the task's files):

- **Goal**: the first prompt of the session, or the task title.
- **Done**: successful edits per file, and commits made in the session window.
- **Failed attempts**: shell commands that failed (grouped, with a count and whether a later run succeeded), failed or denied edits, denied tools, interrupts, failing test/build runs.
- **Decisions**: user corrections ("no, use pnpm"), answers to the agent's questions, accepted lessons.
- **Files**, **last test results** (from recorded runs), **open todos** (the session's last TodoWrite list, or the task's acceptance criteria) and **checkpoints**.
- **Next steps**: fix the failing tests, retry a failing command, open todos, unmet criteria, verification, or "continue from the last prompt".

Every item carries `evidence: [{ kind, ref, ts }]` with `kind` one of `session`, `commit`, `file`, `run`, `task`, `checkpoint`.

**Copy as Markdown** (`agentneuron resume --md`) gives a brief to paste into another agent, for example to move from Claude Code to Codex.

**Save** (action `brief.save`, level `state`) writes `.agentneuron/briefs/<id>.json` and `<id>.md` (the newest 200 are kept) and adds a handoff note, so `get_handoffs` and the Live view show it. The handoff note holds only generated text (counts, edited paths, test-derived next steps, the brief id); the full brief is loaded with `get_resume_brief { "brief": "<id>" }`.

## Warnings and preflight

A warning rule comes from one of:

| Source | Example | Severity |
|---|---|---|
| Repo facts | `pnpm-lock.yaml` exists, so `npm install` is wrong | block |
| Context rules | "Use pnpm, not npm" / "Never edit src/gen/" in CLAUDE.md, AGENTS.md, ... | prefer: warn, never: block |
| Accepted lessons | Lessons accepted in [Insights](insights.md) | as the rule says |
| Session history | A command or path that failed or was corrected before | warn |
| Built-in | Generated files (`@generated`, `DO NOT EDIT`), lockfiles, `.env`, destructive commands (`rm -rf` of `/`, `~` or `*`, force push, `git reset --hard`, `git clean -f`, dropping a database, ...), files claimed by another agent session | warn or block |

Each warning has `{ id, severity, title, why, fix, source, evidence }`. A task description adds `info` warnings for rules that look relevant to it.

### Claude Code hook

`agentneuron preflight` reads a Claude Code `PreToolUse` hook event on stdin (`tool_name`, `tool_input.command` or `tool_input.file_path`, `cwd`) when no `--command` / `--paths` flag is given. On a blocking warning it prints the reasons to stderr and exits with code `2`, which stops the tool call and shows the reasons to the agent. Warnings that do not block are printed to stderr with exit code `0`. If the check itself fails, it exits `0` (it never blocks an agent because of its own error).

AgentNeuron never installs hooks. To use it, add this to `.claude/settings.json` yourself:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash|Edit|Write|MultiEdit",
        "hooks": [{ "type": "command", "command": "npx agentneuron preflight" }] }
    ]
  }
}
```

Test a rule by hand:

```sh
agentneuron preflight --command "npm install lodash"; echo "exit $?"
echo '{"tool_name":"Edit","tool_input":{"file_path":".env"},"cwd":"'"$PWD"'"}' | agentneuron preflight
```

## Context pack

Give a task description (or a board task id) and a budget (500 to 200000 tokens, default 8000). Candidates are scored by:

- path and file-name match with the task words, files named in the task, the task's own files;
- keyword hits in file contents (the best matches only);
- import neighbours of strong matches;
- context-file sections (CLAUDE.md, AGENTS.md, ...) that match the task, and paths those sections mention;
- files edited in the same sessions or changed in the same commits;
- related test files;
- repo facts (package manager, scripts, verified context claims).

Items are added in score order (ties by path) until the budget is used; no single item takes more than 60 % of it. The response lists what was left out and why. The same task and repository state always give the same pack.

## Bug detective

Paste an error or stack trace (or use the last failing test/build run). AgentNeuron maps the stack frames to project files (JavaScript/TypeScript, Python, PHP, Rust, Go, Java and generic `file:line` frames) and ranks hypotheses that have supporting evidence:

- a recent change to a file in the stack (git commits and agent edits of the last 7 days);
- a wrong import path, a missing or undeclared package, a dependency version in the stack;
- a missing environment variable (names from `.env.example` / `.env`, values are never read into the report);
- a service that is down, a port in use, a pending migration, a syntax error, a null value;
- recorded failing tests with the same error, and the same error seen in an earlier session.

Each hypothesis has a confidence, its evidence and a concrete way to confirm it. Related files, commits, sessions, config, dependencies and tests are listed. The pasted text is not stored unless you save the report. A report of pasted text is saved by the debug route itself (`{ "save": true }`, level `state`), never as an action parameter, because job parameters are visible to every role. A report of a failing run is saved with the `brief.save` action.

## Privacy

- Session text (prompts, replies, user corrections, quotes, titles) sits only under the keys `prompt`, `title`, `quote`, `lastPrompt`, `thinking` and `body`, and follows the [live prompt policy](live.md#configuration). For roles that may not see prompts (the viewer token by default):
  - resume briefs drop that text, command text and the Markdown export;
  - warnings and rules never use session history, so a query cannot reveal whether a command failed before;
  - the bug detective refuses pasted error text (`403`; the last failing run still works), and the report has no error text, function names, session evidence or Markdown; saved reports of pasted text are withheld.
- Every response passes through the secret masker. Files on the deny list (credentials, keys, `.env` values, ...) are never read; `~/.claude/.credentials.json`, session keys and pasted contents are never touched.
- GET routes and MCP tools never touch the network and spawn nothing except a read-only `git log` with a timeout. The debug route only analyses the text it is given.

## HTTP API

| Method | Path | Parameters | Returns |
|---|---|---|---|
| GET | `/api/brief/resume` | `session?`, `task?` | Resume brief (see above) with `markdown` |
| GET | `/api/brief/sources` | | Sessions and tasks to pick from |
| GET | `/api/brief/briefs` | | `{ briefs: [{ id, kind, title, createdAt, source }] }` |
| GET | `/api/brief/brief` | `id` | One saved brief |
| GET | `/api/brief/warnings` | `command?`, `paths?` (comma list), `task?` | `{ warnings, blocking, rules }` |
| GET | `/api/brief/rules` | | `{ rules }` |
| GET | `/api/brief/pack` | `task`, `budget?` | `{ task, budget, tokens, items, skipped, markdown }` |
| POST | `/api/brief/debug` | `{ error?, run?, save? }` (`run`: id or `last`; `save: true` needs level `state`) | `{ error, frames, hypotheses, related, markdown, saved? }` |

All are level `read`. Saving uses the `brief.save` action (`{ kind: "resume" | "debug", session?, task?, run? }`, level `state`); the brief is recomputed on the server. For viewers, a saved report of pasted error text is withheld entirely (`withheld: true`).
