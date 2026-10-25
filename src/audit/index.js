// Agent config security audit: MCP servers, permissions, bypass modes, hooks, file modes and secrets in
// agent config and context files. Read-only, project-local, confined reads; every value in output is masked.
import fs from 'node:fs';
import path from 'node:path';
import { readRegular } from '../files/safeio.js';
import { scanSecrets, isPlaceholder, maskSecret, maskSecretsInText } from '../health/secrets.js';
import { parseSimpleToml } from '../health/configview.js';

export const SEVERITIES = ['high', 'medium', 'low', 'info'];
const WEIGHT = { high: 0.3, medium: 0.1, low: 0.03, info: 0 };
const CONTEXT_KINDS = new Set(['context', 'rules', 'agent', 'skill', 'command', 'memory']);

// [file, key holding the server map]
const MCP_FILES = [['.mcp.json', 'mcpServers'], ['.cursor/mcp.json', 'mcpServers'], ['.vscode/mcp.json', 'servers'], ['.gemini/settings.json', 'mcpServers'],
  ['.roo/mcp.json', 'mcpServers'], ['.amazonq/mcp.json', 'mcpServers'], ['.junie/mcp/mcp.json', 'mcpServers'], ['.zed/settings.json', 'context_servers'],
  ['.claude/settings.json', 'mcpServers'], ['.claude/settings.local.json', 'mcpServers']];
const CLAUDE_SETTINGS = ['.claude/settings.json', '.claude/settings.local.json'];
const CODEX = '.codex/config.toml';
const RUNNERS = { npx: 1, bunx: 1, uvx: 1, 'pnpx': 1 };
const SECRET_KEY = /(token|secret|password|passwd|api[_-]?key|apikey|auth|credential|private[_-]?key|bearer|cookie|session)/i;
const PIPE_TO_SHELL = /\b(curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod|fetch)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b|\b(curl|wget|iwr|irm)\b[^|;&]*\|\s*(sudo\s+)?(python3?|node|perl|ruby|php|iex|invoke-expression)\b|(ba|z)?sh\s+<\(\s*(curl|wget)|\beval\s+["'`]?\$\((curl|wget)|\b(iex|invoke-expression)\b[^;]*\b(iwr|irm|invoke-webrequest|invoke-restmethod|downloadstring|net\.webclient)/i;
const DOWNLOAD = /\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^;|&]*https?:\/\//i;
const DESTRUCTIVE = /\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+(\/|~|\$HOME)(\s|$|\/\*)/i;

/** JSON with // and /* comments and trailing commas (VS Code, Zed). */
export function parseJsonc(text) {
  let out = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { out += ch; if (ch === '\\') { out += text[++i] ?? ''; } else if (ch === '"') q = false; continue; }
    if (ch === '"') { q = true; out += ch; continue; }
    if (ch === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (ch === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); const chunk = text.slice(i, e < 0 ? text.length : e + 2); out += chunk.replace(/[^\n]/g, ' '); i = e < 0 ? text.length : e + 1; continue; }
    out += ch;
  }
  try { const v = JSON.parse(out.replace(/,(\s*[}\]])/g, '$1')); return v && typeof v === 'object' ? v : null; } catch { return null; }
}

function lineOf(text, needles, from = 1) {
  const lines = text.split(/\r?\n/);
  for (const n of [].concat(needles).filter(Boolean)) {
    for (let i = Math.max(0, from - 1); i < lines.length; i++) if (lines[i].includes(n)) return i + 1;
  }
  return from > 1 ? from : null;
}

