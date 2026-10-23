# Security overview

A short summary. The full model, with configuration and remote-access recipes, is in [permissions-and-security.md](permissions-and-security.md). To report a vulnerability see [SECURITY.md](../SECURITY.md).

- **Local by default.** Listens on `127.0.0.1`. A non-loopback `--host` requires a token (one is generated if you do not set it).
- **Read-only by default.** Levels `read` and `state` only. `edit`, `exec`, `danger` and `terminal` are off until you enable them in `.agentneuron/config.json` (`actions`) or with `--enable`. `terminal` also needs `danger`.
- **Two roles.** `admin` and read-only `viewer` (`--admin-token` plus `--token`). Viewers can read project content, job output and settings, but never run or change anything.
- **No shell.** Commands are spawned as argument arrays after schema validation; script and package names are checked; paths cannot leave the project or touch `.git`, `.agentneuron` or `node_modules`.
- **Audit log.** Every action and every state/edit/danger request is recorded in `.agentneuron/audit.jsonl`, with secrets masked.
- **Web hardening.** Constant-time token checks, login backoff, CSRF and DNS-rebinding guards, strict `Content-Type`, a Content-Security-Policy and other security headers, SSRF-guarded webhooks.
- **Remote access.** Prefer an SSH tunnel. Otherwise use HTTPS (Caddy or nginx examples in [examples/deploy](../examples/deploy/)) with tokens, and never enable `exec`, `danger` or `terminal` without TLS.
- **No telemetry.** Nothing is sent anywhere except the webhooks and commands you configure.
