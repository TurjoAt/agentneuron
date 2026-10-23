# Permissions and security

AgentNeuron is a local developer tool. It reads your project and, if you allow it, changes it and runs commands. The defaults are conservative; this page explains every control.

## Defaults

- Listens on `127.0.0.1` only.
- Read-only: nothing beyond `read` and AgentNeuron's own `state` is enabled.
- No token on loopback (anyone who can connect to the port is admin). On a shared machine, set a token.
- Non-loopback `--host` forces a token; one is generated and printed if you do not provide it.

## Permission levels

Each API route and each action has a minimum level.

| Level | Meaning | Who can use it | Turned on by |
|---|---|---|---|
| `read` | Monitoring, search, graph, health, git read-only views, reports | everyone who is authenticated (viewer or admin) | always |
| `state` | Writes only inside `.agentneuron/`: task board, bookmarks, annotations, rescan, snapshot, cancelling jobs, reading the audit log | admin | always (admin role) |
| `edit` | Writes tracked project files (Markdown and agent config): save/create/rename/delete (to trash), replace, apply lint fixes, templates, sync, history restore, Markdown write-back from the task board, git stage/commit/branch/stash/tag | admin | `actions.edit` |
| `exec` | Runs commands: package manager install/add/remove/update/outdated/audit, `scripts.run`, artisan (allow-listed), git fetch/pull/push, MCP server test, starting a workspace instance. Also writing files that make agent tools run commands: `.claude/settings*.json` (hooks, permissions), `.mcp.json`, `.cursor/mcp.json`, `.codex/config.toml`, `.gemini/settings.json` | admin | `actions.exec` |
| `danger` | Destructive: discard changes, delete branches, drop stash, purge trash, clear history, run migrations | admin | `actions.danger` |
| `terminal` | Free-form command line (`agentneuron.terminal`). Needs `terminal` **and** `danger`. | admin | `actions.terminal` and `actions.danger` |

A level is usable only when the caller is admin **and** the level is enabled. Disabled requests return `403` with the exact setting to change. Viewers never get anything above `read`.

Enable with the CLI for one run, or in config:

```sh
agentneuron --enable edit,exec
```

```json
{ "actions": { "edit": true, "exec": true, "danger": false, "terminal": false } }
```

Settings > Permissions shows what is on, and `GET /api/actions` lists every action with `enabled` and a `reason` when it is not.

How commands are run: always spawned directly, never through a shell. Parameters are validated against a schema (type, pattern, length, enum). Package names and versions must match strict patterns, script names must exist in the manifest, `artisan` commands come from an allow-list, paths must be project-relative and cannot contain `..`. The working directory cannot leave the project. Each job has a timeout (10 minutes; 5 for the terminal), at most 3 run at once, and logs are capped.

`terminal` still lets an authorised admin run any program with your user's rights. It is for trusted, single-user setups only.

## Roles and tokens

| Configuration | Result |
|---|---|
| no `token`, no `adminToken` | everyone is `admin` (loopback by default) |
| `token` only | the holder of `token` is `admin`; no token, no access |
| `adminToken` and `token` | `adminToken` is `admin`; `token` is read-only `viewer` |

Generate strong tokens:

```sh
openssl rand -hex 24
```

Ways to present a token:

1. The login screen in the UI. It calls `POST /api/auth/login` and sets an `agentneuron_session` cookie: `HttpOnly`, `SameSite=Strict`, 7 days, in-memory (restarting the server logs everyone out).
2. `Authorization: Bearer <token>` header. Best for scripts.
3. `?token=<token>` query parameter. Convenient (the startup banner prints such a URL) but the token then lands in browser history, proxy logs and referrers. Avoid it on shared or remote setups.

The static HTML shell is served without authentication; everything that returns data lives under `/api/` and requires a token whenever one is configured. `GET /api/auth/me` reports the current role and which levels are available to it.

Protections:

