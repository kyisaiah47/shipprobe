/* contrast: WCAG 1.4.3 text, 1.4.11 glyphs, and duotone separation, measured against the ground
 * actually painted. The measurement itself lives in ../contrast.mjs, which is the only contrast
 * implementation in this package. */
import { contrastProbe, textVerdicts, glyphVerdicts } from '../contrast.mjs';
import { getTextRuns } from '../textruns.mjs';

export const id = 'contrast';
export const title = 'text and glyph contrast';
export const scope = 'width';
export const summary =
  'Text below WCAG 1.4.3 and SVG marks below 1.4.11, measured against the background actually painted behind them, ' +
  'with failures reviewed against the real pixels; plus two-tone glyphs whose tones have collapsed.';

export async function run(ctx) {
  const runs = await getTextRuns(ctx);
  const text = textVerdicts(runs);
  const glyphs = glyphVerdicts(await ctx.inPage(ctx.page, contrastProbe, 'glyph'));
  return {
    findings: [...text.findings, ...glyphs.findings],
    warnings: text.warnings,
    notes: [...text.notes, ...glyphs.notes],
  };
}
