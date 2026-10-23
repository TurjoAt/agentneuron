// Quick fixes for lint issues. Each fix carries the full before/after of the files it touches.
import path from 'node:path';
import { FileError } from './paths.js';
import { getOps } from './ops.js';
import { rewriteContent, makeIndex } from './rewrite.js';
import { closestFiles, pathDistance } from './fuzzy.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function lineEdits(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  const out = [];
  if (a.length === b.length) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) out.push({ path: null, line: i + 1, before: a[i], after: b[i] });
    return out;
  }
  // insertion / deletion of whole lines
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (b.length > a.length) {
    for (let k = i; k < i + (b.length - a.length); k++) out.push({ path: null, line: k + 1, before: '', after: b[k] });
  } else {
    for (let k = i; k < i + (a.length - b.length); k++) out.push({ path: null, line: k + 1, before: a[k], after: null });
  }
  return out;
}

function makeFix(id, title, description, changes, extra = {}) {
  const edits = [];
  for (const c of changes) for (const e of lineEdits(c.before, c.after)) edits.push({ ...e, path: c.path });
  return { id, title, description, edits, files: changes, ...extra };
}

function relFrom(fromPath, target) {
  const d = path.posix.dirname(fromPath);
  const r = path.posix.relative(d === '.' ? '' : d, target);
  return r.startsWith('.') ? r : r;
}

