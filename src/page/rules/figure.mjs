/* figure.mjs: a picture at the full reading measure is a thin band, or it has something to read.
 *
 * THE RULE. A picture is allowed to take the whole reading column in exactly four ways, and there
 * is no fifth:
 *
 *   1. A THIN LANDSCAPE BAND, 3.5:1 or wider.
 *   2. ONE COLUMN OF A TWO-COLUMN SECTION, with real prose in the other column. Either side.
 *   3. A BACKGROUND COVER, with content painted over it. A hero is not a figure.
 *   4. DENSE ENOUGH TO STUDY: glyph-scale structure at or above 8%, and no taller than 900px.
 *
 * WHY IT IS NOT AN ASPECT RATIO. The first version of this measured only aspect ratio, and it
 * refused a capture of a product's own workspace sitting at the page's own column width. Measured
 * at 1440: 1116x702, aspect 1.59:1, 95% of its column. Satisfying the ratio produced an inset
 * composition that was rejected on sight; satisfying the design failed the gate, so the section
 * shipped and the gate stayed red. A permanently red gate is a gate everybody learns to skip,
 * which is the same disease as one that is permanently green.
 *
 * Aspect ratio was a proxy. What is being refused is a DECORATIVE render taking the whole measure,
 * filler at the size of an argument. A capture of an interface IS the argument of the section it
 * sits in, the reader is meant to study it, and shrinking it to 48% makes its labels unreadable.
 * That cost is invisible to a ratio, because 1.59:1 describes a clay object and a dashboard
 * identically. One number cannot separate two things it does not measure.
 *
 * SO IT MEASURES WHETHER THERE IS ANYTHING TO READ. Not the filename, not the directory, not a
 * `data-` attribute anybody can type onto a render, and not an allowlist. The pixels: how much of
 * the image is glyph-scale structure.
 *
 *   Greyscale, fit to 900px wide, then BOX-DOWNSAMPLE 2x. This is the load-bearing step. A first
 *   version skipped it and measured a per-pixel laplacian, and a grainy render scored 5.04% purely
 *   on film grain. Random grain averages toward the mean under a 2x box; a 2px letterform stroke
 *   survives it. Then a laplacian over the downsampled plane at |v| > 40, counting only pixels in
 *   a HORIZONTAL RUN of 2 or more. A stroke edge is a run. A speck is one pixel. The same grain
 *   that scored 5.04 raw scores 0.87 this way.
 *
 * MEASURED, 2026-09-02, on real assets, as a percentage of the downsampled plane:
 *
 *   INTERFACE CAPTURES        a product workspace            12.93
 *                             four deck captures      13.92 / 11.53 / 11.09 / 10.73
 *                             a publish dialog               10.81
 *   the gap, 5.35 to 10.73, with nothing in it
 *   RENDERS AND PHOTOGRAPHS   a paper still                   5.35
 *                             a near-empty dialog             5.21
 *                             a second paper still            4.43
 *                             a channel banner                3.27
 *                             two brand photographs    3.04 / 3.03
 *                             two more paper stills    2.46 / 1.82
 *                             a near-empty toggle             1.75
 *                             a plain ground                  0.28
 *
 * DETAIL_FLOOR is 8.0: three points clear of the densest render and 2.7 clear of the sparsest
 * capture, sitting in an empty band rather than beside anything.
 *
 * AND IT IS HONEST ABOUT WHAT IT MEASURES. This is not "is it a screenshot". It is "would shrinking
 * this destroy information", which is the actual reason a capture earns the column. A dense
 * text-bearing figure that is not a UI, a table, a filled form, a specimen sheet, passes, and it
 * should: the reader is meant to read it. A render, a photograph and a near-empty dialog do not.
 * Nothing here can be gamed by renaming a file, moving it, or declaring an intent in the markup.
 *
 * A CAPTURE THAT EARNS THE COLUMN STILL HAS TO BE STUDYABLE IN ONE SCREEN. A 2,400px-tall dashboard
 * at the full measure is a wall, not a figure. STUDY_H is 900px of rendered height, a laptop
 * viewport.
 *
 * AN IMAGE WHOSE PIXELS CANNOT BE READ IS NOT GIVEN THE BENEFIT OF THE DOUBT. A cross-origin image
 * taints the canvas and `getImageData` throws; an image that never loaded has no pixels at all.
 * Either way the density is unknown, and unknown is treated as NOT dense: the thin-band rule
 * applies and the finding says why.
 */

