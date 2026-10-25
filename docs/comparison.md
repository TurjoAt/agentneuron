# How AgentNeuron compares

AgentNeuron is not the only way to look after AI-agent instruction files. This page compares it with the approaches teams commonly use instead, so you can pick what fits. It compares categories, not named products.

## Summary

| | AgentNeuron | Generic Markdown linters | Per-tool rule sync scripts | Reading files by hand |
|---|---|---|---|---|
| Knows which files each AI tool loads | Yes, 13 tools | No | One or a few tools | You have to know |
| Effective context per folder, with token estimates | Yes (Claude, Codex, Cursor) | No | No | Manual |
| Broken links and `@imports` | Yes | Links only | No | Manual |
| Secret detection in context files | Yes | No | No | Manual |
| Drift between tools' instruction files | Yes, pairwise similarity | No | Usually one-way copy | Manual |
| Live change feed and per-file history | Yes | No | No | `git log` |
| MCP server so agents can query it | Yes, read-only | No | No | No |
| Markdown style rules (headings, lists, line length) | No | Yes | No | Manual |
| Runs locally, no account | Yes | Yes | Yes | Yes |

## When to use what

### Generic Markdown linters (markdownlint and similar)

Good at style and syntax: heading order, list indentation, trailing spaces. They do not know that `CLAUDE.md` imports `@docs/rules.md`, that Cursor loads `.cursor/rules/*.mdc` by glob, or that a token budget matters. Use one alongside AgentNeuron if you want style rules; AgentNeuron does not enforce Markdown style.

### Per-tool rule sync scripts

Scripts or small CLIs that copy one source file into `CLAUDE.md`, `AGENTS.md`, `.cursorrules` and so on. They solve duplication but usually in one direction and without showing what drifted. AgentNeuron's **Agents > Sync & drift** shows how similar each pair of files is (`identical`, `linked`, `similar`, `drifted`, `diverged`) and, with `edit` enabled, can copy a file or replace it with an `@import` of a single source. If you already have a sync script, AgentNeuron can still tell you when someone edited a target by hand.

### Reading the files by hand

Fine for one tool and a handful of files. It stops scaling when several tools, nested `CLAUDE.md` files in subfolders, skills and subagents are involved, because the question "what does the agent actually see in `src/api/`?" needs the merge order of every file on the way. AgentNeuron's Context page answers that directly.

## What AgentNeuron does not do

- It does not call an AI model, rewrite your instructions for you, or judge whether a rule is good advice.
- Token counts are estimates from characters and words, not a provider tokenizer.
- It does not enforce Markdown formatting style.
- Write actions are off until you enable them; see [permissions and security](permissions-and-security.md).

See also: [supported tools](supported-tools.md), [FAQ](faq.md).