function envName(text, valuePrefix, message) {
  const i = text.indexOf(valuePrefix);
  const m = i > 0 ? /([A-Za-z0-9_.-]+)["']?\s*[:=]\s*["'`]?$/.exec(text.slice(0, i)) : null;
  let name = m ? m[1] : null;
  if (!name) {
    const label = /^(.*?) found on line/.exec(message || '');
    name = label ? label[1].replace(/\(.*$/, '') : 'SECRET';
  }
  name = name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
  return /^[A-Z_]/.test(name) && name ? name : 'SECRET';
}

export async function computeFixes(ctx, issueId) {
  const ops = getOps(ctx);
  const a = await ctx.analysis();
  const issue = (a.issues || []).find((i) => i.id === issueId);
  if (!issue) throw new FileError(404, 'issue not found');
  const tracked = new Set(ctx.store.files.keys());
  const fixes = [];
  const p = issue.path;
  const content = ops.readFresh(p);
  if (content == null && issue.rule !== 'empty-file') return { issue, fixes };

  if (issue.rule === 'broken-link') {
    const prefix = `broken-link:${p}:${issue.line ?? 0}:`;
    const to = issue.id.startsWith(prefix) ? issue.id.slice(prefix.length) : null;
    if (to) {
      const index = makeIndex(tracked);
      for (const cand of closestFiles(to, tracked, { from: p, limit: 3 })) {
        const res = rewriteContent({
          from: p, content, index, exists: () => false,
          map: (T, type, info) => ((type === 'wiki' ? info.name === to : T === to) ? cand : undefined),
        });
        if (res.content !== content) {
          fixes.push(makeFix(`repoint:${cand}`, `Point to ${cand}`, `Replace the broken target "${to}" with the existing file ${cand}.`, [{ path: p, before: content, after: res.content }]));
        }
      }
    }
  } else if (issue.rule === 'missing-path') {
    const prefix = `missing-path:${p}:${issue.line ?? 0}:`;
    const cand0 = issue.id.startsWith(prefix) ? issue.id.slice(prefix.length) : null;
    if (cand0) {
      const lines = content.split('\n');
      const li = (issue.line || 1) - 1;
      for (const cand of closestFiles(cand0, tracked, { from: p, limit: 3 })) {
        const nv = cand0.startsWith('.') ? relFrom(p, cand) : cand;
        const needle = '`' + cand0 + '`';
        if (!lines[li] || !lines[li].includes(needle)) break;
        const copy = lines.slice();
        copy[li] = copy[li].replace(needle, () => '`' + nv + '`');
        fixes.push(makeFix(`repoint:${cand}`, `Use ${cand}`, `Replace \`${cand0}\` with the existing file \`${cand}\`.`, [{ path: p, before: content, after: copy.join('\n') }]));
      }
    }
  } else if (issue.rule === 'orphan') {
    const rank = { 'readme.md': 0, 'agents.md': 1, 'claude.md': 2 };
    const indexes = [...tracked].filter((x) => x !== p && rank[path.posix.basename(x).toLowerCase()] !== undefined)
      .sort((x, y) => pathDistance(p, x) - pathDistance(p, y) || rank[path.posix.basename(x).toLowerCase()] - rank[path.posix.basename(y).toLowerCase()] || x.localeCompare(y))
      .slice(0, 3);
    const title = ctx.store.files.get(p)?.title || path.posix.basename(p).replace(/\.[^.]+$/, '');
    for (const idx of indexes) {
      const ic = ops.readFresh(idx);
      if (ic == null) continue;
      const entry = `- [${title}](${relFrom(idx, p)})`;
      const lines = ic.split('\n');
      let at = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/^#{1,6}\s+(docs|documentation|links|index|references|contents|see also|resources)\b/i.test(lines[i])) {
          let j = i + 1;
          let last = -1;
          while (j < lines.length && !/^#{1,6}\s/.test(lines[j])) { if (/^\s*[-*+]\s/.test(lines[j])) last = j; j++; }
          at = last >= 0 ? last + 1 : i + 1 + (lines[i + 1] === '' ? 1 : 0);
          break;
        }
      }
      let after;
      if (at >= 0) { const c = lines.slice(); c.splice(at, 0, entry); after = c.join('\n'); }
      else after = ic.replace(/\n*$/, '\n') + `\n## Docs\n\n${entry}\n`;
      fixes.push(makeFix(`link-from:${idx}`, `Link from ${idx}`, `Add "${entry}" to ${idx}.`, [{ path: idx, before: ic, after }]));
    }
  } else if (issue.rule === 'secret') {
    const li = (issue.line || 1) - 1;
    const lines = content.split('\n');
    const line = lines[li] ?? '';
    const pref = /\(([^()]{1,4})\*{4}\)\s*$/.exec(issue.message || '')?.[1];
    if (pref) {
      const m = new RegExp(esc(pref) + '[^\\s"\'`,;)}\\]]*').exec(line);
      if (m) {
        const name = envName(line, m[0], issue.message);
        const copy = lines.slice();
        copy[li] = line.slice(0, m.index) + '${' + name + '}' + line.slice(m.index + m[0].length);
        fixes.push(makeFix(`env:${name}`, `Replace with \${${name}}`, `Replace the hard-coded value with an environment variable reference. Rotate the credential too; it stays in history.`, [{ path: p, before: content, after: copy.join('\n') }]));
      }
    }
  } else if (issue.rule === 'empty-file') {
    fixes.push({ id: 'trash', title: 'Delete empty file', description: `Move ${p} to .agentneuron/trash (restorable).`, edits: [], files: [], trash: p });
  } else if (issue.rule === 'duplicate-rule') {
    const others = [...(issue.message.match(/[^\s,]+:\d+/g) || [])];
    const targets = [{ path: p, line: issue.line }, ...others.map((o) => { const i = o.lastIndexOf(':'); return { path: o.slice(0, i), line: Number(o.slice(i + 1)) }; })];
    for (const t of targets) {
      const c = t.path === p ? content : ops.readFresh(t.path);
      if (c == null) continue;
      const lines = c.split('\n');
      if (!/^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[t.line - 1] || '')) continue;
      lines.splice(t.line - 1, 1);
      fixes.push(makeFix(`remove:${t.path}:${t.line}`, `Remove from ${t.path}`, `Delete the duplicated rule at ${t.path}:${t.line}; keep the other copy as the source of truth.`, [{ path: t.path, before: c, after: lines.join('\n') }]));
    }
  }
  return { issue, fixes };
}

export const publicFix = (f) => ({ id: f.id, title: f.title, description: f.description, edits: f.edits });

export async function applyFix(ctx, issueId, fixId) {
  const ops = getOps(ctx);
  const { fixes } = await computeFixes(ctx, issueId);
  const fix = fixes.find((f) => f.id === fixId);
  if (!fix) throw new FileError(404, 'fix not found');
  for (const c of fix.files) {
    if (ops.readFresh(c.path) !== c.before) throw new FileError(409, `${c.path} changed; reload and retry`);
  }
  const changed = [];
  for (const c of fix.files) { await ops.writeTracked(c.path, c.after); changed.push(c.path); }
  if (fix.trash) { const r = await ops.remove({ path: fix.trash }); changed.push(fix.trash); return { applied: true, changed, trash: r.id }; }
  return { applied: true, changed };
}
