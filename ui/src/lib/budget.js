// Context-token budgets shown on the Overview tool cards.
//
// The server exposes no budget setting yet (/api/settings and /api/config carry
// none), so the UI uses a documented default. It is anchored to the health
// linter (src/health/lint.js): an always-loaded context file warns at 5k tokens
// and errors at 10k. A tool's *combined* instruction set (main file + scoped
// rules/skills) gets a little headroom above one file's error limit.

/** Default suggested instruction-token budget per AI tool. */
export const TOOL_TOKEN_BUDGET = 12_000;

