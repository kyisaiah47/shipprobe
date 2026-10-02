/* The rules measured across a ladder of viewport widths on one page load: overflow, wrap, fold
 * and primary. Each exports `probe(ctx, vp)` and is called once per viewport.
 *
 * The narrow widths are layout measurements, not captures: nothing here takes a picture. */

export const VIEWPORTS = [
  { w: 320, h: 720, label: '320 (small phone)' },
  { w: 375, h: 812, label: '375 (phone)' },
  { w: 414, h: 896, label: '414 (large phone)' },
  { w: 768, h: 1024, label: '768 (tablet)' },
  { w: 1280, h: 800, label: '1280x800 (laptop)' },
  { w: 1920, h: 1080, label: '1920 (desktop)' },
];

/* ── overflow ─────────────────────────────────────────────────────────────────────────────── */
export function probeOverflow() {
  const doc = document.scrollingElement || document.documentElement;
  const overflow = doc.scrollWidth - doc.clientWidth;
  const offenders = [];
  if (overflow > 1) {
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const past = Math.round(r.right + scrollX - doc.clientWidth);
      if (past > 1) {
        const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
        offenders.push({ sel: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}`, past });
      }
    }
    offenders.sort((a, b) => b.past - a.past);
  }
  return { overflow: Math.max(0, overflow), offenders: offenders.slice(0, 6) };
}

export const overflow = {
  id: 'overflow',
  title: 'horizontal overflow',
  scope: 'ladder',
  summary: 'The page scrolls sideways at any width from 320 to 1920.',
  async probe(ctx, vp) {
    const { overflow: px, offenders } = await ctx.inPage(ctx.page, probeOverflow);
    if (px <= 1) return [];
    return [
      {
        sel: offenders[0]?.sel || '(page)',
        msg: `the page scrolls horizontally by ${px}px at ${vp.label}. Widest: ${offenders.map((o) => `${o.sel} (+${o.past}px)`).join(', ') || 'no single element identified'}`,
        measured: { px, viewport: vp.w, offenders },
      },
    ];
  },
};

/* ── wrap ─────────────────────────────────────────────────────────────────────────────────── */
/* Only affordances: nav links and anything that paints as a button. A footer list of article
 * titles wraps at 320 and always will. The text nodes are measured, not the element box, so an
 * inline icon beside a label is not a second line; an aria-hidden hover-swap copy is skipped; and
 * an authored <br> is subtracted, because a break somebody typed is not a reflow. */
export function probeWrap() {
  const sels = ["header nav a", "nav a", "[role='navigation'] a", 'button', "[role='button']", "a[class*='cta' i]", "a[class*='btn' i]", "a[class*='button' i]"];
  const seen = new Set();
  const bad = [];
  for (const sel of sels) {
    for (const el of document.querySelectorAll(sel)) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (el.closest('footer')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ visibilityProperty: true })) continue;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 28) continue;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const tops = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.nodeValue.trim()) continue;
        if (n.parentElement?.closest("[aria-hidden='true']")) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) {
          if (r.width < 1 || r.height < 1) continue;
          if (!tops.some((t) => Math.abs(t - r.top) <= 4)) tops.push(r.top);
        }
      }
      if (tops.length - el.querySelectorAll('br').length > 1) bad.push({ sel: el.tagName.toLowerCase(), text, lines: tops.length });
    }
  }
  return bad;
}

export const wrap = {
  id: 'wrap',
  title: 'wrapped control labels',
  scope: 'ladder',
  summary: 'A nav link, button or call-to-action label breaks onto a second line at any width from 320 to 1920.',
  async probe(ctx, vp) {
    return (await ctx.inPage(ctx.page, probeWrap)).map((w) => ({
      sel: w.sel,
      msg: `clickable text on ${w.lines} lines at ${vp.label}. "${w.text}"`,
      measured: { ...w, viewport: vp.w },
    }));
  },
};

/* ── fold ─────────────────────────────────────────────────────────────────────────────────── */
export function probeFold() {
  const h1 = document.querySelector('h1');
  const heroRoot = h1 ? h1.closest("section, header, div[class*='hero' i]") || document.body : null;
  const cta = heroRoot ? heroRoot.querySelector("a[class*='cta' i], a[class*='btn' i], a[class*='button' i], button, nav ~ * a[href]") : null;
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60), top: Math.round(r.top), bottom: Math.round(r.bottom), within: r.bottom <= innerHeight };
  };
  return { h1: box(h1), cta: box(cta), viewportH: innerHeight };
}

export const fold = {
  id: 'fold',
  title: 'headline above the fold',
  scope: 'ladder',
  summary: 'At 1280x800 the h1 runs past the fold (a failure) or the primary call to action sits below it (a warning).',
  async probe(ctx, vp) {
    if (vp.w !== 1280) return [];
    const f = await ctx.inPage(ctx.page, probeFold);
    const out = [];
    if (f.h1 && !f.h1.within) out.push({ sel: 'h1', msg: `the headline runs past the fold at 1280x800 (bottom ${f.h1.bottom}px > ${f.viewportH}px). "${f.h1.text}"`, measured: f.h1 });
    if (f.cta && !f.cta.within) out.push({ warning: true, sel: 'cta', msg: `the primary call to action sits below the fold at 1280x800 (top ${f.cta.top}px). "${f.cta.text}"`, measured: f.cta });
    return out;
  },
};

/* ── primary ──────────────────────────────────────────────────────────────────────────────── */
/* More than one accent-filled control on one screen means neither is primary. It counts what is on
 * screen at the top of each width, not what is on the page. Selected toggles (aria-pressed,
 * aria-selected, aria-current) are excluded on their declaration. The accent is named with
 * --accent, as a colour or a CSS variable; without it this rule cannot know which fill is the
 * accent, so it runs only when one is named. */
export function probePrimaries(accent) {
  let value = accent;
  if (/^--/.test(accent)) value = getComputedStyle(document.documentElement).getPropertyValue(accent).trim();
  if (!value) return { error: `the variable ${accent} is not defined on :root` };
  const probe = document.createElement('span');
  probe.style.color = value;
  document.body.appendChild(probe);
  const accentRgb = getComputedStyle(probe).color;
  probe.remove();
  const vh = window.innerHeight;
  const hits = [];
  for (const el of document.querySelectorAll('a, button, [role=button], input[type=submit]')) {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > vh || r.width < 8 || r.height < 8) continue;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ visibilityProperty: true })) continue;
    if (el.closest("[aria-hidden='true']")) continue;
    if (el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true') continue;
    if (el.getAttribute('aria-current') && el.getAttribute('aria-current') !== 'false') continue;
    if (getComputedStyle(el).backgroundColor !== accentRgb) continue;
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    hits.push({ sel: `${el.tagName.toLowerCase()}${cls}`, text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) });
  }
  return { hits };
}

export const primary = {
  id: 'primary',
  title: 'competing primary actions',
  scope: 'ladder',
  optIn: true,
  summary: 'Two or more controls filled with the accent colour on one screen at any width. Runs when --accent names the accent.',
  async probe(ctx, vp) {
    const r = await ctx.inPage(ctx.page, probePrimaries, ctx.options.accent);
    if (r.error) throw Object.assign(new Error(r.error), { cannotCheck: true });
    if (r.hits.length < 2) return [];
    return [
      {
        sel: r.hits.map((h) => h.sel).sort().join(' + '),
        msg: `${r.hits.length} accent-filled controls on one screen at ${vp.label}, so none of them reads as the primary action: ${r.hits.map((h) => `${h.sel} "${h.text}"`).join(', ')}`,
        measured: { viewport: vp.w, hits: r.hits },
      },
    ];
  },
};

export const LADDER_RULES = [overflow, wrap, fold, primary];
