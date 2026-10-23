const WEIGHTS = { error: 10, warn: 3, info: 0.5 };

/**
 * @param {object[]} issues
 * @param {object[]} files
 * @returns {{score:number, grade:string, counts:{error:number,warn:number,info:number}, byRule:Record<string,number>}}
 */
export function healthScore(issues = [], files = []) {
  const counts = { error: 0, warn: 0, info: 0 };
  const byRule = {};
  let penalty = 0;
  for (const i of issues) {
    const sev = WEIGHTS[i.severity] !== undefined ? i.severity : 'info';
    counts[sev]++;
    byRule[i.rule] = (byRule[i.rule] || 0) + 1;
    penalty += WEIGHTS[sev];
  }
  const n = Math.max(1, files.length);
  // Normalised by file count: penalty per file, saturating curve.
  let score = Math.round(100 / (1 + penalty / (5 * n)));
  if (counts.error > 0) score = Math.min(score, 89); // an error can never be an A
  if (penalty > 0) score = Math.min(score, 99);
  score = Math.max(0, Math.min(100, score));
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
  return { score, grade, counts, byRule };
}
