# AgentNeuron documentation

AgentNeuron is an open-source Node.js CLI, local web dashboard and read-only MCP server that monitors, lints and manages AI coding-agent context files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, Cursor rules, Copilot instructions, skills, subagents, MCP configs). New here? Run `npx agentneuron` and read [getting started](getting-started.md).

| Guide | What it covers |
|---|---|
| [Getting started](getting-started.md) | Install, first run, a tour of each page, enabling actions safely |
| [CLI reference](cli.md) | Every command and flag |
| [Configuration](configuration.md) | Every `.agentneuron/config.json` key |
| [Permissions and security](permissions-and-security.md) | Levels, roles, tokens, login, remote access, TLS, audit log |
| [Security overview](security.md) | One-page summary |
| [HTTP API](http-api.md) | Endpoints grouped by area, with required level |
| [Actions](actions.md) | Action ids, levels and parameters |
| [Truth check](verify.md) | Verify commands, scripts, paths and versions in context files against the repo |
| [Security audit](audit.md) | Risky MCP servers, permissions, hooks and secrets in agent config |
| [Context CI](ci.md) | `agentneuron ci`, GitHub annotations, `--base` diffs, the GitHub Action |
| [MCP](mcp.md) | Run the MCP server; Claude Code and Cursor configuration |
| [Live view](live.md) | Real-time view of the files agents are editing, from their transcripts |
| [Coordination](coordination.md) | Advisory file claims, task claims and handoff notes for several agents |
| [Supported tools](supported-tools.md) | Which files are detected for which AI tool |
| [Project intelligence](project-intelligence.md) | Stacks, dependencies, CI, env, Laravel, doc drift |
| [Architecture](architecture.md) | Module map, data flow, single-file build |
| [FAQ](faq.md) | Short answers to common questions |
| [Comparison](comparison.md) | How it relates to Markdown linters, sync scripts and manual review |
| [Troubleshooting](troubleshooting.md) | Ports, permissions, firewalls, migrating from mdctl |

See also the runnable [examples](../examples/) and the [changelog](../CHANGELOG.md).

`docs/internal/` holds design notes and contracts written during development. They are kept for contributors and may be out of date; the guides above are authoritative.
