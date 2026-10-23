import { scanLines } from './links.js';

function parseFm(content) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  const fm = {};
  if (!m) return { fm, bodyStart: 0 };
  for (const l of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(l);
    if (kv) fm[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { fm, bodyStart: m[0].split(/\r?\n/).length };
}

const DATE_RE = /(\d{4}-\d{2}-\d{2})/;

function isAdrPath(path) {
  return /(^|\/)(adr|adrs|decisions?)\//i.test(path) || /(^|\/)\d{3,4}-[^/]+\.md$/i.test(path) && /adr|decision/i.test(path);
}

export function extractDecisions(path, content, kind) {
  const lines = scanLines(content).filter((l) => !l.inFence);
  const { fm } = parseFm(content);
  const base = path.split('/').pop();
  const out = [];

  const statusOf = (from, to) => {
    for (let i = from; i < to; i++) {
      const m = /^\s*(?:[-*]\s*)?(?:\*\*)?Status(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.+?)\s*(?:\*\*)?\s*$/i.exec(lines[i].text);
      if (m) return m[1].replace(/\*+/g, '');
      if (/^\s{0,3}#{2,6}\s+Status\s*$/i.test(lines[i].text)) {
        for (let j = i + 1; j < to; j++) {
          const t = lines[j].text.trim();
          if (t) return /^#/.test(t) ? undefined : t.replace(/\*+/g, '');
        }
      }
    }
    return undefined;
  };
  const dateOf = (from, to) => {
    for (let i = from; i < to; i++) {
      const m = /^\s*(?:[-*]\s*)?(?:\*\*)?Date(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.+)$/i.exec(lines[i].text);
      if (m) { const d = DATE_RE.exec(m[1]); if (d) return d[1]; }
    }
    return undefined;
  };
  const clean = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]; return o; };

  const isLog = /^(decisions?|decision[-_ ]log|adr[-_ ]?log)\.md$/i.test(base);
  const isAdr = kind === 'decision' && !isLog || (kind === undefined && isAdrPath(path));

  if (isLog || (kind === 'decision' && isLog)) {
    const heads = [];
    lines.forEach((l, i) => { const m = /^\s{0,3}##\s+(.+?)\s*#*\s*$/.exec(l.text); if (m) heads.push({ i, title: m[1], line: l.n }); });
    heads.forEach((h, k) => {
      const end = k + 1 < heads.length ? heads[k + 1].i : lines.length;
      out.push(clean({ path, title: h.title, status: statusOf(h.i, end), date: dateOf(h.i, end) || DATE_RE.exec(h.title)?.[1], line: h.line }));
    });
    return out;
  }

  if (isAdr) {
    const h1i = lines.findIndex((l) => /^\s{0,3}#\s+\S/.test(l.text));
    const title = h1i >= 0 ? lines[h1i].text.replace(/^\s{0,3}#\s+/, '').replace(/\s*#*\s*$/, '') : base.replace(/\.[^.]+$/, '');
    out.push(clean({
      path, title,
      status: fm.status || statusOf(0, lines.length),
      date: DATE_RE.exec(fm.date || '')?.[1] || dateOf(0, lines.length) || DATE_RE.exec(base)?.[1],
      line: h1i >= 0 ? lines[h1i].n : 1,
    }));
    return out;
  }

  // generic: "## Decision" headings
  lines.forEach((l, i) => {
    const m = /^\s{0,3}#{2,3}\s+Decision(?:s)?\s*(?:[:\-—]\s*(.+?))?\s*#*\s*$/i.exec(l.text);
    if (!m) return;
    let title = m[1];
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) if (/^\s{0,3}#{1,3}\s/.test(lines[j].text)) { end = j; break; }
    if (!title) {
      for (let j = i + 1; j < end; j++) if (lines[j].text.trim()) { title = lines[j].text.trim().replace(/^[-*]\s+/, ''); break; }
    }
    if (!title) return;
    out.push(clean({ path, title, status: statusOf(i, end), date: dateOf(i, end) || DATE_RE.exec(base)?.[1], line: l.n }));
  });
  return out;
}
