// Text helpers for insights: normalisation, tokens, Jaccard similarity, masked quotes.
import crypto from 'node:crypto';
import { maskSecretsInText } from '../health/secrets.js';

const STOP = new Set(('a an the and or but if then so to of in on at by for with from into onto as is are was were be been being it its this that these those '
  + 'i you we he she they me us my your our their please pls just can could would should will shall do does did done have has had not no '
  + 'there here what which who when where why how all any some more most very also again too only than up out about over').split(' '));

/** Mask first, then clip: a secret cut in half could slip past the masker. */
export const quote = (s, n = 200) => maskSecretsInText(String(s ?? '').replace(/\s+/g, ' ').trim()).slice(0, n);

export const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');

export const norm = (s) => String(s ?? '').toLowerCase().replace(/[`'"“”‘’]/g, '').replace(/[^\p{L}\p{N}_./@-]+/gu, ' ').replace(/\s+/g, ' ').trim();

const stem = (w) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w);

/** Content tokens (stopwords dropped, crude stemming). Negations are kept: they carry the meaning of a rule. */
export function tokens(s) {
  const out = new Set();
  for (const w of norm(s).split(' ')) {
    if (!w || w.length < 2) continue;
    if (STOP.has(w) && !/^(not|no|never)$/.test(w)) continue;
    out.add(stem(w.replace(/[./-]+$/, '')));
  }
  return out;
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
}

/** Share of `a` found in `b` (how much of a lesson an existing rule already says). */
export function containment(a, b) {
  if (!a.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / a.size;
}

/** Drop fenced code, inline quotes ("> ..."), and collapse whitespace. */
export function stripCode(s) {
  return String(s ?? '').replace(/```[\s\S]*?(```|$)/g, ' ').replace(/^\s*>.*$/gm, ' ').replace(/\s+/g, ' ').trim();
}

export const toMs = (v) => {
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) && Math.abs(n) <= 8.64e15 ? n : 0;
};

export const sentence = (s) => {
  let t = String(s).trim().replace(/\s+/g, ' ').replace(/[\s,;:]+$/, '');
  if (!t) return '';
  t = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(t) ? t : `${t}.`;
};
