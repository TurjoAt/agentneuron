# Insights

The **Insights** view (and `agentneuron lessons`, the MCP tool `suggest_rules`, and `/api/insights/*`) reads the Claude Code (`~/.claude/projects/*/*.jsonl`) and Codex (`~/.codex/sessions/**`) transcripts of the current project and answers four questions:

1. **Lessons**: what should the context files say that they don't yet?
2. **Rule effectiveness**: which rules do agents follow, ignore, or never need?
3. **Replay**: what context did the agent have when it made a change?
4. **Cost by feature**: what did each feature or task cost in agent tokens?

Everything is computed locally and heuristically. Nothing leaves the machine, and no ML or extra dependencies are involved. Each transcript is read through the same tail cap as the rest of AgentNeuron (`MAX_TRANSCRIPT_BYTES`, the last 64 MB), parsed results are cached by file size and mtime, and at most the 200 most recent sessions are considered. Every quote and every output string is passed through the secret masker before it is returned. Quotes are masked first and then cut to 200 characters.

## Lessons

Sources:

| Kind | Detected when |
|---|---|
| `correction` | A user turn comes right after the agent edited a file or ran a command, and it reads like a correction. That means it starts with `no`, `nope`, `wrong`, `stop`, `don't`, `never`, `revert`, `instead`, ... or contains a directive such as `never`, `always use`, `we use X not Y`, `instead of`, `should not`. The turn must be at most 500 characters and at most 12 lines. Fenced code and `>` quotes are stripped first. Polite phrases (`no worries`, `no problem`, `never mind`, `don't worry`, `no, that's fine`) and plain questions are ignored. A rejected tool call where the user typed feedback ("the user said: ...") always counts. Sub-agent (sidechain) turns are skipped. |
| `revert` | A later edit to the same file swaps an earlier edit's old and new text back, within 7 days. Rejected edits are ignored. |
| `fix` / `failure` | The same command (program plus subcommand, for example `npm install` or `npm run build`) failed at least twice. Failure means a non-zero exit code, `is_error`, or `Process exited with code N`. If a different command for the same job succeeded right after (for example `pnpm install` after `npm install`), the rule is "Use X instead of Y" (`fix`). If the same command later passed in most sessions, this is treated as normal test-fix iteration and nothing is proposed. |
| `repeated` | An instruction-like prompt ("remember to ...", "always ...", "run ...", "use ...") that appears, with similar wording, in at least two different sessions. |

The candidates are normalised (lower-cased, stop words dropped, crude stemming) and clustered greedily by token Jaccard similarity (≥ 0.5). A cluster becomes one proposed rule, phrased as a short imperative sentence ("Use pnpm, not npm."). Each lesson has:

```json
{
  "id": "99f214c7c728",
  "rule": "Use pnpm, not npm.",
  "kind": "correction",
  "kinds": ["correction", "fix", "repeated"],
  "target": "CLAUDE.md",
  "targets": ["CLAUDE.md", "AGENTS.md"],
  "evidence": [{ "session": "sess-a", "tool": "claude", "ts": 1790849040000, "quote": "no, we use pnpm not npm", "kind": "correction" }],
  "count": 6, "sessions": 3, "confidence": 0.97,
  "alreadyCovered": { "file": "CLAUDE.md", "line": 4, "rule": "Use pnpm, not npm.", "similarity": 1 }
}
```

- `confidence` combines several signals: a base value per kind, how often the lesson was seen, whether it appeared in more than one session, whether the correction was strong (it starts with a negation or the tool call was rejected), and whether several kinds agree.
- `target`: the suggested file. Evidence from Codex only points to `AGENTS.md` and evidence from Claude only points to `CLAUDE.md`. When every path in the evidence shares a top-level directory, that directory's `CLAUDE.md`/`AGENTS.md` is suggested, or a scoped `.cursor/rules/<dir>.mdc` if the project uses Cursor rules.
- `alreadyCovered`: the closest existing rule, matched by Jaccard ≥ 0.5 or ≥ 75 % containment, or `null`. Covered lessons are hidden by default; use the "show already covered" toggle, `?all=1`, or `--covered`.
- `id` is stable: it is derived from the kind and the normalised rule.

**Accept** appends `- <rule>` under a `## Lessons learned` heading of the target file. The heading is created if it is missing. If the file is new, it is created; a new `.mdc` file gets frontmatter. The write goes through the normal safe file operations: tracked context files only, symlinks refused, hash-checked, and history recorded. It needs the **edit** level, which is off by default. You can edit the rule text before accepting, as a single line of at most 300 characters. If the text is already in the file, nothing is written.

