/* contrast.mjs: THE contrast implementation. One colour parser, one ground walk, one ratio, used
 * for text, for glyphs, for the visibility rule and for the pixel arbiter.
 *
 * WHAT IT MEASURES
 *   TEXT     WCAG 1.4.3: 4.5:1, or 3:1 for large text (24px, or 18.66px bold).
 *   GLYPH    WCAG 1.4.11: 3:1 for an SVG mark that carries meaning. `aria-hidden` alone does not
 *            exempt a mark: a sighted reader still has to see it. Being inside a control whose own
 *            text passes does, because then the mark repeats the label.
 *   DUOTONE  the two tones inside one two-tone glyph: the plate against the ground at 1.35:1 and
 *            the mark against the plate at 1.25:1. Separation floors, not WCAG thresholds. Neither
 *            can trip on an untouched glyph; both fire on a plate some stylesheet has changed.
 *
 * THE GROUND IS WHAT IS PAINTED BEHIND THE TEXT, not what the element declares. The walk follows
 * the FLATTENED tree (a slotted node's parent is its slot, a shadow root's is its host), skips any
 * ancestor whose box does not contain the element's centre, skips `display: contents` boxes (they
 * paint nothing), composites every translucent layer with alpha carried, and falls through to the
 * canvas colour, which is not always white.
 *
 * WHEN THE STYLESHEET CANNOT KNOW, THE PIXELS DECIDE, IN ONE DIRECTION ONLY. A photograph under
 * the text (a url() background, or an <img>, <video> or <canvas> painted beneath it) and a gradient
 * make the computed ground an estimate. For those, and for any text that fails on the stylesheet,
 * the pixel arbiter hides every glyph, screenshots the viewport and takes the 10th percentile of
 * contrast against the real backdrop. The arbiter only ever DROPS a failure; it never raises one.
 * A failure that the pixels confirm stands. An estimate the pixels never read becomes a warning.
 *
 * WHAT DEMOTES A FAILURE TO A WARNING, BECAUSE THE MODEL DOES NOT APPLY
 *   blended    an ancestor carries mix-blend-mode or a filter, so the painted ink is not `color`
 *   occluded   something else is painted on top of the text at its centre
 *
 * WHAT IS NOT MEASURED, AND WHY EACH IS DECLARED OR GEOMETRIC RATHER THAN GUESSED
 *   aria-hidden text (declared decoration), a disabled control (WCAG 1.4.3 exempts it), a 1x1
 *   clipped visually-hidden heading (assistive only), a box clipped to nothing (a sprite sheet), a
 *   box outside its clipping ancestor (an off-screen carousel tile), a closed <details> (laid out,
 *   never painted), a transparent-ink editor over a highlighted twin (the twin is measured instead).
 *
 * Every guard here exists because a version without it reported a finding on a page that renders
 * correctly. A gate that invents findings gets switched off, which costs more than the defect it
 * was written to catch.
 */

