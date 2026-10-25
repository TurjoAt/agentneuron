// Insights facade: lessons (+ accept/dismiss), rule effectiveness, replay, cost by feature. One per ctx.
import fs from 'node:fs';
import { FileError, agentneuronPath, readJson, atomicJson, cleanRel, resolveSafe } from '../files/paths.js';
import { getOps } from '../files/ops.js';
import { maskSecretsInText } from '../health/secrets.js';
import { projectSessions, signature } from './transcripts.js';
import { lessonsFrom } from './lessons.js';
import { parseRules, effectiveness } from './rules.js';
import { replay, recentChanges } from './replay.js';
import { costsByFeature } from './features.js';
import { tokens, norm } from './text.js';

export { lessonsFrom, detectCorrection, toRule } from './lessons.js';
export { parseRules, classify, effectiveness } from './rules.js';
export { joinFeatures } from './features.js';

const TTL = 5000;
const cache = new WeakMap();
export function getInsights(ctx) {
  if (!cache.has(ctx)) cache.set(ctx, createInsights(ctx));
  return cache.get(ctx);
}

/** Accepted/dismissed lessons live in .agentneuron/insights.json (read-only callers never write it). */
export function readState(root) {
  const s = readJson(agentneuronPath(root, 'insights.json'), null);
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x.id === 'string') : []);
  return { dismissed: arr(s?.dismissed), accepted: arr(s?.accepted) };
}
export const hiddenOf = (st) => ({ ids: new Set([...st.dismissed, ...st.accepted].map((x) => x.id)), rules: st.dismissed.map((x) => tokens(String(x.rule || ''))).filter((t) => t.size) });

const RULE_FILE = /(^|\/)(CLAUDE(\.local)?\.md|AGENTS(\.override)?\.md|GEMINI\.md|\.github\/copilot-instructions\.md)$|^\.cursor\/rules\/[\w.-]+\.mdc$/;

function appendRule(content, rule) {
  const lines = content.replace(/\s+$/, '').split('\n');
  const h = lines.findIndex((l) => /^#{1,3}\s+(lessons learned|learned rules|lessons)\s*$/i.test(l));
  if (h < 0) return `${lines.join('\n')}${lines.join('').trim() ? '\n\n' : ''}## Lessons learned\n\n- ${rule}\n`;
  let end = lines.length;
  for (let i = h + 1; i < lines.length; i++) if (/^#{1,3}\s/.test(lines[i])) { end = i; break; }
  while (end > h + 1 && !lines[end - 1].trim()) end--;
  lines.splice(end, 0, `${end === h + 1 ? '\n' : ''}- ${rule}`);
  return `${lines.join('\n')}\n`;
}

function newFile(target, rule, scope) {
  if (target.endsWith('.mdc')) return `---\ndescription: Lessons learned from agent sessions${scope ? ` in ${scope}/` : ''}\nglobs: ${scope ? `${scope}/**` : '**'}\nalwaysApply: false\n---\n\n- ${rule}\n`;
  return `# Project instructions\n\n## Lessons learned\n\n- ${rule}\n`;
}

export function createInsights(ctx) {
  let memo = { key: null, at: 0, v: null };
  const files = () => [...ctx.store.files.values()];
  const sessions = () => projectSessions(ctx);

  async function lessons({ all = false } = {}) {
    const ss = await sessions();
    const st = readState(ctx.root);
    const key = `${signature(ss)}#${ctx.store.files.size}:${files().reduce((a, f) => a + (f.mtime || 0), 0)}#${JSON.stringify(st)}#${all}`;
    if (memo.key === key && Date.now() - memo.at < TTL * 12) return memo.v;
    const list = lessonsFrom(ss, { files: files(), contents: ctx.store.contents, hidden: all ? null : hiddenOf(st) });
    const v = { lessons: list, sessions: ss.length, hidden: st.dismissed.length + st.accepted.length, generatedAt: Date.now() };
    memo = { key, at: Date.now(), v };
    return v;
  }

  async function find(id) {
    if (typeof id !== 'string' || !/^[0-9a-f]{12}$/.test(id)) throw new FileError(400, 'invalid lesson id');
    const l = (await lessons({ all: true })).lessons.find((x) => x.id === id);
    if (!l) throw new FileError(404, 'lesson not found');
    return l;
  }

  function record(kind, entry) {
    const st = readState(ctx.root);
    st[kind] = st[kind].filter((x) => x.id !== entry.id).concat(entry).slice(-1000);
    atomicJson(agentneuronPath(ctx.root, 'insights.json'), st);
    memo.key = null;
    try { ctx.broadcast?.('insights', { changed: true }); } catch { /* ignore */ }
  }

  async function dismiss({ id } = {}) {
    const l = await find(id);
    record('dismissed', { id: l.id, rule: l.rule, ts: Date.now() });
    return { ok: true, id: l.id };
  }

  async function accept({ id, target, rule } = {}) {
    const l = await find(id);
    let text = l.rule;
    if (rule !== undefined && rule !== null && rule !== '') {
      if (typeof rule !== 'string' || /[\r\n]/.test(rule) || rule.trim().length > 300 || !rule.trim()) throw new FileError(400, 'rule must be a single line of at most 300 characters');
      text = rule.trim();
    }
    text = maskSecretsInText(text.replace(/^[-*]\s+/, ''));
    const t = cleanRel(typeof target === 'string' && target ? target : l.target);
    const tracked = ctx.store.files.get(t);
    if (!RULE_FILE.test(t) || !(l.targets.includes(t) || (tracked && (tracked.kind === 'context' || tracked.kind === 'rules')))) throw new FileError(400, 'target must be one of the suggested context files or a tracked CLAUDE.md / AGENTS.md / .cursor/rules file');
    const ops = getOps(ctx);
    const { abs } = resolveSafe(ctx.root, t);
    let created = false, unchanged = false, hash;
    if (fs.existsSync(abs)) {
      const cur = ops.readRaw(t);
      if (norm(cur.content).includes(norm(text))) unchanged = true;
      else hash = (await ops.save({ path: t, content: appendRule(cur.content, text), baseHash: cur.hash })).hash;
    } else {
      const scope = t.startsWith('.cursor/rules/') ? (l.evidence.map((e) => e.path).find(Boolean) || '').split('/')[0] : '';
      hash = (await ops.create({ path: t, content: newFile(t, text, scope && scope.includes('.') ? '' : scope) })).hash;
      created = true;
    }
    record('accepted', { id: l.id, rule: text, target: t, ts: Date.now() });
    return { ok: true, id: l.id, path: t, rule: text, created, unchanged, hash };
  }

  async function rules() {
    const ss = await sessions();
    const r = effectiveness(parseRules(files(), ctx.store.contents), ss);
    return { ...r, rules: r.rules.sort((a, b) => b.checkable - a.checkable || b.appliesTimes - a.appliesTimes) };
  }

  async function costs() {
    let tasks = [];
    try { const { getBoard } = await import('../board/index.js'); tasks = getBoard(ctx).collect(); } catch { /* no board */ }
    return costsByFeature(ctx, { sessions: await sessions(), tasks });
  }

  return {
    lessons, accept, dismiss, rules, costs,
    replay: (q) => replay(ctx, q),
    recent: () => recentChanges(ctx),
  };
}
