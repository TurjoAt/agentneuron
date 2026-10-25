// Claim extraction from context markdown. Precision over recall: commands only from inline code and shell
// fences, prose only for runtime/framework names; example sections, placeholders and URLs are skipped.

export const SHELL_LANGS = new Set(['', 'sh', 'bash', 'shell', 'console', 'zsh', 'shell-session', 'shellsession', 'terminal', 'cmd', 'powershell', 'ps', 'pwsh', 'fish']);
const EXAMPLE_RE = /\b(examples?|samples?|templates?|placeholders?|hypothetical|illustrat\w*)\b/i;
const EXAMPLE_LINE_RE = /\be\.g\.|\b(for example|for instance|example|sample|hypothetical|placeholder)\b|\beg[,:]/i;
const PLACEHOLDER_RE = /[<>{}[\]]|\$\w|\$\{|\.\.\.|…|\b(foo|bar|baz|qux|my-?script|my-?target|your[-_]\w*|some[-_]\w*|xxx+|name|script|target|task|command|cmd)\b/i;
const NEGATION_RE = /\b(not|no|don'?t|do not|never|instead of|rather than|unlike|migrat\w*|replac\w*|remov\w*|deprecat\w*|legacy|formerly|previously|used to|avoid|without|drop\w*|switch\w* from|moved? (away )?from)\b/i;
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s)>\]`'"]+/gi;
const PM = new Set(['npm', 'pnpm', 'yarn', 'bun']);

const RUNTIMES = { Node: 'node', 'Node.js': 'node', NodeJS: 'node', PHP: 'php', Python: 'python' };
// display name -> dependency names (first match wins)
export const FRAMEWORKS = {
  React: ['react'], 'Next.js': ['next'], Vue: ['vue'], 'Vue.js': ['vue'], Svelte: ['svelte'], SvelteKit: ['@sveltejs/kit'], Angular: ['@angular/core'],
  Nuxt: ['nuxt'], Astro: ['astro'], Vite: ['vite'], TypeScript: ['typescript'], 'Tailwind CSS': ['tailwindcss'], Tailwind: ['tailwindcss'], Express: ['express'],
  NestJS: ['@nestjs/core'], Electron: ['electron'], Storybook: ['storybook', '@storybook/react'], Prisma: ['prisma', '@prisma/client'], ESLint: ['eslint'],
  Jest: ['jest'], Vitest: ['vitest'], Playwright: ['@playwright/test', 'playwright'], Cypress: ['cypress'],
  Laravel: ['laravel/framework'], Symfony: ['symfony/framework-bundle', 'symfony/symfony'], Livewire: ['livewire/livewire'], Filament: ['filament/filament'],
  PHPUnit: ['phpunit/phpunit'], Pest: ['pestphp/pest'], Django: ['django'], Flask: ['flask'], FastAPI: ['fastapi'],
};
// same-purpose tools: mentioning one while the project only has another is a likely stale instruction
export const COMPETITORS = [
  { group: 'test runner', eco: 'npm', names: { Jest: 'jest', Vitest: 'vitest', Mocha: 'mocha' } },
  { group: 'e2e framework', eco: 'npm', names: { Playwright: '@playwright/test', Cypress: 'cypress' } },
  { group: 'ORM', eco: 'npm', names: { Prisma: 'prisma', Drizzle: 'drizzle-orm', TypeORM: 'typeorm', Sequelize: 'sequelize' } },
  { group: 'linter', eco: 'npm', names: { ESLint: 'eslint', Biome: '@biomejs/biome' } },
];
const ENV_WHITELIST = new Set(['NODE_ENV', 'NODE_OPTIONS', 'CI', 'PATH', 'HOME', 'USER', 'SHELL', 'PWD', 'TERM', 'LANG', 'TZ', 'EDITOR', 'GITHUB_TOKEN', 'GITHUB_STEP_SUMMARY',
  'GITHUB_OUTPUT', 'GITHUB_ENV', 'GITHUB_WORKSPACE', 'GITHUB_SHA', 'GITHUB_REF', 'RUNNER_OS', 'XDG_CONFIG_HOME', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'TMPDIR', 'DEBUG', 'NO_COLOR', 'FORCE_COLOR',
  'CLAUDE_FILE_PATHS', 'CLAUDE_PROJECT_DIR', 'ANTHROPIC_MODEL', 'APP_ENV', 'APP_DEBUG', 'VIRTUAL_ENV', 'PYTHONPATH', 'GOPATH', 'GOOS', 'GOARCH', 'CARGO_HOME', 'RUST_LOG', 'RUST_BACKTRACE']);
const ENV_CONTEXT_RE = /\benv\b|\benvironment\b|\bvariables?\b|\.env\b|\bsecrets?\b|\btokens?\b|\bapi[ -]?keys?\b|\bcredentials?\b|\bset\b|\bexport\b/i;

const PATH_EXTS = 'md|mdc|js|mjs|cjs|ts|tsx|jsx|json|yml|yaml|toml|py|php|rb|go|rs|java|sh|css|scss|html|vue|svelte|sql|txt|lock|xml|conf|ini|kt|cs|swift|astro|blade\\.php';
const PATH_RE = /^(?:\.{1,2}\/)*[A-Za-z0-9_@.\-()]+(?:\/[A-Za-z0-9_@.\-()]+)*\/?$/;
const EXT_RE = new RegExp(`\\.(?:${PATH_EXTS})$`, 'i');
const GENERATED_DIRS = /(^|\/)(node_modules|vendor|dist|build|\.next|storage|\.git|\.agentneuron|coverage|tmp|temp|cache|\.cache|logs?|out|target)(\/|$)/;

const TOOL_DIRS = /^(?:\.\/)?\.(?:claude|cursor|codex|gemini|windsurf|github|vscode|roo|continue|zed|junie|amazonq|clinerules|agentneuron|mdctl|circleci|gitlab|idea|devcontainer|husky|aider[\w.-]*)(?:\/|$)/i;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Split a shell line into segments on && || ; | (outside quotes), keeping each segment's exact text. */
export function segments(cmd) {
  const out = []; let q = null; let start = 0;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    const two = cmd.slice(i, i + 2);
    if (two === '&&' || two === '||') { out.push(cmd.slice(start, i)); start = i + 2; i++; continue; }
    if (ch === ';' || ch === '|' || ch === '&') { out.push(cmd.slice(start, i)); start = i + 1; }
  }
  out.push(cmd.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

const tokens = (s) => (s.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((t) => t.replace(/^(["'])(.*)\1$/, '$2'));

/** Parse one command segment into a command claim or null. `cwd` from a preceding `cd`. */
export function parseCommand(seg, cwd = '') {
  let t = tokens(seg);
  while (t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0])) t.shift(); // FOO=bar cmd
  if (t[0] === 'sudo' || t[0] === 'time' || t[0] === 'exec') t.shift();
  if (!t.length) return null;
  let tool = t[0];
  let rest = t.slice(1);
  if (tool === 'php' && rest[0] === 'artisan') { tool = 'artisan'; rest = rest.slice(1); } else if ((tool === 'python' || tool === 'python3') && rest[0] === '-m' && rest[1] === 'pytest') { tool = 'pytest'; rest = rest.slice(2); } else if (tool === 'py.test') tool = 'pytest';
  if (!PM.has(tool) && !['make', 'composer', 'artisan', 'pytest', 'cargo', 'go', 'poetry', 'uv'].includes(tool)) return null;
  // flags and their scope
  const flags = []; const args = [];
  let dir = cwd; let scoped = false; let global = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--') { args.push(...rest.slice(i + 1)); break; }
    if (a.startsWith('-')) {
      flags.push(a);
      const name = a.split('=')[0];
      if (['-g', '--global', '--location=global'].includes(a)) global = true;
      if (['--filter', '-F', '-w', '--workspace', '--workspaces', '-ws', '-r', '--recursive', '--prefix', '--cwd', '--dir'].includes(name) || (tool !== 'make' && name === '-C')) {
        scoped = true;
        if (!a.includes('=') && ['--filter', '-F', '-w', '--workspace', '--prefix', '--cwd', '--dir', '-C'].includes(name)) i++;
      }
      if (tool === 'make' && (name === '-C' || name === '--directory')) { const v = a.includes('=') ? a.split('=')[1] : rest[++i]; dir = joinDir(dir, v || ''); }
      if (tool === 'make' && ['-f', '--file', '--makefile'].includes(name)) { scoped = true; if (!a.includes('=')) i++; }
      continue;
    }
    args.push(a);
  }
  if (tool === 'yarn' && args[0] === 'workspace') { scoped = true; args.splice(0, 2); }
  return { tool, args, flags, dir, scoped, global, text: seg };
}

function joinDir(base, d) {
  const parts = (base ? base.split('/') : []);
  for (const s of String(d).replace(/\\/g, '/').split('/')) {
    if (!s || s === '.') continue;
    if (s === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(s);
  }
  return parts.join('/');
}

/** Commands in a shell snippet (inline code or one fence line). */
export function commandsIn(code) {
  const out = [];
  let cwd = '';
  const line = code.replace(/^\s*(?:\$|>|PS>)\s+/, '');
  for (const seg of segments(line)) {
    const cd = /^cd\s+(\S+)$/.exec(seg);
    if (cd) { const d = joinDir('', cd[1].replace(/^["']|["']$/g, '')); cwd = d == null || /^[~/$]|^[A-Za-z]:/.test(cd[1]) ? null : d; continue; }
    if (cwd === null) break; // cd outside the project: nothing to check
    const c = parseCommand(seg, cwd);
    if (c) out.push(c);
  }
  return out;
}

function stripComments(line, state) {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (state.comment) {
      const e = line.indexOf('-->', i);
      if (e < 0) return out;
      state.comment = false; i = e + 3; continue;
    }
    const s = line.indexOf('<!--', i);
    if (s < 0) { out += line.slice(i); break; }
    out += line.slice(i, s);
    state.comment = true; i = s + 4;
  }
  return out;
}

function looksLikePath(cand) {
  if (/\s/.test(cand) || /[*?<>{}$|;:=,!]/.test(cand) || /^(?:[a-z]+:)?\/\//i.test(cand)) return false;
  if (/^[~/]/.test(cand) || cand.startsWith('#') || cand.startsWith('@')) return false;
  if (TOOL_DIRS.test(cand)) return false; // conventional agent-config locations are named, not claimed
  if (cand.endsWith('/') && cand.split('/').filter(Boolean).length < 2) return false; // "history/", "notes/": too generic
  if (cand.split('/').some((s) => s && !/[A-Za-z0-9]/.test(s.replace(/^\.+/, '')))) return false;
  if (cand.split('/').filter(Boolean).every((s) => /^\.\w{1,4}$/.test(s))) return false; // ".md/.mdc"
  if (!cand.includes('/') || !PATH_RE.test(cand) || !(EXT_RE.test(cand) || cand.endsWith('/'))) return false;
  if (GENERATED_DIRS.test(cand.replace(/\/$/, '')) || /^\d+(\.\d+)+/.test(cand)) return false;
  return !cand.replace(/^(\.\.?\/)+/, '').startsWith('..');
}

/**
 * Extract raw claims from one markdown file.
 * @returns {{line:number, kind:string, text:string, lineText:string, [k:string]:any}[]}
 */
export function extractClaims(text) {
  const out = [];
  const lines = String(text || '').split(/\r?\n/);
  let fence = null; // { ch, len, shell, skip }
  let heading = '';
  let prevText = '';
  let ignoreNext = false; let ignoreBlock = false;
  const cstate = { comment: false };
  let start = 0;
  if (lines[0] === '---') { const e = lines.indexOf('---', 1); if (e > 0) start = e + 1; } // frontmatter
  for (let i = start; i < lines.length; i++) {
    const raw = lines[i];
    const ln = i + 1;
    if (/agentneuron-ignore-start/.test(raw)) { ignoreBlock = true; continue; }
    if (/agentneuron-ignore-end/.test(raw)) { ignoreBlock = false; continue; }
    const fm = /^\s{0,3}(`{3,}|~{3,})\s*([^`]*)$/.exec(raw);
    if (fm && (!fence || (fm[1][0] === fence.ch && fm[1].length >= fence.len && !fm[2].trim()))) {
      if (fence) { fence = null; prevText = ''; continue; }
      const info = fm[2].trim().toLowerCase();
      const lang = info.split(/[\s{,]/)[0].replace(/^\./, '');
      fence = { ch: fm[1][0], len: fm[1].length, shell: SHELL_LANGS.has(lang), skip: EXAMPLE_RE.test(info) || EXAMPLE_RE.test(prevText) || EXAMPLE_RE.test(heading) || ignoreBlock || ignoreNext };
      ignoreNext = false;
      continue;
    }
    const wasComment = cstate.comment;
    const t = stripComments(raw, cstate);
    const ignoreHere = ignoreBlock || ignoreNext || (/agentneuron-ignore/.test(raw) && t.trim() !== '');
    if (/agentneuron-ignore(?!-)/.test(raw) && !t.trim()) { ignoreNext = true; continue; }
    if (t.trim()) ignoreNext = false;
    if (fence) {
      if (fence.skip || !fence.shell || ignoreHere) continue;
      const code = t.trim();
      if (!code || code.startsWith('#')) continue;
      const body = code.replace(/^(?:\$|>|PS>)\s+/, '');
      if (PLACEHOLDER_RE.test(body) || EXAMPLE_LINE_RE.test(body)) continue;
      for (const c of commandsIn(body)) out.push({ line: ln, kind: 'command', text: c.text, lineText: raw, cmd: c, fenced: true });
      continue;
    }
    if (wasComment && !t.trim()) continue;
    const h = /^\s{0,3}#{1,6}\s+(.*)$/.exec(t);
    if (h) { heading = h[1]; prevText = h[1]; continue; }
    if (t.trim()) prevText = t;
    if (ignoreHere || EXAMPLE_RE.test(heading)) continue;
    const exampleLine = EXAMPLE_LINE_RE.test(t);
    // ports first (localhost URLs are port claims), then drop URLs
    for (const m of t.matchAll(/\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})\b/g)) out.push({ line: ln, kind: 'port', text: m[0], lineText: raw, port: Number(m[1]) });
    const noUrl = t.replace(URL_RE, (u) => ' '.repeat(u.length));
    for (const m of noUrl.matchAll(/\bports?\s+(?:is\s+|of\s+|=\s*|:\s*)?`?(\d{2,5})\b/gi)) out.push({ line: ln, kind: 'port', text: m[0].replace(/`/g, ''), lineText: raw, port: Number(m[1]) });
    // inline code spans
    const spans = [];
    for (const m of noUrl.matchAll(/(`+)([^`]+?)\1/g)) spans.push(m[2].trim());
    const prose = noUrl.replace(/(`+)([^`]+?)\1/g, (s) => ' '.repeat(s.length));
    for (const code of spans) {
      if (!exampleLine && !PLACEHOLDER_RE.test(code)) for (const c of commandsIn(code)) if (c.args.length || c.flags.length || c.tool === 'pytest') out.push({ line: ln, kind: 'command', text: c.text, lineText: raw, cmd: c });
      if (looksLikePath(code)) out.push({ line: ln, kind: 'path', text: code, lineText: raw, path: code.replace(/\/$/, ''), dir: code.endsWith('/') });
      const env = /^(?:process\.env\.|import\.meta\.env\.|\$\{?|env\(['"]|getenv\(['"]|os\.environ\[['"])?([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)(?:['"]\)?\]?|\})?$/.exec(code);
      if (env && !ENV_WHITELIST.has(env[1]) && !/^(AGENTNEURON|MDCTL|CLAUDE|CODEX|GEMINI|CURSOR)_/.test(env[1]) && !exampleLine && (env[0] !== env[1] || ENV_CONTEXT_RE.test(prose))) {
        out.push({ line: ln, kind: 'env', text: code, lineText: raw, name: env[1] });
      }
    }
    if (exampleLine) continue;
    const scr = /`([\w:.-]+)`\s+(?:npm\s+|composer\s+|package\.json\s+)?script\b|\bscript\s+`([\w:.-]+)`/gi;
    for (const m of noUrl.matchAll(scr)) {
      const name = m[1] || m[2];
      if (!PLACEHOLDER_RE.test(name)) out.push({ line: ln, kind: 'script', text: name, lineText: raw, name });
    }
    if (NEGATION_RE.test(noUrl)) continue;
    // runtime versions: "Node 20", "Node.js >= 18", "PHP 8.2+", "Python 3.12"
    const rt = /\b(Node\.js|NodeJS|Node|PHP|Python)\s*(?:v(?:ersion)?\s*)?(>=|≥|\^|~)?\s*v?(\d{1,2})(?:\.(\d{1,2}))?(?:\.x|\.\d+)?(\+|\s+or\s+(?:newer|later|higher|above))?(?![\w%]|\.\d)/g;
    for (const m of noUrl.matchAll(rt)) {
      out.push({ line: ln, kind: 'version', text: m[0].trim(), lineText: raw, runtime: RUNTIMES[m[1]], name: m[1], major: Number(m[3]), minor: m[4] != null ? Number(m[4]) : null, atLeast: !!(m[2] && m[2] !== '~' || m[5]) });
    }
    const names = Object.keys(FRAMEWORKS).sort((a, b) => b.length - a.length).map(esc).join('|');
    const fw = new RegExp(`(?<![\\w.@/-])(${names})\\s+v?(\\d{1,2})(?:\\.(\\d{1,2}))?(?:\\.x|\\.\\d+)?(\\+)?(?![\\w%]|\\.\\d)`, 'g');
    for (const m of noUrl.matchAll(fw)) out.push({ line: ln, kind: 'version', text: m[0].trim(), lineText: raw, framework: m[1], deps: FRAMEWORKS[m[1]], name: m[1], major: Number(m[2]), minor: m[3] != null ? Number(m[3]) : null, atLeast: !!m[4] });
    for (const g of COMPETITORS) {
      for (const [nm, dep] of Object.entries(g.names)) {
        const re = new RegExp(`(?<![\\w.@/-])(${esc(nm)}|\`${esc(dep)}\`)(?![\\w-])`);
        const m = re.exec(prose) || new RegExp(`(?<![\\w.@/-])\`${esc(dep)}\`(?![\\w-])`).exec(noUrl);
        if (m) out.push({ line: ln, kind: 'dependency', text: nm, lineText: raw, name: nm, dep, group: g });
      }
    }
  }
  return out;
}
