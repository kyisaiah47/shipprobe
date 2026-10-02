/* The text runs of one page at one width, measured once and shared by the contrast rule and the
 * visibility rule, so the two can never disagree about what was on screen.
 *
 * THE SECOND LOOK. Anything the sweep condemned as invisible is measured once more, on purpose:
 * scrolled to the middle of the viewport, held long enough for a staggered reveal to finish, and
 * re-read whole. Only condemned runs pay for it. A stop can catch an element entering at the
 * bottom edge mid-reveal, and the best-reading merge then has only that reading. A run that
 * survives being scrolled to and waited on is a real invisible run; one that does not never was.
 * The fresh reading replaces the stale one WHOLE, because a run read at opacity 0 also carries a
 * dead 1:1 contrast, and adopting only the opacity would turn one false finding into another. */
import { textSweep, contrastProbe, OPACITY_FLOOR } from './contrast.mjs';

export async function getTextRuns(ctx) {
  if (ctx.shared.textRuns) return ctx.shared.textRuns;
  const runs = await textSweep(ctx.page, ctx.inPage, { stopSettle: ctx.stopSettle, pixels: true });
  for (const t of runs.filter((r) => r.opacity < OPACITY_FLOOR && !r.decorative && !r.clipped)) {
    await ctx.page.evaluate((top) => window.scrollTo(0, Math.max(0, top - innerHeight / 2)), t.top);
    await ctx.page.waitForTimeout(Math.max(300, Math.min(1400, ctx.stopSettle * 2)));
    const fresh = await ctx.inPage(ctx.page, contrastProbe, 'text');
    const better = fresh.find((f) => f.key === t.key && f.inFold);
    if (better && better.opacity > t.opacity) {
      for (const k of Object.keys(t)) delete t[k];
      Object.assign(t, better);
    }
  }
  await ctx.page.evaluate(() => window.scrollTo(0, 0));
  ctx.shared.textRuns = runs;
  return runs;
}
