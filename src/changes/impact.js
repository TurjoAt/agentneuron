// #3 Change impact analyzer: changed symbols -> importers, callers, routes, tests, API contracts.
// Static and bounded: a light regex parser (JS/TS, PHP, Python, Go), an import graph over at most MAX_FILES
// source files (cached by mtime + size), capped graph output. No model, no processes beyond read-only git.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { cleanRelPath } from '../git2/run.js';
import { readRegularAsync } from '../files/safeio.js';
import { laravelRoutes } from '../project/index.js';
import { collectDiff, hunkLines } from './diff.js';
import { repoFiles } from './review.js';
import { GRAPH_EXT, isTest, isGenerated, testStem, sourceStem } from './classify.js';

const MAX_FILES = 5000;
const MAX_BYTES = 256 * 1024;
const MAX_NODES = 150;
const MAX_EDGES = 400;
const MAX_AFFECTED = 400;
const MAX_CHANGED = 60;
const MAX_SYMBOLS = 40;
const COMMON = new Set(['get', 'set', 'run', 'main', 'init', 'index', 'default', 'handler', 'handle', 'render', 'update', 'create', 'delete', 'remove', 'load', 'save', 'test', 'setup', 'start', 'stop',
  'config', 'options', 'value', 'data', 'result', 'error', 'name', 'type', 'list', 'item', 'items', 'props', 'state', 'store', 'app', 'router', 'request', 'response', 'constructor', 'toString', 'call', 'apply',
  'then', 'catch', 'module', 'exports', 'require', 'self', 'this', 'super', 'new', 'class', 'function', 'return', 'export', 'import', 'string', 'number', 'boolean', 'object', 'array', 'map', 'filter', 'find']);
const langOf = (p) => {
  const e = path.posix.extname(p).toLowerCase();
  if (e === '.php') return 'php';
  if (e === '.py') return 'py';
  if (e === '.go') return 'go';
  return 'js';
};

// ---- parsing ----------------------------------------------------------------------

