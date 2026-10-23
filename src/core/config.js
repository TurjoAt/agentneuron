import fs from 'node:fs';
import path from 'node:path';

export const DEFAULTS = {
  port: 4747,
  host: '127.0.0.1',
  token: null,
  ignore: [],
  extraPatterns: [],
  includeAllMarkdown: true,
  maxFileSize: 1048576,
  historyLimitPerFile: 200,
  openBrowser: false,
  allowWrite: false, // legacy alias for actions.edit
  adminToken: null,
  actions: { edit: false, exec: false, danger: false, terminal: false },
  notifications: { webhooks: [], browser: true },
  pricing: {},
  workspaceRoot: null,
};

export const ACTION_LEVELS = ['edit', 'exec', 'danger', 'terminal'];

/** Normalise an `actions` object: only strict `true` enables a level. */
export function normalizeActions(a) {
  const out = { edit: false, exec: false, danger: false, terminal: false };
  if (a && typeof a === 'object') for (const k of ACTION_LEVELS) out[k] = a[k] === true;
  return out;
}

/** Parse "edit,exec" into a list; throws on unknown levels. */
export function parseEnable(list) {
  const out = [];
  for (const part of String(list === true ? '' : list || '').split(',')) {
    const l = part.trim().toLowerCase();
    if (!l) continue;
    if (!ACTION_LEVELS.includes(l)) throw new Error(`unknown level "${l}" (valid: ${ACTION_LEVELS.join(', ')})`);
    out.push(l);
  }
  return out;
}

/** Resolve config: defaults < <root>/.mdctl/config.json < overrides. */
export function loadConfig(root, overrides = {}) {
  const absRoot = path.resolve(root);
  let fileCfg = {};
  try {
    const raw = fs.readFileSync(path.join(absRoot, '.mdctl', 'config.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) fileCfg = parsed;
  } catch { /* missing or invalid config: use defaults */ }

  const clean = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined));
  const cfg = { ...DEFAULTS, ...clean(fileCfg), ...clean(overrides), root: absRoot };
  cfg.actions = normalizeActions({ ...(fileCfg.actions || {}), ...(overrides.actions || {}) });
  if (cfg.allowWrite === true) cfg.actions.edit = true;
  const n = cfg.notifications && typeof cfg.notifications === 'object' ? cfg.notifications : {};
  cfg.notifications = { browser: n.browser !== false, webhooks: Array.isArray(n.webhooks) ? n.webhooks.filter((w) => w && typeof w.url === 'string') : [] };
  if (!cfg.pricing || typeof cfg.pricing !== 'object') cfg.pricing = {};
  if (!Array.isArray(cfg.ignore)) cfg.ignore = [];
  if (!Array.isArray(cfg.extraPatterns)) cfg.extraPatterns = [];
  return cfg;
}

/** Create <root>/.mdctl/ with a .gitignore for generated data. Returns the dir. */
export function ensureMdctlDir(root) {
  const dir = path.join(path.resolve(root), '.mdctl');
  fs.mkdirSync(dir, { recursive: true });
  const gi = path.join(dir, '.gitignore');
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, 'history/\ncache/\n');
  return dir;
}
