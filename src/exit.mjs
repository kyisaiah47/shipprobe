/* The four exit codes. Every command returns one of them, and they mean the same thing everywhere.
 *
 *   0  PASS       checked, and nothing failed
 *   1  FAIL       checked, and the subject violates something
 *   2  UNCHECKED  could not check. Never a pass, and never collapsed into 0 or 1
 *   3  NEVER      checked, and every violation is "this was never produced"
 *
 * 2 is the one that matters. "I could not check" and "I checked and it was fine" are different
 * answers. A pipeline that renders both as green has taught itself to ignore the gate.
 *
 * When several results combine (promote runs many gates, page runs many rules), 2 wins over
 * everything, then 1, then 3, then 0. A run that could not finish is not a verdict, so it must
 * not report the code that means "here is what is wrong".
 */
export const PASS = 0;
export const FAIL = 1;
export const UNCHECKED = 2;
export const NEVER = 3;

const RANK = { [UNCHECKED]: 4, [FAIL]: 3, [NEVER]: 2, [PASS]: 1 };

/** The combined code of several results, by the precedence above. An empty list is UNCHECKED:
 *  zero checks run is not a pass. */
export function combine(codes) {
  const list = codes.filter((c) => c !== undefined && c !== null);
  if (!list.length) return UNCHECKED;
  let best = list[0];
  for (const c of list) {
    const r = RANK[c] ?? RANK[UNCHECKED];
    if (r > (RANK[best] ?? RANK[UNCHECKED])) best = c;
  }
  return RANK[best] === undefined ? UNCHECKED : best;
}

export const MEANING = {
  [PASS]: 'checked, nothing failed',
  [FAIL]: 'checked, and something failed',
  [UNCHECKED]: 'could not check, which is not a pass',
  [NEVER]: 'checked, and the thing was never produced',
};

/** An error that means "could not check". Any command that throws one exits 2. */
export class CannotCheck extends Error {
  constructor(message) {
    super(message);
    this.name = 'CannotCheck';
    this.cannotCheck = true;
  }
}
