# MCP server

`agentneuron mcp` exposes the same data the UI shows to any MCP-capable AI tool, so an agent can ask "what is the effective context for `src/api`?" or "which links are broken?" instead of guessing. By default it is **read-only**: no tool writes or runs anything. With `--level state` it adds the [coordination](coordination.md) tools, which write only inside `.agentneuron/`.

```sh
agentneuron mcp [dir] [--level state]
```

- Transport: stdio, newline-delimited JSON-RPC 2.0.
- Protocol versions: `2025-06-18` (default), `2025-03-26`, `2024-11-05`.
- `dir` is the project root; default is the current directory (MCP clients normally start the process in the project folder, but passing the path is safer).
- stdout carries only protocol messages. Set `AGENTNEURON_DEBUG=1` for diagnostics on stderr.
- It reads the project itself and watches it for changes. It does not need the web server to be running, and it does not use tokens.
- Secrets found in files are masked in everything it returns. Output is capped (file text 200 KB; any single tool result 1 MB; request lines 4 MB). `get_context` accepts only the tools `claude`, `codex` and `cursor`.
- `report_export` reads the history that `agentneuron start` keeps in `.agentneuron/` (events, metrics) when present, plus changes seen since the MCP server started that are newer than that history (so nothing is counted twice); it never writes it.

## Tools

| Tool | Arguments | Returns |
|---|---|---|
| `project_info` | | Name, root, file and token counts, files per tool, health, detected AI tools |
| `list_files` | `tool?`, `kind?` | Tracked files with path, tool, kind, size, tokens, lines, mtime, title |
| `read_file` | `path` | Content of a tracked file (masked, truncated at 200 KB) |
| `search` | `query`, `limit?` (default 50, max 200) | Case-insensitive line matches |
| `get_health` | `limit?` (default 25, max 200) | Score, grade, counts, issues per rule |
| `get_context` | `dir?`, `tool?` (`claude`, `codex`, `cursor`) | Effective merged context for a directory: chain of files, tokens, text |
| `recent_changes` | `since?` (ISO date, epoch ms, or `2h`, `3d`, `1w`; default 24 h), `limit?` | Changed files and recent events |
| `get_tasks` | `status?` (`open`, `done`, `all`), `limit?` | Checkbox and TODO/FIXME tasks |
| `get_links` | `path` | Incoming and outgoing links, with broken ones flagged |
| `verify_context` | `status?` (`false` default, `unknown`, `ok`, `all`), `file?`, `limit?` | [Truth check](verify.md): claims from context files with status, evidence and suggested fix, plus a summary |
| `audit_agent_config` | `minSeverity?` (`high`, `medium`, `low` default, `info`) | [Security audit](audit.md) of the agent config: risk score, counts, findings (values masked) |
| `compile_preview` | `tools?` (comma list), `diff?` | Read-only plan for compiling `.agentneuron/rules/` into each tool's files: stale outputs, hand-edited regions, merge-back candidates. See [rules compiler](compiler.md) |
| `report_export` | `range?` (`24h`, `7d`, `30d`, `2w`...; default `7d`), `format?` (`ai` default, `json`), `includeContent?` | Report for the period ending now. `ai` returns the Markdown context pack as plain text; `json` returns the `agentneuron.report/v1` object (see [HTTP API](http-api.md#exports)) |
| `list_claims` | `path?` | Active advisory file claims of every agent session (only those covering `path` when given) |
| `get_handoffs` | `taskId?`, `sessionId?`, `agent?`, `limit?` | Handoff notes, newest first |
| `suggest_rules` | `limit?` (default 20, max 100), `includeCovered?` | Lessons mined from this project's Claude Code / Codex sessions as proposed rules: `{ id, rule, kinds, target, targets, evidence[{session, tool, ts, quote}], count, sessions, confidence, alreadyCovered }`. Quotes are secret-masked. Read-only: it reads but never writes `.agentneuron/insights.json`. See [Insights](insights.md) |
| `get_usage` | `range?` (`24h`, `7d`, `30d` default, `90d`, `all`) | Usage summary of this project's Claude Code / Codex sessions: cost (exact where Claude Code recorded it, otherwise estimated), tokens, cache hit rate and savings, models, tool errors, anomalies and tips. No prompt text or titles. See [Usage](usage.md) |
| `get_session_replay` | `id`, `limit?` (default 200, max 1000) | One session: summary row, the last `limit` timeline rows, subagents and saved file versions. Prompts are included (masked); thinking text only when `live.showPrompts` allows it |
| `get_tool_health` | `range?` | Tool calls, errors, denials, durations, MCP servers needing auth, skills, hooks and error loops |

### Coordination tools (`--level state`)

These tools are hidden from `tools/list` and refused at the default `read` level. Enable them with `agentneuron mcp --level state` or `"mcp": { "level": "state" }` in `.agentneuron/config.json`. See [Coordination](coordination.md).

| Tool | Arguments | Returns |
|---|---|---|
| `claim_files` | `paths`, `ttlMinutes?` (default 15, max 240), `note?`, `force?`, `agent?`, `sessionId?` | `{ granted, conflicts, claims }`. Paths held by another session are not granted unless `force` |
| `release_files` | `paths?`, `id?`, `agent?`, `sessionId?` | `{ released }` (all your claims when no paths or id are given) |
| `claim_task` | `id`, `ttlMinutes?`, `agent?`, `sessionId?` | Assigns the board task to you, moves it to In progress and claims its files |
| `handoff_note` | `summary?`, `done?`, `next?`, `blockers?`, `taskId?`, `files?`, `agent?`, `sessionId?` | The stored note |

`agent` defaults to the MCP client name sent in `initialize`, and `sessionId` defaults to this server process.

## Claude Code

Project-scoped, shared with your team through `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "agentneuron": {
      "command": "npx",
      "args": ["-y", "agentneuron", "mcp"]
    }
  }
}
```

Or from the CLI:

```sh
claude mcp add agentneuron -- npx -y agentneuron mcp
```

With a global install or the per-project bundle:

```json
{ "mcpServers": { "agentneuron": { "command": "agentneuron", "args": ["mcp", "."] } } }
```

```json
{ "mcpServers": { "agentneuron": { "command": "node", "args": [".agentneuron/agentneuron.mjs", "mcp"] } } }
```

## Cursor

`.cursor/mcp.json` in the project (or `~/.cursor/mcp.json` for all projects):

```json
{
  "mcpServers": {
    "agentneuron": {
      "command": "npx",
      "args": ["-y", "agentneuron", "mcp", "."]
    }
  }
}
```

Other clients (Codex, Windsurf, Gemini CLI, Zed, Continue...) use the same stdio command: `npx -y agentneuron mcp <dir>`; consult each tool's MCP documentation for where to put it.

## Test it by hand

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"project_info","arguments":{}}}' \
  | npx agentneuron mcp .
```

AgentNeuron can also manage the MCP servers your project declares: the Agents > MCP page lists them, and with `edit`/`exec` enabled you can add, remove and test them (`agents.mcp.add`, `agents.mcp.remove`, `agents.mcp.test`; see [actions](actions.md)).
