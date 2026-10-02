/* visible: text that occupies space and is not painted.
 *
 * A landing page shipped with an empty hero: its h1 held an animation's start frame at opacity
 * 0.001, permanently. The element was in the DOM at the right size, colour and position. There is
 * no string to grep for that. This multiplies the opacity of the whole ancestor chain, judges only
 * what is in front of the reader at each scroll stop, and gives every condemned run a second look.
 *
 * Text below the floor is either decoration or a bug, and the rule does not guess which: it asks
 * the author to have said. `aria-hidden="true"` is that declaration, the same one a screen reader
 * needs. A heading is never decoration.
 *
 * Then once more with prefers-reduced-motion set. A reveal runtime that never starts leaves every
 * element at its starting state, so anything invisible there is invisible by construction.
 */
import { textSweep, OPACITY_FLOOR } from '../contrast.mjs';
import { getTextRuns } from '../textruns.mjs';

export const id = 'visible';
export const title = 'unpainted text';
export const scope = 'width';
export const summary =
  'Text that occupies space but is painted below 8% effective opacity or collapsed by a transform, judged where the reader ' +
  'can see it, and again with reduced motion set.';

function verdict(t, when = '') {
  if (t.opacity >= OPACITY_FLOOR && !t.clipped) return null;
  const how = t.clipped ? 'collapsed by a transform or a hidden ancestor' : `painted at opacity ${t.opacity}`;
  if (t.heading) return { sel: t.sel, msg: `${how}${when}. A heading is never decoration. "${t.text}"`, measured: { opacity: t.opacity, clipped: t.clipped } };
  if (t.decorative) return null;
  return {
    sel: t.sel,
    msg: `${how}${when}, and not marked decorative. Either it is a bug, or it is a watermark and needs aria-hidden="true". "${t.text}"`,
    measured: { opacity: t.opacity, clipped: t.clipped },
  };
}

export async function run(ctx) {
  const runs = await getTextRuns(ctx);
  const findings = runs.map((t) => verdict(t)).filter(Boolean);
  const notes = [];
  if (ctx.first) {
    const { page } = await ctx.openPage(ctx.browser, ctx.url, { width: ctx.width, height: ctx.height, settleMs: Math.min(ctx.settleMs, 600), reducedMotion: 'reduce' });
    try {
      const reduced = await textSweep(page, ctx.inPage, { stopSettle: Math.min(180, ctx.stopSettle), pixels: false });
      const already = new Set(runs.filter((t) => t.opacity < OPACITY_FLOOR || t.clipped).map((t) => t.key));
      for (const t of reduced) {
        if (already.has(t.key)) continue;
        const f = verdict(t, ' only when prefers-reduced-motion is set: the reveal never runs, so this never appears');
        if (f) findings.push(f);
      }
    } finally {
      await page.close();
    }
  } else {
    notes.push('the reduced-motion pass ran at the first width only');
  }
  return { findings, notes };
}
