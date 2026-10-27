// #6 Review guardian: per-file / per-hunk risk with reasons, removed checks, missing tests, read-first order.
// Reason messages never quote source lines (the review is visible to viewers; diff content is not).
import { runGit } from '../git2/run.js';
import { scanSecrets } from '../health/secrets.js';
import { collectDiff, hunkLines } from './diff.js';
import { fileKind, isTest, isGenerated, isLockfile, isEnv, sensitiveAreas, testStem, sourceStem } from './classify.js';

const RANK = { low: 1, medium: 2, high: 3 };
export const maxRisk = (a, b) => (RANK[a] >= RANK[b] ? a : b);

// removed lines: checks that guarded something
const REMOVED = [
  ['removed-check', 'high', 'Removed an authentication / permission condition', /\bif\s*\(?\s*(!|not\s+)\s*\$?(?:this\.|self\.|req\.|request\.|\$request->|ctx\.)?(user|auth\w*|session|currentUser|current_user|isAuthenticated|is_authenticated|loggedIn|logged_in|isAdmin|is_admin|can\w*|has\w*Perm\w*|token|isOwner|is_owner)\b/i],
  ['removed-check', 'high', 'Removed an authorization call', /(^|[^\w.])(authorize|authorizeResource|checkPermission|hasPermission|has_perm|requirePermission|requireAuth|require_auth|ensureAuthenticated|ensureLoggedIn|isAuthenticated|verifyToken|verify_token|verifyJwt|checkAuth|abort_unless|abort_if|Gate::(allows|denies|authorize)|\$this->authorize|->can|\.can)\s*\(/],
  ['removed-check', 'high', 'Removed a route middleware / guard', /->middleware\(|\.middleware\(|@UseGuards|\bguard\s*\(|router\.use\(\s*(auth|requireAuth|authenticate|protect)/i],
  ['removed-check', 'high', 'Removed CSRF protection', /@csrf\b|csrf_token|csrfProtection|csrf\(\)|VerifyCsrfToken|csrf_protect|CsrfViewMiddleware/i],
  ['removed-check', 'high', 'Removed a decorator / annotation that restricts access', /@(login_required|permission_required|PreAuthorize|Secured|RolesAllowed|Authorize|requires_auth|admin_required|staff_member_required)\b/],
  ['removed-check', 'high', 'Removed a 401/403 response', /\babort\(\s*40[13]|status\(\s*40[13]\s*\)|throw new (Unauthorized|Forbidden|Authorization|AccessDenied)\w*|raise (PermissionDenied|Unauthorized|Forbidden)\w*|HttpResponseForbidden|StatusUnauthorized|StatusForbidden/],
  ['removed-validation', 'medium', 'Removed input validation or escaping', /(^|[^\w])(validate\w*|validator|sanitize\w*|escape\w*|htmlspecialchars|assert\w*)\s*\(/i],
];
// added lines
const ADDED = [
  ['widened-permission', 'high', 'Grants broad permissions or disables a security check', /chmod\s+(-R\s+)?0?777|\b(chmod|chmodSync|mkdir|mkdirSync)\b[^\n]{0,60}\b0o?777\b|\bmode\s*:\s*0o?777\b|\bpermitAll\(\)|\bAllowAny\b|\ballow_all\b|isAdmin\s*[:=]\s*true|is_admin\s*=\s*True|\brole\s*[:=]\s*['"](admin|superuser|root)['"]|csrf_exempt|withoutMiddleware\(|skip_before_action\s+:(authenticate|verify)|rejectUnauthorized\s*:\s*false|verify\s*=\s*False|NODE_TLS_REJECT_UNAUTHORIZED|InsecureSkipVerify\s*:\s*true|\bdisable_?auth\w*|\bauth\s*[:=]\s*(false|False|None|null)\b|Gate::before\(.*true/i],
  ['widened-permission', 'medium', 'Allows any origin (CORS *)', /Access-Control-Allow-Origin['"]?\s*[:,]\s*['"]\*|\borigin\s*:\s*(['"]\*['"]|true\b)|\bcors\(\s*\)|allow_origins\s*=\s*\[\s*['"]\*|CORS_ALLOW_ALL_ORIGINS\s*=\s*True|AllowAnyOrigin\(\)/],
  ['disabled-test', 'high', 'Skips or disables a test', /\b(it|test|describe|context|suite)\.skip\s*\(|\bx(it|describe|test)\s*\(|@pytest\.mark\.skip|@unittest\.skip|@Disabled\b|@Ignore\b|markTestSkipped|markTestIncomplete|\bt\.Skip(Now)?\(|\b(it|test)\.todo\s*\(|\{\s*skip\s*:\s*true\s*\}/],
  ['focused-test', 'medium', 'Focuses one test (.only): the rest stop running', /\b(it|test|describe|context|suite)\.only\s*\(|\bf(it|describe)\s*\(/],
  ['risky-api', 'medium', 'Uses a dangerous API (eval, raw HTML, shell or raw SQL)', /\beval\s*\(|new Function\s*\(|dangerouslySetInnerHTML|\.innerHTML\s*=|\bv-html\b|\{@html\s|shell\s*=\s*True|os\.system\s*\(|DB::raw\s*\(|->whereRaw\s*\(|\$queryRawUnsafe|\bexecSync\s*\(|unserialize\s*\(|pickle\.loads?\s*\(|yaml\.load\s*\((?![^)]*Loader)/],
  ['security-headers', 'medium', 'Changes security headers / CSP', /helmet\s*\(|Content-Security-Policy|X-Frame-Options|Strict-Transport-Security|X-Content-Type-Options|frameguard|contentSecurityPolicy/i],
  ['debug-code', 'low', 'Leaves debugging code', /\bdebugger\s*;|\bdd\s*\(|\bvar_dump\s*\(|binding\.pry|\bpdb\.set_trace\s*\(|breakpoint\s*\(\s*\)/],
];
const DEF_RE = /^\s*(export\s+)?(default\s+)?(async\s+)?(function\*?|class|def|func|interface|type|enum|trait)\s+[A-Za-z_$]|^\s*(public|protected|private|static)\s+(static\s+)?function\s+\w|^\s*export\s+(const|let|var)\s+\w/;
const norm = (s) => s.replace(/\s+/g, ' ').trim();

/** Classify one diff file -> { risk, reasons, hunks } (no repo access). */
export function classifyFile(f) {
  const reasons = [];
  const push = (code, severity, message, line = null, side = 'new') => {
    if (reasons.length >= 40) return;
    if (reasons.some((r) => r.code === code && r.line === line && r.message === message)) return;
    reasons.push({ code, severity, message, line, side });
  };
  const kind = fileKind(f.path);
  const areas = sensitiveAreas(f.path);
  const HIGH_AREAS = new Set(['auth', 'permissions', 'payments', 'crypto']);
  for (const a of areas) {
    if (a.area === 'lockfile') push('lockfile', 'low', 'Lockfile changed: dependency versions moved');
    else if (a.area === 'config') push('area', 'low', `Touches ${a.label}`);
    else if (a.area === 'env') push('env-file', f.status === 'D' ? 'low' : 'high', f.status === 'D' ? 'Environment file removed' : 'Environment file in the change: may contain real credentials');
    else push('area', HIGH_AREAS.has(a.area) || a.area === 'migrations' || a.area === 'infra' || a.area === 'deps' ? 'medium' : 'low', `Touches ${a.label}`);
  }
  if (f.status === 'D' && isTest(f.path)) push('deleted-test', 'high', 'Deletes a test file');
  else if (f.status === 'D' && areas.some((a) => HIGH_AREAS.has(a.area))) push('deleted-sensitive', 'high', `Deletes a file in a sensitive area (${areas[0].label})`);
  if (f.binary) push('binary', isGenerated(f.path) ? 'low' : 'low', 'Binary file: not reviewable as text');
  if (!isLockfile(f.path) && (isGenerated(f.path) || f.added > 1500)) push('generated-blob', 'medium', isGenerated(f.path) ? 'Generated / build output committed' : `Very large addition (${f.added} lines): likely generated`);

  const added = new Set();
  const addedLines = []; // { text, line }
  const hunkOut = [];
  for (const h of f.hunks) {
    for (const l of hunkLines(h)) if (l.type === 'add') { added.add(norm(l.text)); addedLines.push({ text: l.text, line: l.newLine }); }
  }
  let longLine = false;
  for (const h of f.hunks) {
    const hr = { oldStart: h.oldStart, newStart: h.newStart, added: 0, removed: 0, risk: 'low', codes: [] };
    for (const l of hunkLines(h)) {
      if (l.type === 'ctx') continue;
      if (l.type === 'add') hr.added++; else hr.removed++;
      if (l.text.length > 2000) { longLine = true; continue; }
      const rules = l.type === 'del' ? REMOVED : ADDED;
      for (const [code, sev, msg, re] of rules) {
        if (!re.test(l.text)) continue;
        if (l.type === 'del' && added.has(norm(l.text))) continue; // moved, not removed
        if ((code === 'disabled-test' || code === 'focused-test') && kind !== 'tests' && !isTest(f.path)) continue;
        if (code === 'debug-code' && kind !== 'source') continue;
        push(code, sev, msg, l.type === 'del' ? l.oldLine : l.newLine, l.type === 'del' ? 'old' : 'new');
        hr.risk = maxRisk(hr.risk, sev);
        if (!hr.codes.includes(code)) hr.codes.push(code);
      }
    }
    hunkOut.push(hr);
  }
  if (longLine && !reasons.some((r) => r.code === 'generated-blob') && !isLockfile(f.path)) push('generated-blob', 'medium', 'Contains minified / very long lines');
  // secrets in added lines (only location + kind, never the value)
  if (addedLines.length && !f.binary) {
    const text = addedLines.map((a) => a.text).join('\n');
    for (const s of scanSecrets(f.path, text).slice(0, 10)) {
      const label = String(s.message || 'Secret').replace(/ found on line.*$/, '');
      const line = addedLines[s.line - 1]?.line ?? null;
      push('secret-added', 'high', `${label} added`, line);
      const hr = hunkOut.find((h, i) => line != null && line >= h.newStart && (i === hunkOut.length - 1 || line < hunkOut[i + 1].newStart));
      if (hr) { hr.risk = 'high'; if (!hr.codes.includes('secret-added')) hr.codes.push('secret-added'); }
    }
  }
  if (kind === 'source' && f.added + f.removed > 400) push('large-change', 'low', `Large change (${f.added + f.removed} lines): review in parts`);
  let risk = 'low';
  for (const r of reasons) risk = maxRisk(risk, r.severity);
  // several medium signals in one sensitive file add up
  if (risk === 'medium' && areas.some((a) => HIGH_AREAS.has(a.area)) && reasons.filter((r) => r.severity === 'medium').length >= 3) risk = 'high';
  const defsAdded = addedLines.filter((a) => DEF_RE.test(a.text)).length;
  let defsRemoved = 0;
  for (const h of f.hunks) for (const l of hunkLines(h)) if (l.type === 'del' && DEF_RE.test(l.text)) defsRemoved++;
  return { kind, risk, reasons, hunks: hunkOut, defsAdded, defsRemoved };
}

function groupOf(f, c) {
  if (c.kind === 'tests') return 'tests';
  if (c.kind === 'deps') return 'deps';
  if (c.kind === 'docs') return 'docs';
  if (c.kind === 'config' || c.kind === 'other') return 'config';
  if (f.status === 'A' || c.defsAdded > c.defsRemoved || (f.added > 20 && f.added > f.removed * 3)) return 'feature';
  return 'refactor';
}

/** All files of the repo (tracked + untracked, not ignored), cwd-relative; capped. */
export async function repoFiles(root, cap = 60000) {
  const r = await runGit(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { timeout: 20000 });
  if (!r.ok) return [];
  const out = r.out.split('\0').filter(Boolean);
  return out.length > cap ? out.slice(0, cap) : out;
}

/**
 * Review the current diff (or base..head).
 * -> { available, base, head, generatedAt, summary, groups, files, readFirst, truncated }
 */
export async function reviewChanges(root, { base, head } = {}) {
  const d = await collectDiff(root, { base, head });
  const empty = { files: 0, added: 0, removed: 0, high: 0, medium: 0, low: 0, missingTests: 0 };
  if (!d.available) return { available: false, reason: d.reason, base: d.base, head: d.head, generatedAt: Date.now(), summary: empty, groups: [], files: [], readFirst: [], truncated: false };
  const all = await repoFiles(root);
  const testsByStem = new Map();
  for (const p of all) if (isTest(p)) { const s = testStem(p); if (s.length >= 2) (testsByStem.get(s) || testsByStem.set(s, []).get(s)).push(p); }
  const changedTests = new Set(d.files.filter((f) => isTest(f.path) && f.status !== 'D').map((f) => f.path));
  const changedTestStems = new Set([...changedTests].map(testStem));
  const files = [];
  const groups = new Map();
  for (const f of d.files) {
    const c = classifyFile(f);
    let tests = [];
    let missingTest = false;
    if (c.kind === 'source' && f.status !== 'D' && !isGenerated(f.path)) {
      const stem = sourceStem(f.path);
      tests = (testsByStem.get(stem) || []).slice(0, 6);
      const touched = tests.some((t) => changedTests.has(t)) || changedTestStems.has(stem);
      if (!tests.length && !touched && f.added > 0) {
        missingTest = true;
        c.reasons.push({ code: 'missing-test', severity: 'low', message: 'No test file found for this source file', line: null, side: 'new' });
      } else if (tests.length && !touched && f.added + f.removed > 0) {
        c.reasons.push({ code: 'tests-not-updated', severity: 'low', message: 'Has tests, but none of them changed', line: null, side: 'new' });
      }
    }
    const g = groupOf(f, c);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(f.path);
    const out = { path: f.path, status: f.status, added: f.added, removed: f.removed, kind: c.kind, group: g, risk: c.risk, reasons: c.reasons, hunks: c.hunks, tests, missingTest };
    if (f.from) out.from = f.from;
    if (f.untracked) out.untracked = true;
    if (f.binary) out.binary = true;
    files.push(out);
  }
  const score = (f) => RANK[f.risk] * 1000 + f.reasons.filter((r) => r.severity === 'high').length * 50 + f.reasons.filter((r) => r.severity === 'medium').length * 10 + Math.min(9, Math.floor((f.added + f.removed) / 50));
  files.sort((a, b) => score(b) - score(a) || a.path.localeCompare(b.path));
  const risky = files.filter((f) => f.risk !== 'low' && f.kind !== 'deps' || f.risk === 'high');
  const readFirst = (risky.length ? risky : files.filter((f) => f.kind === 'source')).slice(0, 8).map((f) => f.path);
  const summary = { ...empty, files: files.length };
  for (const f of files) { summary.added += f.added; summary.removed += f.removed; summary[f.risk]++; if (f.missingTest) summary.missingTests++; }
  const ORDER = ['feature', 'refactor', 'config', 'deps', 'tests', 'docs'];
  return {
    available: true, base: d.base, head: d.head, generatedAt: Date.now(), summary,
    groups: ORDER.filter((k) => groups.has(k)).map((kind) => ({ kind, files: groups.get(kind) })),
    files, readFirst, truncated: d.truncated,
  };
}

/** Compact Markdown for the CLI / MCP. */
export function reviewMarkdown(r) {
  if (!r.available) return `Review unavailable: ${r.reason}`;
  const s = r.summary;
  const out = [`# Change review (${r.base || 'empty tree'}${r.head ? `..${r.head}` : ' vs working tree'})`, '',
    `${s.files} files, +${s.added} -${s.removed}; risk: ${s.high} high, ${s.medium} medium, ${s.low} low; ${s.missingTests} without tests`, ''];
  if (r.readFirst.length) out.push('## Read these first', ...r.readFirst.map((p, i) => `${i + 1}. ${p}`), '');
  for (const f of r.files.filter((x) => x.risk !== 'low').slice(0, 30)) {
    out.push(`- **${f.risk.toUpperCase()}** ${f.path}`);
    for (const x of f.reasons.filter((y) => y.severity !== 'low').slice(0, 6)) out.push(`  - ${x.message}${x.line ? ` (line ${x.line}${x.side === 'old' ? ', removed' : ''})` : ''}`);
  }
  return out.join('\n');
}
