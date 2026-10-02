/* The rule registry. Order is the order findings print in.
 *
 * There is no plugin loader and no config file of rules to disable. --only and --skip are on the
 * command line, where they show in the log of the run that used them, instead of in a checked-in
 * file where they become permanent and nobody remembers what they cover.
 *
 * scope  width   runs on the page at each --vw width
 *        ladder  runs on one page load stepped through 320 to 1920 wide
 *        page    runs once per target, on its own page or browser
 */
import * as contrast from './contrast.mjs';
import * as visible from './visible.mjs';
import * as clipped from './clipped.mjs';
import * as nested from './nested.mjs';
import * as deadColumn from './dead-column.mjs';
import * as pageChrome from './page-chrome.mjs';
import * as figure from './figure.mjs';
import * as numeralLabel from './numeral-label.mjs';
import * as tableShape from './table-shape.mjs';
import * as noise from './noise.mjs';
import { overflow, wrap, fold, primary } from './ladder.mjs';

export const RULES = [contrast, visible, clipped, overflow, wrap, fold, nested, primary, deadColumn, pageChrome, figure, numeralLabel, tableShape, noise];
export const RULE_IDS = RULES.map((r) => r.id);

export function selectRules({ only = null, skip = null, accent = null } = {}) {
  const known = new Set(RULE_IDS);
  const bad = [...(only || []), ...(skip || [])].filter((n) => !known.has(n));
  if (bad.length) {
    /* An unknown name fails. A typo in --only that selected nothing, or in --skip that skipped
     * nothing, is a run whose scope is not what was asked for. */
    throw Object.assign(new Error(`unknown rule name(s): ${bad.join(', ')}. Known: ${RULE_IDS.join(', ')}`), { cannotCheck: true });
  }
  let out = RULES.filter((r) => !r.optIn || accent || (only && only.includes(r.id)));
  if (only && only.length) out = out.filter((r) => only.includes(r.id));
  if (skip && skip.length) out = out.filter((r) => !skip.includes(r.id));
  if (out.some((r) => r.id === 'primary') && !accent) {
    throw Object.assign(new Error('the primary rule needs --accent <colour or --css-variable> to know which fill is the accent'), { cannotCheck: true });
  }
  if (!out.length) throw Object.assign(new Error('no rules selected, so nothing would be checked. Zero checks run is not a pass.'), { cannotCheck: true });
  return out;
}
