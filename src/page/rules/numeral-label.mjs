/* numeral-label.mjs: no-numeral-label, measured on the rendered page.
 *
 * THE BANNED REGISTER, and both halves have to be present together:
 *
 *   1. A NUMBER is the dominant type element on the surface: at least 1.6x the largest piece of
 *      type beside it, which in practice is that surface's own headline.
 *   2. It is paired with a small ALL-CAPS LETTER-SPACED LABEL directly above or below it. An
 *      eyebrow, a kicker, a rail: uppercase, letter-spacing at 0.08em or wider, at a fraction of
 *      the figure's size.
 *
 * The signature is the extreme size jump between a giant numeral and a tiny tracked caption. The
 * exact shapes this was written against: a 178px bare figure under a 23px eyebrow tracked +0.14em;
 * a year at 238px over a tracked line naming a deadline; a ratio at 212px over a tracked line
 * naming what the ratio is of. In each one the number is the subject of the card and it tells a
 * stranger nothing, because the sentence that would have made it mean something is the caption
 * nobody can read.
 *
 * NOT BANNED, AND THIS RULE MUST NEVER TREAT THEM AS VIOLATIONS: a small tracked uppercase label on
 * its own, which is what section headers, chips and rails are; a number inside a headline or a
 * sentence; tables, ledgers, data rows and charts where figures sit at body size. The ban is on the
 * PAIRING and the size jump, not on numerals and not on tracked capitals.
 *
 * WHAT TO DO INSTEAD: go sentence-led. The headline or the claim is the largest element on the
 * surface, and a figure, if it earns a place at all, sits at body size inside the sentence.
 *
 * WHY IT IS MEASURED ON THE PAGE AND NOT IN THE SOURCE. The same register was banned once inside a
 * single rendering pipeline, and it reappeared the next day on a different surface, because a ban
 * scoped to one pipeline is not a ban. And the pipeline check was inert anyway: it read a merged
 * object where one spread overwrote the field it was inspecting, so the key it guarded was never in
 * the object it looked at. Measured at the time: 42 of 42 recipes carrying a figure passed, it
 * caught zero, and the shipped look rendered a 178px figure for every product but one. A check that
 * cannot see the field it guards is worse than none, because it reads as coverage. This one reads
 * the painted page, so it does not care which pipeline drew it.
 *
 * There is no allowlist and no flag. If a figure is the subject of a card, the card is the thing to
 * change.
 */

export const id = "numeral-label";
export const title = "figure over a tracked label";
export const scope = 'width';
export const summary =
  "A number set as the dominant type on a surface, paired with a small all-caps letter-spaced " +
  "label directly above or below it.";

/* HOW MUCH BIGGER THE FIGURE HAS TO BE THAN EVERYTHING ELSE ON ITS SURFACE. The measured cases sat
 * at 178/23, 238/27 and 212/27, which are 7.7x, 8.8x and 7.9x. 1.6 is far below any of them and is
 * the point at which a numeral has stopped being part of the type hierarchy and become the subject
 * of the surface. */
export const DOMINANT_RATIO = 1.6;
/* THE FLOOR EXISTS TO PROTECT THE CARVE-OUT, not to catch the offenders. Figures at body size in a
 * table, a ledger row or a chart are explicitly allowed, and body type on these surfaces runs 14 to
 * 20px, so 40 is twice the top of that range. The four shipped offenders measured 178, 212, 232 and
 * 238px, so nothing anywhere near this floor is at risk of being missed by it. */
export const FIGURE_MIN_PX = 40;
/* WCAG-independent, and taken from the register itself: the labels in the rejected cards were
 * tracked at +0.13em and +0.14em. 0.08em is the point at which letter-spacing stops being an
 * optical correction and becomes a treatment. */
export const TRACKED_EM = 0.08;

