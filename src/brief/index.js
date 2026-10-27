// Agent brief (agent C): resume briefs, mistake prevention, context packs and the bug detective.
// Contract: docs/internal/quality-contract.md (Slice C). User doc: docs/brief.md.
import { redactPrompts } from '../live/coord.js';
import { isRel } from './util.js';

export { briefCtx, DEFAULT_DEPS } from './util.js';
export { buildResume, resumeSources, sessionParts } from './resume.js';
export { warningRules, checkAction, publicRule } from './warnings.js';
export { buildPack, DEFAULT_BUDGET, importsOf, resolveImport, sections, pieces } from './pack.js';
export { buildDebug, parseFrames, errorHead, MAX_ERROR } from './debug.js';
export { saveBrief, listBriefs, getBrief } from './store.js';

const relOrNull = (p) => (isRel(p) ? p : null);
const noCmd = ({ command: _c, quote: _q, ...x }) => x;

/**
 * Views for roles that may not see prompts. Session text sits under the redactable keys and is removed by
 * redactPrompts; on top of that, commands and tool output (`command`, `quote`) are dropped, absolute paths
 * hidden and the Markdown export omitted, like the usage replay viewer rows.
 */
export const VIEWER = {
  resume: (v) => {
    const items = (list) => (list || []).map((i) => redactPrompts({ ...noCmd(i), path: relOrNull(i.path) }));
    const { markdown: _m, ...rest } = v;
    return {
      ...rest,
      title: '', lastPrompt: '', goal: redactPrompts(v.goal || {}), sessions: redactPrompts(v.sessions || []),
      task: v.task ? { ...v.task, title: '' } : null,
      done: items(v.done), failed: items(v.failed), decisions: items(v.decisions), next: items(v.next),
      todos: items(v.todos), criteria: v.criteria || [], files: (v.files || []).filter((f) => isRel(f.path)),
      runs: (v.runs || []).map((r) => ({ ...r, failures: (r.failures || []).map(({ quote: _q, ...f }) => f) })),
    };
  },
  sources: (v) => ({ ...v, sessions: redactPrompts(v.sessions || []) }),
  /** only rules that are not session-derived reach viewers (the route also asks for sessionData: false) */
  warnings: (v) => ({ ...v, warnings: (v.warnings || []).filter((w) => !w.sessionDerived).map((w) => ({ ...w, evidence: redactPrompts(w.evidence || []) })) }),
  rules: (v) => ({ ...v, rules: (v.rules || []).filter((r) => r.source?.kind !== 'history').map((r) => ({ ...r, evidence: redactPrompts(r.evidence || []) })) }),
  debug: (v) => {
    const { markdown: _m, ...rest } = v;
    return {
      ...rest, error: { type: v.error?.type || '', quote: '' }, frames: (v.frames || []).map(({ fn: _f, ...f }) => f),
      hypotheses: (v.hypotheses || []).map((h) => ({ ...h, evidence: (h.evidence || []).filter((e) => e.kind !== 'session').map(({ quote: _q, ...e }) => e) })),
      related: { ...(v.related || {}), sessions: [] },
    };
  },
  briefs: (v) => ({ briefs: (v.briefs || []).map((b) => ({ ...b, title: '' })) }),
  saved: (v) => ({ ...v, title: '', brief: v.kind === 'debug' ? VIEWER.debug(v.brief || {}) : VIEWER.resume(v.brief || {}) }),
};