const SYM = {
  js: [
    [/^\s*export\s+(default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/, 'function', true],
    [/^\s*export\s+(default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, 'class', true],
    [/^\s*export\s+(?:declare\s+)?()(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, 'const', true],
    [/^\s*export\s+(?:declare\s+)?()(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/, 'type', true],
    [/^()(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/, 'function', false],
    [/^()(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, 'class', false],
    [/^()(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, 'function', false],
    [/^\s{2,4}()(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/, 'method', false],
  ],
  php: [
    [/^\s*()(?:final\s+|abstract\s+|readonly\s+)*(class|interface|trait|enum)\s+(\w+)/, 'class', true, 3],
    [/^\s*()(?:(?:public|protected|private|static|final|abstract)\s+)+function\s+&?(\w+)/, 'method', true],
    [/^()function\s+&?(\w+)/, 'function', true],
  ],
  py: [
    [/^()(?:async\s+)?def\s+(\w+)/, 'function', true],
    [/^()class\s+(\w+)/, 'class', true],
    [/^\s{4}()(?:async\s+)?def\s+(\w+)/, 'method', true],
  ],
  go: [
    [/^func\s+\(([^)]*)\)\s*(\w+)/, 'method', true],
    [/^func\s+()(\w+)/, 'function', true],
    [/^type\s+()(\w+)/, 'type', true],
  ],
};
const isExportedName = (lang, name, exp) => (lang === 'go' ? /^[A-Z]/.test(name) : lang === 'py' ? !name.startsWith('_') : exp);

export function parseSymbols(lang, text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length && out.length < 400; i++) {
    const l = lines[i];
    if (l.length > 400) continue;
    for (const [re, kind, exp, g = 2] of SYM[lang] || SYM.js) {
      const m = re.exec(l);
      if (!m || !m[g] || (lang === 'js' && kind === 'method' && COMMON.has(m[g]))) continue;
      const k = kind === 'class' && lang === 'php' && m[2] === 'interface' ? 'type' : kind;
      out.push({ name: m[g], kind: k, line: i + 1, exported: isExportedName(lang, m[g], exp) });
      break;
    }
  }
  // `export { a, b as c }`
  if (lang === 'js') for (const m of text.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) for (const part of m[1].split(',')) {
    const nm = part.trim().split(/\s+as\s+/)[0]?.trim();
    const s = out.find((x) => x.name === nm);
    if (s) s.exported = true;
  }
  return out;
}

const IMPORT = {
  js: /(?:^|[^\w$.])(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"\n]+)['"]|(?:^|[^\w$.])import\s*\(\s*['"]([^'"\n]+)['"]\s*\)|(?:^|[^\w$.])require\s*\(\s*['"]([^'"\n]+)['"]\s*\)|^\s*import\s+['"]([^'"\n]+)['"]/gm,
  php: /^\s*use\s+(?:function\s+|const\s+)?\\?([A-Za-z_][\w\\]*)(?:\s+as\s+\w+)?\s*;|(?:require|include)(?:_once)?\s*\(?\s*(?:__DIR__\s*\.\s*)?['"]([^'"]+\.php)['"]/gm,
  py: /^\s*from\s+(\.*[\w.]*)\s+import\s+([\w*, ()]+)|^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm,
  go: /^\s*(?:import\s+)?(?:\w+\s+)?"([\w./-]+)"\s*$/gm,
};

function parseImports(lang, text) {
  const out = [];
  const re = IMPORT[lang];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) && out.length < 300) {
    if (lang === 'js') out.push(m[1] || m[2] || m[3] || m[4]);
    else if (lang === 'php') out.push(m[1] ? { cls: m[1] } : { file: m[2] });
    else if (lang === 'py') {
      if (m[1] != null) { out.push({ mod: m[1], names: m[2].replace(/[()]/g, '').split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean) }); }
      else for (const x of m[3].split(',')) out.push({ mod: x.trim().split(/\s+as\s+/)[0], names: [] });
    } else out.push(m[1]);
  }
  return out;
}

const ROUTE_RE = {
  js: /\b(?:app|router|server|fastify|api|routes?|r)\.(get|post|put|patch|delete|all|head|options)\(\s*['"`](\/[^'"`]*)['"`]/g,
  py: /@(?:\w+)\.(route|get|post|put|patch|delete|api_route)\(\s*['"](\/[^'"]*)['"]/g,
  go: /\.(HandleFunc|Handle|GET|POST|PUT|PATCH|DELETE|Get|Post|Put|Patch|Delete)\(\s*"(\/[^"]*)"/g,
  php: /Route::(get|post|put|patch|delete|any|match)\(\s*['"]([^'"]+)['"]/g,
};
function parseRoutes(lang, text) {
  const out = [];
  const re = ROUTE_RE[lang];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) && out.length < 200) {
    const line = text.slice(0, m.index).split('\n').length;
    const method = /^(route|all|any|match|HandleFunc|Handle|api_route)$/i.test(m[1]) ? 'ANY' : m[1].toUpperCase();
    out.push({ method, uri: m[2], line });
  }
  return out;
}
/** File-system routes (Next.js, SvelteKit, Nuxt server) */
function fileRoute(p) {
  let m = /^(?:src\/)?app\/(.*?)\/?route\.[cm]?[jt]sx?$/.exec(p);
  if (m) return { method: 'ANY', uri: '/' + m[1].replace(/\([^)]*\)\/?/g, '').replace(/\[([^\]]+)\]/g, ':$1') };
  m = /^(?:src\/)?pages\/(api\/.*?)(?:\/index)?\.[cm]?[jt]sx?$/.exec(p);
  if (m) return { method: 'ANY', uri: '/' + m[1].replace(/\[([^\]]+)\]/g, ':$1') };
  m = /^src\/routes\/(.*?)\/?\+server\.[jt]s$/.exec(p);
  if (m) return { method: 'ANY', uri: '/' + m[1].replace(/\([^)]*\)\/?/g, '').replace(/\[([^\]]+)\]/g, ':$1') };
  m = /^server\/(api\/.*?)(?:\/index)?(?:\.(get|post|put|patch|delete))?\.[jt]s$/.exec(p);
  if (m) return { method: (m[2] || 'any').toUpperCase(), uri: '/' + m[1].replace(/\[([^\]]+)\]/g, ':$1') };
  return null;
}

// ---- index (cached per root, entries keyed by mtime + size) ------------------------

const caches = new Map();
async function loadIndex(root) {
  let cache = caches.get(root);
  if (!cache) { cache = new Map(); caches.set(root, cache); if (caches.size > 8) caches.delete(caches.keys().next().value); }
  const all = await repoFiles(root);
  const list = all.filter((p) => GRAPH_EXT.has(path.posix.extname(p).toLowerCase()) && !isGenerated(p) && !/(^|\/)(node_modules|vendor|\.git)\//.test(p) && !p.endsWith('.d.ts'));
  const truncated = list.length > MAX_FILES;
  const files = truncated ? list.slice(0, MAX_FILES) : list;
  const seen = new Set(files);
  for (const k of cache.keys()) if (!seen.has(k)) cache.delete(k);
  for (let i = 0; i < files.length; i += 48) {
    await Promise.all(files.slice(i, i + 48).map(async (p) => {
      let st; try { st = await fsp.stat(path.join(root, p)); } catch { cache.delete(p); return; }
      const c = cache.get(p);
      if (c && c.mtime === st.mtimeMs && c.size === st.size) return;
      if (st.size > MAX_BYTES) { cache.set(p, { mtime: st.mtimeMs, size: st.size, lang: langOf(p), imports: [], symbols: [], routes: [], words: new Set(), big: true }); return; }
      const r = await readRegularAsync(path.join(root, p), { maxBytes: MAX_BYTES });
      if (!r) return;
      const text = r.buf.toString('utf8');
      const lang = langOf(p);
      const words = new Set();
      for (const m of text.matchAll(/[A-Za-z_$][\w$]{2,}/g)) { words.add(m[0]); if (words.size > 20000) break; }
      cache.set(p, { mtime: st.mtimeMs, size: st.size, lang, imports: parseImports(lang, text), symbols: parseSymbols(lang, text), routes: parseRoutes(lang, text), words });
    }));
  }
  return { cache, files, all, truncated };
}

function makeResolver(root, files, all) {
  const set = new Set(files);
  const allSet = new Set(all);
  const JS_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.mjs'];
  const phpByBase = new Map();
  const goDirs = new Map();
  for (const p of files) {
    if (p.endsWith('.php')) { const b = path.posix.basename(p, '.php').toLowerCase(); (phpByBase.get(b) || phpByBase.set(b, []).get(b)).push(p); }
    if (p.endsWith('.go') && !p.endsWith('_test.go')) { const d = path.posix.dirname(p); (goDirs.get(d) || goDirs.set(d, []).get(d)).push(p); }
  }
  let goModule = null;
  const ready = (async () => {
    if (!allSet.has('go.mod')) return;
    const r = await readRegularAsync(path.join(root, 'go.mod'), { maxBytes: 64 * 1024 });
    goModule = r ? /^module\s+(\S+)/m.exec(r.buf.toString('utf8'))?.[1] || null : null;
  })();
  const tryJs = (base) => {
    for (const e of JS_EXT) if (set.has(base + e)) return base + e;
    const m = /\.(m|c)?js$/.exec(base);
    if (m) for (const e of ['.ts', '.tsx', '.mts', '.cts']) { const t = base.replace(/\.(m|c)?js$/, e); if (set.has(t)) return t; }
    return null;
  };
  function resolve(from, lang, spec) {
    if (lang === 'js') {
      if (typeof spec !== 'string') return [];
      let base;
      if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
      else if (/^[@~]\//.test(spec)) base = 'src/' + spec.slice(2);
      else if (spec.startsWith('$lib/')) base = 'src/lib/' + spec.slice(5);
      else if (spec.startsWith('/')) base = spec.slice(1);
      else return [];
      const r = tryJs(base) || (/^[@~]\//.test(spec) ? tryJs(spec.slice(2)) : null);
      return r ? [r] : [];
    }
    if (lang === 'php') {
      if (spec.file) { const p = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec.file)); return set.has(p) ? [p] : []; }
      const segs = spec.cls.split('\\').filter(Boolean);
      const cands = phpByBase.get((segs[segs.length - 1] || '').toLowerCase()) || [];
      if (cands.length <= 1) return cands;
      const tail = segs.slice(1).join('/').toLowerCase() + '.php';
      const best = cands.filter((c) => c.toLowerCase().endsWith(tail));
      return (best.length ? best : cands).slice(0, 2);
    }
    if (lang === 'py') {
      const out = [];
      let mod = spec.mod;
      let dir = '';
      if (mod.startsWith('.')) {
        const dots = /^\.+/.exec(mod)[0].length;
        dir = path.posix.dirname(from);
        for (let i = 1; i < dots; i++) dir = path.posix.dirname(dir);
        mod = mod.slice(dots);
        if (dir === '.') dir = '';
      }
      const rel = mod.replace(/\./g, '/');
      const bases = dir ? [path.posix.join(dir, rel)] : [rel, 'src/' + rel];
      for (const b of bases) {
        for (const c of [`${b}.py`, `${b}/__init__.py`]) if (set.has(c.replace(/^\//, ''))) out.push(c.replace(/^\//, ''));
        for (const n of spec.names || []) { const c = `${b ? b + '/' : ''}${n}.py`.replace(/^\//, ''); if (set.has(c)) out.push(c); }
      }
      return [...new Set(out)];
    }
    if (lang === 'go') {
      if (!goModule || typeof spec !== 'string' || !spec.startsWith(goModule)) return [];
      const d = spec.slice(goModule.length).replace(/^\//, '') || '.';
      return (goDirs.get(d) || []).slice(0, 50);
    }
    return [];
  }
  return { resolve, ready, set };
}

// ---- analysis --------------------------------------------------------------------

/**
 * -> { changed: [{ path, symbols: [{ name, kind, line, removed? }] }], nodes, edges, affected, truncated, stats }
 * opts: { base, paths: string[] | comma string }
 */
export async function analyzeImpact(root, { base, paths } = {}) {
  let changedFiles = [];
  let diffTruncated = false;
  const explicit = typeof paths === 'string' ? paths.split(',').map((s) => s.trim()).filter(Boolean) : Array.isArray(paths) ? paths : [];
  if (explicit.length) {
    for (const raw of explicit.slice(0, MAX_CHANGED)) {
      const c = cleanRelPath(root, raw);
      if (!c) throw Object.assign(new Error(`invalid path: ${String(raw).slice(0, 80)}`), { status: 400 });
      changedFiles.push({ path: c.replace(/^\.\//, ''), status: 'M', hunks: null });
    }
  } else {
    const d = await collectDiff(root, { base });
    if (!d.available) return { available: false, reason: d.reason, changed: [], nodes: [], edges: [], affected: [], truncated: false };
    changedFiles = d.files.slice(0, MAX_CHANGED);
    diffTruncated = d.truncated || d.files.length > MAX_CHANGED;
  }
  const { cache, files, all, truncated: indexTruncated } = await loadIndex(root);
  const R = makeResolver(root, files, all);
  await R.ready;

  // reverse import map
  const importedBy = new Map();
  const importsOf = new Map();
  for (const p of files) {
    const e = cache.get(p);
    if (!e) continue;
    const targets = new Set();
    for (const s of e.imports) for (const t of R.resolve(p, e.lang, s)) if (t !== p) targets.add(t);
    importsOf.set(p, targets);
    for (const t of targets) (importedBy.get(t) || importedBy.set(t, new Set()).get(t)).add(p);
  }

  // changed symbols
  const changed = [];
  for (const f of changedFiles) {
    const e = cache.get(f.path);
    const syms = [];
    const lang = langOf(f.path);
    if (f.hunks && e) {
      const defs = e.symbols.slice().sort((a, b) => a.line - b.line);
      const lines = new Set();
      for (const h of f.hunks) for (const l of hunkLines(h)) {
        if (l.type === 'add') lines.add(l.newLine);
        else if (l.type === 'del') {
          lines.add(Math.max(1, (l.newLine ?? h.newStart)));
          const m = parseSymbols(lang, l.text)[0];
          if (m && !defs.some((d) => d.name === m.name)) syms.push({ ...m, line: l.oldLine, removed: true });
        }
      }
      for (const ln of lines) {
        let enc = null;
        for (const d of defs) { if (d.line <= ln) enc = d; else break; }
        if (enc && !syms.some((s) => s.name === enc.name && !s.removed)) syms.push({ name: enc.name, kind: enc.kind, line: enc.line, exported: enc.exported });
      }
    } else if (e) {
      for (const d of e.symbols) if (d.exported || f.status === 'A') syms.push({ name: d.name, kind: d.kind, line: d.line, exported: d.exported });
    } else if (f.status === 'D' && f.hunks) {
      for (const h of f.hunks) for (const l of hunkLines(h)) if (l.type === 'del') { const m = parseSymbols(lang, l.text)[0]; if (m) syms.push({ ...m, line: l.oldLine, removed: true }); }
    }
    changed.push({ path: f.path, status: f.status, symbols: syms.slice(0, MAX_SYMBOLS) });
  }

  // graph
  const nodes = new Map();
  const edges = [];
  const affected = new Map();
  let capped = false;
  const node = (id, kind, label, p, extra = {}) => {
    if (nodes.has(id)) return true;
    if (nodes.size >= MAX_NODES) { capped = true; return false; }
    nodes.set(id, { id, kind, label, path: p ?? null, ...extra });
    return true;
  };
  const edge = (from, to, kind) => {
    if (!nodes.has(from) || !nodes.has(to) || from === to) return;
    if (edges.length >= MAX_EDGES) { capped = true; return; }
    if (!edges.some((e) => e.from === from && e.to === to && e.kind === kind)) edges.push({ from, to, kind });
  };
  const RANKC = { high: 3, medium: 2, low: 1 };
  const affect = (kind, label, p, confidence, via) => {
    const k = `${kind}:${label}`;
    const prev = affected.get(k);
    if (prev && RANKC[prev.confidence] >= RANKC[confidence]) return;
    if (!prev && affected.size >= MAX_AFFECTED) { capped = true; return; }
    affected.set(k, { kind, label, path: p ?? null, confidence, via });
  };
  const changedSet = new Set(changed.map((c) => c.path));
  const fileId = (p) => `file:${p}`;
  const CONTRACT_RE = /(^|\/)(openapi|swagger)[^/]*\.(ya?ml|json)$|\.(graphql|gql|proto|avsc)$|\.d\.ts$|(^|\/)schema\.(json|prisma)$/i;
  for (const c of changed) {
    // only code (and contract) files are graph nodes; other changed files stay in `changed`
    if (!GRAPH_EXT.has(path.posix.extname(c.path).toLowerCase()) && !CONTRACT_RE.test(c.path)) continue;
    node(fileId(c.path), isTest(c.path) ? 'test' : 'file', path.posix.basename(c.path), c.path, { changed: true });
    for (const s of c.symbols.slice(0, 12)) if (node(`sym:${c.path}#${s.name}`, 'symbol', s.name, c.path, { symbolKind: s.kind, line: s.line, removed: !!s.removed })) edge(fileId(c.path), `sym:${c.path}#${s.name}`, 'defines');
  }
  // importers (depth 1) and callers
  const direct = new Map(); // importer -> changed file
  for (const c of changed) {
    const imps = [...(importedBy.get(c.path) || [])].filter((p) => !changedSet.has(p)).slice(0, 40);
    const names = c.symbols.filter((s) => !COMMON.has(s.name) && s.name.length >= 3).map((s) => s.name);
    for (const imp of imps) {
      direct.set(imp, c.path);
      const e = cache.get(imp);
      const uses = names.filter((n) => e?.words.has(n));
      const test = isTest(imp);
      const id = fileId(imp);
      node(id, test ? 'test' : 'file', path.posix.basename(imp), imp);
      edge(id, fileId(c.path), test ? 'covers' : 'imports');
      for (const n of uses.slice(0, 6)) edge(id, `sym:${c.path}#${n}`, 'calls');
      const conf = uses.length || !names.length ? 'high' : 'medium';
      affect(test ? 'test' : 'file', imp, imp, conf, uses.length ? `calls ${uses.slice(0, 3).join(', ')} from ${c.path}` : `imports ${c.path}`);
    }
  }
  // transitive importers (depth 2)
  let depth2 = 0;
  for (const [imp, src] of direct) {
    for (const p2 of importedBy.get(imp) || []) {
      if (changedSet.has(p2) || direct.has(p2) || depth2 >= 40) continue;
      depth2++;
      const test = isTest(p2);
      if (node(fileId(p2), test ? 'test' : 'file', path.posix.basename(p2), p2)) edge(fileId(p2), fileId(imp), test ? 'covers' : 'imports');
      affect(test ? 'test' : 'file', p2, p2, test ? 'medium' : 'low', `imports ${imp}, which uses ${src}`);
    }
  }
  // name-only references (no import relation): exported, distinctive names only
  for (const c of changed) {
    for (const s of c.symbols.filter((x) => x.exported && x.name.length >= 5 && !COMMON.has(x.name)).slice(0, 10)) {
      let n = 0;
      for (const p of files) {
        if (n >= 8) break;
        if (p === c.path || changedSet.has(p) || direct.has(p)) continue;
        const e = cache.get(p);
        if (!e?.words.has(s.name) || e.symbols.some((d) => d.name === s.name)) continue;
        n++;
        const test = isTest(p);
        if (node(fileId(p), test ? 'test' : 'file', path.posix.basename(p), p)) edge(fileId(p), `sym:${c.path}#${s.name}`, test ? 'covers' : 'calls');
        affect(test ? 'test' : 'file', p, p, 'low', `mentions ${s.name} (no import found)`);
      }
    }
  }
  // tests matched by name
  const stems = new Map(changed.filter((c) => !isTest(c.path)).map((c) => [sourceStem(c.path), c.path]));
  for (const p of all) {
    if (!isTest(p) || changedSet.has(p)) continue;
    const src = stems.get(testStem(p));
    if (!src) continue;
    if (node(fileId(p), 'test', path.posix.basename(p), p)) edge(fileId(p), fileId(src), 'covers');
    affect('test', p, p, 'medium', `named after ${src}`);
  }
  // routes
  const routeNodes = [];
  const addRoute = (r, servedBy, conf, via, file) => {
    const id = `route:${r.method} ${r.uri}`;
    if (node(id, 'route', `${r.method === 'ANY' ? '' : r.method + ' '}${r.uri}`, file, { method: r.method, uri: r.uri })) { edge(id, servedBy, 'serves'); routeNodes.push(r); }
    affect('route', `${r.method} ${r.uri}`, file, conf, via);
  };
  for (const c of changed) {
    const e = cache.get(c.path);
    const fr = fileRoute(c.path);
    if (fr) addRoute(fr, fileId(c.path), 'high', `${c.path} is the route handler`, c.path);
    for (const r of e?.routes || []) addRoute(r, fileId(c.path), 'high', `defined in ${c.path}`, c.path);
  }
  for (const [imp, src] of direct) {
    const e = cache.get(imp);
    const fr = fileRoute(imp);
    if (fr) addRoute(fr, fileId(imp), 'medium', `handler imports ${src}`, imp);
    for (const r of (e?.routes || []).slice(0, 10)) addRoute(r, fileId(imp), 'medium', `defined in ${imp}, which imports ${src}`, imp);
  }
  const phpChanged = changed.filter((c) => c.path.endsWith('.php'));
  if (phpChanged.length && all.some((p) => p.startsWith('routes/'))) {
    let routes = [];
    try { routes = await laravelRoutes(root); } catch { /* no routes */ }
    const byClass = new Map(phpChanged.map((c) => [path.posix.basename(c.path, '.php'), c]));
    for (const r of routes.slice(0, 3000)) {
      const [cls, method] = String(r.action || '').split('@');
      const c = byClass.get(String(cls || '').split('\\').pop());
      if (c) {
        const sym = method && c.symbols.find((s) => s.name === method);
        if (method && c.symbols.length && !sym) continue;
        addRoute({ method: r.method, uri: '/' + String(r.uri).replace(/^\//, '') }, sym ? `sym:${c.path}#${sym.name}` : fileId(c.path), sym ? 'high' : 'medium', `${r.file}:${r.line} -> ${r.action}`, r.file);
      } else if (changedSet.has(r.file)) {
        addRoute({ method: r.method, uri: '/' + String(r.uri).replace(/^\//, '') }, fileId(r.file), 'high', `defined in ${r.file}`, r.file);
      }
    }
  }
  // contracts: changed spec/schema files, exported types, OpenAPI documents that mention an affected route
  for (const c of changed) {
    if (CONTRACT_RE.test(c.path)) {
      node(`contract:${c.path}`, 'contract', path.posix.basename(c.path), c.path, { changed: true });
      edge(`contract:${c.path}`, fileId(c.path), 'documents');
      affect('contract', c.path, c.path, 'high', 'API contract file changed');
    }
    for (const s of c.symbols.filter((x) => x.exported && (x.kind === 'type' || x.kind === 'class'))) {
      if (s.kind === 'class' && !/\.(d\.)?tsx?$/.test(c.path)) continue;
      affect('contract', `${s.kind === 'type' ? 'type' : 'class'} ${s.name}`, c.path, 'medium', `exported from ${c.path}`);
    }
  }
  if (routeNodes.length) {
    const specs = all.filter((p) => /(^|\/)(openapi|swagger)[^/]*\.(ya?ml|json)$/i.test(p) && !/node_modules\//.test(p)).slice(0, 5);
    for (const sp of specs) {
      const r = await readRegularAsync(path.join(root, sp), { maxBytes: 4 * 1024 * 1024 });
      if (!r) continue;
      const text = r.buf.toString('utf8');
      for (const rt of routeNodes) {
        const plain = rt.uri.replace(/:(\w+)/g, '{$1}').replace(/\{(\w+)\?\}/g, '{$1}');
        if (plain.length > 1 && text.includes(plain)) {
          if (node(`contract:${sp}`, 'contract', path.posix.basename(sp), sp)) edge(`contract:${sp}`, `route:${rt.method} ${rt.uri}`, 'documents');
          affect('contract', sp, sp, 'medium', `documents ${rt.uri}`);
        }
      }
    }
  }
  const ORDER = { high: 0, medium: 1, low: 2 };
  const KORD = { route: 0, contract: 1, test: 2, file: 3 };
  return {
    available: true,
    changed: changed.map((c) => ({ path: c.path, status: c.status, symbols: c.symbols.map(({ exported, ...s }) => ({ ...s, exported: !!exported })) })),
    nodes: [...nodes.values()],
    edges,
    affected: [...affected.values()].sort((a, b) => ORDER[a.confidence] - ORDER[b.confidence] || KORD[a.kind] - KORD[b.kind] || a.label.localeCompare(b.label)),
    truncated: capped || indexTruncated || diffTruncated,
    stats: { indexed: files.length, changed: changed.length, importers: direct.size },
  };
}

export function impactMarkdown(r) {
  if (!r.available) return `Impact unavailable: ${r.reason}`;
  const out = ['# Change impact', ''];
  for (const c of r.changed) out.push(`- ${c.path}${c.symbols.length ? `: ${c.symbols.slice(0, 8).map((s) => s.name + (s.removed ? ' (removed)' : '')).join(', ')}` : ''}`);
  out.push('', '## Possibly affected');
  for (const a of r.affected.slice(0, 60)) out.push(`- [${a.confidence}] ${a.kind} ${a.label} (${a.via})`);
  if (!r.affected.length) out.push('- nothing found by the static import graph');
  return out.join('\n');
}
