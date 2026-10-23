# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.2.x | Yes |
| < 0.2 (`mdctl`) | No |

Only the latest minor release receives security fixes while the project is pre-1.0.

## Reporting a vulnerability

Please **do not open a public issue**. Report privately via either:

1. GitHub: [Report a vulnerability](https://github.com/TurjoAt/agentneuron/security/advisories/new) (Security Advisories), or
2. Email **hi@turjo.me** with the subject `[agentneuron security]`.

Include the version, a description, reproduction steps or a proof of concept, and the impact you see.

Response targets: acknowledgement within 3 business days, an initial assessment within 7 days, and a fix or mitigation plan within 30 days for confirmed issues. We will credit reporters in the advisory unless you prefer to stay anonymous.

## Scope and threat model

AgentNeuron is a **local-first** developer tool. By default it:

- binds to `127.0.0.1` only,
- is **read-only**: actions beyond read/state (`edit`, `exec`, `danger`, `terminal`) are off unless explicitly enabled with `--enable` or `.agentneuron/config.json`,
- makes no telemetry or outbound network calls on its own,
- confines file access to the project root.

In scope: path traversal or symlink escapes, authentication/token bypass, command injection, XSS in the UI, cross-site/DNS-rebinding attacks against the local server, secret leakage, and permission-level bypasses.

Out of scope: issues requiring an attacker who already has local shell access as the same user, or who was handed an enabled `--enable danger/terminal` instance and token; findings in devDependencies that are not present in the published bundle.

## Deployment guidance

- Keep the default loopback binding. Binding to a non-loopback host (including the Docker image's `0.0.0.0`) auto-generates an access token; keep it secret and prefer a reverse proxy with TLS.
- Do not expose an instance with `exec`, `danger` or `terminal` enabled to a network you do not fully trust.
- Use `--admin-token` plus a separate read-only viewer `--token` when sharing a dashboard.
- Mount projects read-only (`-v "$PWD:/project:ro"`) in Docker when you only need monitoring.
