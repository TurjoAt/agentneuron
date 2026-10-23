// Python, Go, Rust, Ruby, Java, .NET, Deno detectors.
import { stack, cleanVersion, hasBinary, parseToml } from '../util.js';

const pyName = (s) => String(s).split(/[\s<>=!~;[(]/)[0].toLowerCase();
const pyVer = (s) => { const m = /(?:==|~=|>=|<=|>|<)\s*([\w.*]+)/.exec(String(s)); return m ? m[1] : null; };

export const python = {
  id: 'python',
  async detect(root, idx) {
    const reqFiles = idx.find((p) => /^requirements[\w.-]*\.txt$/.test(p) || /^requirements\/[\w.-]+\.txt$/.test(p));
    const hasPy = idx.has('pyproject.toml');
    if (!hasPy && !reqFiles.length && !idx.has('Pipfile') && !idx.has('setup.py')) return {};
    const res = { stacks: [], manifests: [], packageManagers: [], scripts: [], framework: {} };
    const deps = []; let name = null, version = null, description = null, pyreq = null; let poetry = false;
    if (hasPy) {
      const t = parseToml((await idx.read('pyproject.toml')) || '');
      const proj = t.project || t.tool?.poetry || {};
      name = proj.name || null; version = proj.version || null; description = proj.description || null;
      pyreq = t.project?.['requires-python'] || t.tool?.poetry?.dependencies?.python || null;
      poetry = !!t.tool?.poetry;
      for (const d of t.project?.dependencies || []) deps.push({ name: pyName(d), version: pyVer(d) || '*', dev: false, manager: poetry ? 'poetry' : 'pip' });
      for (const list of Object.values(t.project?.['optional-dependencies'] || {})) for (const d of list) deps.push({ name: pyName(d), version: pyVer(d) || '*', dev: true, manager: poetry ? 'poetry' : 'pip' });
      for (const [g, dev] of [['dependencies', false], ['dev-dependencies', true]]) {
        for (const [n, v] of Object.entries(t.tool?.poetry?.[g] || {})) if (n !== 'python') deps.push({ name: n.toLowerCase(), version: typeof v === 'string' ? v : v?.version || '*', dev, manager: 'poetry' });
      }
      for (const [n, v] of Object.entries(t.tool?.poetry?.group?.dev?.dependencies || {})) deps.push({ name: n.toLowerCase(), version: typeof v === 'string' ? v : v?.version || '*', dev: true, manager: 'poetry' });
      if (t['dependency-groups']) for (const list of Object.values(t['dependency-groups'])) for (const d of list) if (typeof d === 'string') deps.push({ name: pyName(d), version: pyVer(d) || '*', dev: true, manager: 'pip' });
    }
    for (const rf of reqFiles) {
      const txt = (await idx.read(rf)) || '';
      for (const line of txt.split(/\r?\n/)) {
        const l = line.split('#')[0].trim();
        if (!l || l.startsWith('-')) continue;
        deps.push({ name: pyName(l), version: pyVer(l) || '*', dev: /dev|test/.test(rf), manager: 'pip' });
      }
    }
    const mpath = hasPy ? 'pyproject.toml' : reqFiles[0] || (idx.has('Pipfile') ? 'Pipfile' : 'setup.py');
    res.manifests.push({ path: mpath, type: 'python', name, version, scripts: {}, deps });
    if (idx.has('uv.lock')) res.packageManagers.push({ id: 'uv', lockfile: 'uv.lock', manifest: 'pyproject.toml', available: hasBinary('uv') });
    if (poetry || idx.has('poetry.lock')) res.packageManagers.push({ id: 'poetry', lockfile: idx.has('poetry.lock') ? 'poetry.lock' : null, manifest: 'pyproject.toml', available: hasBinary('poetry') });
    if (reqFiles.length || (!poetry && !idx.has('uv.lock'))) res.packageManagers.push({ id: 'pip', lockfile: null, manifest: reqFiles[0] || mpath, available: hasBinary('pip') || hasBinary('pip3') });
    if (idx.has('Pipfile')) res.packageManagers.push({ id: 'pipenv', lockfile: idx.has('Pipfile.lock') ? 'Pipfile.lock' : null, manifest: 'Pipfile', available: hasBinary('pipenv') });
    res.stacks.push(stack('python', 'Python', 'language', { version: cleanVersion(pyreq), confidence: 0.95, source: mpath }));
    if (hasPy && !deps.some((d) => d.name === 'ruff') && /\[tool\.ruff/.test((await idx.read('pyproject.toml')) || '')) deps.push({ name: 'ruff', version: '*', dev: true, manager: 'pip' });
    const find = (n) => deps.find((d) => d.name === n);
    for (const [dep, id, nm, cat] of [['django', 'django', 'Django', 'framework'], ['flask', 'flask', 'Flask', 'framework'], ['fastapi', 'fastapi', 'FastAPI', 'framework'],
      ['pytest', 'pytest', 'pytest', 'testing'], ['sqlalchemy', 'sqlalchemy', 'SQLAlchemy', 'db'], ['celery', 'celery', 'Celery', 'tool'], ['anthropic', 'anthropic-sdk', 'Anthropic SDK', 'ai'], ['openai', 'openai-sdk', 'OpenAI SDK', 'ai'], ['ruff', 'ruff', 'Ruff', 'tool']]) {
      const d = find(dep);
      if (d) res.stacks.push(stack(id, nm, cat, { version: d.version !== '*' ? cleanVersion(d.version) : null, confidence: 0.95, source: mpath }));
      else if (dep === 'django' && idx.has('manage.py')) res.stacks.push(stack('django', 'Django', 'framework', { confidence: 0.7, source: 'manage.py' }));
    }
    for (const id of ['django', 'flask', 'fastapi']) { const s = res.stacks.find((x) => x.id === id); if (s) res.framework[id] = { version: s.version }; }
    if (name) { res.name = name; res.description = description; res.version = version; }
    return res;
  },
};

export const go = {
  id: 'go',
  async detect(root, idx) {
    if (!idx.has('go.mod')) return {};
    const t = (await idx.read('go.mod')) || '';
    const mod = /^module\s+(\S+)/m.exec(t)?.[1] || null;
    const gv = /^go\s+(\S+)/m.exec(t)?.[1] || null;
    const deps = [];
    const block = /require\s*\(([\s\S]*?)\)/g; let m;
    const lines = [];
    while ((m = block.exec(t))) lines.push(...m[1].split('\n'));
    for (const l of t.split('\n')) if (/^require\s+\S+\s+v/.test(l)) lines.push(l.replace(/^require\s+/, ''));
    for (const l of lines) {
      const mm = /^\s*(\S+)\s+(v\S+)(\s*\/\/\s*indirect)?/.exec(l);
      if (mm) deps.push({ name: mm[1], version: mm[2], dev: !!mm[3], manager: 'go' });
    }
    const res = {
      stacks: [stack('go', 'Go', 'language', { version: gv, confidence: 0.98, source: 'go.mod' })],
      manifests: [{ path: 'go.mod', type: 'go', name: mod, version: null, scripts: {}, deps }],
      packageManagers: [{ id: 'go', lockfile: idx.has('go.sum') ? 'go.sum' : null, manifest: 'go.mod', available: hasBinary('go') }], scripts: [], framework: {},
    };
    for (const [pre, id, nm] of [['github.com/gin-gonic/gin', 'gin', 'Gin'], ['github.com/labstack/echo', 'echo', 'Echo'], ['github.com/gofiber/fiber', 'fiber', 'Fiber'], ['github.com/spf13/cobra', 'cobra', 'Cobra']]) {
      const d = deps.find((x) => x.name.startsWith(pre));
      if (d) res.stacks.push(stack(id, nm, 'framework', { version: cleanVersion(d.version), confidence: 0.9, source: 'go.mod' }));
    }
    res.name = mod;
    return res;
  },
};

export const rust = {
  id: 'rust',
  async detect(root, idx) {
    if (!idx.has('Cargo.toml')) return {};
    const t = parseToml((await idx.read('Cargo.toml')) || '');
    const deps = [];
    for (const [k, dev] of [['dependencies', false], ['dev-dependencies', true], ['build-dependencies', true]]) {
      for (const [n, v] of Object.entries(t[k] || {})) deps.push({ name: n, version: typeof v === 'string' ? v : v?.version || '*', dev, manager: 'cargo' });
    }
    const res = {
      stacks: [stack('rust', 'Rust', 'language', { version: t.package?.['rust-version'] || t.package?.edition || null, confidence: 0.98, source: 'Cargo.toml' })],
      manifests: [{ path: 'Cargo.toml', type: 'cargo', name: t.package?.name || null, version: t.package?.version || null, scripts: {}, deps }],
      packageManagers: [{ id: 'cargo', lockfile: idx.has('Cargo.lock') ? 'Cargo.lock' : null, manifest: 'Cargo.toml', available: hasBinary('cargo') }], scripts: [], framework: {},
    };
    for (const [dep, id, nm] of [['axum', 'axum', 'Axum'], ['actix-web', 'actix', 'Actix'], ['rocket', 'rocket', 'Rocket'], ['tokio', 'tokio', 'Tokio'], ['tauri', 'tauri', 'Tauri']]) {
      const d = deps.find((x) => x.name === dep);
      if (d) res.stacks.push(stack(id, nm, 'framework', { version: cleanVersion(d.version), confidence: 0.9, source: 'Cargo.toml' }));
    }
    if (t.package) { res.name = t.package.name; res.description = t.package.description; res.version = t.package.version; }
    return res;
  },
};

export const ruby = {
  id: 'ruby',
  async detect(root, idx) {
    if (!idx.has('Gemfile')) return {};
    const t = (await idx.read('Gemfile')) || '';
    const lock = (await idx.read('Gemfile.lock')) || '';
    const deps = [];
    for (const l of t.split('\n')) {
      const m = /^\s*gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/.exec(l);
      if (m) deps.push({ name: m[1], version: m[2] || '*', dev: false, manager: 'bundler' });
    }
    const lockedVer = (n) => new RegExp(`^    ${n} \\(([^)]+)\\)`, 'm').exec(lock)?.[1] || null;
    const rv = /^ruby\s+['"]([^'"]+)['"]/m.exec(t)?.[1] || null;
    const res = {
      stacks: [stack('ruby', 'Ruby', 'language', { version: rv, confidence: 0.95, source: 'Gemfile' })],
      manifests: [{ path: 'Gemfile', type: 'ruby', name: null, version: null, scripts: {}, deps }],
      packageManagers: [{ id: 'bundler', lockfile: idx.has('Gemfile.lock') ? 'Gemfile.lock' : null, manifest: 'Gemfile', available: hasBinary('bundle') }], scripts: [], framework: {},
    };
    if (deps.some((d) => d.name === 'rails')) {
      const v = lockedVer('rails') || cleanVersion(deps.find((d) => d.name === 'rails').version);
      res.stacks.push(stack('rails', 'Ruby on Rails', 'framework', { version: v, confidence: 0.98, source: 'Gemfile' }));
      res.framework.rails = { version: v };
    }
    if (deps.some((d) => d.name === 'rspec' || d.name === 'rspec-rails')) res.stacks.push(stack('rspec', 'RSpec', 'testing', { confidence: 0.9, source: 'Gemfile' }));
    return res;
  },
};

export const java = {
  id: 'java',
  async detect(root, idx) {
    const hasPom = idx.has('pom.xml');
    const grad = ['build.gradle', 'build.gradle.kts'].find((f) => idx.has(f));
    if (!hasPom && !grad) return {};
    const res = { stacks: [stack('java', 'Java', 'language', { confidence: 0.85, source: hasPom ? 'pom.xml' : grad })], manifests: [], packageManagers: [], scripts: [], framework: {} };
    const deps = []; let name = null, version = null;
    if (hasPom) {
      const t = (await idx.read('pom.xml')) || '';
      const noParent = t.replace(/<parent>[\s\S]*?<\/parent>/, '').replace(/<dependencies>[\s\S]*?<\/dependencies>/g, '');
      name = /<artifactId>([^<]+)<\/artifactId>/.exec(noParent)?.[1] || null;
      version = /<version>([^<]+)<\/version>/.exec(noParent)?.[1] || null;
      const jv = /<(?:java\.version|maven\.compiler\.(?:source|release))>([^<]+)</.exec(t)?.[1];
      if (jv) res.stacks[0].version = jv;
      const re = /<dependency>([\s\S]*?)<\/dependency>/g; let m;
      while ((m = re.exec(t))) {
        const g = /<groupId>([^<]+)</.exec(m[1])?.[1]; const a = /<artifactId>([^<]+)</.exec(m[1])?.[1];
        if (g && a) deps.push({ name: `${g}:${a}`, version: /<version>([^<]+)</.exec(m[1])?.[1] || '*', dev: /<scope>test/.test(m[1]), manager: 'maven' });
      }
      const sb = /<parent>[\s\S]*?spring-boot-starter-parent[\s\S]*?<version>([^<]+)</.exec(t)?.[1];
      if (sb) res.stacks.push(stack('spring', 'Spring Boot', 'framework', { version: sb, confidence: 0.98, source: 'pom.xml' }));
      res.manifests.push({ path: 'pom.xml', type: 'maven', name, version, scripts: {}, deps });
      res.packageManagers.push({ id: 'maven', lockfile: null, manifest: 'pom.xml', available: hasBinary('mvn') || idx.has('mvnw') });
    }
    if (grad) {
      const t = (await idx.read(grad)) || '';
      const gd = [];
      const re = /(implementation|api|compileOnly|runtimeOnly|testImplementation|classpath)\s*\(?\s*['"]([^'":]+):([^'":]+)(?::([^'"]+))?['"]/g; let m;
      while ((m = re.exec(t))) gd.push({ name: `${m[2]}:${m[3]}`, version: m[4] || '*', dev: /^test/.test(m[1]), manager: 'gradle' });
      if (/org\.springframework\.boot/.test(t) && !res.stacks.some((s) => s.id === 'spring')) res.stacks.push(stack('spring', 'Spring Boot', 'framework', { version: /org\.springframework\.boot['"]?\)?\s*(?:version)?\s*['"]([\d.]+)/.exec(t)?.[1] || null, confidence: 0.9, source: grad }));
      if (/kotlin/.test(t)) res.stacks.push(stack('kotlin', 'Kotlin', 'language', { confidence: 0.8, source: grad }));
      res.manifests.push({ path: grad, type: 'gradle', name: null, version: null, scripts: {}, deps: gd });
      res.packageManagers.push({ id: 'gradle', lockfile: idx.has('gradle.lockfile') ? 'gradle.lockfile' : null, manifest: grad, available: hasBinary('gradle') || idx.has('gradlew') });
    }
    const sp = res.stacks.find((s) => s.id === 'spring'); if (sp) res.framework.spring = { version: sp.version };
    if (name) res.name = name;
    return res;
  },
};

export const dotnet = {
  id: 'dotnet',
  async detect(root, idx) {
    const projs = idx.find((p) => /\.(csproj|fsproj|vbproj)$/.test(p) && p.split('/').length <= 3);
    if (!projs.length) return {};
    const res = { stacks: [], manifests: [], packageManagers: [{ id: 'dotnet', lockfile: idx.has('packages.lock.json') ? 'packages.lock.json' : null, manifest: projs[0], available: hasBinary('dotnet') }], scripts: [], framework: {} };
    for (const p of projs) {
      const t = (await idx.read(p)) || '';
      const deps = [];
      const re = /<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?/g; let m;
      while ((m = re.exec(t))) deps.push({ name: m[1], version: m[2] || '*', dev: false, manager: 'nuget' });
      const tf = /<TargetFramework>([^<]+)</.exec(t)?.[1] || null;
      if (!res.stacks.length) res.stacks.push(stack('dotnet', '.NET', 'runtime', { version: tf, confidence: 0.95, source: p }));
      if (/Microsoft\.NET\.Sdk\.Web/.test(t) && !res.stacks.some((s) => s.id === 'aspnet')) res.stacks.push(stack('aspnet', 'ASP.NET Core', 'framework', { version: tf, confidence: 0.9, source: p }));
      res.manifests.push({ path: p, type: 'dotnet', name: p.split('/').pop().replace(/\.\w+$/, ''), version: null, scripts: {}, deps });
    }
    return res;
  },
};

export const deno = {
  id: 'deno',
  async detect(root, idx) {
    const f = ['deno.json', 'deno.jsonc'].find((x) => idx.has(x));
    if (!f) return {};
    let j = await idx.readJson(f);
    if (!j && f.endsWith('c')) { const t = (await idx.read(f)) || ''; try { j = JSON.parse(t.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')); } catch { j = {}; } }
    j ||= {};
    const deps = Object.entries(j.imports || {}).map(([n, v]) => ({ name: n, version: String(v), dev: false, manager: 'deno' }));
    const tasks = j.tasks || {};
    return {
      stacks: [stack('deno', 'Deno', 'runtime', { confidence: 0.98, source: f })],
      manifests: [{ path: f, type: 'deno', name: j.name || null, version: j.version || null, scripts: tasks, deps }],
      packageManagers: [{ id: 'deno', lockfile: idx.has('deno.lock') ? 'deno.lock' : null, manifest: f, available: hasBinary('deno') }],
      scripts: Object.entries(tasks).map(([name, command]) => ({ manager: 'deno', name, command: String(command), source: f })), framework: {},
    };
  },
};
