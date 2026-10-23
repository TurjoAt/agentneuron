// Shared helpers for the Agents context center.
import { TOOLS } from '../../lib/tools.js';

export const CAPS = [
  { id: 'instructions', label: 'Instructions', icon: 'file' },
  { id: 'rules', label: 'Rules', icon: 'flag' },
  { id: 'mcp', label: 'MCP', icon: 'server' },
  { id: 'hooks', label: 'Hooks', icon: 'hook' },
  { id: 'permissions', label: 'Permissions', icon: 'shield' },
  { id: 'agents', label: 'Agents', icon: 'agents' },
  { id: 'skills', label: 'Skills', icon: 'sparkles' },
  { id: 'commands', label: 'Commands', icon: 'terminal' },
  { id: 'ignore', label: 'Ignore', icon: 'eye' },
];
export const CAP_LABEL = Object.fromEntries(CAPS.map((c) => [c.id, c.label]));

/** CSS var-safe tool id (falls back to generic accent). */
export const toolKey = (id) => (TOOLS[id] ? id : 'generic');

/** Template to offer when a tool lacks a capability (null = no template). */
const TPL = {
  'claude:instructions': 'claude-md',
  'claude:agents': 'claude-agent',
  'claude:skills': 'claude-skill',
  'claude:commands': 'slash-command',
  'codex:instructions': 'agents-md',
  'gemini:instructions': 'gemini-md',
  'cursor:rules': 'cursor-rule',
  'copilot:instructions': 'copilot-instructions',
  'copilot:rules': 'copilot-instructions',
};
export const templateFor = (tool, cap) => TPL[`${tool}:${cap}`] || null;

/** Main file behind a capability item (path / source). */
export const itemPath = (it) => it?.path || it?.source || null;

export const capCount = (t, c) => t?.capabilities?.[c]?.count ?? 0;
export const capItems = (t, c) => t?.capabilities?.[c]?.items ?? [];

/** Normalise similarity to 0..100 (real server: percent, mock: fraction). */
export const pct = (s) => (s == null ? 0 : s <= 1 ? Math.round(s * 100) : Math.round(s));

export const permKind = (p) => p.kind || p.mode || 'allow';

/** lineDiff result → flat hunk array (server returns { hunks }, some mocks an array). */
export const hunksOf = (d) => (Array.isArray(d) ? d : Array.isArray(d?.hunks) ? d.hunks : []);