- Token comparison is constant-time.
- Brute-force protection: every wrong token (login, `Authorization`, or `?token=`) counts against the client address. After 5 misses the address is blocked with `429` and a `Retry-After` header, starting at 30 seconds and doubling up to 15 minutes. Behind a reverse proxy every client appears as the proxy's address, so one bad actor can lock out the others.
- Cross-site request protection: state-changing requests (`POST`) are refused with `403` when `Sec-Fetch-Site` is cross-site or when `Origin` does not match `Host`, and request bodies must be `application/json` (`415` otherwise). Your proxy must therefore pass the original `Host` header through.
- DNS-rebinding protection: when **no token** is configured, requests whose `Host` header is not `localhost`, `127.0.0.1`, `::1` or the configured `--host` are refused (`403 invalid host header`). If you put a proxy in front of an instance, set tokens.
- The session cookie gets the `Secure` attribute when the request arrived over HTTPS (directly or via `X-Forwarded-Proto: https`).
- Responses carry `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and a Content-Security-Policy that allows only the UI's own inline script (by hash) and same-origin connections.
- Request bodies are limited to 2 MB (or twice `maxFileSize` if larger); at most 100 live event streams; slow requests time out after 60 seconds.

Viewers can read file contents, history and git data, and also the list of jobs with their full output (`/api/jobs`, `/api/job`) and the settings view (`/api/settings`). Job output can contain command results from admin-run actions. If the project contains a secret in a Markdown file, a viewer can see it (the scanner flags it; MCP output, audit log and notifications mask it). Give the viewer token only to people who may read the repository.

## Audit log

`.agentneuron/audit.jsonl`, one JSON object per line, newest read first in Settings > Audit log or `GET /api/audit?limit=200` (admin). Recorded:

- every action run, with `status: "started"` then `ok`, `error` or `cancelled`, plus job id and exit code;
- every request to a `state`, `edit` or `danger` route, including refusals (`403`);
- failed logins.

Fields include `ts`, `role`, `ip`/`by`, `route` or `action`, `params`, `status`. Parameters are masked: values for keys that look sensitive (token, secret, password, api key, cookie, credential...) become `***`, file `content` is replaced by its length, strings are scanned for known secret formats, long strings are truncated. The file rotates at 20 MB and three old files are kept. It is evidence for you, not tamper-proof: anyone with `edit`/`terminal` rights on the machine can alter files.

## Remote access

Prefer not to expose AgentNeuron at all. In order of preference:

### 1. SSH tunnel (recommended)

Keep the server on loopback and forward the port:

```sh
# on the server
agentneuron /srv/app --admin-token "$(openssl rand -hex 24)" --token "$(openssl rand -hex 24)"

# on your laptop
ssh -N -L 4747:127.0.0.1:4747 you@server
# browse http://127.0.0.1:4747
```

Traffic is encrypted and authenticated by SSH. No firewall port is opened.

### 2. Reverse proxy with HTTPS

When a tunnel is not practical, put a TLS-terminating proxy in front and keep AgentNeuron on loopback (`--host 127.0.0.1`, the default). Requirements:

- HTTPS only, redirect HTTP to HTTPS.
- Tokens set (`--admin-token` and `--token`). Never run without one behind a proxy.
- Disable response buffering for `/api/stream` (Server-Sent Events) and allow long reads.
- Forward the `Host` header unchanged.
- Never enable `exec`, `danger` or `terminal` unless the connection is encrypted, and prefer leaving them off for remote use.
- Optionally add proxy-level protection: IP allow-list, HTTP basic auth, or an SSO proxy.

Caddy (automatic certificates):

```caddyfile
agentneuron.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:4747 {
        flush_interval -1
    }
}
```

nginx / OpenResty:

```nginx
server {
    listen 80;
    server_name agentneuron.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name agentneuron.example.com;

    ssl_certificate     /etc/letsencrypt/live/agentneuron.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/agentneuron.example.com/privkey.pem;

    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:4747;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_buffering off;          # Server-Sent Events (/api/stream)
        proxy_read_timeout 3600s;
    }
}
```

Under OpenResty (for example behind 1Panel) the same `location` block works unchanged. Complete files are in [examples/deploy](../examples/deploy/).

### 3. Binding to a network interface directly

```sh
agentneuron --host 0.0.0.0 --admin-token "$ADMIN" --token "$VIEWER"
```

This serves plain HTTP: tokens and cookies travel in clear text. Use it only on a trusted private network, with `exec`, `danger` and `terminal` off. Open the port in your firewall only to the addresses that need it.

## Checklist before going beyond localhost

- [ ] Tokens set, long and random, not in shell history or git.
- [ ] HTTPS (proxy or tunnel).
- [ ] `exec`, `danger`, `terminal` off, or consciously on with TLS in place.
- [ ] Audit log location backed up or shipped if you need an audit trail.
- [ ] Firewall allows only the proxy or tunnel.
- [ ] `.agentneuron/config.json` is not committed and is mode 600.

## What AgentNeuron never does

- It does not send your files, telemetry or analytics anywhere. The only outbound requests are the webhooks you configure and the commands you run (for example `git fetch`, `npm install`) and the MCP server test action, which contacts the URL of an HTTP MCP server you configured.
- It does not read outside the project except the Claude/Codex session transcripts under your home directory for the Sessions and cost views, and your home agent config if `includeGlobalAgents` is true.
- It does not write outside `.agentneuron/` unless you enabled `edit` and used an editing feature. Writes are confined to tracked Markdown and agent-config files inside the project: absolute paths, `..`, symlinks leaving the project, and `.git`, `.agentneuron` and `node_modules` are refused.

## Webhooks and outbound requests

Webhook delivery is guarded against server-side request forgery: only `http(s)` URLs, redirects are never followed, and targets that are loopback, private (RFC 1918), link-local, carrier-grade NAT, multicast or cloud-metadata addresses are refused. The check is applied to the address actually connected to, so DNS tricks do not bypass it. To deliver to an internal service (for example a self-hosted chat on your LAN) set `"allowPrivate": true` in `notifications`, or on a single webhook. See [configuration](configuration.md#notifications).

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
