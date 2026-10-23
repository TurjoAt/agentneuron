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
  allowWrite: false,
};

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