**Dismiss** needs the **state** level (admin). Both decisions are stored in `.agentneuron/insights.json`, so the lesson does not come back. A dismissed rule also hides near-identical rules (Jaccard ≥ 0.7).

## Rule effectiveness

Each `context` and `rules` file (CLAUDE.md, AGENTS.md, GEMINI.md, `.cursor/rules`, `.claude/rules`, Copilot instructions, ...) is split into atomic statements: bullets, plus directive lines outside code fences and frontmatter. The checkable ones are classified:

| Type | Example | Applies | Followed / violated |
|---|---|---|---|
| `path-prohibition` | "Never edit `dist/`", "Never touch the migrations folder" | A session read, edited or ran a command on a matching path | Per session: no edit to the path is followed; an edit (even a rejected attempt) is violated |
| `command-preference` | "Use pnpm, not npm", "Don't use npm" | Each command whose program is in the same family (npm/pnpm/yarn/bun, pip/uv/poetry, jest/vitest, ...) | Using the preferred program is followed; using an avoided one is violated |
| `command-prohibition` | "Don't run `git push --force`" | Each command with the same program | Running the forbidden command line is violated |
| `run-before` | "Run tests before committing" | Each `git commit` (or `git push`) | A test/lint/... command ran since the last commit in the session is followed |

Each rule row returns `{ rule, file, line, type, appliesTimes, followed, violated, examples, tokenCost }`, where `tokenCost` is the estimate from `core/tokens.js`. The response also includes:

- `neverRelevant`: checkable rules whose trigger never occurred, plus other rules whose backticked terms never appear in any session.
- `ignored`: rules that were violated at least as often as they were followed.
- `diet`: `cut` (the never-relevant rules, with their token savings per session) and `tighten` (the ignored rules, with a concrete rewording hint). Cuts are only suggested after at least 3 sessions.

## Replay

`GET /api/insights/replay?path=src/app.js&ts=<ms>`, or `?session=<id>&ts=<ms>`, reconstructs the following:

- **The session.** It is the one given in the request. Otherwise, it is found by attributing the change to a transcript edit within 2 minutes.
- **The effective context for the path's directory**, for that session's tool, as it was at `ts`. Each file in the chain carries a `version`:
  - `history`: the local `.agentneuron/history` version current at that time.
  - `git`: the last commit before `ts`, used when local history does not reach back that far.
  - `current`: no older version is known.
  - `changedSince: true` flags files that changed after the action.
- **A timeline**: context-file versions in the week before, the session's preceding prompts and actions, and the change itself.

Without `path` or `session`, the endpoint lists recent agent-attributed changes (`{ changes: [...] }`) for the picker. These come from the event log and from transcript edits. The merged context text is masked and capped at 30,000 characters.

## Cost by feature

The join uses three sources:

- **Sessions.** Token usage and estimated USD come from the same code as `/api/agents/costs`. The git branch is read from the transcript: the `gitBranch` field for Claude Code, `session_meta.git.branch` for Codex.
- **Commits.** The last 500 commits on all branches, with their files. A commit belongs to a branch when it is reachable from that branch but not from `main`/`master`.
- **Board tasks.** Their ids, titles and files.

Commits map to a feature in this order of preference:

1. The task id appears in the commit message.
2. The branch name resembles a task title.
3. The commit's files overlap a task's files.
4. The commit's branch.
5. The Conventional Commit scope.

Each session is then assigned to exactly one feature: the one with the highest score. The score adds up these matches: same branch (10), task id in the prompts (8), title resembling the task (4), overlapping files (up to 5), and a commit inside the session window (2). Sessions are never split or counted twice. A session with no match goes to **Unattributed**.

Each row has `{ feature, kind (task|branch|scope|unattributed), sessions, tokens, cost, commits, files, timeMs, matchedBy, sessionList, commitList }`. `timeMs` is the summed session span, with each session capped at 12 hours.

## Interfaces

| Interface | |
|---|---|
| UI | **Insights** in the sidebar, with the tabs Lessons, Rule effectiveness, Replay and Cost by feature. The Overview shows "N lessons to learn" when there are uncovered lessons. |
| CLI | `agentneuron lessons [dir] [--json] [--covered] [--all]`. See [CLI](cli.md#lessons-dir). |
| MCP | `suggest_rules`, read-only. See [MCP](mcp.md). |
| HTTP | See [HTTP API](http-api.md#insights). |

## Limits

These are heuristics, so read the evidence before accepting a lesson:

- Correction detection is tuned for precision. Corrections phrased only as questions, or without any directive words, are missed.
- Rules are checked against the transcripts that exist today, without regard to when each rule was added.
- Only Claude Code and Codex transcripts are read. Cursor, Copilot and Gemini do not leave local transcripts in a known format.
