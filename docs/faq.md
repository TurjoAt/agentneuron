# FAQ

Short, self-contained answers about AgentNeuron. For setup steps see [getting started](getting-started.md).

## General

### What is AgentNeuron?

AgentNeuron is an open-source (MIT) Node.js CLI, local web dashboard and read-only MCP server for the context files AI coding agents read: `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, Cursor rules, GitHub Copilot instructions, Windsurf rules, skills, subagents and MCP configs. It monitors them live, lints them, shows what each agent sees, and can act on them when you allow it.

### Who is it for?

Developers and teams who use one or more AI coding tools (Claude Code, Codex, Cursor, Copilot, Gemini CLI, Windsurf and others) and want to keep their instruction files correct, small, secret-free and consistent across tools.

### How do I install and run it?

Run `npx agentneuron` in your project and open `http://127.0.0.1:4747`. It needs Node.js 18 or newer. Global install (`npm i -g agentneuron`), a single-file bundle and a Docker image are also available; see [getting started](getting-started.md).

### Is it free?

Yes. It is MIT-licensed, has no paid tier, and needs no account.

## Privacy and safety

### Does it send my files anywhere?

No. There is no telemetry or analytics. The only outbound requests are webhooks you configure, commands you run yourself through actions (such as `git fetch` or `npm install`), and the MCP server test, which contacts an HTTP MCP server you declared.

### Does it change my project?

Not by default. It writes inside `.agentneuron/` only. Editing project files, running commands and the rest require you to enable a [permission level](permissions-and-security.md).

### Is it safe to run on a server?

Keep it on localhost and use an SSH tunnel, or put HTTPS and tokens in front of it. See [remote access](permissions-and-security.md#remote-access). Do not enable `exec`, `danger` or `terminal` on a server you expose over plain HTTP.

## Tools and usage

### Which AI tools does it understand?

Claude Code, Codex, Cursor, GitHub Copilot, Windsurf and Gemini CLI fully; Cline, Roo Code, Aider, Continue, Zed, Junie and Amazon Q in the Agents pages. See [supported tools](supported-tools.md). Add anything else with `extraPatterns`.

### Can I use it without Node installed?

Only with Docker: the image `ghcr.io/turjoat/agentneuron` contains Node and the bundle (see [examples/deploy](../examples/deploy/docker.md)). Otherwise it needs Node.js 18 or newer.

### Can I run it in CI?

Yes: `npx agentneuron lint --json` exits 1 on errors. See [examples/ci](../examples/ci/).

### How do I connect it to Claude Code, Cursor or VS Code?

Add the MCP server: `claude mcp add agentneuron -- npx -y agentneuron mcp` for Claude Code, or the `npx -y agentneuron mcp` command in `.cursor/mcp.json` or `.vscode/mcp.json`. The server is read-only. Snippets for each client are in the [README](../README.md#use-it-from-your-ai-agent-mcp) and [MCP](mcp.md).

### How do I keep CLAUDE.md, AGENTS.md and other tools' files in sync?

Open **Agents > Sync & drift**. It compares each pair of root instruction files and labels them `identical`, `linked`, `similar`, `drifted` or `diverged`. With `edit` enabled you can copy one file into the others or replace them with an `@import` of a single source. See [supported tools](supported-tools.md#sync-targets).

### How is it different from a Markdown linter?

A Markdown linter checks style. AgentNeuron knows which files each AI tool loads, follows `@imports`, computes the effective context per folder, and finds secrets, oversized context and drift between tools. See [comparison](comparison.md).

## Health, lint and tokens

### How is the health score calculated?

Penalty per issue (error 10, warning 3, info 0.5) normalised by the number of files, so large projects are not punished for a single warning. Any error prevents an A. Rules and thresholds are in [project intelligence](project-intelligence.md#lint-rules).

### Why does `agentneuron lint` flag a path in my docs as missing?

A backticked path with a file extension (for example `` `src/auth/login.ts` ``) is checked against the project. If the file is generated, lives elsewhere, or is only an example, put it in a fenced code block, remove the extension, or add its folder to `ignore`. Paths under folders like `dist`, `build`, `node_modules` and `storage` are skipped.

### How do I silence a secret false positive?

Placeholders (`your-api-key`, `changeme`, `xxxx`, `example`) are already ignored. For anything else, rewrite the value as an environment variable reference, or keep real-looking sample values out of tracked Markdown.

### How much does it cost me in tokens?

Nothing. AgentNeuron does not call any model. Token counts are local estimates, and costs in the Sessions view are estimated from your own session logs and the prices in `pricing`.

### Why are token counts different from my provider's?

They are approximations from characters and words, not a real tokenizer. Use them for comparison and budgeting, not billing.

## Data and setup

### What is stored in `.agentneuron/`? Should I commit it?

History, cache, trash, logs, board, bookmarks, config, and optionally the bundle. The generated `.gitignore` excludes `history/`, `cache/`, `trash/` and `*.jsonl`. Commit `config.json` if it holds no tokens and you want shared settings, and `agentneuron.mjs` if you want teammates to run it without npm. Otherwise add `.agentneuron/` to your `.gitignore`.

### What is the difference between `token` and `adminToken`?

With one `token`, whoever has it is admin. With `adminToken`, that one is admin and `token` becomes a read-only viewer token. Viewers can never run actions.

### Can several people use one instance?

Yes: give editors the admin token and everyone else the viewer token, behind HTTPS. Actions run as the user who started the server, and the audit log records the role and address of each call.

### Does it work with monorepos?

Yes. It tracks files at any depth, and the Context page shows the chain from the root to any subfolder. Use `ignore` to exclude packages, or `agentneuron workspace <dir>` for a folder of separate repositories.

### I renamed from `mdctl`. What happens to my data?

On first run an existing `.mdctl/` folder is moved to `.agentneuron/` (history, config and all). The old `mdctl` command is no longer installed. See [troubleshooting](troubleshooting.md#migrating-from-mdctl).

### How do I contribute or report a bug?

See [CONTRIBUTING.md](../CONTRIBUTING.md); security issues go through [SECURITY.md](../SECURITY.md).
