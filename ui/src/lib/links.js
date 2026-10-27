// Shared link helpers (owner: UI-A). Resolve md mentions to in-app file links.
//
// Any <a data-path="rel/path.md"> anywhere in the app automatically gets:
//   - hover peek card (PeekCard, global delegate in App)
//   - right-click file context menu
// so other views only need `fileHref()` + `data-path` (or <Linked text=…/>).

import { href } from './nav.js';
import { api } from './api.js';
import { fileIndex } from './store.svelte.js';
import { escapeHtml, resolvePath, dirname } from './format.js';

/** In-app href to a file (optionally a line). */
export function fileHref(path, line) {
  return href('files', { path, line });
}

/** In-app href that opens the file in the editor. */
export function editHref(path, line) {
  return href('files', { path, line, tab: 'edit' });
}

const EXT = 'md|mdc|markdown|mdx|txt|json|jsonc|toml|ya?ml|js|mjs|cjs|ts|tsx|jsx|php|py|go|rs|rb|sh|css|scss|html|vue|svelte|sql|env|example|lock|xml';
/** Path-ish tokens: dir/file.ext, ./x.md, ../x.md, FILE.md, .claude/x.md */
export const PATH_RE = new RegExp(`(?:\\.{1,2}\\/)?(?:[\\w@.-]+\\/)*[\\w@.-]*[\\w-]\\.(?:${EXT})\\b`, 'g');

/**
 * Resolve a mention (relative link, root-relative path, basename, wiki name)
 * against the local file index. Returns the project-relative path or null.
 * @param {string} from  project-relative path of the referring file ('' for root)
 * @param {string} target
 */
export function resolveTarget(from, target) {
  if (!target) return null;
  const idx = fileIndex();
  let t = String(target).trim().replace(/^<|>$/g, '').replace(/^@/, '');
  t = t.split('#')[0].split('?')[0];
  try {
    t = decodeURIComponent(t);
  } catch {
    /* keep */
  }
  if (!t) return null;
  const dir = from ? dirname(from) : '';
  const rel = resolvePath(dir, t);
  if (idx.set.has(rel)) return rel;
  const root = resolvePath('', t);
  if (idx.set.has(root)) return root;
  // wiki-style / bare basename
  if (!t.includes('/')) {
    const b = idx.byBase.get(t.toLowerCase().replace(/\.(md|mdc|markdown)$/, ''));
    if (b) return b;
  }
  return null;
}

/** Server-side resolution (GET /api/links/resolve) with local fallback. */
export async function resolveRemote(from, target) {
  const local = resolveTarget(from, target);
  if (local) return { path: local, exists: true, candidates: [] };
  try {
    return await api('/api/links/resolve', { from: from || '', target });
  } catch {
    return { path: null, exists: false, candidates: [] };
  }
}

/**
 * Turn plain text into safe HTML where file mentions that exist become in-app
 * links (`<a class="md-int" data-path>`). Everything else is escaped.
 * @param {string} text
 * @param {{ from?: string }} [opts]
 */
export function linkifyText(text, opts = {}) {
  const s = String(text ?? '');
  let out = '';
  let last = 0;
  for (const m of s.matchAll(PATH_RE)) {
    const raw = m[0];
    const p = resolveTarget(opts.from || '', raw);
    if (!p) continue;
    out += escapeHtml(s.slice(last, m.index));
    out += `<a href="${escapeHtml(fileHref(p))}" class="md-int" data-path="${escapeHtml(p)}">${escapeHtml(raw)}</a>`;
    last = m.index + raw.length;
  }
  return out + escapeHtml(s.slice(last));
}

/**
 * Find every link-like mention at a text offset (for editor Ctrl+click).
 * Returns { target, from, to } or null.
 */
export function mentionAt(lineText, col) {
  const pats = [
    /\[[^\]]*\]\(([^)\s]+)[^)]*\)/g, // md link
    /\[\[([^\]|#]+)[^\]]*\]\]/g, // wiki
    /`([^`]+)`/g, // backticked
    /@((?:~\/|\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)*\.[a-zA-Z0-9]+)/g, // @import
    PATH_RE,
  ];
  for (const re of pats) {
    re.lastIndex = 0;
    for (const m of lineText.matchAll(re)) {
      const start = m.index;
      const end = start + m[0].length;
      if (col >= start && col <= end) return { target: m[1] ?? m[0], from: start, to: end };
    }
  }
  return null;
}

/** The project on GitHub (source, issues, releases). */
export const REPO_URL = 'https://github.com/TurjoAt/agentneuron';
