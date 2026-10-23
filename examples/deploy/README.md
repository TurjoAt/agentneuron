# Deployment examples

Defaults first: AgentNeuron is a local tool and is happiest on `127.0.0.1`. Reach a remote one with an SSH tunnel:

```sh
ssh -N -L 4747:127.0.0.1:4747 you@server
```

If you need a public URL, use HTTPS plus tokens, and keep `exec`, `danger` and `terminal` off. Read [permissions and security](../../docs/permissions-and-security.md) first.

| File | Purpose |
|---|---|
| [`agentneuron.service`](agentneuron.service), [`install-systemd.md`](install-systemd.md) | systemd unit with hardening, runs on loopback as an unprivileged user |
| [`Dockerfile`](Dockerfile), [`docker.md`](docker.md) | Container image, `docker run` and Compose recipes |
| [`Caddyfile`](Caddyfile) | Caddy reverse proxy with automatic HTTPS |
| [`nginx.conf`](nginx.conf) | nginx / OpenResty reverse proxy with SSE support |

All hostnames, paths and tokens are placeholders.
