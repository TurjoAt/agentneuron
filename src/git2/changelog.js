import { runGit, validRev, US, RS } from './run.js';

export const TYPE_TITLES = [
  ['feat', 'Features'], ['fix', 'Bug Fixes'], ['perf', 'Performance'], ['refactor', 'Refactoring'],
  ['docs', 'Documentation'], ['test', 'Tests'], ['build', 'Build'], ['ci', 'CI'], ['style', 'Style'],
  ['chore', 'Chores'], ['revert', 'Reverts'],
];
const TITLE = new Map(TYPE_TITLES);

export function parseConventional(subject, body = '') {
  const m = /^(\w+)(?:\(([^)]*)\))?(!)?:\s+(.+)$/.exec(subject || '');
  const breaking = /(^|\n)BREAKING[ -]CHANGE:/.test(body) || !!(m && m[3]);
  if (!m || !TITLE.has(m[1].toLowerCase())) return { type: 'other', scope: null, text: subject || '', breaking };
  return { type: m[1].toLowerCase(), scope: m[2] || null, text: m[4], breaking };
}

/** commits: [{hash, short, subject, body}] → [{type, title, items}] in canonical order, "other" last. */
export function groupCommits(commits) {
  const map = new Map();
  for (const c of commits) {
    const p = parseConventional(c.subject, c.body);
    if (!map.has(p.type)) map.set(p.type, []);
    map.get(p.type).push({ hash: c.hash, short: c.short || String(c.hash).slice(0, 7), scope: p.scope, text: p.text, subject: c.subject, breaking: p.breaking });
  }
  const groups = [];
  for (const [t] of TYPE_TITLES) if (map.has(t)) groups.push({ type: t, title: TITLE.get(t), items: map.get(t) });
  if (map.has('other')) groups.push({ type: 'other', title: 'Other', items: map.get('other') });
  return groups;
}

export function renderChangelog(groups, { title = 'Unreleased', date = new Date().toISOString().slice(0, 10) } = {}) {
  const lines = [`## ${title} (${date})`, ''];
  const breaking = groups.flatMap((g) => g.items.filter((i) => i.breaking));
  if (breaking.length) {
    lines.push('### BREAKING CHANGES', '');
    for (const i of breaking) lines.push(`- ${i.scope ? `**${i.scope}:** ` : ''}${i.text} (${i.short})`);
    lines.push('');
  }
  for (const g of groups) {
    lines.push(`### ${g.title}`, '');
    for (const i of g.items) lines.push(`- ${i.scope ? `**${i.scope}:** ` : ''}${i.text} (${i.short})`);
    lines.push('');
  }
  if (!groups.length) lines.push('_No changes._', '');
  return lines.join('\n');
}

export async function buildChangelog(root, { from, to = 'HEAD', date } = {}) {
  if (to && !validRev(to)) return { error: 'bad "to"' };
  if (from && !validRev(from)) return { error: 'bad "from"' };
  const probe = await runGit(root, ['rev-parse', '--is-inside-work-tree'], { timeout: 6000 });
  if (!probe.ok) return { available: false, reason: /dubious/i.test(probe.err) ? 'git refuses this repository ("dubious ownership")' : 'not a git repository', markdown: '', groups: [] };
  if (!from) {
    const d = await runGit(root, ['describe', '--tags', '--abbrev=0', `${to}^`], { timeout: 6000 });
    const d2 = d.ok ? d : await runGit(root, ['describe', '--tags', '--abbrev=0', to], { timeout: 6000 });
    from = d2.ok ? d2.out.trim() : null;
    if (from && !validRev(from)) from = null;
  }
  const range = from ? `${from}..${to}` : to;
  const r = await runGit(root, ['log', range, `--format=%H${US}%h${US}%s${US}%b${RS}`, '--no-merges', '--']);
  const commits = [];
  for (const chunk of r.out.split(RS)) {
    const c = chunk.replace(/^\n+/, '');
    if (!c.trim()) continue;
    const [hash, short, subject, body] = c.split(US);
    commits.push({ hash, short, subject, body: body || '' });
  }
  const groups = groupCommits(commits);
  const title = to === 'HEAD' ? 'Unreleased' : to;
  const markdown = renderChangelog(groups, { title, date });
  return { available: true, from: from || null, to, count: commits.length, markdown, groups };
}

/** Prepend a section to existing CHANGELOG content (keeps a top-level "# Changelog" heading first). */
export function prependChangelog(existing, section) {
  const ex = existing || '';
  const m = /^(# [^\n]*\n+)/.exec(ex);
  if (m) return m[1] + section + '\n' + ex.slice(m[1].length);
  if (!ex.trim()) return `# Changelog\n\n${section}`;
  return `# Changelog\n\n${section}\n${ex}`;
}
