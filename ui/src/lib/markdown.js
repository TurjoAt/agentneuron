// In-house, dependency-free markdown → HTML renderer.
// Everything from the source is HTML-escaped; raw HTML is never passed through.
// Supports: YAML frontmatter, ATX headings, paragraphs, emphasis, strike, inline
// code, code fences, block quotes, nested ordered/unordered lists, task
// checkboxes, tables (with alignment), hr, links (internal → in-app route),
// wiki links [[name]], Claude @imports, bare URLs, images (as safe chips).
// Every block carries data-line (1-based source line) for jump-to-line.

import { escapeHtml as esc, resolvePath, basename } from './format.js';

const FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})\s*([^`\s]*)?.*$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE = /^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/;
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])(\s+|$)/;
const QUOTE_RE = /^\s{0,3}>\s?/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

const lead = (s) => s.match(/^\s*/)[0].replace(/\t/g, '    ').length;

/** Drop everything between < and > (and the brackets), character by character. */
function stripTags(s) {
  let out = '', inTag = false;
  for (const ch of s) {
    if (ch === '<') inTag = true;
    else if (ch === '>') inTag = false;
    else if (!inTag) out += ch;
  }
  return out;
}

export function slugify(text) {
  return (
    'h-' +
    stripTags(String(text))
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-')
  );
}

/**
 * @param {string} src
 * @param {{ path?: string, exists?: (p:string)=>boolean, byBasename?: (n:string)=>string|null, href?: (p:string, anchor?:string)=>string }} opts
 */
export function renderMarkdown(src, opts = {}) {
  try {
    return renderMarkdownUnsafe(src, opts);
  } catch {
    // never let a hostile document break the view: fall back to escaped plain text
    return `<pre class="md-fallback">${esc(String(src ?? '').slice(0, 200000))}</pre>`;
  }
}

function renderMarkdownUnsafe(src, opts) {
  const ctx = {
    dir: opts.path && opts.path.includes('/') ? opts.path.slice(0, opts.path.lastIndexOf('/')) : '',
    exists: opts.exists || (() => false),
    byBasename: opts.byBasename || (() => null),
    href: opts.href || ((p, a) => `#/files?path=${encodeURIComponent(p)}${a ? `&anchor=${encodeURIComponent(a)}` : ''}`),
    slugs: new Map(),
    linkPaths: opts.linkPaths !== false,
  };
  ctx.find = (t) => {
    const clean = String(t).trim().replace(/^\.\//, '');
    if (!clean || /\s/.test(clean) || clean.length > 200) return null;
    const rel = resolvePath(ctx.dir, clean);
    if (ctx.exists(rel)) return rel;
    const root = resolvePath('', clean);
    if (ctx.exists(root)) return root;
    return null;
  };
  const lines = String(src ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').split('\n');
  let start = 0;
  let out = '';
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    const end2 = end < 0 ? lines.indexOf('...', 1) : end;
    if (end2 > 0) {
      out += renderFrontmatter(lines.slice(1, end2));
      start = end2 + 1;
    }
  }
  out += blocks(lines.slice(start), start, ctx)
    .map((b) => b.html)
    .join('\n');
  return out;
}

function renderFrontmatter(fm) {
  const rows = [];
  let cur = null;
  for (const l of fm) {
    const m = l.match(/^([\w.-]+)\s*:\s*(.*)$/);
    if (m) {
      cur = { k: m[1], v: m[2] };
      rows.push(cur);
    } else if (cur && l.trim()) {
      cur.v += (cur.v ? ' ' : '') + l.trim().replace(/^-\s*/, '• ');
    }
  }
  if (!rows.length) return '';
  return (
    `<div class="md-fm" data-line="1"><div class="md-fm-title">frontmatter</div><dl>` +
    rows.map((r) => `<dt>${esc(r.k)}</dt><dd>${esc(r.v.replace(/^["']|["']$/g, '')) || '<span class="muted">—</span>'}</dd>`).join('') +
    `</dl></div>`
  );
}

function isBlockStart(l) {
  return FENCE_RE.test(l) && /(`{3,}|~{3,})/.test(l.trim().slice(0, 3))
    || HEADING_RE.test(l) || HR_RE.test(l) || QUOTE_RE.test(l) || LIST_RE.test(l);
}

const MAX_DEPTH = 12; // nested quotes/lists; deeper content is shown as plain text
const MAX_INLINE = 2000;
const INLINE_BUDGET = 100000; // total chars of rich inline parsing per document // inline regexes are super-linear on pathological input

/** Parse block-level elements. `off` = 0-based source line of lines[0]. */
function blocks(lines, off, ctx) {
  ctx.depth = (ctx.depth || 0) + 1;
  try {
    if (ctx.depth > MAX_DEPTH) return [{ type: 'p', inner: esc(lines.join('\n')), html: `<p data-line="${off + 1}">${esc(lines.join('\n'))}</p>` }];
    return blocksInner(lines, off, ctx);
  } finally {
    ctx.depth--;
  }
}

function blocksInner(lines, off, ctx) {
  const out = [];
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const l = lines[i];
    const lineNo = off + i + 1;
    if (!l.trim()) { i++; continue; }

    // fenced code
    const fm = l.match(FENCE_RE);
    if (fm && /^(`{3,}|~{3,})/.test(l.trim())) {
      const fence = fm[2];
      const lang = (fm[3] || '').toLowerCase();
      const body = [];
      i++;
      while (i < n && !(lines[i].trim().startsWith(fence[0].repeat(fence.length)) && lines[i].trim().replace(new RegExp(`^\\${fence[0]}+`), '').trim() === '')) {
        body.push(lines[i]);
        i++;
      }
      i++; // closing fence
      out.push({
        type: 'code',
        html: `<div class="md-code" data-line="${lineNo}">${lang ? `<span class="md-lang">${esc(lang)}</span>` : ''}<pre><code>${esc(body.join('\n'))}</code></pre></div>`,
      });
      continue;
    }

    const h = l.match(HEADING_RE);
    if (h) {
      const level = h[1].length;
      const inner = inline(h[2], ctx);
      let id = slugify(h[2]);
      const c = ctx.slugs.get(id) || 0;
      ctx.slugs.set(id, c + 1);
      if (c) id += '-' + c;
      out.push({ type: 'h', html: `<h${level} id="${esc(id)}" data-line="${lineNo}">${inner}</h${level}>` });
      i++;
      continue;
    }

    // HTML comments (e.g. file markers in merged context) → muted marker, never raw HTML
    const cm = l.match(/^\s*<!--\s*(.*?)\s*-->\s*$/);
    if (cm) {
      if (cm[1]) out.push({ type: 'comment', html: `<div class="md-comment" data-line="${lineNo}">${esc(cm[1])}</div>` });
      i++;
      continue;
    }

    if (HR_RE.test(l)) {
      out.push({ type: 'hr', html: `<hr data-line="${lineNo}">` });
      i++;
      continue;
    }

    // table
    if (l.includes('|') && i + 1 < n && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = splitRow(l);
      const aligns = splitRow(lines[i + 1]).map((c) => {
        const t = c.trim();
        return t.startsWith(':') && t.endsWith(':') ? 'center' : t.endsWith(':') ? 'right' : t.startsWith(':') ? 'left' : '';
      });
      i += 2;
      const rows = [];
      while (i < n && lines[i].trim() && lines[i].includes('|')) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const cell = (tag, c, k) => `<${tag}${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inline(c.trim(), ctx)}</${tag}>`;
      out.push({
        type: 'table',
        html:
          `<div class="md-table" data-line="${lineNo}"><table><thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead><tbody>` +
          rows.map((r) => `<tr>${head.map((_, k) => cell('td', r[k] ?? '', k)).join('')}</tr>`).join('') +
          `</tbody></table></div>`,
      });
      continue;
    }

    // blockquote
    if (QUOTE_RE.test(l)) {
      const body = [];
      while (i < n && lines[i].trim() && (QUOTE_RE.test(lines[i]) || body.length)) {
        body.push(lines[i].replace(QUOTE_RE, ''));
        i++;
      }
      const innerBlocks = blocks(body, off + i - body.length, ctx);
      const first = body[0] || '';
      const callout = first.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
      if (callout && innerBlocks[0]) {
        const re = /\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;
        innerBlocks[0].html = innerBlocks[0].html.replace(re, `<span class="md-callout-t">${callout[1].toLowerCase()}</span>`);
      }
      out.push({
        type: 'quote',
        html: `<blockquote data-line="${lineNo}"${callout ? ` class="md-callout ${callout[1].toLowerCase()}"` : ''}>${innerBlocks.map((b) => b.html).join('')}</blockquote>`,
      });
      continue;
    }

    // list
    if (LIST_RE.test(l)) {
      const r = list(lines, i, off, ctx);
      out.push({ type: 'list', html: r.html });
      i = r.next;
      continue;
    }

    // paragraph
    const para = [l.trim()];
    i++;
    while (i < n && lines[i].trim() && !isBlockStart(lines[i]) && !(lines[i].includes('|') && i + 1 < n && TABLE_SEP_RE.test(lines[i + 1]))) {
      para.push(lines[i].trim());
      i++;
    }
    const innerP = inline(para.join('\n'), ctx);
    out.push({ type: 'p', inner: innerP, html: `<p data-line="${lineNo}">${innerP}</p>` });
  }
  return out;
}

