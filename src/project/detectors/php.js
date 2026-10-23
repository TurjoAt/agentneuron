import { stack, cleanVersion, hasBinary } from '../util.js';
import { laravelRoutes, laravelMigrations, laravelModels } from '../laravel.js';

const REQ = [
  ['laravel/framework', 'laravel', 'Laravel', 'framework'], ['symfony/framework-bundle', 'symfony', 'Symfony', 'framework'], ['symfony/symfony', 'symfony', 'Symfony', 'framework'],
  ['livewire/livewire', 'livewire', 'Livewire', 'framework'], ['inertiajs/inertia-laravel', 'inertia', 'Inertia', 'framework'],
  ['filament/filament', 'filament', 'Filament', 'framework'], ['laravel/breeze', 'breeze', 'Laravel Breeze', 'tool'], ['laravel/sanctum', 'sanctum', 'Sanctum', 'tool'],
  ['laravel/horizon', 'horizon', 'Horizon', 'tool'], ['laravel/pint', 'pint', 'Pint', 'tool'],
  ['phpunit/phpunit', 'phpunit', 'PHPUnit', 'testing'], ['pestphp/pest', 'pest', 'Pest', 'testing'],
  ['doctrine/orm', 'doctrine', 'Doctrine', 'db'], ['slim/slim', 'slim', 'Slim', 'framework'], ['phpstan/phpstan', 'phpstan', 'PHPStan', 'tool'],
];

export default {
  id: 'php',
  async detect(root, idx) {
    const paths = idx.find((p) => /(^|\/)composer\.json$/.test(p) && p.split('/').length <= 3);
    if (!paths.length) return {};
    const res = { stacks: [], manifests: [], packageManagers: [], scripts: [], framework: {} };
    const lock = idx.has('composer.lock') ? await idx.readJson('composer.lock') : null;
    const locked = new Map();
    for (const pk of [...(lock?.packages || []), ...(lock?.['packages-dev'] || [])]) locked.set(pk.name, String(pk.version || '').replace(/^v/, ''));
    res.packageManagers.push({ id: 'composer', lockfile: lock ? 'composer.lock' : null, manifest: 'composer.json', available: hasBinary('composer') });
    const seen = new Set();
    for (const p of paths.sort()) {
      const c = p === 'composer.json' ? await idx.readJson(p) : await idx.readJson(p);
      if (!c) continue;
      const deps = [];
      for (const [k, dev] of [['require', false], ['require-dev', true]]) {
        for (const [name, version] of Object.entries(c[k] || {})) deps.push({ name, version: String(version), dev, manager: 'composer' });
      }
      const scripts = {};
      for (const [n, v] of Object.entries(c.scripts || {})) scripts[n] = Array.isArray(v) ? v.join(' && ') : String(v);
      res.manifests.push({ path: p, type: 'composer', name: c.name || null, version: c.version || null, scripts, deps });
      for (const [name, command] of Object.entries(scripts)) res.scripts.push({ manager: 'composer', name, command, source: p });
      if (p === 'composer.json') { res.name = c.name; res.description = c.description; res.version = c.version; }
      for (const d of deps) {
        if (d.name === 'php' && p === 'composer.json') {
          res.stacks.push(stack('php', 'PHP', 'language', { version: cleanVersion(d.version), confidence: 0.95, source: 'composer.json require.php' }));
          continue;
        }
        for (const [dep, id, nm, cat] of REQ) {
          if (d.name !== dep || seen.has(id)) continue;
          seen.add(id);
          res.stacks.push(stack(id, nm, cat, { version: locked.get(dep) || cleanVersion(d.version), confidence: 0.98, source: `${p} ${d.dev ? 'require-dev' : 'require'}` }));
        }
      }
    }
    if (!res.stacks.some((s) => s.id === 'php')) res.stacks.push(stack('php', 'PHP', 'language', { confidence: 0.8, source: 'composer.json' }));
    res.stacks.push(stack('composer', 'Composer', 'tool', { confidence: 0.9, source: lock ? 'composer.lock' : 'composer.json' }));
    const isLaravel = seen.has('laravel') || (idx.has('artisan') && idx.dirExists('bootstrap'));
    if (isLaravel) {
      if (!seen.has('laravel')) res.stacks.push(stack('laravel', 'Laravel', 'framework', { confidence: 0.7, source: 'artisan' }));
      const lv = res.stacks.find((s) => s.id === 'laravel')?.version || null;
      let routes = [], migrations = [], models = [];
      try { routes = await laravelRoutes(root); } catch { /* ignore */ }
      try { migrations = await laravelMigrations(root); } catch { /* ignore */ }
      try { models = await laravelModels(root); } catch { /* ignore */ }
      res.framework.laravel = { version: lv, routes: routes.length, migrations: migrations.length, models: models.length, providers: idx.find((p) => /^app\/Providers\/[^/]+\.php$/.test(p)).length };
    }
    if (seen.has('symfony')) res.framework.symfony = { version: res.stacks.find((s) => s.id === 'symfony')?.version || null };
    return res;
  },
};
