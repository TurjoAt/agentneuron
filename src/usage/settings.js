// Settings audit: Claude Code user + project settings, MCP servers waiting for auth, and permission modes seen in sessions.
import path from 'node:path';
import { maskSecretsInText } from '../health/secrets.js';
import { safeRead } from './guard.js';

const MODES = ['auto', 'plan', 'default', 'acceptEdits', 'bypassPermissions'];

async function readJson(file, home) {
  const r = await safeRead(file, home, { maxBytes: 2 * 1024 * 1024 });
  if (!r) return null;
  try { const o = JSON.parse(r.buf.toString('utf8')); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch { return null; }
}

const strs = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string').map((x) => maskSecretsInText(x).slice(0, 500)) : []);
const m = (v) => (typeof v === 'string' ? maskSecretsInText(v).slice(0, 200) : v ?? null);

function hooksOf(h) {
  if (!h || typeof h !== 'object') return {};
  const out = {};
  for (const [ev, list] of Object.entries(h)) {
    if (!Array.isArray(list)) continue;
    out[ev.slice(0, 60)] = list.slice(0, 50).map((x) => ({
      matcher: typeof x?.matcher === 'string' ? x.matcher.slice(0, 200) : null,
      commands: (Array.isArray(x?.hooks) ? x.hooks : []).map((k) => (typeof k?.command === 'string' ? maskSecretsInText(k.command).slice(0, 300) : k?.type || null)).filter(Boolean).slice(0, 20),
    }));
  }
  return out;
}

const BROAD = [
  [/^Bash$|^Bash\(\*\)$|^Bash\(:\*\)$|^\*$/, 'high', 'Any shell command is allowed without asking'],
  [/^Bash\((sudo|rm|curl|wget|ssh|scp|dd|chmod|chown|git push)[\s:]?\*?\)$/i, 'medium', 'A risky command family is allowed without asking'],
  [/^WebFetch$|^WebFetch\(\*\)$/, 'low', 'Fetching any URL is allowed without asking'],
  [/^(Write|Edit)$|^(Write|Edit)\(\*\*?\)$|^(Write|Edit)\(\/\*\*\)$/, 'medium', 'Writes anywhere on disk are allowed without asking'],
];

/**
 * @param o { root, home, permModes: {mode: count}, hookErrors: number }
 */
export async function auditSettings({ root, home, permModes = {}, hookErrors = 0 }) {
  const sources = [
    { location: '~/.claude/settings.json', file: path.join(home, '.claude', 'settings.json') },
    { location: '.claude/settings.json', file: path.join(root, '.claude', 'settings.json') },
    { location: '.claude/settings.local.json', file: path.join(root, '.claude', 'settings.local.json') },
  ];
  const loaded = [];
  for (const s of sources) { const j = await readJson(s.file, home); if (j) loaded.push({ ...s, j }); }
  const merged = { model: null, advisorModel: null, autoMode: null, theme: null, hooks: {}, permissions: { allow: [], deny: [], ask: [] } };
  const findings = [];
  const add = (f) => findings.push({ id: `${f.id}:${findings.length}`, ...f });
  for (const { location, j } of loaded) {
    if (j.model !== undefined) merged.model = m(j.model);
    if (j.advisorModel !== undefined) merged.advisorModel = m(j.advisorModel);
    if (j.theme !== undefined) merged.theme = m(j.theme);
    if (j.autoMode !== undefined) merged.autoMode = j.autoMode && typeof j.autoMode === 'object' ? { environment: strs(j.autoMode.environment).length } : m(j.autoMode);
    const hk = hooksOf(j.hooks);
    for (const [ev, list] of Object.entries(hk)) merged.hooks[ev] = [...(merged.hooks[ev] || []), ...list];
    const p = j.permissions && typeof j.permissions === 'object' ? j.permissions : {};
    for (const k of ['allow', 'deny', 'ask']) for (const r of strs(p[k])) if (!merged.permissions[k].includes(r)) merged.permissions[k].push(r);
    if (p.defaultMode === 'bypassPermissions') add({ id: 'bypass-default', severity: 'high', title: 'Permission checks are bypassed by default', why: 'defaultMode "bypassPermissions" lets the agent run any tool, including shell commands and file deletes, without asking.', fix: 'Use "acceptEdits" or "auto" as defaultMode and allow the specific commands you need.', location });
    for (const r of strs(p.allow)) {
      const hit = BROAD.find(([re]) => re.test(r.trim()));
      if (hit) add({ id: 'broad-allow', severity: hit[1], title: `Broad allow rule: ${r}`, why: `${hit[2]}.`, fix: 'Replace it with narrow rules such as Bash(npm test:*) for the commands you actually run.', location });
    }
    if (j.skipDangerousModePermissionPrompt === true) add({ id: 'skip-danger-prompt', severity: 'medium', title: 'The bypass-mode warning is disabled', why: 'skipDangerousModePermissionPrompt hides the confirmation before entering bypassPermissions mode.', fix: 'Remove skipDangerousModePermissionPrompt.', location });
    if (j.enableAllProjectMcpServers === true) add({ id: 'all-project-mcp', severity: 'medium', title: 'All project MCP servers are enabled automatically', why: 'Any MCP server added to a cloned repo\'s .mcp.json starts without review.', fix: 'Remove enableAllProjectMcpServers and approve servers one by one (enabledMcpjsonServers).', location });
  }
  const auth = await readJson(path.join(home, '.claude', 'mcp-needs-auth-cache.json'), home);
  const mcpNeedsAuth = auth ? Object.keys(auth).filter((k) => /^[\w.@ -]{1,100}$/.test(k)).slice(0, 100) : [];
  if (mcpNeedsAuth.length) add({ id: 'mcp-auth', severity: 'low', title: `${mcpNeedsAuth.length} MCP server(s) need authentication`, why: `Tools of ${mcpNeedsAuth.slice(0, 5).join(', ')}${mcpNeedsAuth.length > 5 ? ', ...' : ''} are unavailable until they are authenticated.`, fix: 'Run /mcp in Claude Code and authenticate, or remove servers you no longer use.', location: '~/.claude/mcp-needs-auth-cache.json' });
  const permissionModes = Object.fromEntries(MODES.map((k) => [k, Object.hasOwn(permModes, k) ? permModes[k] : 0]));
  if (permissionModes.bypassPermissions > 0) add({ id: 'bypass-used', severity: 'medium', title: 'Sessions ran in bypassPermissions mode', why: `${permissionModes.bypassPermissions} record(s) in this project's sessions used bypassPermissions, where no tool call asks for approval.`, fix: 'Prefer auto or acceptEdits mode, and a sandbox or container when bypassing permissions.', location: 'sessions' });
  if (hookErrors > 0) add({ id: 'hook-errors', severity: 'medium', title: `Hooks failed ${hookErrors} time(s)`, why: 'Stop hooks reported errors in recent sessions; a failing hook can silently skip checks it was meant to enforce.', fix: 'Run the hook command by hand and fix it, or remove it from settings.', location: 'sessions' });
  if (loaded.length && !merged.permissions.deny.length) add({ id: 'no-deny', severity: 'info', title: 'No deny rules', why: 'Nothing stops the agent from reading files such as .env or credentials if a task leads there.', fix: 'Add deny rules, e.g. "Read(./.env)" and "Read(./**/*.pem)".', location: loaded[loaded.length - 1].location });
  const order = { high: 0, medium: 1, low: 2, info: 3 };
  return { settings: merged, permissionModes, mcpNeedsAuth, findings: findings.sort((a, b) => order[a.severity] - order[b.severity]) };
}