/** In-page. `mode` is "text" (every text run, with in-view flags) or "glyph" (SVG marks). */
export function contrastProbe(mode) {
  /* COLOUR IS ASKED OF THE BROWSER, NOT PARSED. Tailwind v4 computes `text-white/70` to
   * `oklab(0.999 0 0 / 0.7)`. A regex that only knows rgb() turns that into black, and a white
   * label on near-black measured 1.06:1. A 1x1 canvas resolves every syntax the browser can paint.
   * Two sentinels separate "this colour is black" from "the browser did not understand it": an
   * invalid value leaves fillStyle at whatever preceded it, so assigning after black and after
   * white disagree only for an invalid string. */
  let cc = null;
  const cache = new Map();
  const parse = (s) => {
    const str = String(s);
    if (!str || str === 'none') return null;
    if (cache.has(str)) return cache.get(str);
    let out = null;
    const m = str.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      if (p.length >= 3 && p.every((n) => Number.isFinite(n))) out = { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    }
    if (!out) {
      try {
        if (!cc) {
          const cv = document.createElement('canvas');
          cv.width = 1;
          cv.height = 1;
          cc = cv.getContext('2d', { willReadFrequently: true });
        }
        cc.fillStyle = '#000000';
        cc.fillStyle = str;
        const asBlack = cc.fillStyle;
        cc.fillStyle = '#ffffff';
        cc.fillStyle = str;
        if (asBlack === cc.fillStyle) {
          cc.clearRect(0, 0, 1, 1);
          cc.fillRect(0, 0, 1, 1);
          const d = cc.getImageData(0, 0, 1, 1).data;
          out = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
        }
      } catch {
        out = null;
      }
    }
    cache.set(str, out);
    return out;
  };
  /* Source-over WITH alpha. Two stacked 5% tints are not opaque. */
  const over = (fg, bg) => {
    const a = fg.a + bg.a * (1 - fg.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
      g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
      b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
      a,
    };
  };
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const rgbStr = (c) => `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
  const flatParent = (n) => {
    if (n.assignedSlot) return n.assignedSlot;
    const p = n.parentNode;
    if (p && p.nodeType === 11 && p.host) return p.host;
    return n.parentElement;
  };
  const where = (el) => {
    const bits = [];
    for (let n = el; n && n !== document.body && bits.length < 3; n = n.parentElement) {
      const cls = typeof n.className === 'string' && n.className.trim() ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      bits.unshift(n.tagName.toLowerCase() + (n.id ? `#${n.id}` : '') + cls);
    }
    return bits.join(' > ');
  };

  /* A photograph is not always a background-image. An <img> sibling painted under a card's text
   * has no ancestor background at all. Asked with geometry, once per page. */
  let grounds = null;
  const imageGrounds = () => {
    if (grounds) return grounds;
    grounds = [];
    for (const n of document.querySelectorAll('img, video, canvas')) {
      const r = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      if (r.width < 8 || r.height < 8 || cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.1) continue;
      grounds.push({ el: n, left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    }
    return grounds;
  };
  const canvasOf = () => {
    for (const n of [document.documentElement, document.body]) {
      const c = n ? parse(getComputedStyle(n).backgroundColor) : null;
      if (c && c.a > 0) return { ...c, a: 1 };
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };

  /** The painted ground behind `el`, starting the walk at `from`. */
  const ground = (el, from = el) => {
    const R = el.getBoundingClientRect();
    const cx = R.left + R.width / 2;
    const cy = R.top + R.height / 2;
    let imageBacked =
      R.width > 0 &&
      R.height > 0 &&
      imageGrounds().some((g) => !g.el.contains(el) && R.left < g.right && R.right > g.left && R.top < g.bottom && R.bottom > g.top);
    const behind = (n) => {
      if (n === el || n === from) return true;
      const r = n.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return true;
      return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
    };
    const layers = [];
    for (let n = from; n; n = flatParent(n)) {
      if (n.nodeType !== 1) continue;
      const s = getComputedStyle(n);
      if (s.display === 'contents' || !behind(n)) continue;
      let opaque = false;
      const img = s.backgroundImage;
      if (img && img !== 'none') {
        imageBacked = true;
        if (!/\burl\(/.test(img)) {
          /* A gradient's average is an estimate of the colour under the text. It is composited, so
           * the number is the best available, and the pixels decide. */
          const stops = (img.match(/(?:rgba?|hsla?|hwb|oklab|oklch|lab|lch|color)\([^()]*\)/g) || []).map(parse).filter(Boolean);
          if (stops.length) {
            const sum = stops.reduce((a, c) => ({ r: a.r + c.r, g: a.g + c.g, b: a.b + c.b, a: a.a + c.a }), { r: 0, g: 0, b: 0, a: 0 });
            const layer = { r: sum.r / stops.length, g: sum.g / stops.length, b: sum.b / stops.length, a: sum.a / stops.length };
            layers.push(layer);
            if (layer.a >= 0.999) opaque = true;
          }
        }
      }
      const c = parse(s.backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 0.999) opaque = true;
      }
      if (opaque) break;
    }
    let bg = canvasOf();
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    return { bg: { ...bg, a: 1 }, imageBacked };
  };

  /* Clipped to nothing: a 0x0 positioned clipping ancestor, the sprite-sheet shape. A display:
   * contents box reports 0x0 and clips nothing, so it is excluded. */
  const clipCache = new WeakMap();
  const clippedAway = (el) => {
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      if (clipCache.has(n)) {
        if (clipCache.get(n)) return true;
        continue;
      }
      const s = getComputedStyle(n);
      const hit = s.display !== 'contents' && (n.clientWidth === 0 || n.clientHeight === 0) && s.overflow !== 'visible' && s.display !== 'inline' && s.position !== 'static';
      clipCache.set(n, hit);
      if (hit) return true;
    }
    return false;
  };
  /* Outside its clipping ancestor: a carousel tile laid out off screen inside an overflow:clip
   * track. The walk stops at any positioned box, because an absolute descendant can paint outside
   * an ancestor's clip; there it answers "cannot prove it is clipped" and measures. */
  const outsideClip = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.position !== 'static' && s.position !== 'relative') return false;
      if (n === el || s.display === 'contents') continue;
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      if (n.clientWidth <= 0 || n.clientHeight <= 0) continue;
      const b = n.getBoundingClientRect();
      if (r.right <= b.left + 0.5 || r.left >= b.right - 0.5 || r.bottom <= b.top + 0.5 || r.top >= b.bottom - 0.5) return true;
    }
    return false;
  };
  const blendedAt = (el) => {
    for (let n = el; n; n = flatParent(n)) {
      if (n.nodeType !== 1) continue;
      const s = getComputedStyle(n);
      if (s.mixBlendMode !== 'normal' || (s.filter && s.filter !== 'none')) return true;
    }
    return false;
  };

  if (mode === 'text') {
    const ownText = (el) => {
      let t = '';
      for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
      return t.replace(/\s+/g, ' ').trim();
    };
    const out = [];
    for (const el of document.body ? document.body.querySelectorAll('*') : []) {
      const text = ownText(el);
      if (!text) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      /* checkVisibility answers "is this painted" for display:none anywhere up the chain and for a
       * closed <details>, which keeps a box and is never painted. Opacity is deliberately NOT
       * delegated to it: opacity is what the visibility rule measures. */
      if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ visibilityProperty: true })) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (rect.width <= 4 && rect.height <= 4 && (cs.clipPath !== 'none' || (cs.clip && cs.clip !== 'auto'))) continue;
      if (clippedAway(el) || outsideClip(el)) continue;

      const decorative = !!el.closest("[aria-hidden='true']");
      const inactive = !!el.closest("[disabled],[aria-disabled='true']");

      const ccx = Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
      const ccy = Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
      const inFold = rect.top < innerHeight && rect.bottom > 0;
      const onTop = inFold ? document.elementFromPoint(ccx, ccy) : null;
      const occluded = !!onTop && onTop !== el && !onTop.contains(el) && !el.contains(onTop);

      /* EFFECTIVE opacity, the whole flattened chain multiplied. An ancestor at 0.001 makes this
       * text invisible whatever its own opacity says. A display:contents box generates no box, so
       * its opacity and transform are inert; its visibility still inherits. A transform collapses
       * paint only when its linear part is singular, which a rotation is not. */
      let opacity = 1;
      let clipped = false;
      for (let n = el; n && n !== document.documentElement; n = flatParent(n)) {
        if (n.nodeType !== 1) continue;
        const s = getComputedStyle(n);
        if (s.display === 'contents') {
          if (s.visibility === 'hidden') clipped = true;
          continue;
        }
        opacity *= parseFloat(s.opacity);
        if (s.visibility === 'hidden') clipped = true;
        const m = new DOMMatrixReadOnly(s.transform === 'none' ? '' : s.transform);
        if (Math.abs(m.a * m.d - m.b * m.c) < 1e-4) clipped = true;
      }

      /* An editor that paints its text through an aria-hidden twin: a transparent-ink textarea
       * over a highlighted <pre> with the same string in the same box. The twin is what the reader
       * sees, so the twin is measured. With no twin, a control with alpha-0 ink and a visible caret
       * is an input layer, not unreadable text. */
      let painter = el;
      const ownFg = parse(cs.color);
      if (ownFg && ownFg.a < 0.05 && el.parentElement) {
        const mine = (el.value ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
        for (const cand of el.parentElement.querySelectorAll("[aria-hidden='true']")) {
          if (cand === el || cand.contains(el)) continue;
          if ((cand.textContent || '').replace(/\s+/g, ' ').trim() !== mine) continue;
          const cr = cand.getBoundingClientRect();
          const ov = Math.max(0, Math.min(rect.right, cr.right) - Math.max(rect.left, cr.left)) * Math.max(0, Math.min(rect.bottom, cr.bottom) - Math.max(rect.top, cr.top));
          if (ov > 0.5 * Math.min(rect.width * rect.height, cr.width * cr.height)) {
            painter = cand;
            break;
          }
        }
        if (painter === el && /^(TEXTAREA|INPUT)$/.test(el.tagName)) {
          const caret = parse(cs.caretColor);
          if (caret && caret.a > 0) continue;
        }
      }
      const paintCs = painter === el ? cs : getComputedStyle(painter);
      const { bg, imageBacked } = ground(el, painter);
      const fg = parse(paintCs.color) ?? { r: 0, g: 0, b: 0, a: 1 };
      const fgOver = over({ ...fg, a: fg.a * opacity }, bg);
      const r = ratio(fgOver, bg);
      const size = parseFloat(paintCs.fontSize);
      const weight = parseInt(paintCs.fontWeight, 10) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const inset = (a, b) => (parseFloat(cs[a]) || 0) + (parseFloat(cs[b]) || 0);
      const il = inset('borderLeftWidth', 'paddingLeft');
      const ir = inset('borderRightWidth', 'paddingRight');
      const it = inset('borderTopWidth', 'paddingTop');
      const ib = inset('borderBottomWidth', 'paddingBottom');
      const sel = where(el);
      out.push({
        key: `${sel}|${text.slice(0, 70)}`,
        sel,
        text: text.slice(0, 70),
        opacity: Math.round(opacity * 1000) / 1000,
        clipped,
        decorative,
        inactive,
        heading: /^H[1-6]$/.test(el.tagName),
        ratio: Math.round(r * 100) / 100,
        need: large ? 3 : 4.5,
        px: Math.round(size),
        imageBacked,
        blended: blendedAt(painter),
        occluded,
        occluder: occluded ? where(onTop) : null,
        inFold,
        top: Math.round(rect.top + scrollY),
        color: paintCs.color,
        on: rgbStr(bg),
        fg: [Math.round(fgOver.r), Math.round(fgOver.g), Math.round(fgOver.b)],
        box: { x: Math.round(rect.left + il), y: Math.round(rect.top + it), w: Math.round(rect.width - il - ir), h: Math.round(rect.height - it - ib) },
      });
    }
    return out;
  }

  /* ── GLYPHS ─────────────────────────────────────────────────────────────────────────────── */
  const out = [];
  let skipped = 0;
  const seen = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return false;
    return r.width >= 4 && r.height >= 4 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05 && !clippedAway(el) && !outsideClip(el);
  };
  /* A motif is not a mark: the same sprite id drawn eight or more times, never beside a word and
   * never inside a control, identifies nothing. A footer of twenty different invisible social
   * marks is twenty different ids, so each one is still measured. */
  const MOTIF_MIN = 8;
  const hrefOf = (svg) => {
    const u = svg.querySelector('use');
    return (u && (u.getAttribute('href') || u.getAttribute('xlink:href'))) || '';
  };
  const motifIds = (() => {
    const tally = new Map();
    for (const el of document.querySelectorAll('svg')) {
      const href = hrefOf(el);
      if (!href.startsWith('#')) continue;
      const rec = tally.get(href) || { n: 0, bare: 0 };
      rec.n++;
      const labelled = (el.parentElement?.innerText || '').trim().length > 0;
      if (!labelled && !el.closest('a, button, [role=button], label, summary')) rec.bare++;
      tally.set(href, rec);
    }
    return new Set([...tally].filter(([, r]) => r.n >= MOTIF_MIN && r.bare === r.n).map(([k]) => k));
  })();
  const DEFS = new Set(['defs', 'mask', 'clippath', 'pattern', 'marker', 'filter', 'symbol']);
  const isDefinition = (el, root) => {
    for (let n = el.parentElement; n && n !== root; n = n.parentElement) if (DEFS.has((n.tagName || '').toLowerCase())) return true;
    return false;
  };
  const transparent = (v) => !v || v === 'none' || v === 'transparent' || /^rgba?\(0, 0, 0, 0\)$/.test(v);
  const SHAPES = 'path, circle, ellipse, rect, polygon';

  for (const svg of document.querySelectorAll('svg')) {
    if (!seen(svg)) continue;
    if (motifIds.has(hrefOf(svg))) continue;
    if (blendedAt(svg)) {
      skipped++;
      continue;
    }
    const control = svg.closest('a, button, [role=button]');
    /* role="presentation" beside its own label is an author's deliberate mark (rare on a page),
     * while aria-hidden is on almost every exported svg, so only the former exempts. */
    const labelledSibling = svg.getAttribute('role') === 'presentation' && Boolean(svg.parentElement && (svg.parentElement.innerText || '').trim().length > 1);
    const ornamental = Boolean((control && (control.innerText || '').trim().length > 1) || labelledSibling);
    const cs = getComputedStyle(svg);
    const resolveVar = (v, host) => {
      const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+?)\s*)?\)$/.exec((v || '').trim());
      if (!m) return v;
      return getComputedStyle(host).getPropertyValue(m[1]).trim() || (m[2] ?? '');
    };
    /* A fill at fill-opacity 0 is not ink. */
    const paints = (el) => {
      const fo = el.getAttribute('fill-opacity');
      const o = fo && /^var\(/.test(fo) ? resolveVar(fo, svg) : fo ?? getComputedStyle(el).fillOpacity;
      return parseFloat(o) !== 0;
    };
    let inkShapes = [...svg.querySelectorAll(SHAPES)].filter((e) => !isDefinition(e, svg));
    let sprite = false;
    let spriteRoot = null;
    if (!inkShapes.length) {
      const href = hrefOf(svg);
      const sym = href.startsWith('#') ? document.getElementById(href.slice(1)) : null;
      if (sym) {
        inkShapes = [...sym.querySelectorAll(SHAPES)].filter((e) => !isDefinition(e, sym));
        sprite = true;
        spriteRoot = sym;
      }
    }
    /* In a sprite, `currentColor` resolves against the REFERENCING svg, and the paint often sits
     * on a wrapper <g>, so attributes are read up to the symbol. */
    const spriteAttr = (el, name) => {
      for (let n = el; n && n !== spriteRoot?.parentElement; n = n.parentElement) {
        const a = n.getAttribute && n.getAttribute(name);
        if (a != null) return a;
      }
      return null;
    };
    const deCurrent = (v) => (typeof v === 'string' && v.trim().toLowerCase() === 'currentcolor' ? cs.color : v);
    const fillOf = (el) => (sprite ? deCurrent(resolveVar(spriteAttr(el, 'fill') ?? getComputedStyle(el).fill, svg)) : getComputedStyle(el).fill);
    const strokeOf = (el) => (sprite ? deCurrent(resolveVar(spriteAttr(el, 'stroke') ?? getComputedStyle(el).stroke, svg)) : getComputedStyle(el).stroke);
    const drawn = inkShapes.filter(paints);
    const solid = drawn.find((el) => !el.hasAttribute('opacity')) ?? drawn[0];
    let raw = cs.color;
    if (solid) {
      const f = fillOf(solid);
      if (!transparent(f)) raw = f;
    }
    /* A line drawing is stroked, not filled. The stroke is read only when there is no fill. */
    if (raw === cs.color) {
      const strokeShapes =
        inkShapes.length && sprite
          ? inkShapes.concat([...(inkShapes[0].ownerSVGElement?.querySelectorAll('line, polyline') ?? [])])
          : [...svg.querySelectorAll('path, circle, ellipse, rect, polygon, line, polyline')];
      const stroked = strokeShapes.find((el) => {
        const noFill = transparent(fillOf(el)) || !paints(el);
        const sk = strokeOf(el);
        return noFill && !transparent(sk) && parseFloat(getComputedStyle(el).strokeWidth) > 0;
      });
      if (stroked) raw = strokeOf(stroked);
      /* A rule is not a mark: an unlabelled, uncontrolled svg of straight unclosed-or-closed lines
       * with no curve is a grid guide, meant to be faint. Zero-radius arcs are straight lines. */
      const host = sprite && spriteRoot ? spriteRoot : svg;
      const shapes = [...host.querySelectorAll('path, line, polyline, circle, ellipse, rect, polygon')];
      const straight =
        shapes.length > 0 &&
        shapes.every((el) => {
          const t = el.tagName.toLowerCase();
          if (t === 'line' || t === 'polyline') return true;
          if (t !== 'path') return false;
          const d = (el.getAttribute('d') || '').replace(/[Aa]\s*0*(?:\.0+)?[,\s]+0*(?:\.0+)?[,\s]/g, ' ');
          return d.length > 0 && !/[CcSsQqTt]/.test(d) && !/[Aa]/.test(d);
        });
      const labelled = (svg.parentElement?.innerText || '').trim().length > 0;
      if (stroked && straight && !labelled && !control) continue;
    }
    const fg = parse(raw) ?? parse(cs.color);
    if (!fg) continue;
    const g = ground(svg.parentElement || svg);
    if (g.imageBacked) {
      skipped++;
      continue;
    }
    const bg = g.bg;
    const r = ratio(over(fg, bg), bg);
    const label = (svg.parentElement?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (r < 3 && !ornamental) out.push({ kind: 'glyph', ratio: +r.toFixed(2), need: 3, color: raw, on: rgbStr(bg), text: label, sel: where(svg) });

    /* Duotone separation. It does NOT take the ornamental exemption: a mark that repeats its label
     * is redundant to meaning, which is no reason to stop noticing the drawing fell apart. The
     * plate is found by its AUTHORED opacity attribute, because the defect is a stylesheet forcing
     * both paths to opacity 1; a finder keyed on computed opacity would miss exactly that. */
    if (r >= 3 || ornamental) {
      const paths = [...svg.querySelectorAll(SHAPES)];
      const plate = paths.length > 1 ? paths.find((el) => el.hasAttribute('opacity')) : null;
      if (plate) {
        const pcs = getComputedStyle(plate);
        const po = Number(pcs.opacity);
        const pc = parse(pcs.fill) ?? fg;
        const plated = over({ ...pc, a: (pc.a ?? 1) * po }, bg);
        const vsGround = ratio(plated, bg);
        const vsMark = ratio(over(fg, bg), plated);
        const base = { color: raw, on: rgbStr(bg), text: label, sel: where(svg) };
        if (po >= 0.95 && vsMark < 1.05) {
          out.push({ ...base, kind: 'duotone-tones', ratio: +vsMark.toFixed(2), need: 1.25, note: "the plate's opacity is overridden to 1, so the glyph is drawn as two tones and paints as one shape" });
        } else if (vsGround < 1.35) {
          out.push({ ...base, kind: 'duotone-plate', ratio: +vsGround.toFixed(2), need: 1.35, note: 'the plate half of the glyph is not separated from the ground, so it paints nothing' });
        } else if (vsMark < 1.25) {
          out.push({ ...base, kind: 'duotone-tones', ratio: +vsMark.toFixed(2), need: 1.25, note: 'the two tones are within a step of each other, so the glyph reads as one blob' });
        }
      }
    }
  }
  return { findings: out, skipped };
}

