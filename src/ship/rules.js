// Per-file static rules for readiness (#2) and placeholder (#15) findings.
// Findings never contain the matched secret or credential value, only its kind and location.
// Suppress: `ship-ignore` on the line (or the line above), `ship-ignore-file` in the first 5 lines.
// ship-ignore-file (this file holds the patterns themselves)
import { scanSecrets } from '../health/secrets.js';
import { isTestLike } from './files.js';

export const RULES_VERSION = 5;
const CODE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|php|py|rb|go|rs|java|kt|cs|html?|erb|twig)$/i;
const MARKUP = /\.(?:[jt]sx|vue|svelte|astro|html?|erb|twig|php)$/i;
const DOTENV = /(?:^|\/)\.env(?:\.[\w.-]+)?$/;
const EXAMPLE_ENV = /(?:^|\/)\.env\.(?:example|sample|dist|template|defaults)$/i;

export const ENV_BUILTIN = new Set(['NODE_ENV', 'CI', 'HOME', 'PATH', 'PWD', 'USER', 'SHELL', 'TERM', 'TZ', 'LANG', 'TMPDIR', 'MODE', 'DEV', 'PROD', 'SSR', 'BASE_URL', 'npm_package_version', 'npm_lifecycle_event', 'VERCEL', 'NETLIFY', 'GITHUB_ACTIONS', 'APPDATA', 'USERPROFILE', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'NO_COLOR', 'FORCE_COLOR', 'DEBUG']);
const ENV_PATTERNS = [
  /process\.env\.([A-Z][A-Z0-9_]{1,63})\b/g,
  /process\.env\[\s*['"]([A-Z][A-Z0-9_]{1,63})['"]\s*\]/g,
  /import\.meta\.env\.([A-Z][A-Z0-9_]{1,63})\b/g,
  /\benv\(\s*['"]([A-Z][A-Z0-9_]{1,63})['"]/g,
  /os\.environ(?:\.get)?\s*[([]\s*['"]([A-Z][A-Z0-9_]{1,63})['"]/g,
  /\bgetenv\(\s*['"]([A-Z][A-Z0-9_]{1,63})['"]/g,
  /Deno\.env\.get\(\s*['"]([A-Z][A-Z0-9_]{1,63})['"]/g,
  /os\.Getenv\(\s*"([A-Z][A-Z0-9_]{1,63})"/g,
  /std::env::var\(\s*"([A-Z][A-Z0-9_]{1,63})"/g,
  /ENV\[\s*['"]([A-Z][A-Z0-9_]{1,63})['"]\s*\]/g,
];

const AUTH_FN = /(?:function\s+|def\s+|(?:const|let|var)\s+|public\s+function\s+|func\s+|^\s*)(?:is|check|has|can|verify|validate)_?\w*(?:auth|logged|login|admin|permission|access|authori[sz]|token|password|session)\w*\s*(?:=\s*(?:async\s*)?\([^)]*\)\s*=>|\([^)]*\))/i;
const RETURN_TRUE = /^\s*return\s+(?:true|True)\s*;?\s*(?:\/\/.*|#.*)?$/;

const f = (o) => o; // readability helper
const QUOTED_CRED = /(?:password|passwd|pwd|secret|api[_-]?key|apikey|token|private[_-]?key)\w*["']?\s*[:=]>?\s*["'`][^"'`\s]{8,}["'`]/i;

/**
 * Scan one file. Returns { readiness: [finding], placeholders: [finding], env: [{ name, line }] }.
 * Finding: { id, rule, severity, category, title, why, fix, location: { path, line } }.
 */
export function scanFile(p, text) {
  const readiness = [];
  const placeholders = [];
  const env = [];
  const test = isTestLike(p);
  const code = CODE.test(p);
  const lines = text.split(/\r?\n/);
  const R = (rule, severity, category, title, why, fix, line) => !ignored(line) && readiness.push(f({ id: `${rule}:${p}:${line || 0}`, rule, severity, category, title, why, fix, location: { path: p, line: line || null } }));
  const P = (rule, severity, title, why, fix, line) => !ignored(line) && placeholders.push(f({ id: `${rule}:${p}:${line || 0}`, rule, severity, category: 'placeholder', title, why, fix, location: { path: p, line: line || null } }));

  if (/ship-ignore-file/.test(lines.slice(0, 5).join('\n'))) return { readiness, placeholders, env };
  const ignored = (n) => /ship-ignore\b/.test(lines[n - 1] || '') || /ship-ignore\b/.test(lines[n - 2] || '');

  // secrets: kind + location only
  if (!EXAMPLE_ENV.test(p)) {
    for (const s of scanSecrets(p, text).slice(0, 20)) {
      const kind = String(s.message).replace(/ found on line.*$/, '');
      // in code, a generic "key = value" hit counts only when the value is a string literal (not `token: userToken`)
      if (code && /^Hard-coded credential/.test(kind) && !QUOTED_CRED.test(lines[s.line - 1] || '')) continue;
      R('secret', test ? 'low' : 'high', 'secrets', `${kind} in the repository`, 'Anyone with read access to the repository (and every clone, fork and CI log) gets this credential.', 'Remove it, rotate the credential, and load it from an environment variable or secret manager.', s.line);
    }
  }

  const envFile = DOTENV.test(p);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.length > 2000) continue;
    const n = i + 1;
    // ---- env var usage
    if (code && !test) {
      for (const re of ENV_PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(l))) if (!ENV_BUILTIN.has(m[1]) && env.length < 400) env.push({ name: m[1], line: n });
      }
    }
    // ---- debug / dev flags
    if (envFile && /^\s*APP_DEBUG\s*=\s*["']?true["']?\s*$/i.test(l)) {
      if (EXAMPLE_ENV.test(p)) R('debug-example', 'low', 'debug', 'APP_DEBUG=true in the env example', 'Deployments copied from the example start with debug pages that show stack traces and config.', 'Set APP_DEBUG=false in the example and enable it only locally.', n);
      else R('debug-flag', 'high', 'debug', 'APP_DEBUG=true in a committed env file', 'Debug mode shows stack traces, queries and environment values to visitors.', 'Set APP_DEBUG=false for production and keep real env files out of git.', n);
    }
    if (/(?:^|\/)settings[\w.]*\.py$/.test(p) && /^\s*DEBUG\s*=\s*True\b/.test(l)) R('debug-flag', 'high', 'debug', 'Django DEBUG = True', 'Debug pages expose settings, SQL and stack traces to anyone.', 'Read DEBUG from the environment and default it to False.', n);
    if (/(?:^|\/)config\/app\.php$/.test(p) && /['"]debug['"]\s*=>\s*true\b/.test(l)) R('debug-flag', 'high', 'debug', "Laravel 'debug' => true hard-coded", 'Debug mode cannot be turned off by the environment.', "Use 'debug' => (bool) env('APP_DEBUG', false).", n);
    if (code && !test && /process\.env\.NODE_ENV\s*=(?!=)\s*['"](?:development|dev|test)['"]/.test(l)) R('node-env', 'medium', 'debug', 'NODE_ENV hard-coded to development', 'Frameworks keep dev-only checks, verbose errors and slow paths on.', 'Let the deployment set NODE_ENV; do not assign it in code.', n);
    if (code && !test && /\bapp\.run\([^)]*debug\s*=\s*True/.test(l)) R('debug-flag', 'high', 'debug', 'Flask app.run(debug=True)', 'The Werkzeug debugger allows remote code execution.', 'Remove debug=True or read it from the environment.', n);
    if (!test && /\b(?:SKIP_AUTH|DISABLE_AUTH|AUTH_DISABLED|BYPASS_AUTH|NO_AUTH|DISABLE_AUTHENTICATION)\b['"]?\s*[:=]\s*['"]?(?:true|1|yes)\b/i.test(l)) R('auth-bypass', 'high', 'auth', 'Authentication bypass switched on', 'An auth bypass flag left on in shipped config lets anyone in.', 'Remove the bypass or make sure it is off outside local development.', n);
    // ---- CORS
    if (!test && (/Access-Control-Allow-Origin['"]?\s*[,:]\s*['"]\*['"]/i.test(l) || /\borigin\s*:\s*['"]\*['"]/.test(l)
      || /['"]allowed_origins['"]\s*=>\s*\[\s*['"]\*['"]\s*\]/.test(l) || /\bCORS_(?:ALLOW_ALL_ORIGINS|ORIGIN_ALLOW_ALL)\s*=\s*True\b/.test(l)
      || /\bAllowAllOrigins\s*:\s*true\b/.test(l) || (code && /\bapp\.use\(\s*cors\(\s*\)\s*\)/.test(l)))) {
      R('cors-any', 'medium', 'cors', 'CORS allows any origin', 'Any website can call this API from a visitor\'s browser.', 'List the allowed origins explicitly (from config per environment).', n);
    }
    // ---- default credentials (value never echoed)
    if (!test && !EXAMPLE_ENV.test(p) && /(?:password|passwd|pwd|pass)['"]?\s*[:=]>?\s*['"](?:admin|password|123456|12345678|secret|changeme|root|qwerty|letmein|admin123)['"]/i.test(l)) {
      R('default-credential', 'high', 'credentials', 'Hard-coded default password', 'Default passwords are the first thing attackers try.', 'Remove the literal; read credentials from the environment and require a strong value.', n);
    }
    // ---- release blockers
    if (!test && /\b(?:TODO|FIXME|XXX|HACK)\b.*\bbefore\s+(?:the\s+)?(?:release|launch|prod(?:uction)?|deploy(?:ing|ment)?|going live|go-live|shipping|ship)\b/i.test(l)) {
      R('release-todo', 'high', 'release', 'TODO marked "before release"', 'The code itself says it is not ready to ship.', 'Resolve the TODO or move it to a tracked task with a decision.', n);
    }

    // ---- placeholders (#15): code only, not tests/fixtures/mocks/docs
    if (!code || test) continue;
    if (/\b(?:on[A-Z]\w*|on:\w+|@\w+|onclick|onsubmit|onchange)\s*=\s*\{?\s*["']?\s*(?:\(\s*[\w,\s]*\)|\w+)\s*=>\s*\{\s*\}/.test(l)) P('empty-handler', 'medium', 'Event handler does nothing', 'The control looks interactive but nothing happens when it is used.', 'Implement the handler or remove/disable the control.', n);
    else if (/\b(?:on[A-Z]\w*|on:\w+|@\w+|onclick|onsubmit)\s*=\s*\{?\s*["']?\s*(?:\(\s*[\w,\s]*\)|\w+)\s*=>\s*\{?\s*console\.(?:log|info|debug)\(/.test(l)) P('log-handler', 'medium', 'Event handler only logs to the console', 'The user action is accepted but only printed for the developer.', 'Implement the real behaviour (API call, state change) for this handler.', n);
    if (/\balert\(\s*['"`][^'"`]*\b(?:todo|coming soon|not implemented|not yet|placeholder|wip|under construction)\b/i.test(l)) P('alert-todo', 'medium', 'Feature replaced by an alert', 'The feature shows a "coming soon/TODO" alert instead of working.', 'Implement the feature or hide the entry point until it exists.', n);
    if (/throw\s+new\s+\\?[\w\\]*(?:Error|Exception)\(\s*['"`]\s*(?:not\s+(?:yet\s+)?implemented|todo|unimplemented|stub)/i.test(l) || /\bpanic\(\s*"(?:not implemented|todo|unimplemented)/i.test(l) || /\b(?:todo|unimplemented)!\(/.test(l)) P('not-implemented', 'high', 'Code path throws "not implemented"', 'Calling this path fails at runtime.', 'Implement it, or make sure nothing reachable calls it.', n);
    else if (/^\s*raise\s+NotImplementedError\b/.test(l) && !/abstract|base|interface/i.test(lines.slice(Math.max(0, i - 8), i).join('\n'))) P('not-implemented', 'low', 'raise NotImplementedError', 'Fine in an abstract base class; a bug anywhere else.', 'Implement it, or mark the class abstract (abc.ABC / @abstractmethod).', n);
    if (/\b(?:fetch|axios(?:\.\w+)?|\$http\.\w+|ky(?:\.\w+)?)\(\s*['"`](?:\/api\/(?:todo|placeholder|mock|fake|dummy|test)\b|https?:\/\/(?:[\w-]+\.)?example\.(?:com|org|net)|https?:\/\/(?:jsonplaceholder\.typicode\.com|reqres\.in|dummyjson\.com|httpbin\.org))/i.test(l)) P('fake-api', 'medium', 'Request to a placeholder API', 'The call goes to a demo/placeholder endpoint, not the real backend.', 'Point it at the real endpoint (from config) or remove it.', n);
    if (/lorem ipsum/i.test(l)) P('lorem', 'low', 'Lorem ipsum text', 'Placeholder copy ends up in front of users.', 'Replace it with real content.', n);
    if (MARKUP.test(p) && /<(?:a|button)\b[^>]*\bhref\s*=\s*["']#["']/i.test(l)) P('dead-link', 'low', 'Link or button points to "#"', 'Clicking it goes nowhere (or jumps to the top of the page).', 'Give it a real destination, or use a <button> with a handler.', n);
    if (/(?:password|pass|pwd)\s*={2,3}\s*['"][^'"]{1,40}['"]|['"][^'"]{1,40}['"]\s*={2,3}\s*(?:password|pass|pwd)\b/i.test(l)) P('mock-auth', 'high', 'Password compared to a hard-coded string', 'Anyone who reads the code (or guesses) can log in.', 'Check credentials against hashed values from a user store.', n);
    if (AUTH_FN.test(l)) {
      const body = /\{\s*return\s+true\s*;?\s*\}/.test(l) ? true : (() => {
        let k = i + 1;
        while (k < lines.length && k < i + 4 && !lines[k].trim()) k++;
        const nx = lines[k] || '';
        const after = lines[k + 1] || '';
        return RETURN_TRUE.test(nx) && (/^\s*[}]|^\s*$|^\S/.test(after) || /^\s*(?:def|func|function|public|private|protected)\b/.test(after));
      })();
      if (body) P('mock-auth', 'high', 'Auth check always returns true', 'Every request passes the check, so the protection is not real.', 'Implement the check (session/token/permission lookup).', n);
    }
    if (/\b(?:const|let|var|export\s+const)\s+(?:mock|fake|dummy|demo|sample|hardcoded)[A-Z_]\w*\s*(?::\s*[\w<>[\]]+\s*)?=\s*[[{]/.test(l) || /^\s*(?:MOCK|FAKE|DUMMY|DEMO|SAMPLE)_[A-Z_]+\s*=\s*[[{]/.test(l)) P('demo-data', 'low', 'Hard-coded demo data in app code', 'The UI may show fixed sample data instead of real data.', 'Load the data from the real source; keep samples in tests/fixtures.', n);
    if (/\b(?:TODO|FIXME)\b[:\s-]*(?:implement|hook up|wire up|connect to|replace with real|stub|fake|mock)\b/i.test(l)) P('todo-implement', 'low', 'TODO: not implemented yet', 'A comment says this part is still a stub.', 'Implement it or track it as a task.', n);
  }
  return { readiness: readiness.slice(0, 60), placeholders: placeholders.slice(0, 60), env };
}
