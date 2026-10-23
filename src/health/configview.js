import fs from 'node:fs';
import path from 'node:path';
import { maskSecretsInText } from './secrets.js';

function readText(root, rel) {
  try {
    const abs = path.join(root, rel);
    // lstat + realpath of the parent: neither a symlinked file nor a symlinked directory may lead outside the project
    const st = fs.lstatSync(abs);
    if (!st.isFile() || st.size > 2 * 1024 * 1024) return null;
    const rr = fs.realpathSync(root), rd = fs.realpathSync(path.dirname(abs));
    if (rd !== rr && !rd.startsWith(rr + path.sep)) return null;
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

function readJson(root, rel) {
  const t = readText(root, rel);
  if (t == null) return null;
  try {
    const v = JSON.parse(t.replace(/^﻿/, ''));
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

const str = (v) => (typeof v === 'string' ? maskSecretsInText(v) : undefined);

function serverFromObject(name, def, source) {
  if (!def || typeof def !== 'object') return null;
  const s = { name, source, type: typeof def.type === 'string' ? def.type : def.url ? 'http' : 'stdio' };
  if (def.command !== undefined) s.command = str([def.command, ...(Array.isArray(def.args) ? def.args : [])].filter((x) => typeof x === 'string').join(' '));
  const url = str(def.url || def.serverUrl);
  if (url) s.url = url;
  // keys only: values are never exposed
  if (def.env && typeof def.env === 'object') s.envKeys = Object.keys(def.env);
  if (def.headers && typeof def.headers === 'object') s.headerKeys = Object.keys(def.headers);
  return s;
}

/** Minimal TOML reader: tables + simple string/array/bool values. */
export function parseSimpleToml(text) {
  const root = {};
  let cur = root;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s+|\s+$/g, '');
    if (!line || line.startsWith('#')) continue;
    const t = /^\[\[?([^\]]+)\]\]?$/.exec(line);
    if (t) {
      cur = root;
      for (const part of splitKey(t[1])) {
        if (typeof cur[part] !== 'object' || cur[part] === null) cur[part] = {};
        cur = cur[part];
      }
      continue;
    }
    const kv = /^("[^"]+"|[A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    cur[kv[1].replace(/^"|"$/g, '')] = parseTomlValue(kv[2]);
  }
  return root;
}

function splitKey(k) {
  const parts = [];
  const re = /"([^"]*)"|([^.\s]+)/g;
  let m;
  while ((m = re.exec(k))) parts.push(m[1] ?? m[2]);
  return parts;
}

function parseTomlValue(v) {
  v = v.trim();
  if (v.startsWith('[')) {
    const items = [];
    const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'/g;
    let m;
    while ((m = re.exec(v))) items.push(m[1] ?? m[2]);
    return items;
  }
  if (v.startsWith('{')) {
    const o = {};
    const re = /([A-Za-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^,}\s]+))/g;
    let m;
    while ((m = re.exec(v))) o[m[1]] = m[2] ?? m[3] ?? m[4];
    return o;
  }
  const q = /^"((?:[^"\\]|\\.)*)"|^'([^']*)'/.exec(v);
  if (q) return q[1] ?? q[2];
  const bare = v.replace(/\s+#.*$/, '');
  if (bare === 'true') return true;
  if (bare === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(bare)) return Number(bare);
  return bare;
}

/**
 * Read agent configuration (MCP servers, hooks, permissions). Secrets are never returned.
 */
export function readAgentConfig(root) {
  const mcpServers = [];
  const hooks = [];
  const permissions = { allow: [], deny: [], ask: [], source: '' };
  const settingsFiles = [];
  const permSources = [];

  for (const rel of ['.mcp.json', '.cursor/mcp.json']) {
    const j = readJson(root, rel);
    if (!j) continue;
    settingsFiles.push(rel);
    const servers = j.mcpServers || j.servers || {};
    for (const [name, def] of Object.entries(servers)) {
      const s = serverFromObject(name, def, rel);
      if (s) mcpServers.push(s);
    }
  }

  for (const rel of ['.claude/settings.json', '.claude/settings.local.json']) {
    const j = readJson(root, rel);
    if (!j) continue;
    settingsFiles.push(rel);
    for (const [name, def] of Object.entries(j.mcpServers || {})) {
      const s = serverFromObject(name, def, rel);
      if (s) mcpServers.push(s);
    }
    if (j.hooks && typeof j.hooks === 'object') {
      for (const [event, groups] of Object.entries(j.hooks)) {
        for (const g of Array.isArray(groups) ? groups : []) {
          const list = Array.isArray(g?.hooks) ? g.hooks : g?.command ? [g] : [];
          for (const h of list) {
            if (typeof h?.command !== 'string') continue;
            const e = { event, command: maskSecretsInText(h.command), source: rel };
            if (g.matcher) e.matcher = String(g.matcher);
            hooks.push(e);
          }
        }
      }
    }
    const p = j.permissions;
    if (p && typeof p === 'object') {
      permSources.push(rel);
      for (const k of ['allow', 'deny', 'ask']) {
        for (const v of Array.isArray(p[k]) ? p[k] : []) {
          if (typeof v === 'string') permissions[k].push(maskSecretsInText(v));
        }
      }
    }
  }
  permissions.source = permSources.join(', ');

  const toml = readText(root, '.codex/config.toml');
  if (toml != null) {
    settingsFiles.push('.codex/config.toml');
    try {
      const t = parseSimpleToml(toml);
      for (const [name, def] of Object.entries(t.mcp_servers || {})) {
        const s = serverFromObject(name, def, '.codex/config.toml');
        if (s) mcpServers.push(s);
      }
    } catch { /* ignore malformed toml */ }
  }

  return { mcpServers, hooks, permissions, settingsFiles };
}