const literal = (v) => typeof v === 'string' && v.length >= 8 && !isPlaceholder(v) && !/\$\{?(env:|input:)?[A-Za-z_]/.test(v) && !/^\{\{.*\}\}$/.test(v);

/** Package spec after npx/bunx/uvx/dlx and whether it is pinned to an exact version. */
export function runnerPackage(command, args) {
  const toks = [command, ...args].filter((x) => typeof x === 'string').flatMap((x) => (x.includes(' ') && x === command ? x.split(/\s+/) : [x]));
  let i = toks.findIndex((t) => RUNNERS[path.basename(t).replace(/\.(cmd|exe)$/i, '')] || t === 'dlx' || (t === 'run' && /pipx$/.test(toks[0] || '')));
  if (i < 0) return null;
  for (i = i + 1; i < toks.length; i++) {
    const t = toks[i];
    if (t === '-p' || t === '--package' || t === '--from') { const spec = toks[i + 1]; return spec ? { spec, ...pinInfo(spec) } : null; }
    if (t.startsWith('-')) continue;
    return { spec: t, ...pinInfo(t) };
  }
  return null;
}
function pinInfo(spec) {
  if (/^[./]/.test(spec) || /^[A-Za-z]:\\/.test(spec)) return { local: true, pinned: true };
  const at = spec.lastIndexOf('@');
  const ver = at > 0 ? spec.slice(at + 1) : /==(.+)$/.exec(spec)?.[1] || null;
  return { version: ver, latest: ver === 'latest', pinned: !!ver && /^v?\d+\.\d+\.\d+([-+][\w.]+)?$/.test(ver) };
}

function isLocalHost(host) {
  return /^(localhost|127(?:\.\d+){3}|\[?::1\]?|0\.0\.0\.0|host\.docker\.internal)$/i.test(host);
}

export function riskScore(findings) {
  let keep = 1;
  for (const f of findings) keep *= 1 - (WEIGHT[f.severity] || 0);
  return Math.round(100 * (1 - keep));
}

/**
 * @param {{root:string, files?:object[], contents?:Map<string,string>}} input
 */
export function auditAgentConfig({ root, files = [], contents = new Map() }) {
  const findings = [];
  const scanned = [];
  const absRoot = path.resolve(root);
  const read = (rel) => { const r = readRegular(path.join(absRoot, rel), { maxBytes: 1024 * 1024, confine: absRoot }); return r ? r.buf.toString('utf8').replace(/^﻿/, '') : null; };
  const add = (severity, rule, file, line, title, why, fix) => findings.push({ id: `${rule}:${file}:${line ?? 0}:${findings.length}`, severity, rule, file, line: line ?? null, title: maskSecretsInText(title), why, fix });
  const secretLines = new Set();
  const secretsIn = (file, text, sev = null) => {
    for (const s of scanSecrets(file, text)) {
      const k = `${file}:${s.line}`;
      if (secretLines.has(k)) continue;
      secretLines.add(k);
      add(sev || (s.severity === 'error' ? 'high' : 'medium'), file.match(/\.(json|toml)$/) ? 'inline-secret' : 'context-secret', file, s.line, s.message,
        'Anyone with the repository (and every agent reading it) gets the credential.', 'Remove it, rotate the credential, and reference an environment variable (e.g. ${env:NAME} / ${NAME}) instead.');
    }
  };

  // ---- MCP servers
  const texts = new Map();
  for (const [rel, key] of MCP_FILES) {
    const t = read(rel);
    if (t == null) continue;
    texts.set(rel, t);
    if (!scanned.includes(rel)) scanned.push(rel);
    const j = parseJsonc(t);
    if (!j) { add('low', 'invalid-config', rel, 1, `${rel} is not valid JSON`, 'A config the tool cannot parse may be silently ignored or partially applied.', 'Fix the syntax.'); continue; }
    const map = j[key] || (key === 'mcpServers' ? j.servers : null) || {};
    if (!map || typeof map !== 'object') continue;
    for (const [name, def] of Object.entries(map)) {
      if (!def || typeof def !== 'object') continue;
      const at = lineOf(t, `"${name}"`);
      const args = Array.isArray(def.args) ? def.args.filter((a) => typeof a === 'string') : [];
      const command = typeof def.command === 'string' ? def.command : def.command?.path;
      if (typeof command === 'string') {
        const pkg = runnerPackage(command, args);
        if (pkg && !pkg.local && !pkg.pinned) {
          add('medium', 'unpinned-mcp', rel, lineOf(t, [`"${pkg.spec}"`, pkg.spec], at) ?? at, `MCP server "${name}" runs ${pkg.latest ? `${pkg.spec}` : `unpinned ${pkg.spec}`}`,
            'Every start downloads whatever version is newest: a compromised or hijacked release runs with your permissions and sees your context.',
            `Pin an exact version, e.g. "${pkg.spec.replace(/@[^@/]*$/, '')}@1.2.3", and bump it deliberately.`);
        }
        const full = [command, ...args].join(' ');
        if (PIPE_TO_SHELL.test(full)) add('high', 'remote-script', rel, at, `MCP server "${name}" pipes a download into a shell`, 'Code fetched at start-up is executed unseen.', 'Install the server from a pinned package instead.');
        if (/^docker$/.test(path.basename(command)) && args.includes('run')) {
          const img = args.slice(args.indexOf('run') + 1).find((a, i, arr) => !a.startsWith('-') && !['-e', '--env', '-v', '--volume', '--name', '--network', '-p'].includes(arr[i - 1]));
          if (img && (!/:[\w.-]+$|@sha256:/.test(img) || /:latest$/.test(img))) add('low', 'unpinned-mcp', rel, lineOf(t, img, at) ?? at, `MCP server "${name}" uses image ${img} without a fixed tag`, 'A moving tag can change the server under you.', 'Pin a version tag or digest (@sha256:…).');
        }
      }
      const url = typeof def.url === 'string' ? def.url : typeof def.serverUrl === 'string' ? def.serverUrl : null;
      if (url) {
        let u = null; try { u = new URL(url); } catch { /* placeholder */ }
        if (u && u.protocol === 'http:' && !isLocalHost(u.hostname)) {
          add('high', 'insecure-mcp-url', rel, lineOf(t, url, at) ?? at, `MCP server "${name}" uses plain http to ${u.hostname}`, 'Prompts, file contents and tokens travel unencrypted and can be read or altered in transit.', 'Use https:// (or a local tunnel).');
        } else if (u && /^https?:$/.test(u.protocol) && !isLocalHost(u.hostname)) {
          add('low', 'remote-mcp', rel, lineOf(t, url, at) ?? at, `MCP server "${name}" is remote (${u.hostname})`, 'A remote server receives whatever the agent sends it; make sure you trust the operator.', 'Keep only servers you trust; prefer OAuth over static tokens.');
        }
      }
      for (const [field, obj] of [['env', def.env], ['headers', def.headers]]) {
        if (!obj || typeof obj !== 'object') continue;
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v !== 'string') continue;
          const bearer = /^(Bearer|Basic|token)\s+(\S{12,})$/i.exec(v);
          if ((SECRET_KEY.test(k) && literal(v)) || (bearer && literal(bearer[2]))) {
            const ln = lineOf(t, `"${k}"`, at) ?? at;
            secretLines.add(`${rel}:${ln}`);
            add('high', 'inline-secret', rel, ln, `MCP server "${name}" has an inline ${field} value for ${k} (${maskSecret(bearer ? bearer[2] : v)})`,
              'The credential is committed with the config and visible to every agent and collaborator.', `Use a reference instead, e.g. "${k}": "${bearer ? bearer[1] + ' ' : ''}\${env:${(bearer ? name + '_TOKEN' : k).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}}" (VS Code: \${input:…}).`);
          }
        }
      }
      for (const a of args) {
        const m = /^--?(?:[\w-]*(?:token|key|secret|password))[=:](.{8,})$/i.exec(a);
        if (m && literal(m[1])) { const ln = lineOf(t, a.slice(0, 12), at) ?? at; secretLines.add(`${rel}:${ln}`); add('high', 'inline-secret', rel, ln, `MCP server "${name}" passes a secret on the command line (${maskSecret(m[1])})`, 'Command lines are committed and visible in process lists.', 'Pass it through an environment variable reference.'); }
      }
    }
    secretsIn(rel, t);
  }

  // ---- Claude settings: permissions, bypass modes, hooks
  for (const rel of CLAUDE_SETTINGS) {
    const t = texts.get(rel) ?? read(rel);
    if (t == null) continue;
    if (!scanned.includes(rel)) scanned.push(rel);
    const j = parseJsonc(t);
    if (!j) continue;
    const p = j.permissions && typeof j.permissions === 'object' ? j.permissions : {};
    const mode = p.defaultMode ?? j.defaultMode;
    if (mode === 'bypassPermissions') add('high', 'bypass-permissions', rel, lineOf(t, 'bypassPermissions'), 'Permission prompts are bypassed (defaultMode: bypassPermissions)', 'The agent can run any tool, edit any file and execute any command without asking.', 'Remove defaultMode or use "acceptEdits"/"plan"; allow specific commands instead.');
    for (const k of ['dangerouslySkipPermissions', 'skipDangerousModePermissionPrompt', 'dangerously_skip_permissions']) {
      if (j[k] === true || p[k] === true) add(k.startsWith('skip') ? 'medium' : 'high', 'bypass-permissions', rel, lineOf(t, k), `${k} is enabled`, 'Safety prompts are switched off for everyone using this repo.', `Delete "${k}".`);
    }
    if (j.enableAllProjectMcpServers === true) add('medium', 'auto-approve-mcp', rel, lineOf(t, 'enableAllProjectMcpServers'), 'All MCP servers in .mcp.json are approved automatically', 'A server added to .mcp.json by anyone with commit access starts without review.', 'Remove it and approve servers individually (enabledMcpjsonServers).');
    for (const dir of Array.isArray(p.additionalDirectories) ? p.additionalDirectories : []) {
      if (typeof dir === 'string' && /^(\/|~\/?|\$HOME\/?|[A-Za-z]:\\?)$/.test(dir.trim())) add('medium', 'broad-directory', rel, lineOf(t, JSON.stringify(dir)), `Agent may access ${dir}`, 'Grants the agent the whole home directory or disk.', 'List only the directories it needs.');
    }
    for (const rule of Array.isArray(p.allow) ? p.allow : []) {
      if (typeof rule !== 'string') continue;
      const r = rule.replace(/\s+/g, '');
      const ln = lineOf(t, JSON.stringify(rule));
      if (/^Bash(\((\*|:\*|\*:\*|\*\*)?\))?$/.test(r)) add('high', 'wildcard-allow', rel, ln, `"${rule}" allows every shell command`, 'Any command, including network and destructive ones, runs without a prompt; a prompt-injected agent can exfiltrate or delete data.', 'Allow specific commands instead, e.g. "Bash(npm run test:*)".');
      else if (/^Bash\((curl|wget|sh|bash|zsh|python3?|node|deno|bun|perl|ruby|php|eval|sudo|rm|npx|ssh|scp|nc|xargs|env|pwsh|powershell)(\s|:|\*|\))/.test(r)) add('medium', 'broad-allow', rel, ln, `"${rule}" allows an interpreter, downloader or destructive command`, 'This is effectively arbitrary code execution or data exfiltration without a prompt.', 'Narrow it to the exact command and arguments you need, or move it to "ask".');
      else if (/^(\*|mcp__\*|Write|Edit|WebFetch)$/.test(r) || /^(Write|Edit)\((\*\*|\/\*\*|~\/?\*\*)\)$/.test(r)) add('low', 'broad-allow', rel, ln, `"${rule}" is a blanket allow rule`, 'Broad allow rules remove the review step for a whole tool.', 'Scope it to paths or domains, e.g. "WebFetch(domain:docs.example.com)".');
    }
    const hooks = j.hooks && typeof j.hooks === 'object' ? j.hooks : {};
    for (const [event, groups] of Object.entries(hooks)) {
      for (const g of Array.isArray(groups) ? groups : []) {
        const list = Array.isArray(g?.hooks) ? g.hooks : g?.command ? [g] : [];
        for (const h of list) if (typeof h?.command === 'string') checkHook(rel, t, event, h.command, add);
      }
    }
    secretsIn(rel, t);
  }

  // ---- Codex
  const ct = read(CODEX);
  if (ct != null) {
    scanned.push(CODEX);
    let c = {};
    try { c = parseSimpleToml(ct); } catch { /* ignore */ }
    const profiles = [c, ...Object.values(c.profiles || {})];
    for (const pr of profiles) {
      if (pr.sandbox_mode === 'danger-full-access') add('high', 'bypass-permissions', CODEX, lineOf(ct, 'danger-full-access'), 'Codex sandbox is disabled (sandbox_mode = "danger-full-access")', 'Commands run with full disk and network access.', 'Use "workspace-write" (or "read-only").');
      if (pr.approval_policy === 'never') add(pr.sandbox_mode === 'danger-full-access' ? 'high' : 'medium', 'bypass-permissions', CODEX, lineOf(ct, 'approval_policy'), 'Codex never asks for approval (approval_policy = "never")', 'Commands run without review.', 'Use "on-request" or "untrusted".');
    }
    if (c.sandbox_workspace_write?.network_access === true) add('low', 'network-access', CODEX, lineOf(ct, 'network_access'), 'Codex sandbox allows network access', 'Commands can reach the internet from the workspace sandbox.', 'Disable network_access unless needed.');
    for (const [name, def] of Object.entries(c.mcp_servers || {})) {
      if (!def || typeof def !== 'object') continue;
      const pkg = typeof def.command === 'string' ? runnerPackage(def.command, Array.isArray(def.args) ? def.args : []) : null;
      if (pkg && !pkg.local && !pkg.pinned) add('medium', 'unpinned-mcp', CODEX, lineOf(ct, pkg.spec) ?? lineOf(ct, name), `MCP server "${name}" runs unpinned ${pkg.spec}`, 'Every start downloads whatever version is newest.', 'Pin an exact version.');
      for (const [k, v] of Object.entries(def.env || {})) if (SECRET_KEY.test(k) && literal(v)) { const ln = lineOf(ct, k); secretLines.add(`${CODEX}:${ln}`); add('high', 'inline-secret', CODEX, ln, `MCP server "${name}" has an inline env value for ${k} (${maskSecret(v)})`, 'The credential is committed with the config.', 'Use env_vars / a shell environment variable instead.'); }
    }
    secretsIn(CODEX, ct);
  }

  // ---- world-writable config/context files (POSIX only)
  if (process.platform !== 'win32') {
    const ctx = files.filter((f) => CONTEXT_KINDS.has(f.kind)).map((f) => f.path);
    for (const rel of [...new Set([...scanned, ...ctx])]) {
      let st; try { st = fs.statSync(path.join(absRoot, rel)); } catch { continue; }
      if (st.mode & 0o002) add(scanned.includes(rel) ? 'high' : 'medium', 'world-writable', rel, null, `${rel} is world-writable`, 'Any local user or process can change what your agents are told or allowed to run.', `chmod o-w ${rel}`);
    }
  }

  // ---- secrets in context files (same scanner as the "secret" lint rule)
  for (const f of files) {
    if (!CONTEXT_KINDS.has(f.kind)) continue;
    const t = contents.get(f.path);
    if (typeof t === 'string') secretsIn(f.path, t);
  }

  const rank = { high: 0, medium: 1, low: 2, info: 3 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.file.localeCompare(b.file) || (a.line || 0) - (b.line || 0));
  const counts = { high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  const score = riskScore(findings);
  return { score, level: counts.high ? 'high' : score >= 25 ? 'medium' : score > 0 ? 'low' : 'none', counts, findings, scanned };
}

