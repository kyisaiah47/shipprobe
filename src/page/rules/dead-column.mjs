/* dead-column.mjs: a page that establishes a content width and then, for hundreds of pixels of
 * its own length, uses half of it.
 *
 * THE DEFECT. A left-aligned two-column layout with only the first column filled, and a wide band
 * of nothing down the right. It is a repeated layout defect that no gate could see, because the
 * two decisions that produce it are each correct on their own: cap the measure so a line of prose
 * is readable, and keep the block's left edge on the column every other section shares. Nothing
 * overflows, nothing clips, no contrast fails, no label wraps. Every check passes and the page
 * reads as unbuilt.
 *
 * IT COMPARES THE PAGE AGAINST ITSELF, NOT AGAINST A NUMBER. There is no width a block is supposed
 * to be. The reference is the page's own 90th-percentile content edge, which is how far right this
 * document actually goes when it is using its width, and a run of rows is reported when it stops
 * far short of that edge while still starting on the page's normal left margin.
 *
 * LEFT-ALIGNED ONLY, AND THAT IS THE WHOLE POINT. A narrow block CENTRED in a wide frame is a
 * deliberate reading column and is left alone: the slack is split and the page reads as composed.
 * What is reported is slack that is all on one side.
 *
 * WHAT COUNTS AS CONTENT: text and replaced elements, nothing else. A full-bleed background plate,
 * a hatched rail, a gradient wash and an empty bordered box all paint pixels in that column and
 * none of them is a reason for a reader to look there. Counting paint rather than content is how
 * this check would report every page as clean.
 *
 * Nothing in the measurement knows what any particular site is. It reads geometry out of a real
 * browser: no class names, no framework, no stylesheet. That is what makes it a rule rather than a
 * lint for one template.
 */

export const id = "dead-column";
export const title = "dead column";
export const scope = 'width';
export const summary =
  "A contiguous run of rows whose content stops far short of the width the same page establishes " +
  "elsewhere, while still starting on that page's own left margin.";

