/** Deterministic token estimate: blend of chars/4 and ~1.3 tokens per word. */
export function estimateTokens(text) {
  if (!text) return 0;
  const chars = text.length;
  const words = (text.match(/\S+/g) || []).length;
  return Math.ceil((chars / 4 + words * 1.3) / 2);
}
