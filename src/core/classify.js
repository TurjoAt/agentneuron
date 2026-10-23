import { globMatch, globToRegex } from './glob.js';
import catalogue from '../patterns/catalogue.json' with { type: 'json' };

export const ALWAYS_IGNORED = ['.git', 'node_modules', 'vendor', '.mdctl', 'dist', 'build', '.next', 'storage', '__MACOSX'];

const docKinds = catalogue.docKinds.map((d) => ({ re: new RegExp(d.regex, 'i'), kind: d.kind }));
const MD_RE = /\.(md|mdc|mdx|markdown)$/i;

/**
 * Classify a project-relative POSIX path.
 * `extraPatterns` (optional, from config) take priority over the catalogue.
 */
export function classify(relPath, extraPatterns = []) {
  const all = [...(extraPatterns || []), ...catalogue.patterns];
  let hit = null;
  for (const p of all) {
    if (p && p.glob && globMatch(p.glob, relPath)) { hit = p; break; }
  }
  const isMd = MD_RE.test(relPath);
  if (hit && hit.tool !== 'generic') {
    return { tool: hit.tool, kind: hit.kind || 'other', tracked: true };
  }
  let kind = hit ? hit.kind : null;
  if (isMd && (!hit || kind === 'doc')) {
    const d = docKinds.find((x) => x.re.test(relPath));
    if (d) kind = d.kind;
  }
  if (hit) return { tool: hit.tool || 'generic', kind: kind || 'other', tracked: true };
  if (isMd) return { tool: 'generic', kind: kind || 'other', tracked: true };
  return { tool: 'generic', kind: 'other', tracked: false };
}

/** True if the path (file or dir, relative POSIX) is excluded by built-in or config ignore rules. */
export function isIgnored(relPath, config = {}) {
  const segs = relPath.split('/');
  if (segs.some((s) => ALWAYS_IGNORED.includes(s))) return true;
  // Agent worktrees are full copies of the project; tracking them doubles every file.
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i + 1] === 'worktrees' && (segs[i] === '.claude' || segs[i] === '.codex')) return true;
  }
  for (const entry of config.ignore || []) {
    const e = String(entry).replace(/^\.\//, '').replace(/\/+$/, '');
    if (!e) continue;
    if (!/[*?{[/]/.test(e)) { if (segs.includes(e)) return true; continue; }
    const rx = globToRegex(e);
    for (let i = 1; i <= segs.length; i++) if (rx.test(segs.slice(0, i).join('/'))) return true;
  }
  return false;
}

/** Should this file be tracked by mdctl at all (ignore rules + catalogue / markdown)? */
export function isCandidate(relPath, config = {}) {
  if (!relPath || isIgnored(relPath, config)) return false;
  const extra = config.extraPatterns || [];
  const c = classify(relPath, extra);
  if (!c.tracked) return false;
  if (config.includeAllMarkdown === false) {
    const matched = [...extra, ...catalogue.patterns].some((p) => p && p.glob && globMatch(p.glob, relPath));
    return matched;
  }
  return true;
}