export function probeStatEyebrow(K) {
  const { DOMINANT_RATIO, FIGURE_MIN_PX, TRACKED_EM } = K;

  const label = (el) => {
    const c =
      typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "";
    return el.tagName.toLowerCase() + (c ? "." + c : "");
  };
  const ownText = (el) => {
    let s = "";
    for (const c of el.childNodes) if (c.nodeType === 3) s += c.nodeValue;
    return s.replace(/\s+/g, " ").trim();
  };
  const visible = (el) => {
    if (typeof el.checkVisibility === "function" && !el.checkVisibility()) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width >= 2 && r.height >= 2 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };

  /* Every element carrying its OWN text, with the type facts a reader receives. A wrapper that
   * inherits its children's text is not a piece of type. */
  const NODES = [];
  for (const el of document.body.querySelectorAll("*")) {
    const t = ownText(el);
    if (!t || !visible(el)) continue;
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize) || 0;
    const lsRaw = cs.letterSpacing;
    const ls = lsRaw === "normal" ? 0 : parseFloat(lsRaw) || 0;
    const r = el.getBoundingClientRect();
    NODES.push({
      el,
      text: t,
      fs,
      trackEm: fs ? ls / fs : 0,
      upper: cs.textTransform === "uppercase" || (/[A-Za-z]/.test(t) && t === t.toUpperCase() && (t.match(/[A-Za-z]/g) || []).length >= 3),
      letters: /[A-Za-z]/.test(t),
      rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width },
    });
  }

  /* A FIGURE IS A RUN OF TYPE CARRYING A DIGIT AND NO WORDS. The same test the authored-frame check
   * uses: a headline that carries no letters is not a headline. A currency mark, a percent sign, a
   * colon in a ratio and a decimal point all stay inside a figure; one letter takes it out, which
   * is what keeps "12 filings" and every headline with a number in it clear of this rule. */
  const isFigure = (n) => !n.letters && /\d/.test(n.text) && n.text.length <= 16;

  const out = [];
  const seen = new Set();

  for (const fig of NODES) {
    if (!isFigure(fig) || fig.fs < FIGURE_MIN_PX) continue;

    /* THE SURFACE IS THE NEAREST ANCESTOR THAT HOLDS OTHER TYPE. A card, a section, a slide: the
     * thing a reader takes in as one composition. Walking further out would measure the figure
     * against the page's own hero and let a stat card hide inside a big page. */
    let surface = null;
    let others = [];
    for (let n = fig.el.parentElement, hops = 0; n && hops < 8; n = n.parentElement, hops++) {
      const inside = NODES.filter((o) => o !== fig && n.contains(o.el) && !fig.el.contains(o.el));
      if (inside.length) {
        surface = n;
        others = inside;
        break;
      }
      if (n === document.body) break;
    }
    if (!surface) continue;

    /* DOMINANT: at least DOMINANT_RATIO times every other piece of type on the surface. Written
     * against the largest, not against the headline by tag name, because a card's biggest type is
     * its headline whatever element it happens to be. */
    const biggestOther = Math.max(...others.map((o) => o.fs));
    if (!(fig.fs >= biggestOther * DOMINANT_RATIO)) continue;

    /* THE LABEL: small, uppercase, tracked, and DIRECTLY above or below the figure. Directly means
     * the nearest such block on that axis with nothing between it and the figure, horizontally
     * overlapping the figure's span, and no further away than the figure is tall. A caption further
     * off than the figure's own height is not reading as one unit with it. */
    const candidates = others
      .filter((o) => o.upper && o.trackEm >= TRACKED_EM && o.fs <= fig.fs / DOMINANT_RATIO)
      .filter((o) => Math.min(o.rect.right, fig.rect.right) - Math.max(o.rect.left, fig.rect.left) > 0)
      .map((o) => {
        const gap = o.rect.top >= fig.rect.bottom ? o.rect.top - fig.rect.bottom : fig.rect.top - o.rect.bottom;
        return { ...o, gap, side: o.rect.top >= fig.rect.bottom ? "below" : "above" };
      })
      .filter((o) => o.gap >= -1 && o.gap <= fig.rect.height)
      .sort((a, b) => a.gap - b.gap);
    if (!candidates.length) continue;
    const lab = candidates[0];

    const key = label(fig.el) + "|" + fig.text + "|" + lab.text;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      sel: label(fig.el),
      inside: label(surface),
      figure: fig.text.slice(0, 24),
      figurePx: Math.round(fig.fs),
      labelSel: label(lab.el),
      labelText: lab.text.slice(0, 60),
      labelPx: Math.round(lab.fs),
      labelTrackEm: +lab.trackEm.toFixed(3),
      side: lab.side,
      gap: Math.round(lab.gap),
      jump: +(fig.fs / lab.fs).toFixed(1),
      biggestOtherPx: Math.round(biggestOther),
    });
  }
  return out;
}

export const K = { DOMINANT_RATIO, FIGURE_MIN_PX, TRACKED_EM };

export async function run({ page, inPage }) {
  const rows = await inPage(page, probeStatEyebrow, K);
  return {
    findings: rows.map((f) => ({
      sel: f.sel,
      msg:
        `"${f.figure}" at ${f.figurePx}px is the dominant type in ${f.inside} (next largest ` +
        `${f.biggestOtherPx}px), with "${f.labelText}" ${f.side} it at ${f.labelPx}px tracked ` +
        `+${f.labelTrackEm}em, ${f.gap}px away. That is a ${f.jump}x size jump from a figure to a ` +
        `tracked caption. Make the sentence the largest element and put the figure inside it.`,
      measured: f,
    })),
    notes: [],
  };
}
