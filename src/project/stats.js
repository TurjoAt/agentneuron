// Code stats from the capped file index.
import fsp from 'node:fs/promises';
import path from 'node:path';

const LANGS = {
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript', svelte: 'Svelte', vue: 'Vue', astro: 'Astro',
  php: 'PHP', py: 'Python', go: 'Go', rs: 'Rust', rb: 'Ruby', java: 'Java', kt: 'Kotlin', cs: 'C#', c: 'C', h: 'C', cpp: 'C++', hpp: 'C++', swift: 'Swift', dart: 'Dart',
  css: 'CSS', scss: 'SCSS', sass: 'SCSS', less: 'Less', html: 'HTML', htm: 'HTML', md: 'Markdown', mdx: 'Markdown', mdc: 'Markdown', json: 'JSON', yml: 'YAML', yaml: 'YAML', toml: 'TOML',
  sh: 'Shell', bash: 'Shell', sql: 'SQL', xml: 'XML', graphql: 'GraphQL', lua: 'Lua', ex: 'Elixir', exs: 'Elixir',
};
const BLADE = /\.blade\.php$/;
const LINE_CAP_FILES = 20000;

function langOf(p) {
  if (BLADE.test(p)) return 'Blade';
  const m = /\.([A-Za-z0-9]+)$/.exec(p);
  return m ? LANGS[m[1].toLowerCase()] || null : null;
}

async function countLines(abs) {
  try {
    const buf = await fsp.readFile(abs);
    if (buf.includes(0)) return 0;
    let n = 0; for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++;
    return buf.length && buf[buf.length - 1] !== 10 ? n + 1 : n;
  } catch { return 0; }
}

export async function computeStats(root, idx) {
  const byLang = new Map(); const dirs = new Map(); let totalLines = 0;
  const targets = [];
  for (const f of idx.files) {
    const lang = langOf(f.path);
    const segs = f.path.split('/');
    for (let d = 1; d <= Math.min(2, segs.length - 1); d++) {
      const dp = segs.slice(0, d).join('/');
      const e = dirs.get(dp) || { path: dp, files: 0, bytes: 0 }; e.files++; e.bytes += f.size; dirs.set(dp, e);
    }
    if (!lang) continue;
    const e = byLang.get(lang) || { lang, files: 0, lines: 0, bytes: 0 };
    e.files++; e.bytes += f.size; byLang.set(lang, e);
    if (f.size <= 1024 * 1024 && lang !== 'JSON' && targets.length < LINE_CAP_FILES) targets.push([f, lang]);
  }
  for (let i = 0; i < targets.length; i += 48) {
    const chunk = targets.slice(i, i + 48);
    const counts = await Promise.all(chunk.map(([f]) => countLines(path.join(root, f.path))));
    chunk.forEach(([, lang], k) => { byLang.get(lang).lines += counts[k]; totalLines += counts[k]; });
  }
  return {
    languages: [...byLang.values()].sort((a, b) => b.lines - a.lines || b.bytes - a.bytes),
    totalFiles: idx.files.length,
    totalLines,
    truncated: idx.truncated,
    largest: [...idx.files].sort((a, b) => b.size - a.size).slice(0, 15).map((f) => ({ path: f.path, bytes: f.size })),
    dirs: [...dirs.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 40),
  };
}
