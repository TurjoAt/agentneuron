# Example configurations

Copy one of these to `<your-project>/.agentneuron/config.json` and restart AgentNeuron. JSON does not allow comments, so each file is explained here. Every key is documented in [docs/configuration.md](../../docs/configuration.md).

All token values are placeholders. Generate real ones with:

```sh
openssl rand -hex 24
```

Keep a config that contains tokens or webhook URLs out of git (`chmod 600`).

## `default.json`

What `agentneuron init` writes. Localhost only, read-only, every Markdown file tracked.

## `read-only-remote.json`

Monitoring-only server, reached through an SSH tunnel or an HTTPS reverse proxy.

- `host: 127.0.0.1` : keep it loopback and let the tunnel or proxy handle the network ([remote access](../../docs/permissions-and-security.md#remote-access)).
- `token` : with no `adminToken`, the token holder is admin, but all four action levels are `false`, so there is nothing destructive to do. Anyone with the token can still read every tracked file.
- `ignore` : skip folders that are noisy or not yours.

```sh
cp examples/config/read-only-remote.json .agentneuron/config.json
ssh -N -L 4747:127.0.0.1:4747 you@server        # from your laptop
```

## `admin-and-viewer.json`

Two roles for a small team.

- `adminToken` : you. Can use `state` features and the enabled action levels.
- `token` : colleagues. Because `adminToken` is set, this is a **read-only viewer** token; viewers never run actions.
- `actions.edit: true` : admins can edit Markdown and use git staging/commit from the UI. `exec`, `danger`, `terminal` stay off.

Use this behind HTTPS only.

## `actions-enabled.json`

Single-user workstation setup: edit and exec on, danger and terminal off.

- `exec` allows package manager commands, scripts, `git fetch/pull/push`. Every run is previewed, shown as a job, and written to `.agentneuron/audit.jsonl`.
- `historyLimitPerFile` keeps more versions; `maxFileSize` raises the 1 MiB read limit to 2 MiB.

Equivalent CLI: `agentneuron --enable edit,exec`.

## `webhooks.json`

Send events to Slack and Discord.

- `events` filters per webhook. Valid names: `secret`, `conflict`, `health-drop`, `job-failed`, `job-done`. Leave `events` out to receive all.
- The payload has `text` (Slack) and `content` (Discord) plus `type`, `title`, `body`, `level`, `ts`.
- Webhook URLs are credentials. They appear masked in the UI.
- Targets on loopback, private networks or cloud-metadata addresses are refused. For an internal chat server set `"allowPrivate": true` inside `notifications` (or on that webhook).

Test by running a failing action, or by adding a fake-looking credential to a tracked Markdown file (the `secret` event).

## `custom-patterns.json`

Control what is tracked.

- `ignore` : plain names match any path segment; entries with `/` or `*` are globs.
- `extraPatterns` : track and classify extra files. They take priority over the built-in catalogue.
- `includeAllMarkdown: false` : only files that match a pattern (built-in or yours) are tracked, instead of every `.md`.
- `pricing` : override per-million-token USD prices used for session cost estimates.
