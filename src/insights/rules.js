// Rule effectiveness: split context files into atomic rules, classify the checkable ones, and compare them
// with what agents actually did in transcripts (file edits, commands).
import { estimateTokens } from '../core/tokens.js';
import { globMatch } from '../core/glob.js';
import { sha, norm, quote } from './text.js';

const RULE_KINDS = new Set(['context', 'rules']);
const DIRECTIVE = /\b(must|never|always|don't|do not|use|prefer|avoid|should|run|keep|make sure|ensure|only|no)\b/i;
export const MIN_SESSIONS = 3; // below this, "never relevant" is not evidence enough to cut a rule

// tool families: preferring one member means not using the others for the same job
const FAMILIES = [
  ['npm', 'pnpm', 'yarn', 'bun'],
  ['pip', 'uv', 'poetry', 'pipenv', 'conda'],
  ['jest', 'vitest', 'mocha', 'ava'],
  ['eslint', 'biome', 'oxlint'],
];
const ALIAS = { npx: 'npm', pnpx: 'pnpm', bunx: 'bun', pip3: 'pip', python3: 'python' };
const nm = (x) => { const v = String(x).toLowerCase().replace(/[.,;:!]+$/, ''); return ALIAS[v] || v; };
const familyOf = (p) => FAMILIES.find((f) => f.includes(p)) || null;
const CHECKS = {
  test: /\b(test|tests|vitest|jest|pytest|mocha|phpunit|rspec|go test|cargo test)\b/,
  lint: /\b(lint|eslint|biome|oxlint|ruff|flake8|rubocop|golangci)\b/,
  typecheck: /\b(typecheck|tsc|mypy|pyright)\b/,
  build: /\b(build|compile)\b/,
  format: /\b(format|prettier|fmt)\b/,
};

/** Atomic rule statements (bullets, directive lines) of the context/rules files. */
export function parseRules(files, contents) {
  const out = [];
  for (const f of files) {
    if (!RULE_KINDS.has(f.kind)) continue;
    const c = contents.get(f.path);
    if (typeof c !== 'string') continue;
    const lines = c.split(/\r?\n/);
    let fence = false;
    let i = 0;
    if (lines[0] === '---') { const end = lines.indexOf('---', 1); if (end > 0) i = end + 1; }
    for (; i < lines.length; i++) {
      const raw = lines[i];
      if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; continue; }
      if (fence || !raw.trim() || /^\s*(#|<!--|\||@|>)/.test(raw)) continue;
      const b = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX/]\]\s+)?(.*)$/.exec(raw);
      let text = (b ? b[1] : raw).replace(/\*\*|__/g, '').trim();
      if (!b && !DIRECTIVE.test(text)) continue;
      if (/^\[[^\]]*\]\([^)]*\)$/.test(text) || text.split(/\s+/).length < 3 || text.length > 400) continue;
      const rule = { id: sha(`${f.path}:${norm(text)}`).slice(0, 10), rule: text, file: f.path, line: i + 1, tokenCost: estimateTokens(raw) };
      rule.check = classify(text);
      out.push(rule);
    }
  }
  return out;
}

