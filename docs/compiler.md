# Rules compiler: write once, compile to every tool

Keep your agent rules in one place, `.agentneuron/rules/*.md`, and let `agentneuron compile` write them into each tool's own format. Each tool gets the scoping it understands:

| Tool | Rule for the whole project | Rule scoped to a folder (`scope: src/api/**`) | Rule scoped to other globs |
|---|---|---|---|
| Claude Code | section in `CLAUDE.md` | section in `src/api/CLAUDE.md`, created only if the folder exists | section in `CLAUDE.md` with an `_Applies to:_` line |
| Codex and other AGENTS.md readers | section in `AGENTS.md` | `src/api/AGENTS.md` | `AGENTS.md` with `_Applies to:_` |
| Gemini CLI | section in `GEMINI.md` | `src/api/GEMINI.md` | `GEMINI.md` with `_Applies to:_` |
| Cursor | `.cursor/rules/<slug>.mdc` with `alwaysApply: true` | `.cursor/rules/<slug>.mdc` with `globs:` | same |
| GitHub Copilot | section in `.github/copilot-instructions.md` | `.github/instructions/<slug>.instructions.md` with `applyTo:` | same |
| Windsurf | `.windsurf/rules/<slug>.md` with `trigger: always_on` | `trigger: glob` + `globs:` | same |

Windsurf uses the legacy `.windsurfrules` file instead when that file exists and `.windsurf/rules/` does not. Override this with `"compiler": { "windsurf": "rules" | "legacy" }` in `.agentneuron/config.json`.

## Source rules

One file per rule. The file name is the rule's slug: lowercase letters, digits and dashes, ending in `.md`.

```markdown
---
title: API handlers
description: Conventions for HTTP handlers
scope: ["apps/api/**"]          # globs; omit (or []) for the whole project
tools: [claude, codex, cursor]  # or "all" (default); codex = AGENTS.md
priority: 10                    # higher comes first in shared files; default 0
alwaysApply: false              # optional; Cursor alwaysApply / Windsurf model_decision
---

- Validate every request body with zod.
- Return errors as `{ error: { code, message } }`.
```

The tool names are `claude`, `codex` (also accepted: `agents`), `gemini`, `cursor`, `copilot` and `windsurf`. Rules in shared files are ordered by `priority`, highest first, then by slug.

The folder can be changed with `"compiler": { "rulesDir": "rules" }`. It must be a plain path inside the project, and neither it nor any folder above it may be a symlink. Commit `.agentneuron/rules/` with the project (history, trash and caches in `.agentneuron/` stay local). If you ignore the whole `.agentneuron/` folder, add `!.agentneuron/rules/` or choose another `rulesDir`. A `README.md` in the rules folder is ignored.

## Generated regions

Every compiled rule is wrapped in markers:

```markdown
<!-- agentneuron:begin source=rules/api.md hash=1a2b3c4d5e6f -->
## API handlers

- Validate every request body with zod.
<!-- agentneuron:end source=rules/api.md -->
```

- **Text outside the markers is yours.** The compiler never changes it. You can keep a hand-written intro, notes or `@imports` around the generated sections.
- **`hash` stamps what was written.** On the next compile, each region is in one of these states:
  - **in sync**: the region matches what the source rule produces now.
  - **stale**: the source rule changed and the region still matches its hash, so it is safe to rewrite.
  - **edited**: someone changed the text inside the region. The compiler leaves it alone and reports it. Use `--merge-back` to keep the edit or `--force` to discard it.
  - **orphan**: the source rule was deleted. The region is removed. A generated per-rule file that contains nothing else is moved to the trash.
- **Per-rule files** (`.mdc`, `.instructions.md`, `.windsurf/rules/*.md`) start with native frontmatter followed by one region. The hash also covers the frontmatter. A file at the same path without markers was written by hand: the compiler never overwrites it and reports a conflict instead.
- **Line endings:** CRLF files stay CRLF, and hashes are computed on LF text, so Windows checkouts are not reported as stale.

## Commands

