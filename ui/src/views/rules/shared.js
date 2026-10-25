// Shared helpers for the Rules studio.
export const TOOL_LABEL = { claude: 'Claude', codex: 'AGENTS.md', gemini: 'Gemini', cursor: 'Cursor', copilot: 'Copilot', windsurf: 'Windsurf' };
export const TOOL_IDS = Object.keys(TOOL_LABEL);
export const STATUS_LABEL = { ok: 'in sync', stale: 'stale', edited: 'edited', invalid: 'invalid', none: 'not compiled' };
export const ACTION_LABEL = { create: 'new', update: 'update', delete: 'remove', skip: 'skipped', none: 'unchanged' };

const RANK = { edited: 3, stale: 2, ok: 1 };
const norm = (s) => (s === 'edited' || s === 'orphan-edited' ? 'edited' : s === 'ok' ? 'ok' : 'stale');

/** slug -> worst region status across every compiled output. */
export function ruleStatus(preview) {
  const m = new Map();
  for (const o of preview?.outputs || []) {
    for (const r of o.regions || []) {
      if (!r.slug) continue;
      const s = norm(r.status);
      if (!m.has(r.slug) || RANK[s] > RANK[m.get(r.slug)]) m.set(r.slug, s);
    }
  }
  return m;
}

/** lineDiff result -> hunks array. */
export const hunksOf = (d) => (Array.isArray(d) ? d : Array.isArray(d?.hunks) ? d.hunks : []);

export const NEW_RULE = (slug) => `---
title: "${slug.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}"
description: ""
tools: all
scope: []
priority: 0
---

-
`;
