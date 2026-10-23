# Project intelligence

Beyond the AI-context files, AgentNeuron reads your project's manifests and config to show what you are building and how healthy the documentation around it is. This feeds the **Project** page and `/api/project*`. Detection is read-only and cached for 30 seconds (refreshed when manifests change). Nothing is executed during detection.

## What is detected

| Area | Source files | Shows |
|---|---|---|
| Node.js / JavaScript | `package.json`, lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock[b]`), `tsconfig.json` | Name, version, scripts, dependencies, package manager, frameworks and tools inferred from dependencies (Next.js with app/pages router, Nuxt, Astro, SvelteKit, Remix, Angular, React, Vue, Svelte, Solid, Express, NestJS, Fastify, Vite, Tailwind, TypeScript, Jest, Vitest, Mocha, Storybook, Prisma, Bun...) |
| PHP | `composer.json`, `composer.lock`, `artisan` | Dependencies, scripts, Laravel (plus Livewire, Inertia, Filament, Symfony), Pest |
| Python | `pyproject.toml`, `requirements*.txt`, `poetry.lock` | Dependencies, Python version, Django |
| Go, Rust, Ruby, Java/Kotlin, .NET, Deno | `go.mod`, `Cargo.toml`, `Gemfile`, `pom.xml`, `build.gradle[.kts]`, `*.csproj`, `deno.json` | Stack, dependencies, Rails, RSpec, Spring Boot, ASP.NET Core |
| Docker | `Dockerfile*`, `docker-compose*.yml`, `compose*.yaml` | Files and compose services (image, build, ports) |
| CI | `.github/workflows/*.yml`, `.gitlab-ci.yml`, `.circleci/config.yml`, `azure-pipelines.yml`, `Jenkinsfile`, `.travis.yml`, `bitbucket-pipelines.yml` | Provider, workflow names, triggers, jobs |
| Tooling and hosting | Husky, devcontainer, `vercel.json`, `netlify.toml` and similar | Listed as stacks |
| AI tools | Instruction and config files of Claude, Codex, Cursor, Copilot, Gemini, Windsurf, Cline, Roo, Aider, Junie | Which tools the repository is set up for |
| Environment | `.env.example` (or `.sample`, `.dist`, `.template`) vs `.env`, `.env.local`, `.env.development`, `.env.production` | **Key names only, never values**: keys missing from your real env files, extra keys |
| Hidden folders | `.github`, `.vscode`, `.claude`, `.cursor`, `.husky`, `.devcontainer` and others | What each is, size, sample files |
| Code statistics | File index (capped) | Files and lines per language, per directory |

The Project page also lists scripts you can run (with `exec`), dependency lists with outdated versions after running `packages.outdated`, and a security audit via `packages.audit`.

### Laravel

If `artisan` exists, the Project page adds:

- Routes (`routes/*.php`): method, URI, name, action, middleware (parsed statically from the route files).
- Models (`app/Models`): class, table, relations.
- Migrations (`database/migrations`): file, table, operation (create or alter), timestamp.

These are parsed from source, not by running PHP. Allow-listed read-only artisan commands and migrations are available as `exec`/`danger` actions.

### Doc drift

`/api/project/drift` finds Markdown documents that mention existing code files (in backticks or as plain paths, such as `src/auth/session.ts`) where **git shows the code changed after the document did**. It looks at the last 3000 commits. It is a hint to re-read the doc, not a verdict. It needs a git repository.

## Lint rules

`agentneuron lint`, the Health page, and the health score use these rules:

| Rule | Severity | Triggers when |
|---|---|---|
| `broken-link` | error (warn for bare mentions and reference-style refs) | A Markdown link, wiki link `[[name]]`, or `@import` points to a file that does not exist |
| `missing-path` | warn | A backticked path with a file extension (`src/old/thing.ts`) is mentioned but does not exist |
| `secret` | error (warn for Stripe test keys) | AWS, GitHub, Anthropic, OpenAI, Slack, Stripe, Google keys, JWTs, private key blocks, or high-entropy values assigned to names like `password`, `api_key`, `token`. Placeholders such as `your-key-here` are ignored. Reports show at most the first 4 characters |
| `large-context` | warn above ~5,000 tokens, error above ~10,000 | A `context` or `rules` file is loaded into every session and is too big |
| `duplicate-rule` | info | The same rule line appears in files of two or more different tools (drift risk) |
| `stale-plan` | warn | A plan or TODO file has not changed for 30+ days |
| `orphan` | info | A doc, plan, todo, decision or other file has no inbound links |
| `empty-file` | warn for context/rules, otherwise info | The file has no content |

Score: 100 minus a penalty that grows with issues per file (error 10, warn 3, info 0.5, normalised by file count). Any error caps the score at 89 (never an A); any issue at all caps it at 99. Grades: A 90+, B 80+, C 70+, D 60+, otherwise F.

Tokens are estimated from characters and words (not a real tokenizer); treat them as approximate.

## Links and the graph

Edge types: `md-link` (`[text](path)`), `wiki` (`[[name]]`), `import` (`@path/to/file.md`, as used by Claude Code), `ref` (reference-style definitions), `mention` (plain existing paths in text). Links inside fenced code blocks and inline code are ignored.

## Effective context

`/api/context` and the Context page compute what a tool loads for a directory:

| Tool | Files, in order |
|---|---|
| `claude` | `CLAUDE.md` and `CLAUDE.local.md` from the root down to the directory; each file's `@imports`, followed up to 5 levels deep |
| `codex` | `AGENTS.md` and `AGENTS.override.md` from the root down to the directory |
| `cursor` | `.cursorrules`, plus `.mdc` rules under `.cursor/rules/` (root to directory) that have `alwaysApply: true` in front matter |

This is an approximation of each tool's documented behaviour, useful for sizing and reviewing, not a guarantee of what a given tool version does.

## Tasks

Checkbox items in any tracked Markdown file become tasks:

```markdown
- [ ] To do
- [/] In progress
- [x] Done
- [ ] Ship the API !high #backend @due(2026-11-01) @alice
```

Inline metadata: `!low|med|high|urgent` priority, `#label`, `@due(YYYY-MM-DD)`, `@name` assignee, and backticked file paths are linked to files. Indented checkboxes under a task become its checklist. `TODO:` and `FIXME:` comments in Markdown are listed too (read-only). Files exported from the board contain `<!-- agentneuron:export -->` and are not re-imported.

Decision records are recognised from `adr/`, `adrs/`, `DECISIONS*.md` and similar.
