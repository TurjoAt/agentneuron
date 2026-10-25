// Truth check: verify what context files claim (commands, scripts, paths, versions, env vars, ports)
// against the real repository. Sync so lint, MCP and the CLI share one code path.
import crypto from 'node:crypto';
import { extractClaims } from './extract.js';
import { checkClaim } from './check.js';
import { loadFacts, clearFactsCache } from './facts.js';
import { maskSecretsInText } from '../health/secrets.js';

export { loadFacts, clearFactsCache, extractClaims, checkClaim };

/** Kinds of tracked files whose instructions agents follow. */
export const VERIFY_KINDS = new Set(['context', 'rules', 'agent', 'skill', 'command', 'memory']);
const MAX_FILES = 400;
// sample/fixture projects nested in a repo describe themselves, not the repo
const SAMPLE_DIR = /(^|\/)(examples?|samples?|fixtures|__fixtures__|testdata|test-fixtures|templates?)\//i;
const MAX_CLAIMS = 5000;

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

/**
 * @param {{root:string, files:object[], contents:Map<string,string>, facts?:object}} input
 * @returns {{claims:object[], summary:{files:number,total:number,ok:number,false:number,unknown:number,byKind:object}}}
 */
export function verifyContext({ root, files = [], contents = new Map(), facts = null }) {
  const f = facts || loadFacts(root);
  const claims = [];
  const targets = files.filter((x) => VERIFY_KINDS.has(x.kind) && !SAMPLE_DIR.test(x.path) && typeof contents.get(x.path) === 'string').slice(0, MAX_FILES);
  for (const file of targets) {
    const raw = extractClaims(contents.get(file.path));
    const seen = new Set();
    for (const cl of raw) {
      const key = `${cl.kind}:${cl.line}:${cl.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let r;
      try { r = checkClaim(cl, f, file.path, raw.filter((x) => x.line === cl.line && x !== cl)); } catch { r = { status: 'unknown', evidence: 'check failed', suggestion: null, fix: null }; }
      claims.push({
        id: `${cl.kind}:${file.path}:${cl.line}:${hash(cl.text)}`,
        file: file.path, line: cl.line, kind: cl.kind, text: maskSecretsInText(cl.text),
        status: r.status, evidence: maskSecretsInText(r.evidence || ''), suggestion: r.suggestion ? maskSecretsInText(r.suggestion) : null,
        fixable: !!(r.fix && cl.lineText.includes(r.fix.from)),
      });
      if (claims.length >= MAX_CLAIMS) break;
    }
    if (claims.length >= MAX_CLAIMS) break;
  }
  const summary = { files: targets.length, total: claims.length, ok: 0, false: 0, unknown: 0, byKind: {} };
  for (const c of claims) {
    summary[c.status]++;
    const k = (summary.byKind[c.kind] ??= { ok: 0, false: 0, unknown: 0 });
    k[c.status]++;
  }
  return { claims, summary };
}

/**
 * The concrete edit for a false claim, recomputed from the current file content (never taken from a client).
 * @returns {{path:string, line:number, before:string, after:string}|null}
 */
export function claimFix({ root, files, contents, id, facts = null }) {
  const m = /^([a-z]+):(.+):(\d+):([0-9a-f]{10})$/.exec(String(id || ''));
  if (!m) return null;
  const [, kind, file, lineStr, h] = m;
  const entry = files.find((x) => x.path === file);
  const text = contents.get(file);
  if (!entry || !VERIFY_KINDS.has(entry.kind) || SAMPLE_DIR.test(file) || typeof text !== 'string') return null;
  const line = Number(lineStr);
  const f = facts || loadFacts(root);
  const raw = extractClaims(text);
  const cl = raw.find((x) => x.kind === kind && x.line === line && hash(x.text) === h);
  if (!cl) return null;
  const r = checkClaim(cl, f, file, raw.filter((x) => x.line === line && x !== cl));
  if (r.status !== 'false' || !r.fix) return null;
  const lines = text.split('\n');
  const old = lines[line - 1];
  if (old == null || !old.includes(r.fix.from)) return null;
  const copy = lines.slice();
  copy[line - 1] = old.replace(r.fix.from, () => r.fix.to);
  return { path: file, line, from: r.fix.from, to: r.fix.to, before: text, after: copy.join('\n') };
}

/**
 * Lint issues for the `false-claim` rule. Path claims are left to `missing-path` so a moved file is not
 * penalised twice.
 */
export function falseClaimIssues({ root, files, contents }) {
  if (!root) return [];
  const { claims } = verifyContext({ root, files, contents });
  return claims.filter((c) => c.status === 'false' && c.kind !== 'path').map((c) => ({
    id: `false-claim:${c.id}`,
    rule: 'false-claim',
    severity: 'warn',
    path: c.file,
    line: c.line,
    message: `\`${c.text}\`: ${c.evidence}`,
    hint: c.suggestion ? `Suggested fix: ${c.suggestion}.` : 'Update or remove the instruction so agents do not act on it.',
  }));
}
