/* Findings to a 0 to 100 score and a letter grade. A deduction model: start at 100, subtract per
 * finding by severity with diminishing returns inside a band, so ten low-severity notes cannot
 * outweigh one critical. Any critical caps the grade at F; any high caps it at C. */

export const SEVERITY_WEIGHT = { critical: 40, high: 22, medium: 10, low: 4, pass: 0 };

export function scoreFindings(findings) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, pass: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
  let deduction = 0;
  for (const sev of ['critical', 'high', 'medium', 'low']) {
    for (let i = 0; i < counts[sev]; i++) deduction += SEVERITY_WEIGHT[sev] * Math.pow(0.7, i);
  }
  const score = Math.max(0, Math.round(100 - deduction));
  let grade;
  if (counts.critical > 0) grade = 'F';
  else if (score >= 90) grade = 'A';
  else if (score >= 78) grade = 'B';
  else if (score >= 62) grade = 'C';
  else if (score >= 45) grade = 'D';
  else grade = 'F';
  if (counts.high > 0 && (grade === 'A' || grade === 'B')) grade = 'C';
  return { score, grade, counts };
}

export function summarize({ counts, grade }) {
  if (counts.critical > 0) {
    return `Critical exposure found. ${counts.critical} issue${counts.critical > 1 ? 's' : ''} could let anyone read or damage the app's data now.`;
  }
  if (counts.high > 0) {
    return `Serious gaps found. ${counts.high} high-risk issue${counts.high > 1 ? 's' : ''} to fix before real users arrive.`;
  }
  if (counts.medium > 0) {
    return `A few hardening gaps. Nothing open to walk through, and ${counts.medium} thing${counts.medium > 1 ? 's' : ''} to tighten.`;
  }
  if (grade === 'A') return 'Clean on every check that ran.';
  return 'Mostly clean, with minor items to tidy.';
}