function splitRow(l) {
  let s = l.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  let code = false;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === '\\' && s[k + 1] === '|') { cur += '|'; k++; continue; }
    if (ch === '`') code = !code;
    if (ch === '|' && !code) { cells.push(cur); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur);
  return cells;
}

function list(lines, i, off, ctx) {
  const n = lines.length;
  const m0 = lines[i].match(LIST_RE);
  const indent = lead(m0[1]);
  const ordered = /\d/.test(m0[2]);
  const startNum = ordered ? parseInt(m0[2], 10) : 1;
  const items = [];
  let hasTasks = false;
  while (i < n) {
    const m = lines[i].match(LIST_RE);
    if (!m || lead(m[1]) !== indent || /\d/.test(m[2]) !== ordered) break;
    const contentIndent = m[0].length;
    const itemStart = i;
    const body = [lines[i].slice(contentIndent)];
    i++;
    while (i < n) {
      const l = lines[i];
      if (!l.trim()) {
        let j = i + 1;
        while (j < n && !lines[j].trim()) j++;
        if (j < n && lead(lines[j]) > indent) {
          for (let k = i; k < j; k++) body.push('');
          i = j;
          continue;
        }
        break;
      }
      const ld = lead(l);
      if (ld > indent) {
        body.push(l.replace(/^\s+/, ' '.repeat(Math.max(0, ld - Math.min(ld, contentIndent)))));
        i++;
        continue;
      }
      if (isBlockStart(l)) break;
      body.push(l.trim()); // lazy continuation
      i++;
    }
    let task = null;
    const tm = body[0].match(/^\[( |x|X|\/)\]\s+/);
    if (tm) {
      task = tm[1] === '/' ? 'doing' : tm[1] !== ' ';
      body[0] = body[0].slice(tm[0].length);
      hasTasks = true;
    }
    const inner = blocks(body, off + itemStart, ctx);
    let html = '';
    inner.forEach((b, k) => {
      html += k === 0 && b.type === 'p' ? b.inner : b.html;
    });
    const lineNo = off + itemStart + 1;
    items.push(
      task === null
        ? `<li data-line="${lineNo}">${html}</li>`
        : `<li class="md-task${task === 'doing' ? ' doing' : task ? ' done' : ''}" data-line="${lineNo}"><span class="md-check" aria-hidden="true">${task === 'doing' ? '<i></i>' : task ? '<svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg>' : ''}</span><span class="md-task-body">${html}</span></li>`
    );
    // skip blank lines between sibling items
    let j = i;
    while (j < n && !lines[j].trim()) j++;
    if (j < n && j !== i) {
      const mm = lines[j].match(LIST_RE);
      if (mm && lead(mm[1]) === indent && /\d/.test(mm[2]) === ordered) i = j;
    }
  }
  const tag = ordered ? 'ol' : 'ul';
  const attrs = `${ordered && startNum !== 1 ? ` start="${startNum}"` : ''}${hasTasks ? ' class="md-tasks"' : ''}`;
  return { html: `<${tag}${attrs}>${items.join('')}</${tag}>`, next: i };
}

