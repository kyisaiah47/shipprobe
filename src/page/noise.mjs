/* noise.mjs: the four noise families, as a library.
 *
 * `noise-patterns.json` beside this file is the list. Every pattern carries a family, a fix, and
 * three scope flags:
 *
 *   answer   a writer composing an answer on somebody's behalf (a form field, a reply, a bio)
 *   copy     outward product copy: a landing page, a card, a caption, a listing
 *   reply    a chat reply
 *
 * The page lint in `rules/noise.mjs` reads the `copy` scope, which is families 1, 3 and 4. Family
 * 2 is deliberately not in that scope: a landing page is not answering a question about
 * experience, and the family-2 patterns are written for the shape of an answer.
 *
 * The patterns use only syntax shared by the JavaScript RegExp engine and Python's `re`, so one
 * file can drive both. They are matched case-insensitively.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SPEC_PATH = path.join(HERE, "noise-patterns.json");
export const SPEC = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));

export const RULE = SPEC.rule;
export const COPY_RULE = SPEC.copy_rule;
export const FAMILIES = SPEC.families;
export const PATTERNS = SPEC.patterns.map((p) => ({ ...p, re: new RegExp(p.pattern, "i") }));
export const SCOPES = ["answer", "copy", "reply", "all"];

export function patternsFor(scope = "copy", families = null) {
  if (!SCOPES.includes(scope)) throw new Error(`scope must be one of ${SCOPES.join("|")}`);
  return PATTERNS.filter(
    (p) => (scope === "all" || p[scope]) && (!families || families.includes(String(p.family))),
  );
}

/* A SENTENCE THAT REPRODUCES A PHRASE IS NOT AN INSTANCE OF IT. Quoting a banned phrase in order
 * to talk about it has to stay possible, or the rule cannot be written down anywhere, including
 * in this repository. A fenced block, a backtick span, a "double-quoted" run of twelve characters
 * or more, a blockquote line and a URL are all removed before matching. Asserting the phrase in
 * your own sentence is what fails, which is the only thing that should. */
export function proseOf(text) {
  let t = String(text || "");
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/```[\s\S]*$/, " ");
  t = t.replace(/`[^`\n]*`/g, " ");
  t = t.replace(/^\s*>.*$/gm, " ");
  t = t.replace(/https?:\/\/\S+/g, " ");
  return t.replace(/[“"][^“”"\n]{12,}[”"]/g, " ");
}

const SENT = /(?<=[.!?])\s+/;
export function sentenceAround(text, index) {
  let pos = 0;
  for (const s of String(text).split(SENT)) {
    const end = pos + s.length;
    if (index >= pos && index < end) return s.replace(/\s+/g, " ").trim();
    pos = end + 1;
    while (pos < text.length && /\s/.test(text[pos])) pos++;
  }
  return String(text)
    .slice(Math.max(0, index - 80), index + 120)
    .replace(/\s+/g, " ")
    .trim();
}

/** Every pattern in scope that fires, at most one hit per pattern. */
export function noiseIssues(text, { scope = "copy", families = null } = {}) {
  const t = String(text || "");
  const out = [];
  for (const p of patternsFor(scope, families)) {
    const m = p.re.exec(t);
    if (!m) continue;
    out.push({
      slug: p.slug,
      family: p.family,
      title: (SPEC.families[String(p.family)] || {}).title || `family ${p.family}`,
      fix: p.fix,
      fragment: m[0].trim(),
      sentence: sentenceAround(t, m.index),
    });
  }
  return out;
}

export function noiseIssue(text, opts = {}) {
  return noiseIssues(text, opts)[0] || null;
}
