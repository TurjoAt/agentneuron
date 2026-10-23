import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../ui/src/lib/markdown.js';
import { escapeHtml, highlight } from '../ui/src/lib/format.js';
import { safeWorkspaceUrl } from '../ui/src/lib/safeurl.js';

const opts = { path: 'docs/a.md', exists: (p) => p === 'docs/b.md' || p === 'README.md' };
const render = (s) => renderMarkdown(s, opts);

/** Parse the output with a tiny tag tokenizer and assert nothing executable exists. */
function assertInert(html, label = '') {
  const tags = [...html.matchAll(/<\s*([a-zA-Z][\w-]*)([^>]*)>/g)];
  const ALLOWED = new Set(['p', 'a', 'strong', 'em', 'del', 'code', 'pre', 'div', 'span', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr', 'br', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'dl', 'dt', 'dd', 'svg', 'path', 'i']);
  for (const [, name, attrs] of tags) {
    assert.ok(ALLOWED.has(name.toLowerCase()), `${label}: unexpected tag <${name}> in ${html}`);
    // attribute names (outside of quoted values) must not include event handlers
    const stripped = attrs.replace(/"[^"]*"/g, '""');
    assert.ok(!/\bon\w+\s*=/i.test(stripped), `${label}: event handler attr in <${name}${attrs}>`);
    assert.ok(!/\bstyle\s*=\s*"[^"]*(expression|url\()/i.test(attrs), `${label}: bad style`);
  }
  for (const m of html.matchAll(/\b(href|src|xlink:href|action|formaction|srcdoc)="([^"]*)"/gi)) {
    const v = m[2].replace(/&amp;/g, '&');
    assert.ok(/^(https?:|mailto:|#)/i.test(v), `${label}: unsafe ${m[1]}="${v}"`);
  }
}

const PAYLOADS = [
  '<img src=x onerror=alert(1)>',
  '<svg onload=alert(1)>',
  '<script>alert(1)</script>',
  '"><script>alert(1)</script>',
  "'><img src=x onerror=alert(1)>",
  '[x](javascript:alert(1))',
  '[x](JaVaScRiPt:alert(1))',
  '[x]( javascript:alert(1))',
  '[x](java&#x09;script:alert(1))',
  '[x](java&#115;cript:alert(1))',
  '[x](&#106;avascript:alert(1))',
  '[x](jav\tascript:alert(1))',
  '[x](\u0001javascript:alert(1))',
  '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  '[x](vbscript:msgbox(1))',
  '[x](//evil.example/x)',
  '[x](\\\\evil.example\\x)',
  '[x](<javascript:alert(1)>)',
  '[x](https://a.example "t\\" onmouseover=\\"alert(1)")',
  '[x](https://a.example/"onmouseover="alert(1))',
  '[x](https://a.example/?q=\'><script>alert(1)</script>)',
  '![x" onerror="alert(1)](https://evil.example/t.png)',
  '![a](https://evil.example/track.png "x\\" onerror=alert(1)")',
  '![a](javascript:alert(1))',
  '![a](x"onerror="alert(1))',
  '<a href="&#106;avascript:alert(1)">x</a>',
  '<a href="javascript:alert(1)">x</a>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<style>@import "//evil.example/x.css"</style>',
  '<link rel=stylesheet href=//evil.example/x.css>',
  '<object data="javascript:alert(1)"></object>',
  '<embed src="javascript:alert(1)">',
  '<form action="javascript:alert(1)"><button>x</button></form>',
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
  '<!-- --><img src=x onerror=alert(1)><!-- -->',
  '<!--><img src=x onerror=alert(1)-->',
  '<!-- x --!><img src=x onerror=alert(1)>',
  '<https://a.example/"onmouseover="alert(1)>',
  '<javascript:alert(1)>',
  'https://a.example/"><img src=x onerror=alert(1)>',
  'https://a.example/\'onmouseover=\'alert(1)',
  '[[x"><img src=x onerror=alert(1)>]]',
  '[[x|"><img src=x onerror=alert(1)>]]',
  '@x"onmouseover="alert(1).md',
  '`<img src=x onerror=alert(1)>`',
  '```"><img src=x onerror=alert(1)>\n<script>alert(1)</script>\n```',
  '```js"onmouseover="alert(1)\nx\n```',
  '# <img src=x onerror=alert(1)>',
  '# "><script>alert(1)</script>',
  '# a\n# a\n# "onfocus="alert(1)',
  '- [ ] <img src=x onerror=alert(1)>',
  '> [!NOTE] <img src=x onerror=alert(1)>',
  '| a | b |\n|---|---|\n| <img src=x onerror=alert(1)> | [x](javascript:alert(1)) |',
  '| a |\n|:"onmouseover="alert(1)|\n| x |',
  '---\n"><script>alert(1)</script>: x\nk: <img src=x onerror=alert(1)>\n---\nbody',
  '---\nk: v\n---\n---\n<script>alert(1)</script>',
  '\u0000\u0000 0 \u0000 <img src=x onerror=alert(1)>',
  '\\<img src=x onerror=alert(1)>',
  '**<img src=x onerror=alert(1)>**',
  '*a <img src=x onerror=alert(1)> b*',
  '~~<script>~~',
  'a  \n<img src=x onerror=alert(1)>',
  '[x]([y](javascript:alert(1)))',
  '[<img src=x onerror=alert(1)>](https://a.example)',
  '[a](b)[c](https://x.example/\u0000)',
  '[x](docs/b.md#"onmouseover="alert(1))',
  '[x](docs/b.md#<img src=x onerror=alert(1)>)',
  '[x](#"onmouseover="alert(1))',
];

test('renderMarkdown: classic XSS payload battery stays inert', () => {
  for (const p of PAYLOADS) assertInert(render(p), JSON.stringify(p));
});

test('renderMarkdown: raw HTML is escaped, never passed through', () => {
  const h = render('<img src=x onerror=alert(1)> and <script>alert(1)</script>');
  assert.ok(!/<img|<script/i.test(h));
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('renderMarkdown: dangerous link schemes never become href', () => {
  for (const u of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java&#x09;script:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.example', ' javascript:alert(1)', 'jav\tascript:alert(1)']) {
    const h = render(`[x](${u})`);
    assert.ok(!/href="[^"]*(javascript|data:|vbscript|\/\/evil)/i.test(h), u + ' -> ' + h);
  }
});

test('renderMarkdown: external links are _blank + noopener noreferrer; mailto allowed', () => {
  const h = render('[a](https://example.com/x?a=1&b=2) <https://example.org> [m](mailto:a@b.co)');
  const anchors = [...h.matchAll(/<a [^>]*class="md-ext"[^>]*>/g)].map((m) => m[0]);
  assert.equal(anchors.length, 3);
  for (const a of anchors) {
    assert.match(a, /target="_blank"/);
    assert.match(a, /rel="noopener noreferrer"/);
  }
  assert.match(h, /href="https:\/\/example.com\/x\?a=1&amp;b=2"/);
});

test('renderMarkdown: images never render as <img> (no remote loads / tracking)', () => {
  const h = render('![pixel](https://evil.example/t.gif?u=secret) ![x](data:image/svg+xml,<svg onload=alert(1)>)');
  assert.ok(!/<img/i.test(h));
  assert.ok(!/src=/i.test(h));
});

test('renderMarkdown: attribute breakouts in titles/ids/paths are escaped', () => {
  const h = render('[x](docs/b.md#"onmouseover="alert(1)) ![a](x"y)\n\n# a"onfocus="alert(1)');
  assert.ok(!/"onmouseover=/.test(h));
  assert.ok(!/"onfocus=/.test(h));
  const broken = render('[x](nope/"onmouseover="alert(1).md)');
  assert.ok(!/ onmouseover=/.test(broken));
});

test('renderMarkdown: NUL placeholder forgery cannot inject stash entries', () => {
  const h = render('`<b>code</b>` \u00000\u0000 \u00001\u0000');
  assert.ok(!/<b>/.test(h));
});

test('renderMarkdown: tolerates non-string / hostile input without throwing', () => {
  for (const v of [null, undefined, 42, {}, [], '\u0000', '[', '[]()', '[x](', '|\n|-|', '> '.repeat(500), '- '.repeat(500) + 'x']) {
    assert.doesNotThrow(() => renderMarkdown(v, opts));
  }
});

test('escapeHtml and highlight escape quotes and angle brackets', () => {
  assert.equal(escapeHtml(`<a href="x" onclick='y'>&`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;');
  const h = highlight('<img src=x onerror=1>', [0, 1]);
  assert.ok(!/<img/.test(h));
  assert.match(h, /^<mark>&lt;i<\/mark>/);
});

test('safeWorkspaceUrl: only http(s) on the same hostname with an explicit port', () => {
  const here = 'http://localhost:4000/';
  assert.equal(safeWorkspaceUrl('http://localhost:4001/', here), 'http://localhost:4001/');
  assert.equal(safeWorkspaceUrl('http://localhost:4001/?token=abc', here), 'http://localhost:4001/');
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', '//evil.example:4001/', 'http://evil.example:4001/', 'http://localhost/', 'https://localhost.evil.example:1/', 'http://user:pw@localhost:4001/', 'file:///etc/passwd', '', null, 42, 'http://localhost:4001\\@evil.example/']) {
    assert.equal(safeWorkspaceUrl(bad, here), null, String(bad));
  }
});

test('renderMarkdown: pathological input is bounded in time and recursion depth', () => {
  const t0 = Date.now();
  for (const v of ['['.repeat(20000), '[a]('.repeat(10000), '[['.repeat(10000), '> '.repeat(20000), '- '.repeat(20000) + 'x', '>'.repeat(5000)]) {
    const h = renderMarkdown(v, opts);
    assert.equal(typeof h, 'string');
    assertInert(h, 'pathological');
  }
  assert.ok(Date.now() - t0 < 3000, `too slow: ${Date.now() - t0}ms`);
});