const SAFE_URL = /^(https?:|mailto:)/i;

function linkHtml(url, label, ctx) {
  const raw = url.trim().replace(/^<|>$/g, '');
  if (SAFE_URL.test(raw)) {
    return `<a href="${esc(raw)}" class="md-ext" target="_blank" rel="noopener noreferrer">${label}</a>`;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return `<span class="md-badlink">${label}</span>`;
  if (raw.startsWith('#')) {
    return `<a href="#" class="md-anchor" data-anchor="${esc(slugify(decodeSafe(raw.slice(1)).replace(/-/g, ' ')))}">${label}</a>`;
  }
  const [p, frag] = raw.split('#');
  const target = resolvePath(ctx.dir, decodeSafe(p));
  if (ctx.exists(target)) {
    return `<a href="${esc(ctx.href(target, frag ? slugify(decodeSafe(frag).replace(/-/g, ' ')) : ''))}" class="md-int" data-path="${esc(target)}">${label}</a>`;
  }
  return `<span class="md-broken" title="Broken link → ${esc(target)}">${label}</span>`;
}

function decodeSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Inline formatting. Uses a placeholder stash so code/links aren't re-processed. */
export function inline(text, ctx) {
  ctx.budget = (ctx.budget ?? INLINE_BUDGET) - String(text).length;
  if (String(text).length > MAX_INLINE || ctx.budget < 0 || (ctx.idepth || 0) > 6) return esc(String(text).replace(/\u0000/g, ''));
  ctx.idepth = (ctx.idepth || 0) + 1;
  try {
    return inlineInner(String(text).replace(/\u0000/g, ''), ctx);
  } finally {
    ctx.idepth--;
  }
}

function inlineInner(text, ctx) {
  const stash = [];
  const put = (html) => `\u0000${stash.push(html) - 1}\u0000`;
  let t = text;
  // escaped chars
  t = t.replace(/\\([\\`*_{}[\]()#+\-.!|~@<>])/g, (_, c) => put(esc(c)));
  // code spans
  t = t.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, _t, c) => {
    const code = c.trim();
    const target = ctx.linkPaths && /[./]/.test(code) ? ctx.find(code) : null;
    return put(target
      ? `<a href="${esc(ctx.href(target))}" class="md-int md-codelink" data-path="${esc(target)}"><code>${esc(code)}</code></a>`
      : `<code>${esc(code)}</code>`);
  });
  // images → safe chip (never load remote images)
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt, url) =>
    put(`<span class="md-img" title="${esc(url)}">${esc(alt || basename(url))}</span>`)
  );
  // links
  t = t.replace(/\[([^\]]+)\]\((<[^>]+>|[^)\s]*)(?:\s+"[^"]*")?\)/g, (_, label, url) => put(linkHtml(url, inline(label, ctx), ctx)));
  // wiki links
  t = t.replace(/\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, name, _a, label) => {
    const target = ctx.byBasename(name.trim()) || (ctx.exists(name.trim()) ? name.trim() : null);
    const lbl = esc(label || name);
    return put(target
      ? `<a href="${esc(ctx.href(target))}" class="md-int md-wiki" data-path="${esc(target)}">${lbl}</a>`
      : `<span class="md-broken" title="Unresolved wiki link">${lbl}</span>`);
  });
  // autolinks
  t = t.replace(/<(https?:\/\/[^>\s]+)>/g, (_, u) => put(linkHtml(u, esc(u), ctx)));
  t = t.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, (_, pre, u) => pre + put(linkHtml(u, esc(u), ctx)));
  // Claude @imports (@path/to/file.md) — not emails
  t = t.replace(/(^|[\s(])@((?:~\/|\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)*\.[a-zA-Z0-9]+)/g, (m, pre, p) => {
    const target = resolvePath(ctx.dir, p);
    if (!ctx.exists(target)) return pre + put(`<span class="md-import md-broken" title="Unresolved import">@${esc(p)}</span>`);
    return pre + put(`<a href="${esc(ctx.href(target))}" class="md-int md-import" data-path="${esc(target)}">@${esc(p)}</a>`);
  });
  // plain path mentions of existing files (docs/plan.md, ./README.md)
  if (ctx.linkPaths) {
    t = t.replace(/(^|[\s(,;:])((?:\.{1,2}\/)?(?:[\w@.-]+\/)*[\w@-][\w@.-]*\.(?:md|mdc|markdown|mdx|json|toml|ya?ml|txt))(?=$|[\s),;:!?]|\.(?:\s|$))/g, (m, pre, p) => {
      const target = ctx.find(p);
      return target ? pre + put(`<a href="${esc(ctx.href(target))}" class="md-int md-path" data-path="${esc(target)}">${esc(p)}</a>`) : m;
    });
  }
  t = esc(t);
  t = t
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?![_\w])/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
    .replace(/ {2,}\n/g, '<br>');
  // restore (may be nested once)
  for (let k = 0; k < 2; k++) t = t.replace(/\u0000(\d+)\u0000/g, (_, idx) => stash[+idx]);
  return t;
}
