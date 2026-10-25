// Rules compiler: one source of rules -> every tool's native files; import; merge-back; generate from code.
export { loadRules, parseRule, serializeRule, TOOLS } from './rules.js';
export { planCompile, applyCompile, applyMergeBack, selectTools, composeRule } from './compile.js';
export { planImport, applyImport, splitSections } from './import.js';
export { generateContext, GEN_TARGETS } from './generate.js';
export { writeRuleFile, rulesDirRel, validSlug } from './safety.js';

/** Compact, UI/MCP-friendly view of a plan (no file bodies unless `content`). */
export function summarize(plan, { content = false } = {}) {
  return {
    rulesDir: plan.rulesDir, tools: plan.tools, ok: plan.ok, stale: plan.stale, invalid: plan.invalid,
    rules: plan.rules.map((r) => ({ slug: r.slug, title: r.title, tools: r.tools, scope: r.scope, priority: r.priority, errors: r.errors, warnings: r.warnings })),
    outputs: plan.outputs.map((o) => ({ path: o.path, tool: o.tool, action: o.action, regions: o.regions.map(({ content: _c, ...r }) => r), conflicts: o.conflicts, error: o.error || null,
      ...(o.diff ? { added: o.diff.added, removed: o.diff.removed } : {}), ...(content ? { content: o.content ?? null, diff: o.diff || null } : {}) })),
    edited: plan.edited.map(({ content: _c, ...e }) => e),
    mergeBack: plan.mergeBack.map((m) => ({ slug: m.slug, file: m.file, paths: m.paths, conflict: m.conflict, ...(content ? { diff: m.diff, copies: m.copies } : {}) })),
  };
}
