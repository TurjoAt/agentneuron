# Example: multi-tool project

A fictional React app where the team uses several AI tools and the instruction files have drifted apart, which is the situation AgentNeuron's Agents and Health pages are built for.

```sh
npx agentneuron examples/multi-tool-project
npx agentneuron lint examples/multi-tool-project; echo "exit code $?"     # exit code 1
```

## Files

| File | Tool | Notes |
|---|---|---|
| `AGENTS.md` | Codex (and many others) | Source of truth, most complete |
| `CLAUDE.md` | Claude Code | One line `@AGENTS.md` import plus Claude-only notes. The sync status shows this pair as `linked` |
| `GEMINI.md` | Gemini CLI | An older, partial copy of `AGENTS.md` |
| `.github/copilot-instructions.md` | Copilot | Contradicts `AGENTS.md`: 4 spaces, default exports, 200-line PRs |
| `.windsurfrules` | Windsurf | Short copy; imports an accessibility checklist that does not exist (the broken import below) |
| `.cursor/rules/project.mdc` | Cursor | `alwaysApply: true` |
| `.cursor/rules/typescript.mdc` | Cursor | `globs: ["**/*.ts", "**/*.tsx"]` |
| `.cursor/rules/testing.mdc` | Cursor | `globs: src/**/*.test.tsx` |

## What AgentNeuron shows

**Health** (score 72, grade C; `lint` exits 1):

- One `error`: `broken-link` in `.windsurfrules:6`, an `@import` of a missing accessibility doc.
- Many `info` `duplicate-rule` entries: the same sentences ("Use TypeScript strict mode...", "Use 2 spaces...") live in four or five tools' files. This is the drift risk: change one and forget the others.

**Agents > Sync & drift** compares the root instruction files pairwise, with a similarity percentage:

| Pair | Status |
|---|---|
| `CLAUDE.md` and `AGENTS.md` | linked |
| `AGENTS.md` and `GEMINI.md` | drifted (47%) |
| `AGENTS.md` and `.github/copilot-instructions.md` | diverged (25%) |
| `AGENTS.md` and `.windsurfrules` | diverged (17%) |

With `--enable edit` you can open the sync plan, preview the diff, and bring `GEMINI.md`, Copilot and Windsurf in line with `AGENTS.md` (`copy` writes the text, `import` writes a one-line `@AGENTS.md` stub). Nothing is written until you confirm.

**Agents > Rules for file**: pick `src/components/Grid/Grid.tsx`. The answer lists the files that apply to it: `CLAUDE.md`, `AGENTS.md`, Copilot, Windsurf, Gemini (always on), Cursor `project.mdc` (always) and `typescript.mdc` (glob `**/*.tsx` matches). `testing.mdc` does not match because the file is not a test.

**Context** with tool `cursor`: only rules with `alwaysApply: true` are part of the always-loaded context (here, `project.mdc`); glob rules load when matching files are in play.

**Graph**: `CLAUDE.md` links to `AGENTS.md`; `AGENTS.md` links to `docs/design.md`, which mentions `src/components/Grid/Grid.tsx`.

## Things to try

1. Create the missing accessibility doc (path shown in the error) and watch the error disappear and the score rise. `lint` now exits 0.
2. Change "2 spaces" to "tabs" in `AGENTS.md` and watch the similarity with `GEMINI.md` drop.
3. Make Copilot's file `@AGENTS.md`-only and re-check the pair status.
