# FAQ

**Does it send my files anywhere?**
No. There is no telemetry or analytics. The only outbound requests are webhooks you configure, commands you run yourself through actions (such as `git fetch` or `npm install`), and the MCP server test, which contacts an HTTP MCP server you declared.

**Does it change my project?**
Not by default. It writes inside `.agentneuron/` only. Editing project files, running commands and the rest require you to enable a [permission level](permissions-and-security.md).

**Is it safe to run on a server?**
Keep it on localhost and use an SSH tunnel, or put HTTPS and tokens in front of it. See [remote access](permissions-and-security.md#remote-access). Do not enable `exec`, `danger` or `terminal` on a server you expose over plain HTTP.

**Which AI tools does it understand?**
Claude Code, Codex, Cursor, GitHub Copilot, Windsurf and Gemini CLI fully; Cline, Roo Code, Aider, Continue, Zed, Junie and Amazon Q in the Agents pages. See [supported tools](supported-tools.md). Add anything else with `extraPatterns`.

**Can I use it without Node installed?**
No; it needs Node 18+. Docker works too: see [examples/deploy](../examples/deploy/).

**Can I run it in CI?**
Yes: `npx agentneuron lint --json` exits 1 on errors. See [examples/ci](../examples/ci/).

**How is the health score calculated?**
Penalty per issue (error 10, warning 3, info 0.5) normalised by the number of files, so large projects are not punished for a single warning. Any error prevents an A. Rules and thresholds are in [project intelligence](project-intelligence.md#lint-rules).

**Why does `agentneuron lint` flag a path in my docs as missing?**
A backticked path with a file extension (for example `` `src/auth/login.ts` ``) is checked against the project. If the file is generated, lives elsewhere, or is only an example, put it in a fenced code block, remove the extension, or add its folder to `ignore`. Paths under folders like `dist`, `build`, `node_modules` and `storage` are skipped.

**How do I silence a secret false positive?**
Placeholders (`your-api-key`, `changeme`, `xxxx`, `example`) are already ignored. For anything else, rewrite the value as an environment variable reference, or keep real-looking sample values out of tracked Markdown.

**What is stored in `.agentneuron/`? Should I commit it?**
History, cache, trash, logs, board, bookmarks, config, and optionally the bundle. The generated `.gitignore` excludes `history/`, `cache/`, `trash/` and `*.jsonl`. Commit `config.json` if it holds no tokens and you want shared settings, and `agentneuron.mjs` if you want teammates to run it without npm. Otherwise add `.agentneuron/` to your `.gitignore`.

**How much does it cost me in tokens?**
Nothing. AgentNeuron does not call any model. Token counts are local estimates, and costs in the Sessions view are estimated from your own session logs and the prices in `pricing`.

**Why are token counts different from my provider's?**
They are approximations from characters and words, not a real tokenizer. Use them for comparison and budgeting, not billing.

**What is the difference between `token` and `adminToken`?**
With one `token`, whoever has it is admin. With `adminToken`, that one is admin and `token` becomes a read-only viewer token. Viewers can never run actions.

**Can several people use one instance?**
Yes: give editors the admin token and everyone else the viewer token, behind HTTPS. Actions run as the user who started the server, and the audit log records the role and address of each call.

**Does it work with monorepos?**
Yes. It tracks files at any depth, and the Context page shows the chain from the root to any subfolder. Use `ignore` to exclude packages, or `agentneuron workspace <dir>` for a folder of separate repositories.

**I renamed from `mdctl`. What happens to my data?**
On first run an existing `.mdctl/` folder is moved to `.agentneuron/` (history, config and all). The old `mdctl` command is no longer installed. See [troubleshooting](troubleshooting.md#migrating-from-mdctl).

**How do I contribute or report a bug?**
See [CONTRIBUTING.md](../CONTRIBUTING.md); security issues go through [SECURITY.md](../SECURITY.md).