/* ── THE PIXEL ARBITER (Node side) ──────────────────────────────────────────────────────────
 * Every glyph is made transparent (and its shadow removed, since a shadow is painted from the
 * text), the viewport is captured, and for each condemned run the 10th percentile of contrast
 * between its painted ink and the pixels in its content box is taken. The 10th percentile because
 * the worst pixel fails everything, the mean passes everything, and a tenth of the backdrop is the
 * smallest share that can hide a word. Decoded in the page with a canvas: no image library. */
export async function arbitrate(page, runs) {
  if (!runs.length) return new Map();
  const style = await page.addStyleTag({
    content: `*, *::before, *::after { color: transparent !important; text-shadow: none !important; -webkit-text-fill-color: transparent !important; caret-color: transparent !important; }`,
  });
  await page.waitForTimeout(200);
  let shot;
  try {
    shot = (await page.screenshot({ type: 'png' })).toString('base64');
  } finally {
    await style.evaluate((n) => n.remove()).catch(() => {});
    await page.waitForTimeout(100);
  }
  const sampled = await page.evaluate(
    async ({ shot, runs }) => {
      const lin = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const img = new Image();
      img.src = 'data:image/png;base64,' + shot;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const dpr = img.width / innerWidth;
      const out = [];
      for (const run of runs) {
        const x = Math.round(run.box.x * dpr);
        const y = Math.round(run.box.y * dpr);
        const w = Math.round(run.box.w * dpr);
        const h = Math.round(run.box.h * dpr);
        if (w < 2 || h < 2 || x < 0 || y < 0 || x + w > c.width || y + h > c.height) continue;
        let data;
        try {
          data = ctx.getImageData(x, y, w, h).data;
        } catch {
          continue;
        }
        const fl = lum(run.fg[0], run.fg[1], run.fg[2]);
        const ratios = [];
        for (let i = 0; i < data.length; i += 4) ratios.push(ratio(fl, lum(data[i], data[i + 1], data[i + 2])));
        if (!ratios.length) continue;
        ratios.sort((a, b) => a - b);
        out.push({ key: run.key, pct: Math.round(ratios[Math.floor(ratios.length * 0.1)] * 100) / 100 });
      }
      return out;
    },
    { shot, runs },
  );
  return new Map(sampled.map((s) => [s.key, s.pct]));
}

