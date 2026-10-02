/* clipped: text cut by a box above it, in a direction no scrollbar can undo.
 *
 * `overflow: auto` on a flex column with `justify-content: center` centres a panel until the
 * content is taller than the box. Then the overflow leaves through the TOP, where scrollTop is
 * already 0 and no scroll position brings it back. An `overflow: hidden` box on a fixed height is
 * worse: there is not even a scrollbar to hint that something is missing. Both render, legible,
 * at full opacity, and a reader cannot get to the text.
 *
 * The rule asks only what a reader can answer: is text being cut by a box above it. For a scroll
 * container only the START edge counts: content below the bottom is one scroll away, which is a
 * panel working.
 *
 * DECLARED TRUNCATION IS EXEMPT, because the reader is told: aria-hidden (a hover-swap's parked
 * second label), a collapsed disclosure (aria-expanded="false", or a closed <details>), and
 * -webkit-line-clamp or text-overflow: ellipsis, which paint an ellipsis. The leading of a line box
 * is empty space, so overflow under the half-leading is not counted.
 *
 * CUT AT EVERY STOP, OR IT IS NOT CUT. A masked text reveal is this bug for the length of its
 * animation. The page is walked and only a run that is never once seen whole is reported. Baked
 * geometry is cut at every stop; anything that moves is clear at some.
 */
export const id = 'clipped';
export const title = 'clipped text';
export const scope = 'width';
export const summary = 'Text cut by an overflow:hidden or clip box above it, or pushed past the start edge of its own scroll container, at every scroll position.';

export function probeClipped() {
  const out = [];
  const CLIPS = /^(hidden|clip|auto|scroll)$/;
  const scrolls = /^(auto|scroll)$/;
  const label = (a) => {
    const cls = typeof a.className === 'string' && a.className.trim() ? `.${a.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    return `${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ''}${cls}`;
  };
  for (const el of document.body.querySelectorAll('*')) {
    let text = '';
    for (const n of el.childNodes) if (n.nodeType === 3) text += n.nodeValue;
    text = text.replace(/\s+/g, ' ').trim();
    if (!text || el.closest("[aria-hidden='true']")) continue;
    const cs = getComputedStyle(el);
    if ((cs.webkitLineClamp && cs.webkitLineClamp !== 'none') || cs.textOverflow === 'ellipsis') continue;
    if (el.closest('details:not([open])')) continue;
    let collapsed = false;
    for (let a = el; a && a !== document.body && !collapsed; a = a.parentElement) {
      if (a.getAttribute?.('aria-expanded') === 'false') collapsed = true;
      const sib = a.parentElement?.querySelector?.(':scope > [aria-expanded]');
      if (sib && sib.getAttribute('aria-expanded') === 'false') collapsed = true;
    }
    if (collapsed) continue;
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ visibilityProperty: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const fontPx = parseFloat(cs.fontSize) || 16;
    const linePx = cs.lineHeight === 'normal' ? fontPx * 1.2 : parseFloat(cs.lineHeight) || fontPx * 1.2;
    const leading = Math.max(2, (linePx - fontPx) / 2 + fontPx * 0.12);
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const acs = getComputedStyle(a);
      const oy = acs.overflowY;
      const ox = acs.overflowX;
      if (!CLIPS.test(oy) && !CLIPS.test(ox)) continue;
      const ar = a.getBoundingClientRect();
      if (ar.width < 2 || ar.height < 2) continue;
      /* The clamp is usually declared on the CLIPPING ancestor, whose child holds the text. */
      if ((acs.webkitLineClamp && acs.webkitLineClamp !== 'none') || acs.textOverflow === 'ellipsis') break;
      const cutBottom = CLIPS.test(oy) && !scrolls.test(oy) && r.bottom - ar.bottom > leading;
      const cutTop = CLIPS.test(oy) && ar.top - r.top > leading;
      const cutRight = CLIPS.test(ox) && !scrolls.test(ox) && r.right - ar.right > 2;
      out.push({
        sel: label(a),
        text: text.slice(0, 46),
        cut: cutTop || cutBottom || cutRight,
        by: Math.round(cutTop ? ar.top - r.top : cutBottom ? r.bottom - ar.bottom : cutRight ? r.right - ar.right : 0),
        edge: cutTop ? 'top' : cutBottom ? 'bottom' : cutRight ? 'right' : 'none',
        mode: cutRight ? ox : oy,
      });
      break;
    }
  }
  return out.slice(0, 80);
}

export async function run(ctx) {
  const { page, inPage } = ctx;
  const stops = await page.evaluate(() => {
    const h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    const step = Math.max(Math.round(innerHeight * 0.75), Math.ceil(h / 14));
    const out = [];
    for (let y = 0; y < h; y += step) out.push(y);
    return out.length ? out.slice(0, 14) : [0];
  });
  const tally = new Map();
  for (const y of stops) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(ctx.stopSettle);
    for (const c of await inPage(page, probeClipped)) {
      const key = `${c.sel}|${c.text}`;
      const t = tally.get(key) ?? { seen: 0, cut: 0, worst: null };
      t.seen++;
      if (c.cut) {
        t.cut++;
        if (!t.worst || c.by > t.worst.by) t.worst = c;
      }
      tally.set(key, t);
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  const clipped = new Map();
  for (const t of tally.values()) {
    if (!t.worst || t.cut !== t.seen) continue;
    const k = `${t.worst.sel}|${t.worst.edge}`;
    if (!clipped.has(k) || t.worst.by > clipped.get(k).by) clipped.set(k, t.worst);
  }
  return {
    findings: [...clipped.values()].map((c) => ({
      sel: c.sel,
      msg:
        (c.mode === 'auto' || c.mode === 'scroll'
          ? `text pushed past the ${c.edge} edge of its own scroll container, where no scroll position reaches it. Centre with margin: auto on the child, which collapses to zero when the content does not fit`
          : `text cut by ${c.by}px at the ${c.edge} edge, and overflow: ${c.mode} means there is no scrollbar to reach it. Let the box grow with its content`) +
        `. "${c.text}"`,
      measured: c,
    })),
  };
}
