# Contributing to AgentNeuron

Thanks for helping! AgentNeuron is a local-first tool, so changes are reviewed with security and predictability in mind. By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

Requirements: Node.js >= 18 (22 recommended) and npm.

```bash
git clone https://github.com/__GH_OWNER__/agentneuron.git
cd agentneuron
npm ci
npm test                 # node:test, no extra tooling
npm run dev              # run the CLI from source: node src/cli.js start
npm run ui:dev           # Vite dev server for the UI; open it with ?mock=1 to use mock data (no backend needed)
npm run build            # vite + esbuild -> dist/agentneuron.mjs (use `node scripts/build.mjs --strict` to fail on UI errors)
node dist/agentneuron.mjs status .
```

All npm dependencies are `devDependencies` and get bundled into one file, so the published package has **zero runtime dependencies**. Do not add a runtime `dependencies` entry; add new libraries as devDependencies only if they bundle cleanly, and justify them in the PR.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/cli.js` | CLI entry (`start`, `workspace`, `mcp`, `lint`, `status`, `init`) |
| `src/core/` | config, store, file scanning |
| `src/server/` | HTTP/WebSocket server, auth |
| `src/actions/` | action registry and built-in actions (files, git, packages, agents, tasks) |
| `src/patterns/catalogue.json` | AI-tool file patterns (what counts as CLAUDE.md, Cursor rules, ...) |
| `src/health/`, `src/analysis/`, `src/git2/`, `src/project/` | lint, score, link graph, git and project intelligence |
| `src/mcp/` | MCP server over stdio |
| `ui/` | Svelte 5 + Vite UI, inlined into the bundle at build time |
| `test/` | `*.test.js` using `node:test` |
| `scripts/build.mjs` | build script (vite then esbuild) |

## Coding conventions

- **ESM only**, Node 18 compatible (no APIs newer than Node 18 without a guard).
- **No shell spawning.** Use `execFile`/`spawn` with an argument array and an allowlist; never build command strings from user input. Validate package names, versions and arguments (see `src/actions/packages.js`).
- **Validate every path.** Anything that touches the filesystem on behalf of a request must resolve inside the project root (see `safeRelPath` in `src/actions/registry.js`). Reject absolute paths, `..` and symlink escapes.
- **Respect permission levels.** Actions declare a level: `state` (admin role) or `edit`, `exec`, `danger` (plus `terminal`), which are OFF unless enabled with `--enable` or `.agentneuron/config.json`. A new action must pick the lowest level that works and validate its params with a schema.
- **Local-first.** No telemetry, no outbound network calls unless the user triggers them explicitly.
- Keep modules small, side-effect free where possible, and cover them with tests.
- Match the existing style (`.editorconfig`: 2 spaces, LF, final newline).

## Tests

Tests use the built-in `node:test` runner and create their own **temporary directories** (`fs.mkdtemp(os.tmpdir())`), cleaning up afterwards. Never write to the repo or to the user's home directory from a test. Run a single file with `node --test test/health-lint.test.js`. Security-relevant changes (paths, auth, actions) need a test for the rejection case, not only the happy path.

## Recipes

### Add an AI-tool pattern

1. Add the tool's config file globs to `src/patterns/catalogue.json`, following an existing entry (`glob`, `tool`, `kind`, `description`).
2. Add a fixture under `test/fixtures/` and a test asserting it is detected.
3. Mention the tool in the README supported-tools list.

Open an "AI tool support" issue first if you are unsure about the file conventions.

### Add a detector (lint rule / health check)

1. Add the check in `src/health/lint.js` (or a new module imported from it). Return issues with a stable `rule` id, a `level` (`error`/`warn`/`info`), a file path and message.
2. Errors make `agentneuron lint` exit 1, so use `error` sparingly.
3. Add tests in `test/health-lint.test.js` covering a positive and a negative case.

### Add an action

1. Create or extend a module in `src/actions/` exporting `default function register(registry, ctx)` and register a definition with an `id`, `level` (`state|edit|exec|danger`), params schema and handler (see `src/actions/registry.js`).
2. Use the lowest permission level possible; use `ctx` helpers for job execution rather than spawning processes yourself.
3. Add a test in `test/` (see `project-actions.test.js`) including permission-denied and invalid-param cases.

## Commit messages: Conventional Commits

Format: `type(scope): short imperative summary`.

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`, `security`.
Scopes (examples): `cli`, `server`, `ui`, `mcp`, `actions`, `git`, `health`, `patterns`, `build`, `docker`, `deps`.

```
feat(patterns): detect Windsurf rules files
fix(server): reject path traversal in file read endpoint
docs(readme): document --enable levels
ci: add Node 22 on Windows
feat(actions)!: rename exec level   <- "!" or a BREAKING CHANGE: footer marks a breaking change
```

## Branches and pull requests

- Branch from `main`: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`, `chore/<topic>`.
- Keep PRs focused; update tests and docs with the code.
- Checklist (also in the PR template): `npm test` passes, `node scripts/build.mjs --strict` passes, no new runtime dependency, paths/permissions considered, `CHANGELOG.md` updated for user-visible changes, Conventional Commit title.

## Labels

| Label | Meaning |
| --- | --- |
| `bug` | Something is broken |
| `enhancement` | New feature or improvement |
| `ai-tool-support` | Request/PR for a new AI tool's config files |
| `security` | Security-related (report vulnerabilities privately, see SECURITY.md) |
| `documentation` | Docs only |
| `good first issue` | Small, well-scoped, beginner friendly |
| `help wanted` | Maintainer would welcome a PR |
| `dependencies` | Dependabot / dependency updates |
| `github-actions` | Workflow updates |
| `triage` | New, not yet reviewed |
| `breaking` | Changes public behavior |
| `wontfix` / `duplicate` / `question` | Closed without action / duplicate / support |

## Releasing (maintainers)

One-time setup:

1. Create an npm automation/granular token with publish rights and add it as repository secret **`NPM_TOKEN`**.
2. Provenance: the release workflow has `id-token: write` and runs `npm publish --provenance`; this requires the repository to be public and published from GitHub-hosted runners.
3. GitHub Packages: published as `@__GH_OWNER__/agentneuron` using the built-in `GITHUB_TOKEN` (`packages: write`); no extra secret.
4. ghcr.io: image `ghcr.io/__GH_OWNER__/agentneuron` is pushed with `GITHUB_TOKEN`; after the first push, set the package visibility to public in the package settings.
5. Enable "Private vulnerability reporting" and Discussions in repository settings.

Per release:

1. Make sure `main` is green.
2. Update `CHANGELOG.md` (move Unreleased entries under the new version/date).
3. `npm version <patch|minor|major> --no-git-tag-version`, commit as `chore(release): vX.Y.Z`, merge to `main`.
4. Locally: `npm ci && npm run prepublishOnly && npm run pack:check` and inspect the file list.
5. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`, then create a GitHub Release from the tag (the **release published** event triggers `release.yml`). The tag must match `package.json` version; the workflow checks this.
6. Verify: `npx agentneuron@X.Y.Z --version`, the GitHub Release has `agentneuron.mjs` and its `.sha256`, the Docker image runs.

After npm publish the package is served automatically by unpkg and jsDelivr, e.g. `https://cdn.jsdelivr.net/npm/agentneuron@X.Y.Z/dist/agentneuron.mjs`.
