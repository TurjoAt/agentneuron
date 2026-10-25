// Generated regions: <!-- agentneuron:begin source=rules/x.md hash=… --> … <!-- agentneuron:end source=rules/x.md -->
import { sha } from './safety.js';

export const hashOf = (s) => sha(s).slice(0, 12);
const BEGIN = /^<!--\s*agentneuron:begin\s+source=(\S+)\s+hash=([0-9a-f]{6,40})\s*-->[ \t]*$/;
const END = /^<!--\s*agentneuron:end\s+source=(\S+)\s*-->[ \t]*$/;
const ANY = /^<!--\s*agentneuron:(begin|end)\b/;

export const begin = (source, hash) => `<!-- agentneuron:begin source=${source} hash=${hash} -->`;
export const end = (source) => `<!-- agentneuron:end source=${source} -->`;
export const block = (source, content, hash = hashOf(content)) => `${begin(source, hash)}\n${content}\n${end(source)}`;

/**
 * Split LF text into parts: { type:'text', text } and { type:'region', source, hash, content }.
 * Throws on unbalanced / nested / duplicate markers so a broken file is never rewritten.
 */
export function parseRegions(text) {
  const lines = text.split('\n');
  const parts = [];
  let buf = [], cur = null;
  const seen = new Set();
  lines.forEach((l, i) => {
    if (!ANY.test(l)) { (cur ? cur.lines : buf).push(l); return; }
    const b = BEGIN.exec(l), e = END.exec(l);
    if (b) {
      if (cur) throw new Error(`line ${i + 1}: nested agentneuron:begin`);
      if (seen.has(b[1])) throw new Error(`line ${i + 1}: duplicate region for ${b[1]}`);
      seen.add(b[1]);
      parts.push({ type: 'text', lines: buf }); buf = [];
      cur = { type: 'region', source: b[1], hash: b[2], lines: [], line: i + 1 };
    } else if (e) {
      if (!cur || cur.source !== e[1]) throw new Error(`line ${i + 1}: unmatched agentneuron:end`);
      parts.push({ type: 'region', source: cur.source, hash: cur.hash, content: cur.lines.join('\n'), line: cur.line });
      cur = null;
    } else throw new Error(`line ${i + 1}: malformed agentneuron marker`);
  });
  if (cur) throw new Error(`line ${cur.line}: agentneuron:begin without end`);
  parts.push({ type: 'text', lines: buf });
  return parts;
}

/** Join parts back (exact inverse of parseRegions). Text parts are line arrays; regions are begin + content + end. */
export function joinParts(parts) {
  const out = [];
  for (const p of parts) {
    if (p.type === 'region') out.push(begin(p.source, p.hash), ...p.content.split('\n'), end(p.source));
    else out.push(...p.lines);
  }
  return out.join('\n');
}

/** Remove every generated region (used by import to skip already-compiled content). */
export function stripRegions(text) {
  try { return parseRegions(text).filter((p) => p.type === 'text').flatMap((p) => p.lines).join('\n'); } catch { return text; }
}