export const id = "figure";
export const title = "full-column figure";
export const scope = 'width';
export const summary =
  "A picture at the full reading measure that is none of the four allowed forms: a thin band, one " +
  "column of two with prose beside it, a background cover, or a capture dense enough to study.";

/* At or past this share of its own column, a picture counts as full-width. 0.85 rather than 1.0
 * because a figure inset by a hair is still the full measure to the eye. */
export const FULL_RATIO = 0.85;
/* Below this rendered width a picture is a figure inside a reading column that has a rail beside
 * it, not the huge one-column image this rule refuses. Calibrated on real verdicts, 2026-09-04: a
 * 640px figure beside a left-hand notes rail is a two-column look and is correct, while every
 * picture called wrong measured 1120 or 1440. */
export const FIGURE_MIN_W = 700;
/* THE OTHER COLUMN. The overlap is measured against the SHORTER of the two boxes, never against the
 * picture. Against the picture, a real two-column card fails: a lede card at 1440 puts a 673x463
 * shot beside a title that is 73px tall, so the title covers 16% of the picture and 100% of itself.
 * Requiring 35% of the picture refused the exact layout the rule exists to allow. Measured
 * 2026-09-04. */
export const BESIDE_OVERLAP = 0.6;
/* ANY content painted over the picture makes it a BACKGROUND. The first version wanted 70% of the
 * sample points covered, and that is why it refused correct heroes: a hero holds ONE card over a
 * wide photograph, so most of the picture is bare by design. Measured across every finding of one
 * sweep of many live pages at 1440px, 25 points per picture:
 *
 *   a two-column steps cloud       15/15   correct
 *   a hero                         15/25   correct, a background image
 *   the same page's about hero      9/25   correct, page furniture
 *   a CTA photograph                5/25   correct, logo and headline on its lower band
 *   another hero                    2/25   correct
 *   the line, and there is nothing in it
 *   three entry shots               0/25   all three called wrong
 *
 * Zero and non-zero, with no case anywhere between 0 and 2. A picture nothing is drawn on is a
 * figure; a picture something is drawn on is a ground. `position: absolute` is NOT the test and was
 * measured out: exported templates wrap their images in an absolute div, so it marks the offenders
 * and the backgrounds alike. */
export const COVER_MIN = 1;
/* A full-width picture with nothing to read must be at least this wide for its height. */
export const THIN_ASPECT = 3.5;
/* Below this the element is an icon, a mark or a rule, not a figure. */
export const MIN_W = 240;
/* Glyph-scale structure, percent of the downsampled plane. See the table above. */
export const DETAIL_FLOOR = 8.0;
/* A full-column capture has to be studyable in one screen. */
export const STUDY_H = 900;

