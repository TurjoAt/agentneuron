# Supported tools

AgentNeuron classifies each file by **tool** (which AI tool reads it) and **kind** (what role it plays). Patterns come from a built-in catalogue (`src/patterns/catalogue.json`); `extraPatterns` in [configuration](configuration.md) are checked first.

Kinds: `context` (always-loaded instructions), `rules`, `agent`, `skill`, `command`, `config`, `doc`, `readme`, `todo`, `plan`, `decision`, `changelog`, `memory`, `other`.

## Tracked files (catalogue)

| Tool | Pattern | Kind |
|---|---|---|
| Claude Code | `**/CLAUDE.md` | context |
| | `**/CLAUDE.local.md` | context (personal, gitignored) |
| | `**/.claude/agents/**/*.md` | agent |
| | `**/.claude/skills/**/SKILL.md`, `**/.claude/skills/**/*.md` | skill |
| | `**/.claude/commands/**/*.md` | command |
| | `**/.claude/rules/**/*.md` | rules |
| | `**/.claude/settings*.json` | config (permissions, hooks) |
| | `**/.mcp.json` | config (MCP servers) |
| | `**/.claude/**/*.md` | doc |
| Codex | `**/AGENTS.md`, `**/AGENTS.override.md`, `**/codex.md`, `**/.codex/**/*.md` | context |
| | `**/.codex/**/*.{toml,json}` | config |
| Cursor | `**/.cursorrules` | rules (legacy) |
| | `**/.cursor/rules/**/*.{mdc,md}` | rules |
| | `**/.cursor/mcp.json` | config |
| GitHub Copilot | `.github/copilot-instructions.md` | context |
| | `.github/instructions/**/*.instructions.md` | rules |
| | `.github/prompts/*.prompt.md` | command |
| | `.github/chatmodes/*.chatmode.md` | agent |
| Windsurf | `**/.windsurfrules`, `**/.windsurf/rules/**` | rules |
| | `**/.windsurf/workflows/**` | command |
| Gemini CLI | `**/GEMINI.md`, `**/.gemini/**/*.md` | context |
| | `**/.gemini/**/*.{json,toml}` | config |
| Generic | `**/README{,.*}.md` | readme |
| | `**/TODO*.md` | todo |
| | `**/ROADMAP*.md`, `**/PLAN*.md` | plan |
| | `**/DECISIONS*.md`, `**/adr/**/*.md`, `**/adrs/**/*.md` | decision |
| | `**/CHANGELOG*.md` | changelog |
| | `**/memory/**/*.md`, `**/MEMORY.md` | memory |
| | `docs/**/*.{md,mdx}` | doc |

Any other `.md`, `.mdc`, `.mdx` or `.markdown` file is tracked as `generic` when `includeAllMarkdown` is true (default), with its kind inferred from the name (for example `notes/`, `docs/`, `spec*.md`).

## Agents center coverage

The Agents pages (matrix, setup, rules-for-file) understand a wider set of tools and capabilities (instructions, rules, MCP, hooks, permissions, agents, skills, commands, ignore files):

| Tool | Files |
|---|---|
| Claude Code | `CLAUDE.md`, `CLAUDE.local.md`, `.claude/rules`, `.claude/agents`, `.claude/skills/*/SKILL.md`, `.claude/commands`, `.claude/settings(.local).json`, `.claude/output-styles`, `.mcp.json` |
| OpenAI Codex | `AGENTS.md`, `AGENTS.override.md`, `.codex/config.toml`, `.codex/prompts` |
| Cursor | `.cursorrules`, `.cursor/rules/**/*.mdc`, `.cursor/commands`, `.cursor/mcp.json`, `.cursorignore`, `.cursorindexingignore` |
| GitHub Copilot | `.github/copilot-instructions.md`, `.github/instructions`, `.github/prompts`, `.github/agents`, `.github/chatmodes`, `.vscode/mcp.json` |
| Windsurf | `.windsurfrules`, `.windsurf/rules`, `.windsurf/workflows`, `.codeiumignore` |
| Gemini CLI | `GEMINI.md`, `.gemini/commands/*.toml`, `.gemini/settings.json`, `.geminiignore` |
| Cline | `.clinerules` (file or folder), `.clineignore` |
| Roo Code | `.roorules`, `.roo/rules*/`, `.roomodes`, `.roo/mcp.json`, `.rooignore` |
| Aider | `CONVENTIONS.md`, `.aider.conf.yml`, `.aiderignore` |
| Continue | `.continue/config.yaml\|json`, `.continue/rules`, `.continue/prompts`, `.continue/mcpServers` |
| Zed | `.rules`, `.zed/settings.json` |
| JetBrains Junie | `.junie/guidelines.md`, `.junie/mcp/mcp.json` |
| Amazon Q Developer | `.amazonq/rules`, `.amazonq/prompts`, `.amazonq/mcp.json` |

Files in this table that the catalogue does not list (for example Cline or Aider files that are not Markdown) are shown in the Agents pages but are not part of the document set used for the link graph and linting. Add them with `extraPatterns` if you want them tracked, for example:

```json
{ "extraPatterns": [ { "glob": "CONVENTIONS.md", "tool": "aider", "kind": "context" } ] }
```

## Sync targets

`Agents > Sync & drift` and the `agents.sync.apply` action copy one instruction file into the other tools' root files:

| Tool | Target file |
|---|---|
| Claude Code | `CLAUDE.md` |
| Codex | `AGENTS.md` |
| Gemini CLI | `GEMINI.md` |
| Cursor | `.cursorrules` |
| Copilot | `.github/copilot-instructions.md` |
| Windsurf | `.windsurfrules` |
| Aider | `CONVENTIONS.md` |
| Zed | `.rules` |
| Junie | `.junie/guidelines.md` |
| Cline | `.clinerules` |

Modes: `copy` writes the source text into the target; `import` writes a short file that references the source with an `@` import. Similarity is computed per normalised line (Jaccard over lines), so reformatting does not count as drift but a changed rule does. Each pair of files gets a status: `identical`, `linked` (one `@imports` the other), `similar` (80% or more), `drifted` (30-79%) or `diverged` (under 30%).

## Templates

Built-in templates for `files.create` / `agents.create`: `claude-md`, `agents-md`, `gemini-md`, `cursor-rule`, `copilot-instructions`, `copilot-path-instructions`, `claude-skill`, `claude-agent`, `claude-command`, `claude-rule`, `windsurf-rule`, `adr`, `plan`, `prd`, `todo`, `decision-log`, `session-handoff`, `readme`.
