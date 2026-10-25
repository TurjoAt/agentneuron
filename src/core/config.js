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

/**
 * Projects initialised before the rename keep their data in <root>/.mdctl/.
 * Move it to <root>/.agentneuron/ once, so history and config carry over.
 */
export function migrateLegacyDir(root) {
  const absRoot = path.resolve(root);
  const legacy = path.join(absRoot, '.mdctl');
  const dir = path.join(absRoot, '.agentneuron');
  try {
    if (!fs.existsSync(dir) && fs.statSync(legacy).isDirectory()) {
      fs.renameSync(legacy, dir);
      return true;
    }
  } catch { /* no legacy dir, or not movable: start fresh */ }
  return false;
}

/** Resolve config: defaults < <root>/.agentneuron/config.json < overrides. */
export function loadConfig(root, overrides = {}) {
  const absRoot = path.resolve(root);
  migrateLegacyDir(absRoot);
  let fileCfg = {};
  let configWarning = null;
  let raw = null;
  try { raw = fs.readFileSync(path.join(absRoot, '.agentneuron', 'config.json'), 'utf8'); } catch { /* no config file: defaults */ }
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) fileCfg = parsed;
      else configWarning = '.agentneuron/config.json must be a JSON object; ignoring it and using defaults';
    } catch (e) { configWarning = `.agentneuron/config.json is not valid JSON (${e.message}); ignoring it and using defaults`; }
  }

  const clean = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined));
  const cfg = { ...DEFAULTS, ...clean(fileCfg), ...clean(overrides), root: absRoot };
  cfg.actions = normalizeActions({ ...(fileCfg.actions || {}), ...(overrides.actions || {}) });
  if (cfg.allowWrite === true) cfg.actions.edit = true;
  cfg.configWarning = configWarning;
  // levels a (possibly cloned) project file turns on that can run commands or destroy data
  const fa = normalizeActions(fileCfg.actions);
  cfg.fileEnabled = ['exec', 'danger', 'terminal'].filter((l) => fa[l] && cfg.actions[l]);
  const n = cfg.notifications && typeof cfg.notifications === 'object' ? cfg.notifications : {};
  cfg.notifications = { browser: n.browser !== false, allowPrivate: n.allowPrivate === true, webhooks: Array.isArray(n.webhooks) ? n.webhooks.filter((w) => w && typeof w.url === 'string') : [] };
  if (!cfg.pricing || typeof cfg.pricing !== 'object') cfg.pricing = {};
  if (!Array.isArray(cfg.ignore)) cfg.ignore = [];
  if (!Array.isArray(cfg.extraPatterns)) cfg.extraPatterns = [];
  return cfg;
}

/** Create <root>/.agentneuron/ with a .gitignore for generated data. Returns the dir. */
export function ensureAgentneuronDir(root) {
  migrateLegacyDir(root);
  const dir = path.join(path.resolve(root), '.agentneuron');
  fs.mkdirSync(dir, { recursive: true });
  const gi = path.join(dir, '.gitignore');
  try { fs.writeFileSync(gi, 'history/\ncache/\n*.bak\n', { flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  return dir;
}