export async function probeFullColumnFigure(K) {
  const { FULL_RATIO, THIN_ASPECT, MIN_W, DETAIL_FLOOR, STUDY_H, FIGURE_MIN_W, BESIDE_OVERLAP, COVER_MIN } = K;
  const label = (el) => {
    const c =
      typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "";
    return el.tagName.toLowerCase() + (c ? "." + c : "");
  };
  const vis = (el) => {
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.05;
  };
  /* A TEXT BLOCK is an element carrying its OWN prose, never a wrapper that inherits its children's.
   * `div` and `span` are excluded deliberately: on most pages they ARE the layout, so counting them
   * makes the measure the page width and the beside test always true, which is a gate that passes
   * everything. */
  const TEXT_SEL = "p,h1,h2,h3,h4,h5,h6,li,dd,dt,blockquote,figcaption,td,th,label,a,button";
  const ownText = (el) => {
    let n = 0;
    for (const c of el.childNodes) if (c.nodeType === 3) n += c.nodeValue.trim().length;
    return n;
  };
  const TEXT = [...document.querySelectorAll(TEXT_SEL)].filter((e) => {
    if (ownText(e) < 40 || !vis(e)) return false;
    const r = e.getBoundingClientRect();
    return r.width >= 120 && r.height >= 10;
  });

  const detailOf = (img) => {
    try {
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      if (!nw || !nh) return null;
      const W = Math.min(900, nw);
      const H = Math.max(4, Math.round((nh * W) / nw));
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0, W, H);
      const d = g.getImageData(0, 0, W, H).data; /* throws on a tainted canvas */
      const hw = W >> 1;
      const hh = H >> 1;
      if (hw < 8 || hh < 8) return null;
      const s = new Float32Array(hw * hh);
      for (let y = 0; y < hh; y++)
        for (let x = 0; x < hw; x++) {
          const i = (2 * y * W + 2 * x) * 4;
          const j = ((2 * y + 1) * W + 2 * x) * 4;
          const l = (p) => 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
          s[y * hw + x] = (l(i) + l(i + 4) + l(j) + l(j + 4)) / 4;
        }
      let runs = 0;
      let tot = 0;
      for (let y = 1; y < hh - 1; y++) {
        let run = 0;
        for (let x = 1; x < hw - 1; x++) {
          const i = y * hw + x;
          const lap = 4 * s[i] - s[i - 1] - s[i + 1] - s[i - hw] - s[i + hw];
          tot++;
          if (Math.abs(lap) > 40) run++;
          else {
            if (run >= 2) runs += run;
            run = 0;
          }
        }
        if (run >= 2) runs += run;
      }
      return tot ? +((runs / tot) * 100).toFixed(2) : null;
    } catch {
      return null;
    }
  };

  const out = [];
  for (const img of document.querySelectorAll("img, picture, video")) {
    const cs = getComputedStyle(img);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    let r = img.getBoundingClientRect();
    if (r.width < MIN_W || r.height < 24) continue;
    /* Under the figure floor it is a tile inside a card, and this rule has no opinion about one.
     * The offence is a huge one-column image, not a 300px thumbnail. */
    if (r.width < FIGURE_MIN_W) continue;

    /* THE BACKGROUND CARVE, MEASURED RATHER THAN DECLARED. Scroll the picture into view and sample
     * twenty-five points. If the topmost element at those points is neither the picture nor inside
     * it, content is PAINTED OVER IT and the reader is looking at a hero, not at a picture taking
     * the measure. No class name, no attribute, nothing anybody can type on. */
    img.scrollIntoView({ block: "center", inline: "nearest" });
    await new Promise((res) => setTimeout(res, 60));
    r = img.getBoundingClientRect();
    let covered = 0;
    let sampled = 0;
    for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9])
      for (const fy of [0.15, 0.35, 0.5, 0.65, 0.85]) {
        const x = r.left + r.width * fx;
        const y = r.top + r.height * fy;
        if (x < 1 || y < 1 || x > window.innerWidth - 1 || y > window.innerHeight - 1) continue;
        sampled++;
        const top = document.elementFromPoint(x, y);
        if (top && top !== img && !img.contains(top) && !top.contains(img)) covered++;
      }
    if (covered >= COVER_MIN) continue;

    /* THE MEASURE IS THE PROSE'S OWN WIDTH, NEVER AN ANCESTOR'S BOX. The old walk took the nearest
     * ancestor STRICTLY WIDER than the picture, so a picture that exactly fills its reading column,
     * which is the offence itself, skipped that column and landed on the wrapper one level out.
     * Measured on a live article at 1440px, 2026-09-04: 860x860 inside a reading column of 860,
     * which the walk skipped in favour of a wrapper at 1240, giving 69% and printing a tick. The
     * gate could not see the one case it exists for.
     *
     * AND THE COLUMN HAS TO BE AT LEAST AS WIDE AS THE PICTURE, or it is not the column. The first
     * version stopped at the FIRST ancestor holding any prose, which on a marquee of cards is the
     * card's own caption. Measured 2026-09-04: a 920px tile in a horizontally scrolling row scored
     * against a 565px caption inside it, printing "163% of its column" and a finding. A share over
     * 100% is the tell that the thing being measured is inside the picture rather than around it,
     * so the walk keeps going. */
    let scope = null;
    let cols = [];
    for (let n = img.parentElement, hops = 0; n && n !== document.body && hops < 10; n = n.parentElement, hops++) {
      const inside = TEXT.filter((t) => n.contains(t) && !img.contains(t) && t !== img);
      const widest = inside.length ? Math.max(...inside.map((t) => t.getBoundingClientRect().width)) : 0;
      if (widest >= r.width - 2) {
        scope = n;
        cols = inside;
        break;
      }
      if (n.getBoundingClientRect().width >= window.innerWidth - 2) {
        scope = scope || n;
        break;
      }
    }
    const measure = cols.length
      ? Math.max(...cols.map((t) => t.getBoundingClientRect().width))
      : scope
        ? scope.getBoundingClientRect().width
        : window.innerWidth;
    const share = r.width / measure;
    if (share < FULL_RATIO) continue;

    /* THE TWO-COLUMN EXIT. Real prose standing BESIDE the picture: overlapping its vertical band,
     * with its own horizontal centre outside the picture's span. Either side. */
    const beside = TEXT.some((t) => {
      if (img.contains(t) || t.contains(img)) return false;
      const tr = t.getBoundingClientRect();
      const ov = Math.min(r.bottom, tr.bottom) - Math.max(r.top, tr.top);
      if (ov < Math.min(r.height, tr.height) * BESIDE_OVERLAP) return false;
      const cx = tr.left + tr.width / 2;
      return cx < r.left + 2 || cx > r.right - 2;
    });
    if (beside) continue;

    const aspect = r.width / r.height;
    if (aspect >= THIN_ASPECT) continue;

    const detail = img.tagName === "VIDEO" ? null : detailOf(img);
    if (detail !== null && detail >= DETAIL_FLOOR && r.height <= STUDY_H) continue;

    const why =
      detail === null
        ? "its pixels could not be read (cross-origin, or it never loaded), so density is unknown and the band rule applies"
        : detail >= DETAIL_FLOOR
          ? `dense enough to study (${detail}%) but ${Math.round(r.height)}px tall, over the ${STUDY_H}px a reader gets in one screen`
          : `only ${detail}% glyph-scale structure. This is a render or a photograph, not something to read (floor ${DETAIL_FLOOR}%)`;

    out.push({
      sel: label(img),
      inside: scope ? label(scope) : "(viewport)",
      w: Math.round(r.width),
      h: Math.round(r.height),
      colW: Math.round(measure),
      pct: Math.round(share * 100),
      aspect: +aspect.toFixed(2),
      detail,
      sampled,
      why,
      src: ((img.currentSrc || img.getAttribute("src") || "").split("/").pop() || "").slice(0, 60),
    });
  }
  window.scrollTo(0, 0);
  const seen = new Set();
  return out.filter((o) => {
    const k = o.src + o.w + o.h;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const K = {
  FULL_RATIO,
  THIN_ASPECT,
  MIN_W,
  DETAIL_FLOOR,
  STUDY_H,
  FIGURE_MIN_W,
  BESIDE_OVERLAP,
  COVER_MIN,
};

export async function run({ page, inPage }) {
  const rows = await inPage(page, probeFullColumnFigure, K);
  return {
    findings: rows.map((f) => ({
      sel: f.sel,
      msg:
        `fills ${f.pct}% of ${f.inside} at ${f.w}x${f.h} (aspect ${f.aspect}:1, column ${f.colW}px). ` +
        `${f.why}.` + (f.src ? ` ${f.src}` : ""),
      measured: f,
    })),
    notes: [],
  };
}
