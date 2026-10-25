# Truth check (`verify`)

Context files go stale quietly: a script gets renamed, the team moves from yarn to pnpm, React is upgraded, an env var is renamed. Agents keep following the old instructions. The truth check extracts every *checkable* claim from your context files and verifies it against the repository.

```sh
agentneuron verify                 # list false and unknown claims; exit 1 if any is false
agentneuron verify --all           # also list the claims that checked out
agentneuron verify --fix-preview   # show the line edit each suggested fix would make (writes nothing)
agentneuron verify --json          # { root, summary, claims[, fixes] }
```

On [`examples/drifted-project`](../examples/drifted-project/):

```
CLAUDE.md
     3  FALSE   version    `Node 18+`  package.json engines.node is >=20
                       fix: replace `Node 18+` with `Node 20+`
     3  FALSE   version    `React 17`  react is ^18.3.1 in package.json
                       fix: replace `React 17` with `React 18`
     7  FALSE   command    `yarn install`  project uses pnpm (pnpm-lock.yaml)
                       fix: replace `yarn install` with `pnpm install`
     8  FALSE   port       `port 3000`  "dev" script sets port 5173
                       fix: replace `port 3000` with `port 5173`
     9  FALSE   dependency `Jest`  jest is not a dependency; the project uses vitest as its test runner
                       fix: replace `Jest` with `Vitest`
    10  UNKNOWN command    `pnpm run typecheck`  no "typecheck" script; it may be a binary (node_modules not installed)
    11  FALSE   command    `make release`  no "release" target in Makefile (has: build, test)
                       fix: add a "release" target to Makefile or remove this instruction
    15  FALSE   path       `src/api/client.ts`  src/api/client.ts does not exist
                       fix: update the path or remove the mention
    16  FALSE   env        `STRIPE_SECRET`  not in .env.example and not referenced in source
                       fix: add STRIPE_SECRET to .env.example or remove the mention

14 claims in 1 context files: 5 ok, 8 false, 1 unknown (--all lists ok claims)
```

## What is checked

Files: tracked files of kind `context`, `rules`, `agent`, `skill`, `command` and `memory` (CLAUDE.md, AGENTS.md, GEMINI.md, Cursor/Copilot/Windsurf rules, skills, subagents...). READMEs and docs are not instructions and are skipped, as are nested sample projects (`examples/`, `fixtures/`, `templates/`...).

| Kind | Claim | Verified against |
|---|---|---|
| `command` | `npm run x`, `npm test`, `pnpm x`, `yarn x`, `bun run x` | package manager (single lockfile or `packageManager`), scripts of the nearest `package.json` (respects `cd dir &&`), dependency binaries |
| `command` | `make x`, `make -C dir x` | targets of the nearest Makefile |
| `command` | `composer x`, `php artisan x` | `composer.json` scripts and built-ins; `artisan` file |
| `command` | `pytest`, `cargo x`, `go x`, `poetry`/`uv` | Python manifests/pytest config, `Cargo.toml`, `go.mod`, `[tool.poetry]` vs `uv.lock` |
| `script` | "the \`build\` script" | scripts of every `package.json` / `composer.json` |
| `path` | backticked paths such as \`src/api/client.ts\` | the file tree (relative to the file or the root, shortened paths accepted) |
| `version` | `Node 20`, `Node 18+`, `PHP 8.2`, `Python 3.12` | `.nvmrc`/`.node-version`/`.tool-versions`, `engines.node`, `require.php`, `requires-python`, `.python-version` |
| `version` | `React 18`, `Next.js 14`, `Laravel 11`, `Vite 5`, ... | declared ranges in package.json / composer.lock / composer.json |
| `dependency` | Jest vs Vitest vs Mocha, Playwright vs Cypress, Prisma/Drizzle/TypeORM/Sequelize, ESLint vs Biome | the mentioned tool is absent while a same-purpose tool is present |
| `env` | \`DATABASE_URL\` on a line about env/secrets, `process.env.X`, `${X}` | `.env.example` (and siblings) key names, then UPPER_SNAKE names in source/config files |
| `port` | `port 3000`, `localhost:3000` | an explicit `--port`/`-p`/`PORT=` in the script named on the same line (false), or any configured port (ok) |

Each claim is `{ id, file, line, kind, text, status, evidence, suggestion, fixable }` with `status` one of `ok`, `false` or `unknown`.

## Precision rules

A false positive teaches people to ignore the tool, so anything uncertain is `unknown`, never `false`:

- Commands are read only from inline code and shell fences (`sh`, `bash`, `console`, no language). Code in other languages is ignored.
- Fences whose info string or preceding line/heading says *example*, *sample* or *template*, and sections headed "Examples", are skipped. So are lines containing "e.g." or "for example".
- Placeholders (`<script>`, `{name}`, `$VAR`, `...`, `foo`) are not claims.
- Prose framework mentions on lines with negations ("not", "instead of", "migrated from", "legacy"...) are skipped.
- URLs are ignored (except `localhost:<port>`).
- No `package.json` means npm claims are `unknown`; the package manager is only "certain" with exactly one lockfile family or a `packageManager` field; workspace-scoped commands (`--filter`, `-w`, `--prefix`) are only checked against all workspaces; `pnpm x` that might be a dependency binary is `unknown` until `node_modules` is installed.
- Runtime ranges: "Node 20" is fine with `>=18`; "Node 18+" is false only when it understates the floor (`>=20`).
- `<!-- agentneuron-ignore -->` on its own line skips the next line; inline it skips its line. `<!-- agentneuron-ignore-start -->` ... `<!-- agentneuron-ignore-end -->` skips a block.

## In the health score

False claims (except paths, which the `missing-path` rule already reports) appear as the warn-level lint rule **`false-claim`** and count toward the health score, in `agentneuron lint`, the Health page and `get_health`. Repo facts are cached for 15 seconds (or until a root manifest changes); renaming a script updates `/api/verify` immediately and the health score at the next analysis.

## Fixing

Each false claim with a concrete replacement is `fixable`. In the UI (Truth & safety > Truth check) **Apply fix** appears when the `edit` level is enabled; it calls `POST /api/verify/fix` with the claim id. The server recomputes the replacement from the current file (the client never supplies text), refuses with `409` if the file changed on disk, and writes through the same safe file operations as the editor (realpath confinement, history snapshot before and after). Agent-config files that can run commands still need `exec`.

Also available as the MCP tool `verify_context` and `GET /api/verify`.
