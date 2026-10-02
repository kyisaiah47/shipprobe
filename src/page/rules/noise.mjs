/* noise.mjs: the four noise families, run as a copy lint over the page's visible text.
 *
 * WHAT NOISE IS. Four moves, each banned on its own:
 *
 *   1  PERFORMED SINCERITY. A phrase announcing that the speaker is being honest instead of being
 *      honest. Delete it and say the thing.
 *   2  EUPHEMISM FOR NO. Saying no without the word. Scoped out of this lint on purpose: a landing
 *      page is not answering a question about experience, and the family-2 patterns are written for
 *      the shape of an answer. They ship in the library for a writer that is.
 *   3  NARRATING THE ANSWER. A sentence about the speaker's stance toward the answer instead of the
 *      answer. Delete the frame and write the thing it was announcing.
 *   4  FILLER NOISE IN PRODUCT COPY. Describing a product or a feature with padding instead of what
 *      it does, and any sentence that could be pasted onto a different product unchanged. If a
 *      sentence would still be true with the product name swapped for another product, delete it.
 *
 * WHY IT IS A RULE AND NOT A STYLE PREFERENCE. Filler is the one defect on this list that damages
 * the thing it is describing. A product that does something concrete, described in words that
 * would fit anything, reads as a product that does nothing in particular. The copy is the only
 * evidence most readers ever see, so a page of interchangeable sentences is a page arguing against
 * its own product.
 *
 * WHAT IT READS. The page's own visible text, block by block, out of a real browser. Not the
 * source, not the metadata: what a reader receives. Code, preformatted text, blockquotes and
 * quotations are excluded, and a "double-quoted span of twelve characters or more" is removed
 * before matching, so a page that quotes a banned phrase in order to talk about it does not fail
 * for reproducing it. Asserting the phrase in the page's own voice is what fails, which is the only
 * thing that should.
 */
import { noiseIssues, proseOf } from "../noise.mjs";

export const id = "noise";
export const title = "copy noise";
export const scope = 'width';
export const summary =
  "Filler and throat-clearing in the page's own visible text: performed sincerity, a frame " +
  "announcing the answer, and product copy that would fit any other product unchanged.";

export function probeVisibleCopy() {
  const SKIP = "pre, code, kbd, samp, blockquote, q, script, style, noscript, template, [aria-hidden='true']";
  const BLOCK = "p,li,h1,h2,h3,h4,h5,h6,figcaption,dd,dt,td,th,button,a,label,summary,span,div,strong,em";
  const sel = (el) => {
    const c =
      typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "";
    return el.tagName.toLowerCase() + (c ? "." + c : "");
  };
  const visible = (el) => {
    if (typeof el.checkVisibility === "function" && !el.checkVisibility()) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width >= 2 && r.height >= 2 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };

  const out = [];
  for (const el of document.body.querySelectorAll(BLOCK)) {
    if (el.closest(SKIP)) continue;
    /* THE INNERMOST BLOCK THAT CARRIES THE SENTENCE. A wrapper holding another block would report
     * the same sentence again one level out, and the finding would name a container rather than the
     * line a writer has to edit. Inline emphasis inside a paragraph is not a block, so a sentence
     * broken by a <b> is still measured whole. */
    if ([...el.querySelectorAll(BLOCK)].some((c) => (c.innerText || "").trim().length > 0)) continue;
    const t = (el.innerText || "").replace(/\s+/g, " ").trim();
    if (t.length < 12) continue;
    if (!visible(el)) continue;
    out.push({ sel: sel(el), text: t.slice(0, 400) });
  }
  return out;
}

export async function run({ page, inPage }) {
  const blocks = await inPage(page, probeVisibleCopy);
  const findings = [];
  const seen = new Set();
  for (const b of blocks) {
    for (const hit of noiseIssues(proseOf(b.text), { scope: "copy" })) {
      const key = hit.slug + "|" + hit.sentence;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        sel: b.sel,
        msg: `${hit.title} (${hit.slug}): "${hit.fragment}" in "${hit.sentence}". Fix: ${hit.fix}`,
        measured: { slug: hit.slug, family: hit.family, fragment: hit.fragment, sentence: hit.sentence, fix: hit.fix },
      });
    }
  }
  return { findings, notes: [] };
}
