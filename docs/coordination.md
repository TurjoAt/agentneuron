# Multi-agent coordination

When several agents (or an agent and you) work in one repository, AgentNeuron gives them three shared, file-based tools: **claims** (advisory locks on paths), **task claims** on the board, and **handoff notes**. All three live in `.agentneuron/`, so every agent process sees the same state: each MCP server, the web server and the UI. They show up in the [Live view](live.md), on board cards and in the task dialog.

Claims are **advisory**. Nothing blocks a filesystem write. A conflicting claim is refused unless forced, and an edit to a path another agent holds raises a loud collision warning in the Live view.

## Enabling the tools for agents

The MCP server is read-only by default. The writing tools need the `state` level, the same level that board edits need over HTTP:

```sh
agentneuron mcp --level state
```

You can also set `"mcp": { "level": "state" }` in `.agentneuron/config.json`. The writes stay inside `.agentneuron/`: `claims.json`, `handoffs.jsonl`, and the board overlay in `board.json`. Markdown task files are never rewritten by the MCP `claim_task` tool. The dashboard's claim button (`POST /api/live/claim-task`) is different: when the server runs with `--enable edit`, assigning a task that lives in a Markdown file updates that task line, the same way the Tasks board does. Because a cloned repository can carry that config file, check `.agentneuron/config.json` in projects you did not create.

At the `read` level, `claim_task`, `claim_files`, `release_files` and `handoff_note` are missing from `tools/list` and are refused if called anyway. `list_claims` and `get_handoffs` are always available.

## Identity

Every call takes optional `agent` and `sessionId` arguments.

- `agent` defaults to the MCP client's name from `initialize` (for example `claude-code`).
- `sessionId` defaults to `pid<MCP server process id>`. Clients usually start one MCP server per session, so the default separates sessions.

A claim belongs to the pair `agent:sessionId`.

When an edit in a transcript touches a claimed path, the Live view treats the claim as **someone else's** when:

- the claim's agent family (claude, codex, cursor) differs from the editing tool, or
- the claim names a different session that AgentNeuron can see.

Your own claims therefore don't warn you, even though MCP cannot know the transcript's session id.

## Claims

- A claim is a project-relative path or glob, such as `src/api/client.ts`, `docs/**` or `src/*.js`.
- A plain path also covers everything below it, so `src/api` covers `src/api/x.ts`.
- Overlap between two globs is approximate and conservative: they overlap when their static prefixes nest.
- TTL defaults to 15 minutes, with a minimum of 10 seconds and a maximum of 4 hours. Claiming the same pattern again refreshes it.
- There are at most 50 paths per call and 500 active claims in total.
- `..` and absolute paths are rejected.
- A conflicting path is not granted unless `force: true`. Conflicts are always returned as `{ path, heldBy: { agent, sessionId }, pattern, expiresAt, taskId }`.
- Writes take a cross-process lock file (`claims.json.lock`, created exclusively and taken over after 5 s if stale) and an atomic rename, so two agents claiming the same path at the same moment cannot both win.

## Task claims

`claim_task { id }`:

1. Sets the task's assignee to `<agent>.<first 8 chars of the session id>`, for example `claude-code.1a2b3c4d`.
2. Moves the task to the in-progress column (`doing`, or the third column of a custom board).
3. Claims the task's linked files.

It returns `{ task, assignee, previousAssignee, claims }`. A task already assigned to someone else is still claimed, and `previousAssignee` tells you who had it.

## Handoff notes

`handoff_note { summary?, done?, next?, blockers?, taskId?, files? }` appends one line to `.agentneuron/handoffs.jsonl`, which rotates at 5 MB.

- List fields accept an array, or a string with one item per line.
- Every field is masked and capped: 30 items of 500 characters each.

Notes appear in the Live view, on the board card (count) and in the task dialog when `taskId` is set. `get_handoffs { taskId?, sessionId?, agent?, limit? }` returns the newest first.

## Suggested agent workflow

Add something like this to `CLAUDE.md` or `AGENTS.md`:

```markdown
## Coordination (agentneuron MCP)
- Before editing shared files: `list_claims`, then `claim_files` for what you will touch (globs are fine).
- Taking a board task: `claim_task` with its id.
- When you stop: `release_files` and `handoff_note` with done / next / blockers.
```

## HTTP

The same operations exist over HTTP for scripts and the UI (see [HTTP API](http-api.md#live-agents)). Writes need the `state` level (admin). The UI claims as `agent: "human"`, `sessionId: "ui"`.