export function probeDeadColumn() {
  const ROW = 8; // scanline height, px
  const MIN_DEAD = 300; // px of unused width before a row counts as dead
  const MIN_FRACTION = 0.3; // and it has to be this much of the page's own width
  const MIN_RUN = 240; // px of contiguous dead height before a run is worth reporting
  const LEFT_SLOP = 40; // how far off the page's left margin a row may start

  const doc = document.scrollingElement || document.documentElement;
  const pageH = doc.scrollHeight;
  const rows = Math.ceil(pageH / ROW);
  if (rows < MIN_RUN / ROW) return [];

  const right = new Float64Array(rows).fill(-1);
  const left = new Float64Array(rows).fill(Infinity);
  /* What element is responsible for the row's right edge, kept so a finding can name the block
   * that is short rather than only the geometry of the hole beside it. */
  const owner = new Array(rows);

  const REPLACED = new Set(["IMG", "SVG", "CANVAS", "VIDEO", "IFRAME", "INPUT", "TEXTAREA", "SELECT", "BUTTON", "HR"]);
  /* AN INLINE <svg> REPORTS ITS `tagName` IN LOWER CASE, SO "SVG" IN THAT SET NEVER MATCHED ONE.
   * HTML elements uppercase their tag name; SVG elements keep the case they were written in. The
   * set was asked once, in upper case, so every inline icon was invisible to this rule: it paints,
   * and the row it is on measured as having nothing on it. Measured 2026-08-22 at 1280: a nav's
   * hamburger is an inline <svg> at x=1238 to 1250, the far right of a 1230px page, and the rule
   * read that nav row as 1065px unused with the row's content ending at the wordmark on x=185. */
  const paints = (el) => {
    if (REPLACED.has((el.tagName || "").toUpperCase())) return true;
    for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) return true;
    return false;
  };

  /* A STICKY BLOCK OCCUPIES ITS WHOLE TRAVEL, NOT THE BAND IT HAPPENS TO BE PARKED IN. The probe
   * reads rects once, at one scroll position, so a sticky rail measures as three hundred pixels of
   * content wherever it currently sits, and the four screens of column it fills for an actual
   * reader read as dead. A reading rail is the canonical fix for this very finding, so a check that
   * reports the fix as the defect is worse than no check. Its span is its parent's box, which is
   * exactly what sticky positioning is constrained by. */
  const sticky = [];
  for (const el of document.body.querySelectorAll("*")) {
    if (getComputedStyle(el).position !== "sticky" || !el.parentElement) continue;
    sticky.push({ el, box: el.parentElement.getBoundingClientRect() });
  }

  /* THE EXTENSION MAY ONLY RAISE A ROW THAT ALREADY HAS CONTENT ON IT. IT MUST NEVER PUT CONTENT ON
   * AN EMPTY ROW, AND THE FIRST BUILD DID EXACTLY THAT, DOWN A WHOLE DOCUMENT. A sticky element's
   * travel is its parent's box, and for a sticky TOP NAV that parent is the page wrapper. Measured
   * 2026-08-22 at 1280 on a page that is correct: a sticky nav inside a wrapper whose box runs
   * y=0 to y=12467, the entire document, so the nav's 121px wordmark was written into all 1558 rows
   * of the page at x=185, and every row where nothing else painted stopped being AIR and became a
   * 1065px DEAD row owned by that wordmark. Two runs came out of that, and in the second one 35 of
   * the 39 dead rows were section padding with nothing whatever in them.
   *
   * AIR and DEAD are not the same state. The extension exists so a rail's band does not read DEAD,
   * and a DEAD row is by definition a row that has content on it, so gating the extension on
   * `right[i] >= 0` removes nothing it was written for and removes every phantom. It has to be a
   * SECOND PASS: inside one loop, "does this row already have content" is an answer that depends on
   * `querySelectorAll` order. */
  const stretched = [];
  for (const el of document.body.querySelectorAll("*")) {
    if (!paints(el)) continue;
    const cs = getComputedStyle(el);
    /* A fixed nav or a fixed bar rides with the reader over the top of the document and is not part
     * of its column. Counting it would paint every row of the page as reaching the nav's right
     * edge, which is a check that can never fire. */
    if (cs.position === "fixed") continue;
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    if (el.closest("[aria-hidden='true']")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    let vTop = r.top;
    let vBot = r.bottom;
    for (const s of sticky) {
      if (s.el === el || s.el.contains(el)) {
        vTop = Math.min(vTop, s.box.top);
        vBot = Math.max(vBot, s.box.bottom);
      }
    }
    const top = Math.max(0, Math.floor((r.top + scrollY) / ROW));
    const bot = Math.min(rows - 1, Math.floor((r.bottom + scrollY) / ROW));
    const rr = r.right + scrollX;
    const rl = r.left + scrollX;
    for (let i = top; i <= bot; i++) {
      if (rr > right[i]) {
        right[i] = rr;
        owner[i] = el;
      }
      if (rl < left[i]) left[i] = rl;
    }
    if (vTop < r.top - 0.5 || vBot > r.bottom + 0.5) {
      stretched.push({
        el,
        rr,
        rl,
        top: Math.max(0, Math.floor((vTop + scrollY) / ROW)),
        bot: Math.min(rows - 1, Math.floor((vBot + scrollY) / ROW)),
      });
    }
  }
  /* The snapshot is taken before ANY extension is applied, so one sticky cannot make a row eligible
   * for the next one. */
  const hadContent = new Uint8Array(rows);
  for (let i = 0; i < rows; i++) hadContent[i] = right[i] >= 0 ? 1 : 0;
  for (const q of stretched) {
    for (let i = q.top; i <= q.bot; i++) {
      if (!hadContent[i]) continue;
      if (q.rr > right[i]) {
        right[i] = q.rr;
        owner[i] = q.el;
      }
      if (q.rl < left[i]) left[i] = q.rl;
    }
  }

  const filled = [];
  for (let i = 0; i < rows; i++) if (right[i] >= 0) filled.push(right[i]);
  if (filled.length < 20) return [];
  filled.sort((a, b) => a - b);
  /* The page's own content edge, at the 90th percentile rather than the maximum: one full-bleed
   * banner must not become the width every paragraph on the page is then judged against. */
  const pageRight = filled[Math.floor(filled.length * 0.9)];
  const lefts = [];
  for (let i = 0; i < rows; i++) if (left[i] < Infinity) lefts.push(left[i]);
  lefts.sort((a, b) => a - b);
  const pageLeft = lefts[Math.floor(lefts.length * 0.1)];
  const pageWidth = pageRight - pageLeft;
  if (pageWidth < 900) return []; // a narrow page has no second column to waste

  /* THREE STATES, NOT TWO, AND THE FIRST BUILD OF THIS HAD TWO. A row with nothing in it is the air
   * between two paragraphs; treating it as "not dead" ended the run at every paragraph break, so a
   * guide with 162 dead rows down it reported zero runs and the gate printed clean against the exact
   * page the check was written from.
   *
   *   DEAD  content that stops far short of the page's own edge
   *   LIVE  content that uses the width, which ENDS a run
   *   AIR   nothing on this row: it carries the run through, and never starts one */
  const DEAD = 2;
  const LIVE = 1;
  const AIR = 0;

  /* A TICKER'S BAND IS FILLED, AND MEASURING ONE ON A STILL FRAME SAYS OTHERWISE. A marquee or a
   * carousel is a strip whose content is WIDER than its clipped box and is translated through it
   * continuously. It paints across the full width for a reader at every instant, but the probe
   * reads rects once, and whichever item happens to be rightmost at that moment is where the row's
   * content "ends". The same page measures LIVE or DEAD on that band depending on nothing but when
   * the reading was taken. Measured 2026-08-22 at 1440: an infinite ticker whose <ul> runs from
   * x=-79 out to x=2192 inside a 1360px clipped box read LIVE on one run and DEAD on the next,
   * merging with the section heading below it and reporting a 360px run against a section that
   * renders as the two-column layout it is.
   *
   * The test is the DOM's own: content wider than the box that clips it. A column that stopped short
   * never overflows the thing it sits in, and that is the whole difference between the two. */
  const strips = new Set();
  for (const el of document.body.querySelectorAll("*")) {
    if (el.scrollWidth - el.clientWidth <= 4 || el.clientWidth < 40) continue;
    const ox = getComputedStyle(el).overflowX;
    if (ox === "visible") continue;
    strips.add(el);
  }
  const inStrip = (el) => {
    for (let n = el; n; n = n.parentElement) if (strips.has(n)) return true;
    return false;
  };

  /* A <summary> IN A COLLAPSED <details> IS A ROW LABEL, NOT A COLUMN. Measured 2026-08-22 at 1440:
   * the rule reported "993px unused beside 400px of content" against an FAQ question, on an
   * accordion rendering correctly at full width with its affordance on the right. It was measuring
   * the question text inside the <summary> and calling a short question a dead column. Left in, it
   * fails every page whose FAQ questions are short. ONLY WHEN COLLAPSED: an open <details> is a real
   * content block and its answer prose is measured normally. */
  const inClosedSummary = (el) => {
    for (let n = el; n; n = n.parentElement) {
      if (n.tagName === "SUMMARY") {
        const d = n.closest("details");
        return !!d && !d.open;
      }
      if (n.tagName === "DETAILS") return false;
    }
    return false;
  };

  const state = (i) => {
    if (right[i] < 0) return AIR;
    if (left[i] - pageLeft > LEFT_SLOP) return LIVE; // centred or indented, deliberate
    if (owner[i] && inStrip(owner[i])) return LIVE; // a ticker's band is filled
    if (owner[i] && inClosedSummary(owner[i])) return LIVE; // a collapsed FAQ row label
    const gap = pageRight - right[i];
    return gap >= MIN_DEAD && gap / pageWidth >= MIN_FRACTION ? DEAD : LIVE;
  };

  /* How much of this page's CONTENT is short of its own edge, as a fraction. A single dead pocket
   * inside a spread that otherwise uses the width is composition; a page where half the rows stop
   * early is the defect. Carried on every run so the caller can tell them apart. */
  let deadRows = 0;
  let contentRows = 0;
  for (let k = 0; k < rows; k++) {
    if (right[k] < 0) continue;
    contentRows++;
    if (state(k) === DEAD) deadRows++;
  }
  const deadFraction = contentRows ? deadRows / contentRows : 0;

  const runs = [];
  let i = 0;
  while (i < rows) {
    if (state(i) !== DEAD) {
      i++;
      continue;
    }
    const start = i;
    let gap = 0;
    let deadRowsHere = 0;
    const seen = new Map();
    while (i < rows && state(i) !== LIVE) {
      if (state(i) === DEAD) {
        deadRowsHere++;
        gap = Math.max(gap, pageRight - right[i]);
        const el = owner[i];
        if (el) seen.set(el, (seen.get(el) ?? 0) + 1);
      }
      i++;
    }
    /* THE HEIGHT IS THE DEAD ROWS, NOT THE SPAN FROM THE FIRST TO THE LAST. The air after a block
     * is the page's own section padding and is not part of the finding, and the air BETWEEN two
     * short blocks is the same padding measured from the other side. Measured 2026-08-22 at 1440:
     * a title band of 83 dead rows and a heading above its paragraph of another 26, with 155px of
     * section padding between them and nothing painting in it. Spanned, that is a 272px run and the
     * rule reported a correctly set page title; summed, it is 109px and under MIN_RUN, which is what
     * two short bands actually are. A genuinely tall column that stops short has no air inside it,
     * so it measures exactly as before. */
    const height = deadRowsHere * ROW;
    if (height < MIN_RUN) continue;
    /* A PAGE TITLE ALONE IN ITS BAND IS A TITLE, NOT A TWO-COLUMN LAYOUT WITH ONE COLUMN FILLED.
     * Whether it trips depended on how many words the title happens to have: "How it works" passed
     * and "Blog" failed on the same template, same band, same design, which is the tell that the
     * measurement was picking up the string and not the layout. A run whose only content is the
     * document's leading heading is exempt; a run that contains the heading AND something else is
     * not, because then there is a block beside it that stopped short.
     *
     * AND THE OWNER IS RESOLVED TO ITS HEADING, BECAUSE A TITLE IS OFTEN NOT ONE TEXT NODE. The
     * exemption tested the owning element, and a title set as `<h1>PRIVACY <span>POLICY</span></h1>`
     * holds no text node of its own, so `paints()` is false for the h1 and the row's rightmost
     * painted thing is the span. Whether a title trips must not depend on whether a word inside it
     * is wrapped for colour. */
    const owners = new Set([...seen.keys()].map((o) => (o && o.tagName === "H1" ? o : o && o.closest("h1")) || o));
    if (owners.size === 1) {
      const only = [...owners][0];
      if (only && only.tagName === "H1" && document.querySelector("h1") === only) continue;
    }
    /* A RUN WHOSE CONTENT IS ALL INSIDE ONE STICKY RAIL IS THE RAIL'S OWN BAND. The extension above
     * does not reach this shape, and the reason is worth writing down: it widens the ROWS a
     * sticky's descendants occupy, but the rail's own box is never contributed, because `paints()`
     * is true only for an element holding a text node or a replaced element and a rail wrapper holds
     * neither. So the row's right edge is set by the rail's narrow leaf spans and the band the rail
     * scrolls through reads as one filled column. Measured 2026-08-22 at 1440: a sticky 698x800
     * heading travelling 3142px down a section beside a timeline that fills x=758 to 1400 for almost
     * all of it, reported as two runs where the rail's heading sits between two timeline cards.
     *
     * IT CANNOT MASK A REAL DEAD COLUMN, AND THAT IS WHY IT IS WRITTEN AS "ALL", NOT "ANY". A block
     * outside the rail that stopped short is an owner this test does not find inside the rail, so the
     * run stays and still reports. */
    if (seen.size) {
      const os = [...seen.keys()];
      const rail = sticky.find((s) => os.every((el) => s.el === el || s.el.contains(el)));
      if (rail) continue;
    }
    /* The block that owns the most rows of the run is the one that is short. */
    let worst = null;
    let best = -1;
    for (const [el, n] of seen)
      if (n > best) {
        best = n;
        worst = el;
      }
    const cls =
      worst && typeof worst.className === "string" && worst.className.trim()
        ? `.${worst.className.trim().split(/\s+/).slice(0, 2).join(".")}`
        : "";
    runs.push({
      top: start * ROW,
      height,
      dead: Math.round(gap),
      pageWidth: Math.round(pageWidth),
      pageHeight: pageH,
      deadFraction: Math.round(deadFraction * 100) / 100,
      sel: worst ? `${worst.tagName.toLowerCase()}${cls}` : "(unidentified)",
      text: worst ? (worst.textContent || "").replace(/\s+/g, " ").trim().slice(0, 48) : "",
    });
  }
  /* The worst one. A guide with a dead rail beside every section would otherwise report the same
   * single cause once per section, and the useful number is the root cause, not the count of places
   * it shows. */
  runs.sort((a, b) => b.dead * b.height - a.dead * a.height);
  return runs.slice(0, 2);
}

export async function run({ page, inPage }) {
  const runs = await inPage(page, probeDeadColumn);
  return {
    findings: runs.map((r) => ({
      sel: r.sel,
      msg:
        `${r.dead}px of the page's own ${r.pageWidth}px measure is unused beside ${r.height}px of ` +
        `content starting at y=${r.top}. This block uses ${Math.round(((r.pageWidth - r.dead) / r.pageWidth) * 100)}% ` +
        `of the width the same page establishes elsewhere, and ${Math.round(r.deadFraction * 100)}% of the ` +
        `page's content rows stop short of it.` + (r.text ? ` "${r.text}"` : ""),
      measured: r,
    })),
    notes: [],
  };
}
