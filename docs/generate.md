# Generate a context file from the code

`agentneuron generate` writes a starter `AGENTS.md` (or `CLAUDE.md`, ...) built only from what the project shows. Every line ends with a comment naming its source. If something can't be detected, it is left out rather than guessed.

```sh
agentneuron generate                    # AGENTS.md to stdout
agentneuron generate --tool claude      # CLAUDE.md flavour
agentneuron generate --out              # write the tool's default path (refuses if it exists)
agentneuron generate --out docs/x.md --force
```

| `--tool` | Path | Notes |
|---|---|---|
| `agents` (default), `codex` | `AGENTS.md` | |
| `claude` | `CLAUDE.md` | |
| `gemini` | `GEMINI.md` | |
| `copilot` | `.github/copilot-instructions.md` | |
| `cursor` | `.cursor/rules/project.mdc` | `alwaysApply: true` frontmatter |
| `windsurf` | `.windsurf/rules/project.md` | `trigger: always_on` frontmatter |

## What is detected

- **Commands**
  - **Install command:** from the lockfile (`pnpm-lock.yaml`, `yarn.lock`, `bun.lock(b)`, `package-lock.json`) or from `package.json#packageManager`. Without either, the line says `npm install` and adds "no lockfile found".
  - **Package scripts:** `dev`, `start`, `build`, `test`, `lint`, `typecheck` and `format` come first, followed by up to 8 other scripts (`pre*`/`post*` hooks are skipped). Each line shows the command the script runs.
  - **PHP:** Composer install and scripts. Laravel `artisan serve`, `migrate` and `test`, when migrations or PHPUnit/Pest config exist.
  - **Python:** `uv`, `poetry`, `pipenv` or `pip`; `pytest`; `ruff`; Django `manage.py`.
  - **Others:** Go, Cargo, Bundler, common `Makefile` targets and `docker compose`.
- **Stack:** languages, runtimes, frameworks, test tools, databases and AI SDKs from the project detector (the same data as the Project view), with versions. Only entries backed by a manifest are included.
- **Project layout:** each top-level folder with a file count. The folder's purpose comes from its `package.json` description, the first sentence of its `README.md`, or a well-known folder name such as `src`, `test`, `docs` or `routes`. A folder without any of these is listed without a purpose.
- **Conventions**
  - **Modules and types:** ES modules (`"type": "module"`) and TypeScript strict mode (`tsconfig.json`, comments allowed).
  - **Lint and format:** ESLint, Prettier and Biome configs, and indentation from `.editorconfig` `[*]`.
  - **Tests:** the test framework, or `node --test`.
  - **Repository:** workspaces/monorepo, Husky hooks and GitHub Actions workflows.
  - **Language tooling:** Python version, Black and mypy; Laravel Pint and PHPStan.

Citations look like `<!-- from package.json#scripts.test -->`, `<!-- from tsconfig.json#compilerOptions.strict -->` or `<!-- from directory name src/ -->`. They are HTML comments, so agents can see where a line came from and they don't clutter the rendered page.

## HTTP

- `GET /api/compiler/generate?tool=agents` returns `{ tool, path, content, items: [{ section, text, source }], exists, currentHash }`. It needs only the read level.
- `POST /api/compiler/generate/write { tool, overwrite?, baseHash? }` needs the `edit` level. It creates the file. An existing file is replaced only with `overwrite: true` and the matching `baseHash`; otherwise the request fails with 409.

The UI is under **Rules → Generate from code**. It shows each line next to its citation and offers create or replace.