```sh
agentneuron rules import --dry-run     # see what would be created from your current files
agentneuron rules import               # create .agentneuron/rules/*.md (never overwrites)
agentneuron rules list
agentneuron compile --dry-run          # per-file diff, writes nothing
agentneuron compile                    # write every tool's files
agentneuron compile --tools claude,cursor
agentneuron compile --check            # exit 1 if anything is stale or edited by hand (CI)
agentneuron compile --merge-back       # pull hand edits inside regions back into the source, then compile
agentneuron compile --force            # overwrite hand-edited regions
```

`compile --check --json` prints `{ ok, stale, invalid, outputs, mergeBack }`. A CI step:

```yaml
- run: npx agentneuron compile --check
```

## Import

`rules import` reads the context files the project already has:

- root and nested `CLAUDE.md`, `AGENTS.md` and `GEMINI.md`
- `.github/copilot-instructions.md` and `.github/instructions/*.instructions.md`
- `.cursor/rules/*.mdc` and `.cursorrules`
- `.windsurfrules` and `.windsurf/rules/*.md`

Each file becomes rules as follows:

- **Shared files** produce one rule per `##` section. The text before the first `##` becomes a rule named after the `#` title.
- **Per-rule files** produce one rule each. Their `globs`, `applyTo` and `alwaysApply`/`trigger` become `scope` and `alwaysApply`.
- **Nested files** such as `pkg/web/CLAUDE.md` get `scope: pkg/web/**`.
- **Content already inside agentneuron regions** is skipped.

Duplicates are merged into one rule whose `tools` list every tool the text came from:

- sections with the same text in several tools' files
- near-identical sections, at 90% line similarity or more
- a section that only `@imports` another context file, such as `@AGENTS.md` in `CLAUDE.md`

Sections that already exist as source rules are skipped.

Import does not change your existing files. After importing, run `compile --dry-run`: the compiled regions are added next to the original hand-written sections. Delete the hand-written copies once you are happy with the result.

## Merge-back

When someone, or an agent, edits text inside a generated region, `compile` keeps the edit and reports the region as `edited`. Merge-back then works like this:

1. It reads the region and removes the heading the compiler added. If the heading text was changed, that becomes the new `title`.
2. It writes the remaining text as the source rule's body. The rule's frontmatter is kept exactly as it was.
3. It compiles again, so every other tool picks up the change.

If two tools' copies of the same rule were edited differently, nothing is merged for that rule until you choose which copy to keep: pick it in the UI, or send `pick: { slug: path }` to the API. Edits to the frontmatter of a per-rule file are not merged back. Change the source rule instead, or use `--force`.

## HTTP API and UI

The **Rules** view (Rules studio) has four tabs: the source-rule editor, the compile preview with per-file diffs and merge-back, Import, and Generate from code. Every write needs the `edit` action level, which is off by default. While it is off, the buttons are disabled and explain how to turn it on. The endpoints are listed in [HTTP API](http-api.md#rules-compiler). The MCP server exposes a read-only `compile_preview` tool.

## Safety

- **Rule file names** must be slugs. Names such as `CON.md`, names with spaces, subfolders and symlinks are rejected. Output paths come from slugs, and every output path is checked against a per-tool allowlist (for example `^\.cursor/rules/[a-z0-9-]+\.mdc$`).
- **Scope globs** are written into YAML frontmatter, so they are limited to a safe character set: no quotes, newlines, `#`, `..`, absolute paths or drive letters. Commas are allowed only inside `{a,b}`. A rule with a bad glob is reported and not compiled.
- **Titles and descriptions** are reduced to a single line and quoted. A rule whose text contains `agentneuron:begin`/`end` markers is rejected.
- **Nested `CLAUDE.md` files** are only written into folders that exist, are not symlinks, are not hidden and are not ignored.
- **Writes** go through the same file operations as the editor. They refuse symlinks and keep the file inside the project. Each write records history, and a write is refused if the file changed on disk after it was planned. Deleted files go to the agentneuron trash.
