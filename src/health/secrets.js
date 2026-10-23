// Secret scanner: regex detectors + entropy check for generic assignments.
// Messages never contain more than the first 4 characters of a secret.

/** @typedef {{id:string, rule:string, severity:'error'|'warn'|'info', path:string, line?:number, message:string, hint?:string}} Issue */

const HINT = 'Remove it from the file, rotate the credential, and read it from an environment variable or a secret manager instead.';

const PATTERNS = [
  { label: 'AWS access key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { label: 'AWS secret access key', re: /aws_?secret_?(?:access_?)?key["']?\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/gi, group: 1 },
  { label: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { label: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g },
  { label: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { label: 'OpenAI API key', re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g },
  { label: 'Slack token', re: /\bxox[abeoprs]-[A-Za-z0-9-]{10,}/g },
  { label: 'Slack webhook URL', re: /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\/[A-Za-z0-9]{16,}/g },
  { label: 'Stripe live key', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g },
  { label: 'Stripe test key', re: /\b(?:sk|rk)_test_[A-Za-z0-9]{16,}\b/g, severity: 'warn' },
  { label: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { label: 'JSON Web Token', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { label: 'Private key block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g, noMaskValue: true },
];

const ASSIGN_RE = /([A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|token|private[_-]?key|client[_-]?secret))["']?\s*[:=]\s*["'`]?([^\s"'`,;)}\]]{8,})/gi;

const PLACEHOLDER_WORDS = [
  'your', 'example', 'placeholder', 'changeme', 'change-me', 'change_me', 'xxxx', '****', 'redacted',
  'dummy', 'sample', 'insert', 'replace', 'fake', 'todo', 'tbd', 'token_here', 'key_here', 'secret_here',
  'password_here', 'here', 'undefined', 'null', 'none', 'foobar', 'lorem', 'process.env',
];

/** Shannon entropy in bits per char. */
export function entropy(str) {
  if (!str) return 0;
  const freq = new Map();
  for (const ch of str) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / str.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** True for obvious fake values like "your-api-key", "xxxx", "<token>", "${VAR}". */
export function isPlaceholder(value) {
  const v = String(value).trim();
  if (!v) return true;
  const l = v.toLowerCase();
  if (/^[<[{$%]/.test(v) || /[>\]}]$/.test(v) && /^[<[{]/.test(v)) return true;
  if (/\$\{|\{\{|<[^>]*>|%\w+%/.test(v)) return true;
  if (/^(.)\1+$/.test(v)) return true;
  if (/^[x*._\-•]+$/i.test(v)) return true;
  if (/x{4,}|\*{3,}|\.{3,}|•{2,}/i.test(v)) return true;
  if (new Set(l).size < 5) return true;
  return PLACEHOLDER_WORDS.some((w) => l.includes(w));
}

/** Mask: first 4 chars + stars. */
export function maskSecret(value) {
  const v = String(value);
  return v.slice(0, 4) + '****';
}

function looksLikeSecretValue(v) {
  if (v.length < 8) return false;
  if (isPlaceholder(v)) return false;
  if (/^(?:https?|file):\/\//i.test(v) && !/\/\/[^/@\s]+:[^/@\s]+@/.test(v)) return false;
  if (/^[./~]/.test(v) && /\//.test(v)) return false; // path
  if (/^[A-Za-z_$][\w$]*(?:[.[(]|::|->)/.test(v)) return false; // function call / property access
  if (/^[A-Z][A-Z0-9_]+$/.test(v) && v.includes('_')) return false; // ENV_VAR_NAME
  if (/^[a-z]+(?:[-_.][a-z]+)+$/.test(v)) return false; // kebab/snake words, e.g. my-secret-name
  const hasDigit = /\d/.test(v);
  const hasLetter = /[A-Za-z]/.test(v);
  const mixedCase = /[a-z]/.test(v) && /[A-Z]/.test(v);
  if (!(hasDigit && hasLetter) && !mixedCase && !/[^A-Za-z0-9]/.test(v)) return false;
  return entropy(v) >= (v.length >= 16 ? 3.2 : 2.9);
}

/**
 * Scan content for secrets.
 * @param {string} path project-relative path
 * @param {string} content
 * @returns {Issue[]}
 */
export function scanSecrets(path, content) {
  const issues = [];
  if (!content || typeof content !== 'string') return issues;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (text.length > 5000 || text.length < 8) continue;
    const taken = [];
    const overlaps = (s, e) => taken.some(([a, b]) => s < b && e > a);
    let n = 0;
    const push = (label, severity, value, noMask) => {
      n++;
      issues.push({
        id: `secret:${path}:${i + 1}:${n}`,
        rule: 'secret',
        severity,
        path,
        line: i + 1,
        message: noMask
          ? `${label} found on line ${i + 1}`
          : `${label} found on line ${i + 1} (${maskSecret(value)})`,
        hint: HINT,
      });
    };
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(text))) {
        const value = p.group ? m[p.group] : m[0];
        const start = m.index + (p.group ? m[0].indexOf(value) : 0);
        const end = start + value.length;
        if (m[0].length === 0) p.re.lastIndex++;
        if (overlaps(start, end)) continue;
        if (!p.noMaskValue && isPlaceholder(value)) continue;
        taken.push([start, end]);
        push(p.label, p.severity || 'error', value, p.noMaskValue);
      }
    }
    ASSIGN_RE.lastIndex = 0;
    let m;
    while ((m = ASSIGN_RE.exec(text))) {
      const value = m[2];
      const start = m.index + m[0].lastIndexOf(value);
      const end = start + value.length;
      if (overlaps(start, end)) continue;
      if (!looksLikeSecretValue(value)) continue;
      taken.push([start, end]);
      push(`Hard-coded credential (${m[1].toLowerCase()})`, 'error', value);
    }
  }
  return issues;
}

/** Replace anything that looks like a secret in free text with a masked form. */
export function maskSecretsInText(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    out = out.replace(p.re, (...args) => {
      const full = args[0];
      return isPlaceholder(full) && !p.noMaskValue ? full : maskSecret(full);
    });
  }
  out = out.replace(/(\b(?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]{12,}/g, (_, a) => a + '****');
  out = out.replace(/(:\/\/[^/@\s:]+:)[^/@\s]+@/g, '$1****@');
  out = out.replace(ASSIGN_RE, (full, key, val) => (looksLikeSecretValue(val) ? full.slice(0, full.length - val.length) + maskSecret(val) : full));
  return out;
}
