// Link-aware content rewriting: md links, reference defs, [[wiki]], @imports, plain/backticked mentions.
import { posix } from 'node:path';
import { scanLines, blankInlineCode } from '../analysis/links.js';

const isUrl = (s) => /^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//');
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const stripExt = (s) => s.replace(/\.[^./]+$/, '');

export function resolveRel(fromPath, target) {
  const dir = posix.dirname(fromPath);
  let t = target;
  if (t.startsWith('/')) t = t.slice(1);
  else t = posix.join(dir === '.' ? '' : dir, t);
  t = posix.normalize(t);
  if (t.startsWith('../') || t === '..') return null;
  return t.replace(/^\.\//, '');
}

export function formatRel(newFrom, target, orig) {
  if (orig.startsWith('/')) return '/' + target;
  const dir = posix.dirname(newFrom);
  let r = posix.relative(dir === '.' ? '' : dir, target);
  if (orig.startsWith('./') && !r.startsWith('.')) r = './' + r;
  if (orig.includes('%')) r = r.split('/').map(encodeURIComponent).join('/');
  return r;
}

/** Index over a set of paths for wiki-link resolution. */
export function makeIndex(files) {
  const set = files instanceof Set ? files : new Set(files);
  const baseIdx = new Map();
  for (const p of [...set].sort()) {
    const b = posix.basename(p).replace(/\.[^.]+$/, '').toLowerCase();
    if (!baseIdx.has(b)) baseIdx.set(b, []);
    baseIdx.get(b).push(p);
  }
  return { files: set, baseIdx };
}

export function resolveWiki(from, name, index) {
  const asPath = name.includes('/') ? [name, name + '.md'].map((x) => x.replace(/^\//, '')) : [];
  for (const c of asPath) if (index.files.has(c)) return c;
  const cands = index.baseIdx.get(posix.basename(name).replace(/\.[^.]+$/, '').toLowerCase()) || [];
  const dir = posix.dirname(from);
  return cands.find((c) => posix.dirname(c) === dir && c !== from) || cands.find((c) => c !== from) || null;
}

/**
 * @param {object} o
 * @param {string} o.from        current (old) path of the file holding the content
 * @param {string} [o.newFrom]   new path of that file (if it moves)
 * @param {string} o.content
 * @param {{files:Set<string>, baseIdx:Map}} o.index
 * @param {(p:string)=>boolean} o.exists  does project path exist on disk
 * @param {(target:string|null, type:string, info:object)=>string|null|undefined} [o.map]  new target path for a link target
 * @param {Map<string,string>} [o.mentions] old path -> new path for plain mentions
 */
export function rewriteContent({ from, newFrom = from, content, index, exists = () => false, map = () => undefined, mentions = null }) {
  const raw = String(content);
  const lines = raw.split('\n');
  const flags = scanLines(raw);
  const outEdits = [];
  let count = 0;
  const moved = newFrom !== from;

  for (let li = 0; li < lines.length; li++) {
    if (flags[li]?.inFence) continue;
    const t = lines[li];
    if (!t) continue;
    const s = blankInlineCode(t);
    const edits = []; // {start,end,text}
    const free = (a, b) => !edits.some((e) => a < e.end && b > e.start);

    // path-like target (md link / ref def / import): decide new path part
    const pathTarget = (start, end, type, { bracketed = false } = {}) => {
      const tok = t.slice(start, end);
      const pathPart = tok.split('#')[0].split('?')[0];
      if (!pathPart || isUrl(pathPart)) return;
      const tail = tok.slice(pathPart.length);
      const decoded = safeDecode(pathPart);
      const T = resolveRel(from, decoded);
      if (T === null) return;
      let mapped = map(T, type, { raw: tok });
      if (mapped == null) {
        if (moved && (index.files.has(T) || exists(T))) mapped = T; else return;
      }
      if (mapped === T && !moved) return;
      let np = formatRel(newFrom, mapped, pathPart);
      if (!bracketed && /\s/.test(np)) np = np.replace(/ /g, '%20');
      if (np === pathPart) return;
      edits.push({ start, end: start + pathPart.length, text: np });
    };

    // inline links / images
    for (const m of s.matchAll(/!?\[(?:[^\]\\]|\\.)*\]\(\s*(<[^>]*>|[^()\s]*(?:\([^()]*\)[^()\s]*)*)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/dg)) {
      const [gs, ge] = m.indices[1];
      if (s[gs] === '<') {
        const close = s.indexOf('>', gs);
        pathTarget(gs + 1, close > 0 && close < ge ? close : ge, 'md-link', { bracketed: true });
      } else pathTarget(gs, ge, 'md-link');
    }
    // reference definitions
    const rd = /^(\s{0,3}\[[^\]]+\]:\s*)(\S+)/d.exec(s);
    if (rd) {
      const [gs, ge] = rd.indices[2];
      if (s[gs] === '<') pathTarget(gs + 1, s.indexOf('>', gs) > 0 ? s.indexOf('>', gs) : ge, 'md-link', { bracketed: true });
      else pathTarget(gs, ge, 'md-link');
    }
    // wiki links
    for (const m of s.matchAll(/\[\[([^\]\n|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/dg)) {
      const [gs, ge] = m.indices[1];
      const name = m[1].trim();
      if (!name) continue;
      const lead = m[1].length - m[1].trimStart().length;
      const hit = resolveWiki(from, name, index);
      const mapped = map(hit, 'wiki', { name });
      if (!mapped || mapped === hit) continue;
      const hadExt = /\.[A-Za-z0-9]+$/.test(posix.basename(name));
      let nn;
      if (name.includes('/')) nn = hadExt || !/\.md$/i.test(mapped) ? mapped : stripExt(mapped);
      else nn = hadExt ? posix.basename(mapped) : stripExt(posix.basename(mapped));
      if (nn === name) continue;
      edits.push({ start: gs + lead, end: gs + lead + name.length, text: nn });
      void ge;
    }
    // @imports
    for (const m of s.matchAll(/(?<![\w@./~`:\\-])@([A-Za-z0-9_.\-/]+)/dg)) {
      const tt = m[1].replace(/[.,;:)\]]+$/, '');
      if (!tt || (!tt.includes('/') && !/\.[A-Za-z0-9]+$/.test(tt))) continue;
      if (/^\d/.test(tt) && !tt.includes('/')) continue;
      const [gs] = m.indices[1];
      pathTarget(gs, gs + tt.length, 'import');
    }
    // plain / backticked mentions
    if (mentions && mentions.size) {
      for (const [oldP, newP] of mentions) {
        if (!t.includes(oldP)) continue;
        let fromIdx = 0;
        for (;;) {
          const i = t.indexOf(oldP, fromIdx);
          if (i === -1) break;
          fromIdx = i + oldP.length;
          const before = t[i - 1];
          const after = t[i + oldP.length];
          if (before !== undefined && /[\w/.\-]/.test(before)) continue;
          if (after !== undefined && /[\w/\-]/.test(after)) continue;
          if (after === '.' && /\w/.test(t[i + oldP.length + 1] || '')) continue;
          if (!free(i, i + oldP.length)) continue;
          edits.push({ start: i, end: i + oldP.length, text: newP });
        }
      }
    }

    if (!edits.length) continue;
    edits.sort((a, b) => b.start - a.start);
    let out = t;
    for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
    if (out !== t) {
      lines[li] = out;
      count += edits.length;
      outEdits.push({ line: li + 1, before: t.replace(/\r$/, ''), after: out.replace(/\r$/, '') });
    }
  }
  return { content: lines.join('\n'), edits: outEdits, count };
}
