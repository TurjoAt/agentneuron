// Test/build output parsers: node:test / TAP, Jest, Vitest, PHPUnit, pytest, go test, cargo test, generic.
// Pure functions over captured stdout+stderr. Never throws.

const MAX_TESTS = 500;
const MAX_FAILURES = 100;

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)/g;
export const stripAnsi = (s) => String(s ?? '').replace(ANSI, '');

const num = (v) => (v == null ? 0 : Number(v) || 0);

/** First project-relative `file:line` in a block of text (stack traces, PHPUnit, pytest). */
export function fileLine(text) {
  const t = String(text || '');
  const re = /(?:^|[\s(\[@"'])((?:\.{1,2}\/|[A-Za-z]:[\\/]|\/)?[\w@.\-\\/]+\.(?:[cm]?[jt]sx?|vue|svelte|php|py|go|rs|rb))(?::|", line |\()(\d+)/g;
  let m;
  while ((m = re.exec(t))) {
    const f = m[1].replace(/\\/g, '/');
    if (/node_modules\/|node:internal|^internal\/|\/vendor\/|site-packages\//.test(f)) continue;
    return { file: f, line: Number(m[2]) };
  }
  return { file: null, line: null };
}

function finish(out) {
  out.tests = out.tests.slice(0, MAX_TESTS);
  out.failures = out.failures.slice(0, MAX_FAILURES).map((f) => ({ ...f, message: String(f.message || '').trim().slice(0, 600) }));
  return out;
}
const blank = (format) => ({ format, passed: 0, failed: 0, skipped: 0, tests: [], failures: [] });

/** TAP (node --test, tap, ava --tap). */
function parseTap(text) {
  const out = blank('tap');
  const lines = text.split('\n');
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(not ok|ok) \d+(?: - (.*?))?(?:\s+#\s*(SKIP|TODO)\b.*)?$/i.exec(lines[i]);
    if (!m) continue;
    found = true;
    const indent = m[1].length;
    const name = (m[3] || '').trim();
    // subtests are reported nested; node --test reports a parent with its own line too. Count leaf-ish lines:
    // a line whose next non-blank lines at deeper indent contain test results is a suite.
    let isSuite = false;
    for (let j = i - 1; j >= 0 && j >= i - 400; j--) {
      const pm = /^(\s*)(?:not ok|ok) \d+/.exec(lines[j]);
      if (pm) { if (pm[1].length > indent) isSuite = true; break; }
      if (/^\s*# Subtest:/.test(lines[j]) && /^(\s*)/.exec(lines[j])[1].length === indent) break;
    }
    if (isSuite) continue;
    const skip = !!m[4];
    const ok = m[2].toLowerCase() === 'ok';
    if (skip) { out.skipped++; out.tests.push({ name, status: 'skipped' }); continue; }
    if (ok) { out.passed++; out.tests.push({ name, status: 'passed' }); continue; }
    out.failed++;
    out.tests.push({ name, status: 'failed' });
    // YAML diagnostic block follows
    const diag = [];
    for (let j = i + 1; j < lines.length && j < i + 60; j++) {
      if (/^\s*(?:not ok|ok) \d+/.test(lines[j]) || /^\s*# Subtest:/.test(lines[j])) break;
      diag.push(lines[j]);
    }
    const d = diag.join('\n');
    const loc = /location:\s*'?([^'\n]+?):(\d+):\d+'?/.exec(d);
    const err = /error:\s*(?:\|-?\n)?\s*['"]?([^\n'"]+)/.exec(d);
    const fl = loc ? { file: loc[1].replace(/^file:\/\//, ''), line: Number(loc[2]) } : fileLine(d);
    out.failures.push({ name, file: fl.file, line: fl.line, message: err ? err[1] : '' });
  }
  // leaf counts above; the "# pass N" summary (which also counts parent tests) only when no result line was seen
  const sum = (k) => { const r = new RegExp(`^# ${k} (\\d+)$`, 'm').exec(text); return r ? Number(r[1]) : null; };
  if (!found && sum('pass') != null) { out.passed = sum('pass'); out.failed = sum('fail') ?? 0; out.skipped = (sum('skipped') ?? 0) + (sum('todo') ?? 0); }
  return found || sum('pass') != null ? out : null;
}

/** node --test with the spec reporter ("ℹ pass 3"). */
function parseNodeSpec(text) {
  const pass = /^ℹ pass (\d+)$/m.exec(text);
  if (!pass) return null;
  const out = blank('node-spec');
  out.passed = Number(pass[1]);
  out.failed = num(/^ℹ fail (\d+)$/m.exec(text)?.[1]) + num(/^ℹ cancelled (\d+)$/m.exec(text)?.[1]);
  out.skipped = num(/^ℹ skipped (\d+)$/m.exec(text)?.[1]) + num(/^ℹ todo (\d+)$/m.exec(text)?.[1]);
  const fails = text.split(/^✖ failing tests:$/m)[1] || '';
  for (const m of fails.matchAll(/^\s*✖ (.+?)(?: \([\d.]+m?s\))?$/gm)) {
    const after = fails.slice(m.index + m[0].length, m.index + m[0].length + 1500);
    const msg = after.split('\n').map((l) => l.trim()).find((l) => l && !/^at /.test(l)) || '';
    out.failures.push({ name: m[1].trim(), ...fileLine(after.replace(/file:\/\//g, '')), message: msg });
    out.tests.push({ name: m[1].trim(), status: 'failed' });
  }
  return out;
}

/** Jest / Vitest. */
function parseJestLike(text) {
  const jest = /^Tests:\s+(.*\btotal)\s*$/m.exec(text);
  const vitest = /^\s*Tests\s+(.*\(\d+\))\s*$/m.exec(text);
  const line = jest?.[1] || vitest?.[1];
  if (!line) return null;
  const out = blank(vitest && !jest ? 'vitest' : 'jest');
  out.failed = num(/(\d+) failed/.exec(line)?.[1]);
  out.passed = num(/(\d+) passed/.exec(line)?.[1]);
  out.skipped = num(/(\d+) skipped/.exec(line)?.[1]) + num(/(\d+) todo/.exec(line)?.[1]);
  for (const m of text.matchAll(/^\s*[✓√✔]\s+(.+?)(?:\s+\(\d+\s*m?s\))?\s*$/gm)) out.tests.push({ name: m[1].trim(), status: 'passed' });
  for (const m of text.matchAll(/^\s*[✕×✗✖]\s+(.+?)(?:\s+\d+m?s)?\s*$/gm)) out.tests.push({ name: m[1].trim(), status: 'failed' });
  // Jest failure blocks: "  ● Suite › test name" ... stack; Vitest: " FAIL  file > suite > test"
  const blocks = text.split(/^\s*●\s+/m).slice(1);
  for (const b of blocks) {
    const [head, ...rest] = b.split('\n');
    if (/^Test suite failed to run/.test(head)) { out.failures.push({ name: head.trim(), ...fileLine(rest.join('\n')), message: rest.find((l) => l.trim())?.trim() || '' }); continue; }
    const body = rest.join('\n');
    const msg = rest.map((l) => l.trim()).find((l) => l && !/^(at |>|\d+ \|)/.test(l)) || '';
    out.failures.push({ name: head.replace(/\s›\s/g, ' > ').trim(), ...fileLine(body), message: msg });
  }
  if (!blocks.length) {
    for (const m of text.matchAll(/^\s*FAIL\s+(\S+)\s+>\s+(.+)$/gm)) {
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 2000);
      const msg = after.split('\n').map((l) => l.trim()).find((l) => l && !/^(❯|at |\d+\|)/.test(l)) || '';
      const fl = fileLine(after);
      out.failures.push({ name: `${m[1]} > ${m[2].trim()}`, file: fl.file || m[1], line: fl.line, message: msg });
    }
  }
  return out;
}

/** PHPUnit / Pest. */
function parsePhpunit(text) {
  const ok = /^OK \((\d+) tests?,/m.exec(text);
  const bad = /^Tests: (\d+), Assertions: \d+(?:, (?:Errors|Failures|Skipped|Incomplete|Risky|Warnings|Deprecations): \d+)*/m.exec(text);
  const pest = /^\s*Tests:\s+(.*)$/m.exec(text);
  if (!ok && !bad && !(pest && /PHPUnit|Pest|PASS|FAIL/.test(text))) return null;
  const out = blank('phpunit');
  if (ok) { out.passed = Number(ok[1]); return out; }
  if (bad) {
    const total = Number(bad[1]);
    const f = num(/Failures: (\d+)/.exec(bad[0])?.[1]) + num(/Errors: (\d+)/.exec(bad[0])?.[1]);
    out.skipped = num(/Skipped: (\d+)/.exec(bad[0])?.[1]) + num(/Incomplete: (\d+)/.exec(bad[0])?.[1]);
    out.failed = f; out.passed = Math.max(0, total - f - out.skipped);
  } else {
    out.failed = num(/(\d+) failed/.exec(pest[1])?.[1]); out.passed = num(/(\d+) passed/.exec(pest[1])?.[1]); out.skipped = num(/(\d+) skipped/.exec(pest[1])?.[1]);
  }
  for (const m of text.matchAll(/^\d+\) ([\w\\]+::\w+)(?: with data set [^\n]*)?\n([\s\S]*?)(?=\n\d+\) |\n(?:FAILURES|ERRORS)!|\n--\n|(?![\s\S]))/gm)) {
    const body = m[2];
    const msg = body.split('\n').map((l) => l.trim()).find(Boolean) || '';
    out.failures.push({ name: m[1], ...fileLine(body), message: msg });
    out.tests.push({ name: m[1], status: 'failed' });
  }
  return out;
}

/** pytest. */
function parsePytest(text) {
  const sum = /^=+ (.*?(?:passed|failed|error|skipped|no tests ran).*?) in [\d.]+s(?: \([^)]*\))? =+$/m.exec(text);
  if (!sum) return null;
  const s = sum[1];
  const out = blank('pytest');
  out.passed = num(/(\d+) passed/.exec(s)?.[1]);
  out.failed = num(/(\d+) failed/.exec(s)?.[1]) + num(/(\d+) errors?/.exec(s)?.[1]);
  out.skipped = num(/(\d+) skipped/.exec(s)?.[1]) + num(/(\d+) xfailed/.exec(s)?.[1]);
  for (const m of text.matchAll(/^(FAILED|ERROR) (\S+?)(?: - (.*))?$/gm)) {
    const [file, ...rest] = m[2].split('::');
    const name = rest.length ? rest.join('::') : m[2];
    const lm = new RegExp(`^${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+):`, 'm').exec(text);
    out.failures.push({ name: m[2], file, line: lm ? Number(lm[1]) : null, message: m[3] || '' });
    out.tests.push({ name, status: 'failed' });
  }
  for (const m of text.matchAll(/^(\S+?::\S+) PASSED/gm)) out.tests.push({ name: m[1].split('::').slice(1).join('::'), status: 'passed' });
  return out;
}

/** go test (plain or -v). */
function parseGo(text) {
  if (!/^(?:ok|FAIL|---|PASS|\?)\s/m.test(text) || !/^(?:ok\s+\S+|FAIL\s+\S+|--- (?:PASS|FAIL))/m.test(text)) return null;
  const out = blank('go');
  for (const m of text.matchAll(/^\s*--- (PASS|FAIL|SKIP): (\S+)/gm)) {
    const st = m[1] === 'PASS' ? 'passed' : m[1] === 'FAIL' ? 'failed' : 'skipped';
    out[st === 'passed' ? 'passed' : st === 'failed' ? 'failed' : 'skipped']++;
    out.tests.push({ name: m[2], status: st });
    if (st === 'failed') {
      // go prints t.Error output between "=== RUN name" and "--- FAIL: name" (older versions: after it)
      const before = text.slice(0, m.index);
      const runAt = before.lastIndexOf(`=== RUN   ${m[2]}`);
      const scope = (runAt >= 0 ? before.slice(runAt) : '') + text.slice(m.index + m[0].length, m.index + m[0].length + 1500);
      const fm = /^\s+([\w./-]+\.go):(\d+): (.*)$/m.exec(scope);
      out.failures.push({ name: m[2], file: fm?.[1] || null, line: fm ? Number(fm[2]) : null, message: fm?.[3] || '' });
    }
  }
  if (!out.tests.length) {
    out.passed = (text.match(/^ok\s+\S+/gm) || []).length;
    for (const m of text.matchAll(/^FAIL\s+(\S+)/gm)) { out.failed++; out.failures.push({ name: m[1], file: null, line: null, message: 'package failed' }); }
  }
  return out;
}

/** cargo test. */
function parseCargo(text) {
  const res = [...text.matchAll(/^test result: (\w+)\. (\d+) passed; (\d+) failed; (\d+) ignored/gm)];
  if (!res.length) return null;
  const out = blank('cargo');
  for (const m of res) { out.passed += Number(m[2]); out.failed += Number(m[3]); out.skipped += Number(m[4]); }
  for (const m of text.matchAll(/^test (\S+) \.\.\. (ok|FAILED|ignored)$/gm)) out.tests.push({ name: m[1], status: m[2] === 'ok' ? 'passed' : m[2] === 'FAILED' ? 'failed' : 'skipped' });
  for (const m of text.matchAll(/^---- (\S+) stdout ----\n([\s\S]*?)(?=\n---- |\nfailures:\n|(?![\s\S]))/gm)) {
    const body = m[2];
    const pm = /panicked at ([\w./-]+\.rs):(\d+):\d+:\n?(.*)/.exec(body) || /panicked at '([^']*)', ([\w./-]+\.rs):(\d+)/.exec(body);
    if (pm && pm[1].endsWith('.rs')) out.failures.push({ name: m[1], file: pm[1], line: Number(pm[2]), message: (pm[3] || '').trim() });
    else if (pm) out.failures.push({ name: m[1], file: pm[2], line: Number(pm[3]), message: pm[1] });
    else out.failures.push({ name: m[1], file: null, line: null, message: body.trim().split('\n')[0] || '' });
  }
  return out;
}

/** Lint / typecheck / build: count `file:line` errors (eslint stylish, tsc, generic compilers). */
function parseDiagnostics(text) {
  const out = blank('diagnostics');
  // tsc: src/a.ts(3,7): error TS2322: ... | src/a.ts:3:7 - error TS2322: ...
  for (const m of text.matchAll(/^([\w./@-]+\.[cm]?[jt]sx?|[\w./@-]+\.(?:vue|svelte))(?:\((\d+),\d+\)|:(\d+):\d+)\s*[:-]\s*error\s+(TS\d+:?.*)$/gm)) {
    out.failures.push({ name: m[4].slice(0, 120), file: m[1], line: Number(m[2] || m[3]), message: m[4] });
  }
  // eslint stylish: a file header line then "  3:7  error  message  rule"
  let file = null;
  for (const line of text.split('\n')) {
    if (/^(?:\/|[A-Za-z]:\\|\.{0,2}\/?[\w@.-]+\/)[^\s:]*\.\w+$/.test(line.trim()) && !/^\s/.test(line)) { file = line.trim(); continue; }
    const m = /^\s+(\d+):\d+\s+error\s+(.*?)(?:\s{2,}([\w@/-]+))?$/.exec(line);
    if (m && file) out.failures.push({ name: m[3] || 'lint error', file, line: Number(m[1]), message: m[2] });
  }
  out.failed = out.failures.length;
  return out.failures.length ? out : null;
}

/**
 * Parse captured output of one check. Returns { format, passed, failed, skipped, tests, failures }.
 * With no recognised format the exit code decides: { format: 'exit', failed: code ? 1 : 0, passed: code ? 0 : 1 }.
 */
export function parseOutput(raw, { exitCode = 0 } = {}) {
  const text = stripAnsi(raw).replace(/\r\n?/g, '\n');
  const p = parseNodeSpec(text) || parseJestLike(text) || parsePhpunit(text) || parsePytest(text) || parseCargo(text) || parseTap(text) || parseGo(text) || parseDiagnostics(text);
  if (p) {
    // a non-zero exit with zero parsed failures still means failure (crash, coverage threshold, ...)
    if (exitCode && !p.failed) {
      p.failed = 1;
      const tail = text.trim().split('\n').slice(-3).join(' ').slice(0, 300);
      p.failures.push({ name: 'exit code', file: null, line: null, message: `exited with code ${exitCode}${tail ? `: ${tail}` : ''}` });
    }
    return finish(p);
  }
  const out = blank('exit');
  if (exitCode === 0) out.passed = 1;
  else {
    out.failed = 1;
    const errLine = text.split('\n').map((l) => l.trim()).filter(Boolean).reverse().find((l) => /error|fail|exception|cannot|not found/i.test(l)) || '';
    out.failures.push({ name: 'exit code', ...fileLine(text), message: `exited with code ${exitCode ?? 'null'}${errLine ? `: ${errLine}` : ''}` });
  }
  return finish(out);
}
