// Static (no PHP execution) Laravel introspection: routes, migrations, models.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { splitTop } from './util.js';

/** Replace comments with spaces (newlines kept) so offsets/lines stay stable. */
export function stripPhpComments(src) {
  let out = ''; let i = 0; const n = src.length;
  while (i < n) {
    const ch = src[i]; const nx = src[i + 1];
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < n && src[j] !== ch) { if (src[j] === '\\') j++; j++; }
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    if ((ch === '/' && nx === '/') || (ch === '#' && nx !== '[')) {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (ch === '/' && nx === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2; continue;
    }
    out += ch; i++;
  }
  return out;
}

function matchClose(s, open) { // s[open] is ( [ or { ; returns index of matching close
  const o = s[open]; const c = o === '(' ? ')' : o === '[' ? ']' : '}';
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" || ch === '"') { i++; while (i < s.length && s[i] !== ch) { if (s[i] === '\\') i++; i++; } continue; }
    if (ch === o) depth++;
    else if (ch === c) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function pv(s) {
  s = (s ?? '').trim();
  let m;
  if ((m = /^(['"])((?:\\.|(?!\1)[^\\])*)\1$/s.exec(s))) return { t: 's', v: m[2].replace(/\\(['"\\])/g, '$1') };
  if ((m = /^\\?([\w\\]+)::class$/.exec(s))) return { t: 'c', v: m[1].split('\\').pop() };
  if (s.startsWith('[') && s.endsWith(']')) {
    const items = splitTop(s.slice(1, -1)).map((x) => x.trim()).filter(Boolean).map((it) => {
      const kv = splitTop(it, '=>');
      return kv.length > 1 ? { key: pv(kv[0]).v, val: pv(kv.slice(1).join('=>')) } : { val: pv(it) };
    });
    return { t: 'a', items };
  }
  if (/^(static\s+)?(function|fn)\b/.test(s)) return { t: 'f' };
  return { t: 'x', v: s };
}
const strs = (v) => (!v ? [] : v.t === 'a' ? v.items.flatMap((i) => strs(i.val)) : v.t === 's' || v.t === 'c' ? [v.v] : v.t === 'x' ? [v.v] : []);

const VERBS = { get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH', delete: 'DELETE', options: 'OPTIONS', any: 'ANY' };
const singular = (w) => (/ies$/.test(w) ? w.replace(/ies$/, 'y') : /s$/.test(w) ? w.slice(0, -1) : w);
const RES = [
  ['index', 'GET', ''], ['create', 'GET', '/create'], ['store', 'POST', ''], ['show', 'GET', '/{p}'],
  ['edit', 'GET', '/{p}/edit'], ['update', 'PUT|PATCH', '/{p}'], ['destroy', 'DELETE', '/{p}'],
];

function readChain(src, start, end) {
  // at src[start] === 'R' of "Route::"; returns { calls, endPos } or null
  if (!src.startsWith('Route::', start)) return null;
  let i = start + 7; const calls = [];
  const readCall = () => {
    const m = /^\s*([A-Za-z_]\w*)\s*\(/.exec(src.slice(i, i + 80));
    if (!m) return false;
    const open = i + m[0].length - 1;
    const close = matchClose(src, open);
    if (close < 0 || close > end) return false;
    calls.push({ name: m[1], args: src.slice(open + 1, close), argStart: open + 1 });
    i = close + 1;
    return true;
  };
  if (!readCall()) return null;
  for (;;) {
    const m = /^\s*(?:\?)?->/.exec(src.slice(i, i + 40));
    if (!m) break;
    const save = i; i += m[0].length;
    if (!readCall()) { i = save; break; }
  }
  return { calls, endPos: i };
}

function applyAttrs(ctx, name, argsRaw) {
  const c = { prefix: [...ctx.prefix], as: ctx.as, middleware: [...ctx.middleware], controller: ctx.controller };
  const args = splitTop(argsRaw).map((x) => x.trim()).filter(Boolean);
  const a0 = pv(args[0]);
  if (name === 'prefix' && a0.t === 's') c.prefix.push(a0.v);
  else if (name === 'name' && a0.t === 's') c.as += a0.v;
  else if (name === 'middleware') c.middleware.push(...args.flatMap((a) => strs(pv(a))));
  else if (name === 'controller' && a0.t === 'c') c.controller = a0.v;
  return c;
}

export function parseRoutesSource(srcRaw, file) {
  const src = stripPhpComments(srcRaw);
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1);
  const lineAt = (pos) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo + 1; };
  const routes = [];

  const joinUri = (ctx, uri) => '/' + [...ctx.prefix, uri].map((s) => String(s).replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
  const actionOf = (ctx, v) => {
    if (!v) return 'Closure';
    if (v.t === 'a') {
      const it = v.items.map((i) => i.val);
      if (it[0]?.t === 'c' || it[0]?.t === 's') return `${it[0].v}@${it[1]?.v || '__invoke'}`;
      return 'Closure';
    }
    if (v.t === 's') return v.v.includes('@') ? v.v.split('\\').pop() : ctx.controller ? `${ctx.controller}@${v.v}` : v.v;
    if (v.t === 'c') return `${v.v}@__invoke`;
    return 'Closure';
  };

  function scan(from, to, ctx) {
    let pos = from;
    for (;;) {
      const at = src.indexOf('Route::', pos);
      if (at < 0 || at >= to) return;
      const ch = readChain(src, at, to);
      if (!ch) { pos = at + 7; continue; }
      pos = ch.endPos;
      handle(ch.calls, at, ctx);
    }
  }

  function handle(calls, at, ctx) {
    const first = calls[0]; const last = calls.at(-1);
    const line = lineAt(at);
    if (last.name === 'group') {
      let c = ctx; let args = splitTop(last.args);
      for (const call of calls.slice(0, -1)) c = applyAttrs(c, call.name, call.args);
      if (calls.length === 1) { // Route::group([attrs], fn)
        const arr = pv(args[0]);
        if (arr.t === 'a') for (const it of arr.items) {
          if (it.key === 'prefix') c = applyAttrs(c, 'prefix', JSON.stringify(strs(it.val)[0] ?? ''));
          else if (it.key === 'as') c = applyAttrs(c, 'name', JSON.stringify(strs(it.val)[0] ?? ''));
          else if (it.key === 'middleware') c = { ...c, middleware: [...c.middleware, ...strs(it.val)] };
          else if (it.key === 'controller') c = { ...c, controller: strs(it.val)[0] || c.controller };
        }
      }
      const open = src.indexOf('{', last.argStart);
      if (open >= 0 && open < last.argStart + last.args.length) {
        const close = matchClose(src, open);
        if (close > 0) scan(open + 1, close, c);
      }
      return;
    }
    const verb = VERBS[first.name];
    const chain = calls.slice(1);
    const mw = [...ctx.middleware]; let name = null;
    const add = (r) => routes.push({ file, line, ...r });
    const args = splitTop(first.args).map((x) => x.trim()).filter(Boolean);
    for (const c of chain) {
      if (c.name === 'middleware') mw.push(...splitTop(c.args).flatMap((a) => strs(pv(a))));
      else if (c.name === 'name') name = strs(pv(splitTop(c.args)[0]))[0] ?? null;
    }
    const nm = (n) => (n == null ? null : ctx.as + n);
    if (verb || first.name === 'match') {
      const methods = first.name === 'match' ? strs(pv(args[0])).map((m) => m.toUpperCase()).join('|') : verb;
      const rest = first.name === 'match' ? args.slice(1) : args;
      const uri = pv(rest[0]);
      add({ method: methods, uri: joinUri(ctx, uri.v ?? ''), action: actionOf(ctx, pv(rest[1])), name: nm(name), middleware: mw });
    } else if (first.name === 'view') {
      add({ method: 'GET', uri: joinUri(ctx, pv(args[0]).v ?? ''), action: `view:${pv(args[1]).v ?? ''}`, name: nm(name), middleware: mw });
    } else if (first.name === 'redirect' || first.name === 'permanentRedirect') {
      add({ method: 'GET', uri: joinUri(ctx, pv(args[0]).v ?? ''), action: `redirect:${pv(args[1]).v ?? ''}`, name: nm(name), middleware: mw });
    } else if (first.name === 'resource' || first.name === 'apiResource' || first.name === 'singleton') {
      const rname = pv(args[0]).v ?? ''; const ctl = pv(args[1]).v || ctx.controller || '';
      const only = chain.find((c) => c.name === 'only'); const except = chain.find((c) => c.name === 'except');
      const onlyL = only ? strs(pv(only.args)) : null; const exceptL = except ? strs(pv(except.args)) : [];
      const api = first.name === 'apiResource';
      const base = rname.replace(/^\/+|\/+$/g, '');
      const param = singular(base.split('/').pop());
      const nameBase = base.replace(/\//g, '.');
      for (const [act, method, suffix] of RES) {
        if (api && (act === 'create' || act === 'edit')) continue;
        if (onlyL && !onlyL.includes(act)) continue;
        if (exceptL.includes(act)) continue;
        add({ method, uri: joinUri(ctx, base + suffix.replace('{p}', `{${param}}`)), action: ctl ? `${ctl}@${act}` : act, name: nm(`${nameBase}.${act}`), middleware: mw });
      }
    }
  }

  scan(0, src.length, { prefix: [], as: '', middleware: [], controller: null });
  return routes;
}

export async function laravelRoutes(root) {
  const dir = path.join(root, 'routes');
  let names; try { names = await fsp.readdir(dir); } catch { return []; }
  const out = [];
  for (const n of names.sort()) {
    if (!n.endsWith('.php') || n === 'console.php') continue;
    let t; try { t = await fsp.readFile(path.join(dir, n), 'utf8'); } catch { continue; }
    out.push(...parseRoutesSource(t, `routes/${n}`));
  }
  return out;
}

export async function laravelMigrations(root) {
  const dir = path.join(root, 'database/migrations');
  let names; try { names = await fsp.readdir(dir); } catch { return []; }
  const out = [];
  for (const n of names.sort()) {
    if (!n.endsWith('.php')) continue;
    let t = ''; try { t = await fsp.readFile(path.join(dir, n), 'utf8'); } catch { /* skip */ }
    const create = /Schema::create\(\s*['"]([^'"]+)['"]/.exec(t);
    const alter = /Schema::(?:table|drop(?:IfExists)?|rename)\(\s*['"]([^'"]+)['"]/.exec(t);
    const mt = /^(\d{4})_(\d{2})_(\d{2})_(\d{6})/.exec(n);
    const ts = mt ? `${mt[1]}-${mt[2]}-${mt[3]}T${mt[4].slice(0, 2)}:${mt[4].slice(2, 4)}:${mt[4].slice(4, 6)}Z` : null;
    const fromName = /create_(\w+?)_table/.exec(n)?.[1] || null;
    out.push({ file: `database/migrations/${n}`, table: create?.[1] || alter?.[1] || fromName, op: create ? 'create' : alter ? 'alter' : 'other', ts });
  }
  return out;
}

export async function laravelModels(root) {
  const base = path.join(root, 'app/Models');
  const out = [];
  async function walk(dir, rel) {
    let ents; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isDirectory()) { await walk(path.join(dir, e.name), `${rel}/${e.name}`); continue; }
      if (!e.name.endsWith('.php')) continue;
      let t = ''; try { t = await fsp.readFile(path.join(dir, e.name), 'utf8'); } catch { /* skip */ }
      if (!/\bclass\s+\w+/.test(t)) continue; // traits / interfaces handled below
      if (/\b(trait|interface)\s+\w+/.test(t) && !/\bclass\s+\w+/.test(t)) continue;
      const cls = /\bclass\s+(\w+)/.exec(t)[1];
      const table = /\$table\s*=\s*['"]([^'"]+)['"]/.exec(t)?.[1] || null;
      const relations = [...t.matchAll(/function\s+(\w+)\s*\([^)]*\)[^{]*\{\s*return\s+\$this->(hasOne|hasMany|belongsTo|belongsToMany|morphTo|morphMany|morphOne|hasManyThrough|hasOneThrough|morphToMany)\(/g)].map((m) => ({ name: m[1], type: m[2] }));
      out.push({ name: cls, path: `app/Models${rel}/${e.name}`, table, relations });
    }
  }
  await walk(base, '');
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