export const OPACITY_FLOOR = 0.08;

/** Scroll stops spread over the WHOLE page height. A fixed step with a hard cap stopped covering
 *  a long page entirely, and every element below the cap was never judged. */
export async function stopsFor(page, max = 14) {
  return page.evaluate((MAX) => {
    const h = Math.max(document.body?.scrollHeight || 0, document.documentElement.scrollHeight);
    const step = Math.max(Math.round(innerHeight * 0.75), Math.ceil(h / MAX));
    const out = [];
    for (let y = 0; y < h; y += step) out.push(y);
    return out.length ? out.slice(0, MAX) : [0];
  }, max);
}

/** Walk the page, probe what is in view at each stop, arbitrate the condemned runs with pixels at
 *  that stop, and keep the BEST reading of each run: if it was ever properly painted, it works. */
export async function textSweep(page, inPage, { stopSettle = 750, pixels = true } = {}) {
  const seen = new Map();
  for (const y of await stopsFor(page)) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(stopSettle);
    const here = await inPage(page, contrastProbe, 'text');
    let px = new Map();
    if (pixels) {
      const condemned = here.filter((t) => t.inFold && t.ratio < t.need && t.opacity >= OPACITY_FLOOR && !t.decorative && !t.inactive && t.box.w >= 2 && t.box.h >= 2);
      if (condemned.length) px = await arbitrate(page, condemned.map((t) => ({ key: t.key, fg: t.fg, box: t.box }))).catch(() => new Map());
    }
    for (const t of here) {
      if (!t.inFold) continue;
      /* An occluded run's backdrop pixels belong to whatever lies on top of it. The arbiter exists
       * to drop failures, so a misleading reading here would drop a real one. Never attached. */
      if (px.has(t.key) && !t.occluded) t.pxRatio = px.get(t.key);
      const prev = seen.get(t.key);
      if (!prev || t.opacity > prev.opacity) {
        if (prev && prev.pxRatio != null && (t.pxRatio == null || prev.pxRatio > t.pxRatio)) t.pxRatio = prev.pxRatio;
        seen.set(t.key, t);
      } else if (t.pxRatio != null && (prev.pxRatio == null || t.pxRatio > prev.pxRatio)) prev.pxRatio = t.pxRatio;
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  return [...seen.values()];
}

/** Text verdicts: a failure, a warning (the model does not apply and the pixels did not settle
 *  it), or nothing. */
export function textVerdicts(runs) {
  const findings = [];
  const warnings = [];
  let estimated = 0;
  for (const t of runs) {
    if (t.opacity < OPACITY_FLOOR || t.clipped || t.decorative || t.inactive) continue;
    if (t.ratio >= t.need) {
      if (t.imageBacked) estimated++;
      continue;
    }
    if (t.pxRatio != null && t.pxRatio >= t.need) continue;
    const unsure = t.blended || t.occluded;
    const measured = t.pxRatio != null && !unsure;
    const msg = measured
      ? `${t.pxRatio}:1 against the pixels painted behind it (10th percentile), needs ${t.need}:1 at ${t.px}px. ${t.color} on the painted backdrop.`
      : t.occluded
        ? `${t.ratio}:1 by the stylesheet, but ${t.occluder} is painted on top of it, so this is not what a reader sees. Dismiss the overlay and measure again.`
        : t.blended
          ? `${t.ratio}:1 by the stylesheet, but an ancestor carries mix-blend-mode or a filter, so the painted ink is not this colour. Verify by eye.`
          : `${t.ratio}:1 against its computed background, needs ${t.need}:1 at ${t.px}px. ${t.color} on ${t.on}${t.imageBacked ? '. It sits over a gradient or an image the pixels could not settle, so the ratio is an estimate' : ''}.`;
    const item = { sel: t.sel, msg: `${msg} "${t.text}"`, measured: { ratio: t.ratio, pxRatio: t.pxRatio ?? null, need: t.need, px: t.px, color: t.color, on: t.on, text: t.text } };
    if (measured || (!t.imageBacked && !unsure)) findings.push(item);
    else warnings.push(item);
  }
  const notes = estimated
    ? [`${estimated} text run(s) sit over an image or a gradient and pass on the stylesheet's estimate of the ground. The pixel arbiter only reviews failures, so those passes are estimates.`]
    : [];
  return { findings, warnings, notes };
}

const GLYPH_KIND = {
  glyph: 'glyph below WCAG 1.4.11',
  'duotone-plate': 'duotone plate lost in the ground',
  'duotone-tones': 'duotone tones collapsed',
};

export function glyphVerdicts({ findings, skipped }) {
  return {
    findings: findings.map((f) => ({
      sel: f.sel,
      msg: `${GLYPH_KIND[f.kind]}: ${f.ratio}:1, needs ${f.need}:1. ${f.color} on ${f.on}.${f.note ? ` ${f.note}.` : ''}${f.text ? ` "${f.text}"` : ''}`,
      measured: f,
    })),
    notes: skipped
      ? [`${skipped} glyph(s) were not measured: their ground is an image, a gradient or a blend, so the colour a reader receives cannot be read from the DOM. Said here rather than guessed.`]
      : [],
  };
}