const ticks = (t) => [...t.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(Boolean);
const pathish = (w) => /[/*]/.test(w) || /^[\w.-]+\.[a-z0-9]{1,6}$/i.test(w);

/** Checkable rule -> { type, ... } or null. */
export function classify(text) {
  const t = text.replace(/\*\*/g, '');
  const lower = t.toLowerCase();
  let m = /\brun\b(.{0,80}?)\bbefore\s+(?:every\s+|each\s+|any\s+|a\s+)?(commit|committing|push|pushing)/i.exec(t);
  if (m) {
    const what = Object.keys(CHECKS).filter((k) => CHECKS[k].test(m[1].toLowerCase()));
    const cmds = ticks(m[1]);
    if (what.length || cmds.length) return { type: 'run-before', what, cmds, before: /push/i.test(m[2]) ? 'push' : 'commit' };
  }
  m = /\b(?:never|don't|do not|avoid|must not|should not|shouldn't)\s+(?:use|run|call)\s+`?([\w.@/-]+)`?/i.exec(t);
  if (m) {
    const p = nm(m[1]);
    if (familyOf(p)) {
      const pref = /\buse\s+`?([\w.@/-]+)`?\s+(?:instead|only)/i.exec(t) || /\b(?:instead|rather)[^.]*?\buse\s+`?([\w.@/-]+)`?/i.exec(t);
      return { type: 'command-preference', prefer: pref ? nm(pref[1]) : null, avoid: [p] };
    }
    const cmd = ticks(t)[0] || m[1];
    return { type: 'command-prohibition', cmd };
  }
  m = /\b(?:never|don't|do not|avoid|must not|should not|shouldn't|no)\b[^.;]{0,30}?\b(?:edit|modify|touch|chang|writ|commit|updat|delet|rewrit)\w*\b(.*)$/i.exec(t);
  if (m) {
    const dirs = [...m[1].matchAll(/\b([\w.-]+)\s+(?:folder|directory|dir)\b/gi)].map((x) => `${x[1]}/`).filter((x) => !/^(the|this|that|any|a)\/$/i.test(x));
    const targets = [...new Set([...dirs, ...ticks(m[1]), ...m[1].split(/[\s,()]+/).map((w) => w.replace(/^[`'"]+|[`'".:;]+$/g, '')).filter(pathish)])].filter((x) => x.length > 1 && !/\s/.test(x));
    if (targets.length) return { type: 'path-prohibition', targets };
    return null;
  }
  m = /\b(?:always\s+)?(?:use|prefer)\s+`?([\w.@/-]+)`?/i.exec(t);
  if (m && !/\b(never|don't|do not)\s+(?:use|prefer)/i.test(lower)) {
    const p = nm(m[1]);
    const fam = familyOf(p);
    const explicit = /\b(?:not|instead of|over|rather than)\s+`?([\w.@/-]+)`?/i.exec(t.slice(m.index + m[0].length));
    const avoid = explicit ? [nm(explicit[1])] : fam ? fam.filter((x) => x !== p) : [];
    if (fam || familyOf(avoid[0])) return { type: 'command-preference', prefer: p, avoid };
  }
  return null;
}

/** Split a shell line into segments and return their programs. */
export function segments(cmd) {
  return String(cmd || '').split(/&&|\|\||;|\|/).map((s) => s.trim()).filter(Boolean).map((seg) => {
    const words = seg.split(/\s+/).filter((w) => !/^\w+=/.test(w) && w !== 'sudo' && w !== 'time');
    let prog = (words[0] || '').replace(/^.*\//, '').toLowerCase();
    prog = ALIAS[prog] || prog;
    return { seg: words.join(' '), prog, words };
  });
}

function pathMatch(target, p) {
  if (!p) return false;
  const t = target.replace(/^\.\//, '');
  if (/[*?{]/.test(t)) return globMatch(t, p) || globMatch(`**/${t}`, p);
  if (t.endsWith('/')) return p.startsWith(t) || p.includes(`/${t}`);
  return p === t || p.startsWith(`${t}/`) || p.endsWith(`/${t}`);
}

/**
 * Compare checkable rules with transcript actions.
 * sessions: projectSessions() output. Counts are per action (commands, commits) or per session (path rules).
 */
export function effectiveness(rules, sessions) {
  const ex = (r, kind, s, e, text) => { if (r.examples.length < 4) r.examples.push({ kind, session: s.sessionId, tool: s.tool, ts: e.ts, text: quote(text) }); };
  const allText = [];
  const rows = rules.map((r) => ({ id: r.id, rule: quote(r.rule, 400), file: r.file, line: r.line, tokenCost: r.tokenCost, type: r.check?.type || null, checkable: !!r.check, appliesTimes: 0, followed: 0, violated: 0, examples: [] }));
  for (const s of sessions) {
    const evs = s.events;
    for (const e of evs) allText.push(e.k === 'cmd' ? e.cmd : e.k === 'prompt' ? e.text : e.path || '');
    rules.forEach((r, i) => {
      const c = r.check;
      const row = rows[i];
      if (!c) return;
      if (c.type === 'path-prohibition') {
        const hit = evs.filter((e) => ((e.k === 'edit' || e.k === 'read') && c.targets.some((t) => pathMatch(t, e.path))) || (e.k === 'cmd' && c.targets.some((t) => e.cmd.includes(t.replace(/\*.*$/, '')) && t.replace(/\*.*$/, '').length > 2)));
        if (!hit.length) return;
        row.appliesTimes++;
        const bad = hit.find((e) => e.k === 'edit');
        if (bad) { row.violated++; ex(row, 'violated', s, bad, `edited ${bad.path}`); } else { row.followed++; ex(row, 'followed', s, hit[0], `${hit[0].k === 'cmd' ? hit[0].cmd : `read ${hit[0].path}`} (no edit)`); }
        return;
      }
      let lastCheck = false;
      for (const e of evs) {
        if (e.k !== 'cmd') continue;
        for (const g of segments(e.cmd)) {
          if (c.type === 'command-preference') {
            if (g.prog === c.prefer) { row.appliesTimes++; row.followed++; ex(row, 'followed', s, e, e.cmd); } else if (c.avoid.includes(g.prog)) { row.appliesTimes++; row.violated++; ex(row, 'violated', s, e, e.cmd); }
          } else if (c.type === 'command-prohibition') {
            const want = segments(c.cmd)[0];
            if (!want || g.prog !== want.prog) continue;
            row.appliesTimes++;
            if (` ${g.seg} `.includes(` ${want.seg} `)) { row.violated++; ex(row, 'violated', s, e, e.cmd); } else row.followed++;
          } else if (c.type === 'run-before') {
            const isGate = g.prog === 'git' && g.words[1] === c.before;
            if (isGate) {
              row.appliesTimes++;
              if (lastCheck) { row.followed++; ex(row, 'followed', s, e, e.cmd); } else { row.violated++; ex(row, 'violated', s, e, e.cmd); }
              lastCheck = false;
            } else if (c.what.some((k) => CHECKS[k].test(g.seg.toLowerCase())) || c.cmds.some((x) => g.seg.includes(x))) lastCheck = true;
          }
        }
      }
    });
  }
  const corpus = allText.join('\n').toLowerCase();
  const neverRelevant = [];
  const ignored = [];
  rows.forEach((row, i) => {
    const r = rules[i];
    if (row.checkable && row.appliesTimes === 0) neverRelevant.push({ ...pick(row), reason: 'its trigger never occurred in agent sessions' });
    else if (!row.checkable) {
      const terms = ticks(r.rule).filter((x) => x.length > 2);
      if (terms.length && !terms.some((x) => corpus.includes(x.toLowerCase()))) neverRelevant.push({ ...pick(row), reason: `never mentioned in agent sessions: ${terms.slice(0, 3).map((x) => `\`${x}\``).join(', ')}` });
    }
    if (row.violated > 0 && row.violated >= row.followed) ignored.push({ ...pick(row), violated: row.violated, followed: row.followed });
  });
  const enough = sessions.length >= MIN_SESSIONS;
  const cut = enough ? neverRelevant : [];
  const tighten = ignored.map((r) => ({ ...r, suggestion: tightenHint(rules.find((x) => x.id === r.id)) }));
  const total = rules.reduce((a, r) => a + r.tokenCost, 0);
  const tokensSaved = cut.reduce((a, r) => a + r.tokenCost, 0);
  return {
    sessions: sessions.length, rules: rows, neverRelevant, ignored,
    diet: { cut, tighten, tokensSaved, totalRuleTokens: total, enoughData: enough,
      note: enough ? `Cutting ${cut.length} rule(s) saves ~${tokensSaved} tokens per session.` : `Need at least ${MIN_SESSIONS} agent sessions before suggesting cuts (have ${sessions.length}).` },
  };
}

const pick = (r) => ({ id: r.id, rule: r.rule, file: r.file, line: r.line, tokenCost: r.tokenCost, type: r.type });

function tightenHint(r) {
  const c = r?.check;
  if (!c) return 'Make the rule concrete and move it near the top of the file.';
  if (c.type === 'path-prohibition') return `State it as a hard rule with the reason, e.g. "NEVER edit ${c.targets.map((t) => `\`${t}\``).join(', ')} (generated). Ask first." and consider a deny permission.`;
  if (c.type === 'command-preference') return `Name the exact commands: "Use \`${c.prefer || '?'}\` (e.g. \`${c.prefer || '?'} install\`, \`${c.prefer || '?'} test\`); never \`${c.avoid.join('`/`')}\`."`;
  if (c.type === 'command-prohibition') return `Say what to do instead of \`${c.cmd}\`, or block it with a hook/permission rule.`;
  if (c.type === 'run-before') return `Give the exact command and the trigger: "Before every \`git ${c.before}\`, run ${c.cmds[0] ? `\`${c.cmds[0]}\`` : `the ${c.what.join('/') || 'check'}s`} and fix failures."`;
  return '';
}
