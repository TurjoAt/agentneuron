# Troubleshooting

Set `AGENTNEURON_DEBUG=1` to print internal warnings to stderr.

## The port is in use

```
agentneuron: listen EADDRINUSE: address already in use 127.0.0.1:4747
```

Another instance (or program) has 4747. Pick another port or a random one:

```sh
agentneuron --port 4748
agentneuron --port 0          # random free port, shown in the banner
```

Find the owner with `ss -ltnp | grep 4747` (Linux) or `lsof -i :4747` (macOS).

## I can't reach it from another machine

By default it listens on `127.0.0.1` only. For remote use prefer an SSH tunnel (`ssh -N -L 4747:127.0.0.1:4747 user@server`). To bind a network interface, add `--host 0.0.0.0` with tokens, and open the port in the firewall:

```sh
sudo ufw allow from 203.0.113.0/24 to any port 4747 proto tcp     # ufw
sudo firewall-cmd --add-port=4747/tcp --permanent && sudo firewall-cmd --reload   # firewalld
```

Cloud providers also have their own security groups. Containers must publish the port (`-p 127.0.0.1:4747:4747`) and run with `--host 0.0.0.0` inside; see [examples/deploy](../examples/deploy/). Then read [remote access](permissions-and-security.md#remote-access).

## 401 unauthorized / the login screen keeps appearing

A token is required (always when `--host` is not loopback). Use the token printed in the banner, or the one in `.agentneuron/config.json`. Restarting the server invalidates browser sessions; log in again. Behind a reverse proxy, make sure it forwards the `Host` header, otherwise cookie logins are refused as cross-origin.

## 403 "invalid host header"

With no token configured, AgentNeuron only answers requests whose `Host` is `localhost`, `127.0.0.1`, `::1` or the `--host` you set (protection against DNS rebinding). Reaching it through a proxy, tunnel service or another hostname trips this. Set a token (`--token`), which turns the check off because every request then needs credentials, and use HTTPS in front.

## 429 too many attempts

Five wrong tokens from one address block that address for 30 seconds, doubling on each further miss up to 15 minutes (`Retry-After` tells you). Behind a reverse proxy all users share the proxy's address, so one mistyped token can briefly block everyone. Wait, or restart the server to clear the counters.

## 415 / 403 "cross-origin" on a script call

`POST` requests need `Content-Type: application/json` and must not carry a foreign `Origin`. With curl add `-H 'content-type: application/json'`.

## 403 "action level is disabled"

That is the permission system working. The message names the setting; for example `--enable edit` or `{"actions":{"edit":true}}` in `.agentneuron/config.json`, then restart. Viewers (read-only token) always get 403 on writes: use the admin token.

## Nothing changes when I edit config.json

The file is read at startup: restart. If it has a JSON syntax error it is silently ignored; validate it:

```sh
node -e "JSON.parse(require('fs').readFileSync('.agentneuron/config.json','utf8'))"
```

Command-line flags override the file.

## Permission denied / read-only or root-owned directories

AgentNeuron writes to `<project>/.agentneuron/`. If the project or `.agentneuron/` is owned by another user (for example it was created with `sudo`, or the project is mounted read-only), monitoring still works but history, logs and the board cannot be saved, and saving from the UI fails. Fix ownership:

```sh
sudo chown -R "$USER" .agentneuron
# or, if the whole project is root-owned
sudo chown -R "$USER" .
```

Do not run AgentNeuron as root to work around it, especially with `exec` or `terminal` enabled. For a project you cannot or do not want to write to, work on a copy, or accept read-only monitoring.

The same applies to `init`: `agentneuron init` fails if it cannot create `.agentneuron/`.

## Files are missing from the list

- Only known AI-tool files and Markdown are tracked. Add others with `extraPatterns`.
- Check `ignore`; and the always-ignored folders (`node_modules`, `vendor`, `dist`, `build`, `.next`, `storage`, `.git`, `.agentneuron`).
- Files over `maxFileSize` (1 MiB default) and binary files are skipped.
- With `includeAllMarkdown: false`, only files matching a pattern are tracked.
- Trigger a rescan with the `agentneuron.rescan` action (Settings > Jobs, or `POST /api/actions/run`).

## Changes are not detected live

The watcher relies on file-system events. On network drives, some Docker bind mounts on macOS/Windows, and WSL paths under `/mnt/c`, events may not arrive. Run AgentNeuron where the files live (inside WSL's Linux file system, or inside the container), or trigger a rescan. If you hit the OS watcher limit on Linux (`ENOSPC`):

```sh
echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf && sudo sysctl -p
```

## Git page is empty / "git not available"

Git must be installed and the project must be inside a repository. In containers, mark the directory safe: `git config --global --add safe.directory /project`. A repository owned by a different user triggers git's "dubious ownership" protection with the same effect.

## Sessions and cost are empty

They read Claude Code transcripts from `~/.claude/projects/<project>/` and Codex sessions from `~/.codex/sessions`. They are empty if you never used those tools in this project, run AgentNeuron as a different user than your agent, or run it in a container without the home folder mounted.

## The UI says "The UI bundle is not built"

You are running from a source checkout without a build. Run `npm run build`, or use `npx agentneuron`. The JSON API works either way.

## Live updates stop behind a proxy

Server-Sent Events need response buffering off and long timeouts. nginx: `proxy_buffering off; proxy_read_timeout 3600s;`. Caddy: `flush_interval -1`. The server also sends `X-Accel-Buffering: no`.

## Migrating from mdctl

AgentNeuron was previously called `mdctl`.

1. Install the new package: `npm i -g agentneuron` (or use `npx agentneuron`). Remove the old one: `npm rm -g mdctl`.
2. Run `agentneuron` in the project once. If `.mdctl/` exists and `.agentneuron/` does not, the folder is renamed to `.agentneuron/` automatically. History, config and logs carry over.
3. If both folders exist, nothing is moved; merge by hand (keep `.agentneuron/`, copy `config.json` and `history/` from `.mdctl/` if you need them) and delete `.mdctl/`.
4. Replace `node .mdctl/mdctl.mjs` with `npx agentneuron init` and `node .agentneuron/agentneuron.mjs`.
5. Update scripts, CI and `.gitignore` entries from `.mdctl/` to `.agentneuron/`, and any MCP config from `mdctl mcp` to `agentneuron mcp`.

`.mdctl` is still ignored by the scanner, so it never shows up as project content.

## Still stuck

Open an issue with the output of `agentneuron --version`, `node --version`, your OS, and the banner or error text (remove tokens).
