// Lessons from sessions: user corrections, reverted edits, repeatedly failing commands and instructions repeated
// across sessions, clustered (normalised tokens + Jaccard) into proposed rules for the context files.
import { maskSecretsInText } from '../health/secrets.js';
import { parseRules, segments } from './rules.js';
import { tokens, jaccard, containment, stripCode, sentence, quote, sha, norm, clipMasked } from './text.js';

const MAX_PROMPT = 500; // longer turns are pasted content, not a correction
const NEG_START = /^(?:no+\b|nope\b|wrong\b|stop\b|don'?t\b|do not\b|never\b|revert\b|undo\b|that'?s (?:not|wrong)\b|not like that\b|instead\b|actually,? (?:no|don'?t|use|we)\b)/i;
const MID = /\b(?:never|always (?:use|run|do|keep|put|add|write|check)|don'?t|do not|instead of|we use|we don'?t|you should(?:n'?t| not)?|should not|must not|please don'?t|rather than|use \S+ (?:not|instead)|not \S+ but)\b/i;
const EXCLUDE = /^(?:no (?:worries|problem|thanks|need)|never ?mind|don'?t worry|no,? (?:that'?s|it'?s|this is) (?:fine|ok|okay|good|great|perfect|correct|right))\b/i;
const INSTRUCTION = /^(?:please\s+)?(?:remember|always|never|don'?t|do not|make sure|ensure|keep|use|avoid|run|check|follow|prefer|stop)\b/i;
const FILLER = /^(?:yes|yep|ok|okay|continue|go on|go ahead|proceed|thanks|thank you|lgtm|looks good|great|perfect|done|next)\b[\s.!]*$/i;
const BASE = { correction: 0.5, fix: 0.55, repeated: 0.4, revert: 0.4, failure: 0.35 };
const RANK = { correction: 5, fix: 4, repeated: 3, revert: 2, failure: 1 };

/** Is this user turn a correction of the agent's previous action? -> { strong } | null */
export function detectCorrection(e) {
  if (!e || e.k !== 'prompt') return null;
  const raw = String(e.text || '');
  if (raw.split('\n').length > 12) return null;
  const t = stripCode(raw);
  if (!t || t.length > MAX_PROMPT || EXCLUDE.test(t)) return null;
  const after = e.after === 'edit' || e.after === 'command' || e.rejected;
  if (!after) return null;
  const start = NEG_START.test(t);
  const mid = MID.test(t);
  if (/\?\s*$/.test(t) && !start && !/\b(we use|never|always)\b/i.test(t)) return null; // a question, not a directive
  if (!start && !mid && !e.rejected) return null;
  if (tokens(t).size < 2) return null;
  return { strong: start || !!e.rejected || (!!e.interrupted && mid) };
}

/** Turn a user correction into a concise imperative rule (or null when nothing is left to learn). */
export function toRule(text) {
  const t = stripCode(text);
  const parts = t.split(/(?<=[.!?])\s+|\s*;\s*|\n+/).map((s) => s.trim()).filter(Boolean);
  let s = parts.find((p) => MID.test(p) && tokens(p).size >= 2) || parts.find((p) => tokens(p.replace(/^(?:no+|nope|wrong|stop)\b[,.!:\s-]*/i, '')).size >= 2) || '';
  for (let i = 0; i < 3; i++) s = s.replace(/^(?:no+|nope|wrong|stop(?: it)?(?=[,.!:;])|actually|hmm+|wait|ugh|oops|please|again|instead)\b[,.!:;\s-]*/i, '');
  s = s.replace(/^(?:that'?s (?:not|wrong)[^,.;]*[,.;]\s*)/i, '');
  let m;
  if ((m = /^we (?:use|prefer|always use) (.+?),? (?:not|instead of|over|rather than) (.+)$/i.exec(s))) s = `Use ${m[1]}, not ${m[2]}`;
  else if ((m = /^(?:use|prefer) (.+?),? (?:not|instead of|rather than) (.+)$/i.exec(s))) s = `Use ${m[1]}, not ${m[2]}`;
  else if ((m = /^we don'?t (.+)$/i.exec(s))) s = `Don't ${m[1]}`;
  else if ((m = /^we (?:use|always use) (.+)$/i.exec(s))) s = `Use ${m[1]}`;
  s = s.replace(/^(?:you should not|you shouldn'?t|you must not|please don'?t|please do not)\s+/i, "Don't ")
    .replace(/^(?:you should|you need to|you must|make sure (?:to|you)|remember to)\s+/i, '');
  s = s.replace(/[\s,;:-]+$/, '');
  if (tokens(s).size < 2 || /^(?:revert|undo)(?: (?:that|this|it|the (?:last )?(?:change|edit)s?))?\.?$/i.test(s)) return null;
  s = maskSecretsInText(s);
  if (s.length > 160) s = `${s.slice(0, 157).replace(/\s+\S*$/, '')}…`;
  return sentence(s);
}

const commandKey = (cmd) => {
  const g = segments(cmd).find((x) => !/^(cd|export|set|source|echo)$/.test(x.prog));
  if (!g) return null;
  const args = g.words.slice(1).filter((w) => !w.startsWith('-'));
  const n = /^(npm|pnpm|yarn|bun)$/.test(g.prog) && args[0] === 'run' ? 2 : 1;
  return clipMasked([g.prog, ...args.slice(0, n)].join(' '), 80);
};
const sameJob = (a, b) => a.split(' ').slice(1).join(' ') === b.split(' ').slice(1).join(' ');

const ev = (s, e, text, extra = {}) => ({ session: s.sessionId, tool: s.tool, ts: e.ts, quote: quote(text), ...extra });

/** Candidate items from all sessions (before clustering). */
export function mine(sessions) {
  const items = [];
  // (a) corrections and (d) repeated instructions
  for (const s of sessions) {
    for (const e of s.events) {
      if (e.k !== 'prompt') continue;
      const c = detectCorrection(e);
      if (c) {
        const rule = toRule(e.text);
        if (rule) items.push({ kind: 'correction', strong: c.strong, rule, evidence: [ev(s, e, stripCode(e.text), { kind: e.rejected ? 'rejected' : 'correction' })] });
        continue;
      }
      const t = stripCode(e.text);
      if (t.length > 300 || t.startsWith('/') || FILLER.test(t) || tokens(t).size < 3) continue;
      if (!INSTRUCTION.test(t) && !MID.test(t)) continue;
      const rule = toRule(t);
      if (rule) items.push({ kind: 'repeated', rule, evidence: [ev(s, e, t, { kind: 'instruction' })] });
    }
  }
  // (b) reverted edits: a later edit swaps an earlier edit's old/new text back
  const edits = [];
  for (const s of sessions) for (const e of s.events) if (e.k === 'edit' && e.inRoot !== false && !e.rejected) for (const c of e.changes || []) edits.push({ s, e, rm: norm(c.removed), add: norm(c.added), c });
  edits.sort((a, b) => a.e.ts - b.e.ts);
  const byPath = new Map();
  for (const x of edits) { if (!byPath.has(x.e.path)) byPath.set(x.e.path, []); byPath.get(x.e.path).push(x); }
  for (const [p, list] of byPath) {
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.add.length < 3 || a.rm === a.add) continue;
      const b = list.slice(i + 1, i + 40).find((y) => y.e.ts - a.e.ts < 7 * 864e5 && y.rm === a.add && y.add === a.rm);
      if (!b) continue;
      const what = clipMasked((a.c.removed || a.c.added).split('\n').map((l) => l.trim()).find(Boolean) || '', 60);
      const rule = maskSecretsInText(a.rm ? `Don't change \`${what}\` in ${p} without asking (an agent edit there was reverted).` : `Don't add \`${what}\` to ${p} (it was reverted).`);
      items.push({ kind: 'revert', key: `revert:${p}:${norm(what)}`, rule, paths: [p], evidence: [
        ev(a.s, a.e, `edit ${p}: ${a.c.removed ? `"${a.c.removed}" → ` : ''}"${a.c.added}"`, { kind: 'edit', path: p }),
        ev(b.s, b.e, `reverted in ${p}: back to "${b.c.added}"`, { kind: 'revert', path: p })] });
    }
  }
  // (c) commands that fail repeatedly (unless the same command later passes: that is normal iteration)
  const fails = new Map(); // key -> { n, sessions:Set, recovered:Set, fixes:Map, evidence }
  for (const s of sessions) {
    const cmds = s.events.filter((e) => e.k === 'cmd');
    cmds.forEach((e, i) => {
      if (e.ok !== false) return;
      const key = commandKey(e.cmd);
      if (!key) return;
      const f = fails.get(key) || { n: 0, sessions: new Set(), recovered: new Set(), fixes: new Map(), evidence: [] };
      f.n++; f.sessions.add(s.sessionId);
      if (f.evidence.length < 6) f.evidence.push(ev(s, e, `$ ${e.cmd}${e.err ? ` → ${e.err}` : ''}`, { kind: 'failed' }));
      for (const nx of cmds.slice(i + 1, i + 6)) {
        if (nx.ok !== true) continue;
        const k2 = commandKey(nx.cmd);
        if (!k2) continue;
        if (k2 === key) { f.recovered.add(s.sessionId); break; }
        const p1 = key.split(' ')[0], p2 = k2.split(' ')[0];
        if ((p1 !== p2 && sameJob(key, k2)) || (p1 === p2 && jaccard(tokens(key), tokens(k2)) >= 0.5)) {
          const fx = f.fixes.get(k2) || { n: 0, e: ev(s, nx, `$ ${nx.cmd} (worked)`, { kind: 'fix' }) };
          fx.n++; f.fixes.set(k2, fx);
          break;
        }
      }
      fails.set(key, f);
    });
  }
  for (const [key, f] of fails) {
    if (f.n < 2) continue;
    const best = [...f.fixes.entries()].sort((a, b) => b[1].n - a[1].n)[0];
    if (best && best[1].n * 2 >= Math.min(f.n, 2)) {
      items.push({ kind: 'fix', key: `cmd:${key}`, rule: maskSecretsInText(`Use \`${best[0]}\` instead of \`${key}\`.`), evidence: [...f.evidence, best[1].e], n: f.n, sessionsN: f.sessions.size });
    } else if (f.recovered.size / f.sessions.size < 0.5) {
      const err = f.evidence.find((x) => / → /.test(x.quote))?.quote.split(' → ')[1] || '';
      items.push({ kind: 'failure', key: `cmd:${key}`, rule: maskSecretsInText(`Don't run \`${key}\` as-is: it failed ${f.n} times${err ? ` ("${err.slice(0, 80)}")` : ''}; find the right invocation first.`), evidence: f.evidence, n: f.n, sessionsN: f.sessions.size });
    }
  }
  return items;
}

/** Greedy single-pass clustering on rule tokens (keyed items only merge with the same key). */
export function cluster(items, threshold = 0.5) {
  const clusters = [];
  for (const it of items) {
    it.tokens = it.tokens || tokens(it.rule);
    let best = null, bs = 0;
    for (const c of clusters) {
      if (it.key && c.key && it.key !== c.key) continue;
      if (it.key && c.key === it.key) { best = c; bs = 1; break; }
      const sc = Math.max(jaccard(it.tokens, c.tokens), Math.min(containment(it.tokens, c.tokens), containment(c.tokens, it.tokens)) >= 0.85 ? 0.6 : 0);
      if (sc >= threshold && sc > bs) { best = c; bs = sc; }
    }
    if (best) best.items.push(it);
    else clusters.push({ key: it.key || null, tokens: it.tokens, items: [it] });
  }
  return clusters;
}

function targetsFor(paths, tools, fileSet) {
  const out = [];
  const dirs = paths.map((p) => (p.includes('/') ? p.split('/')[0] : '')).filter((d) => d !== null);
  const common = dirs.length && dirs.every((d) => d && d === dirs[0]) ? dirs[0] : '';
  if (common) {
    for (const n of ['CLAUDE.md', 'AGENTS.md']) if (fileSet.has(`${common}/${n}`)) out.push(`${common}/${n}`);
    if ([...fileSet].some((f) => f.startsWith('.cursor/rules/'))) out.push(`.cursor/rules/${common.replace(/[^\w-]+/g, '-').toLowerCase()}.mdc`);
  }
  const root = tools.has('codex') && !tools.has('claude') ? ['AGENTS.md', 'CLAUDE.md']
    : tools.has('claude') && !tools.has('codex') ? ['CLAUDE.md', 'AGENTS.md']
      : fileSet.has('AGENTS.md') ? ['AGENTS.md', 'CLAUDE.md'] : ['CLAUDE.md', 'AGENTS.md'];
  return [...new Set([...out, ...root])];
}

/** Best matching existing rule, when it already says (most of) the lesson. */
export function coveredBy(ruleTokens, rules) {
  let best = null;
  for (const r of rules) {
    r.tokens = r.tokens || tokens(r.rule);
    const j = jaccard(ruleTokens, r.tokens), c = containment(ruleTokens, r.tokens);
    const score = Math.max(j, c * 0.9);
    if ((j >= 0.5 || (c >= 0.75 && ruleTokens.size >= 2)) && (!best || score > best.similarity)) best = { file: r.file, line: r.line, rule: quote(r.rule), similarity: Math.round(score * 100) / 100 };
  }
  return best;
}

/**
 * Proposed rules. opts: { files, contents (store), hidden: { ids:Set, rules:[tokens] } }
 * Returns [{ id, rule, kind, kinds, target, targets, evidence, count, sessions, confidence, alreadyCovered }]
 */
export function lessonsFrom(sessions, { files = [], contents = new Map(), hidden = null, limit = 100 } = {}) {
  const items = mine(sessions);
  items.sort((a, b) => RANK[b.kind] - RANK[a.kind]);
  const rules = parseRules(files, contents);
  const fileSet = new Set(files.map((f) => f.path));
  const out = [];
  for (const c of cluster(items)) {
    const kinds = [...new Set(c.items.map((i) => i.kind))];
    const evidence = c.items.flatMap((i) => i.evidence).sort((a, b) => b.ts - a.ts);
    const sessionIds = new Set(evidence.map((e) => e.session));
    if (kinds.length === 1 && kinds[0] === 'repeated' && sessionIds.size < 2) continue; // one-off instruction
    const lead = c.items.slice().sort((a, b) => RANK[b.kind] - RANK[a.kind] || a.rule.length - b.rule.length)[0];
    const count = c.items.reduce((a, i) => a + (i.n || i.evidence.filter((e) => e.kind !== 'fix' && e.kind !== 'edit').length || 1), 0);
    const strong = c.items.some((i) => i.strong);
    let conf = BASE[lead.kind] + Math.min(0.3, 0.12 * (count - 1)) + (sessionIds.size >= 2 ? 0.1 : 0) + (strong ? 0.1 : 0) + (kinds.length > 1 ? 0.05 : 0);
    conf = Math.round(Math.max(0.05, Math.min(0.97, conf)) * 100) / 100;
    const id = sha(`${lead.key || lead.kind}:${norm(lead.rule)}`).slice(0, 12);
    const toks = tokens(lead.rule);
    if (hidden && (hidden.ids.has(id) || hidden.rules.some((t) => jaccard(t, toks) >= 0.7))) continue;
    const paths = [...new Set(c.items.flatMap((i) => i.paths || []))];
    const targets = targetsFor(paths, new Set(evidence.map((e) => e.tool)), fileSet);
    out.push({ id, rule: lead.rule, kind: lead.kind, kinds, target: targets[0], targets, evidence: evidence.slice(0, 8), count, sessions: sessionIds.size, confidence: conf, alreadyCovered: coveredBy(toks, rules), lastAt: evidence[0]?.ts || 0 });
  }
  return out.sort((a, b) => (!!a.alreadyCovered - !!b.alreadyCovered) || b.confidence - a.confidence || b.count - a.count).slice(0, limit);
}
