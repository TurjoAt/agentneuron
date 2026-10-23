import { scanLines } from './links.js';

export function extractTasks(path, content) {
  const out = [];
  let section = null;
  for (const { n, text, inFence } of scanLines(content)) {
    if (inFence) continue;
    const h = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(text);
    if (h) { section = h[1]; continue; }
    const cb = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/.exec(text);
    if (cb) {
      out.push({ path, line: n, text: cb[2].trim(), done: cb[1] !== ' ', section });
      continue;
    }
    const td = /(?:^|[^A-Za-z0-9_])(TODO|FIXME)\s*(?:\([^)]*\))?\s*:\s*(.*)$/.exec(text.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length)));
    if (td) {
      const idx = text.indexOf(td[2], td.index);
      const t = (td[2] ? text.slice(idx) : text).trim();
      out.push({ path, line: n, text: t || text.trim(), done: false, section });
    }
  }
  return out;
}