function checkHook(rel, text, event, command, add) {
  const ln = lineOf(text, JSON.stringify(command).slice(1, 40)) ?? lineOf(text, '"hooks"');
  const short = command.length > 80 ? command.slice(0, 77) + '…' : command;
  if (PIPE_TO_SHELL.test(command)) { add('high', 'remote-script', rel, ln, `${event} hook pipes a download into a shell: ${short}`, 'The hook runs code fetched from the network on every trigger, unseen.', 'Vendor the script into the repo (reviewed) or install a pinned tool.'); return; }
  if (DESTRUCTIVE.test(command)) { add('high', 'destructive-hook', rel, ln, `${event} hook runs a destructive command: ${short}`, 'It can wipe the home directory or disk.', 'Remove it.'); return; }
  if (DOWNLOAD.test(command)) add('medium', 'remote-script', rel, ln, `${event} hook downloads from the network: ${short}`, 'A hook that fetches remote content can change behaviour without a commit.', 'Pin and vendor what it downloads, or remove it.');
  const pkg = runnerPackage(command.split(/\s+/)[0], command.split(/\s+/).slice(1));
  if (pkg && !pkg.local && !pkg.pinned && (pkg.latest || /\s(-y|--yes)\b/.test(command))) add('low', 'unpinned-hook', rel, ln, `${event} hook runs unpinned ${pkg.spec}`, 'Each run may fetch a different version.', 'Use the project-installed binary or pin a version.');
}
