/* nested: a nested scroll region that does not scroll when a real wheel is driven over it.
 *
 * Smooth-scroll libraries listen for `wheel` on the document, call preventDefault, and animate the
 * PAGE. A wheel that started over an inner overflow:auto box is cancelled before the browser can
 * scroll that box. Nothing about it is visible: the box has its content and a scrollbar, computed
 * styles are right, a screenshot is right. The only way to know is to send the input.
 *
 *   The wheel is DIAGONAL, because a library that bails on deltaY === 0 lets a pure horizontal
 *   wheel through on a broken page, and no real trackpad is axis-perfect.
 *   It uses Playwright's mouse.wheel, a trusted input. dispatchEvent(new WheelEvent) scrolls
 *   nothing in any browser, so a check built on it would pass every page.
 *   Each region is scrolled into view, the page is allowed to settle, its rect is read again, and
 *   it is rewound to 0 on the probed axis, because an element already at its scroll end moves 0px
 *   and would read as broken.
 *
 * A POSITIVE CONTROL RUNS FIRST. Two probes with fixed outcomes: an overflowing box carrying
 * data-lenis-prevent must scroll in every configuration, and an overflow:hidden box must never
 * move. If either comes out wrong, the harness is broken and the whole run exits 2.
 *
 * It runs in its own browser with --hide-scrollbars removed, at 1280x800 and at 414 wide, where
 * wide tables finally have something to scroll.
 */
import { settle } from '../browser.mjs';

export const id = 'nested';
export const title = 'dead nested scroll regions';
export const scope = 'page';
export const summary = 'A nested scroll region that a real diagonal wheel cannot scroll, checked at 1280 and 414 wide behind a positive control.';

const PHANTOM = 48;

function probeScrollables(phantom) {
  const out = [];
  let n = 0;
  for (const el of document.body.querySelectorAll('*')) {
    if (el.hasAttribute('data-sp-probe')) continue;
    const cs = getComputedStyle(el);
    /* overflow-x: auto forces overflow-y to auto too, so wide table wrappers report a small phantom
     * vertical overflow. Under ~48px it is that artefact; a real dead region hides hundreds. */
    const sy = /^(auto|scroll|overlay)$/.test(cs.overflowY) && el.scrollHeight - el.clientHeight > phantom;
    const sx = /^(auto|scroll|overlay)$/.test(cs.overflowX) && el.scrollWidth - el.clientWidth > phantom;
    if (!sx && !sy) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) continue;
    const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    el.setAttribute('data-sp-scroll', String(n));
    out.push({ id: n, sel: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}`, axis: sy ? 'y' : 'x', exempt: !!el.closest('[data-lenis-prevent],[data-lenis-prevent-wheel]') });
    if (++n >= 40) break;
  }
  return out;
}

async function waitStill(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let last = -1;
        let stable = 0;
        const tick = () => {
          const y = Math.round(window.scrollY);
          stable = y === last ? stable + 1 : 0;
          last = y;
          if (stable >= 2) return resolve();
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

async function wheelOn(page, selector, axis, notches = 6) {
  const first = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    return true;
  }, selector);
  if (!first) return { skipped: true, why: 'not found' };
  await waitStill(page);
  const at = await page.evaluate(
    ([s, ax]) => {
      const el = document.querySelector(s);
      if (!el) return null;
      if (ax === 'y') el.scrollTop = 0;
      else el.scrollLeft = 0;
      const r = el.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      if (cx < 2 || cy < 2 || cx > innerWidth - 2 || cy > innerHeight - 2) return { off: true };
      const hit = document.elementFromPoint(cx, cy);
      if (!hit || !(el === hit || el.contains(hit))) return { occluded: true };
      const room = ax === 'y' ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
      return { cx, cy, top: el.scrollTop, left: el.scrollLeft, pageY: Math.round(scrollY), room };
    },
    [selector, axis],
  );
  if (!at || at.off || at.occluded) return { skipped: true, why: at?.occluded ? 'occluded' : 'off-screen' };
  if (at.room <= 1) return { skipped: true, why: 'no overflow on this axis' };
  await page.mouse.move(at.cx, at.cy);
  const [dx, dy] = axis === 'y' ? [24, 120] : [120, 24];
  for (let i = 0; i < notches; i++) {
    await page.mouse.wheel(dx, dy);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(700);
  const after = await page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? { top: el.scrollTop, left: el.scrollLeft, pageY: Math.round(scrollY) } : null;
  }, selector);
  if (!after) return { skipped: true, why: 'the element left the DOM' };
  return { moved: Math.round(axis === 'y' ? after.top - at.top : after.left - at.left), pageMoved: Math.round(after.pageY - at.pageY) };
}

async function control(page) {
  await page.evaluate(() => {
    const mk = (name, css) => {
      const d = document.createElement('div');
      d.setAttribute('data-sp-probe', name);
      d.style.cssText = `position:fixed;left:12px;width:220px;height:140px;z-index:2147483647;background:#fff;color:#000;${css}`;
      if (name === 'must-scroll') d.setAttribute('data-lenis-prevent', '');
      d.innerHTML = '<div style="height:1400px">probe</div>';
      document.body.appendChild(d);
    };
    mk('must-scroll', 'top:60px;overflow-y:auto');
    mk('must-not-scroll', 'top:220px;overflow-y:hidden');
  });
  const good = await wheelOn(page, '[data-sp-probe="must-scroll"]', 'y');
  const pos = await page.evaluate(() => {
    const el = document.querySelector('[data-sp-probe="must-not-scroll"]');
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { cx: Math.round(b.left + b.width / 2), cy: Math.round(b.top + b.height / 2), before: el.scrollTop };
  });
  let badMoved = null;
  if (pos) {
    await page.mouse.move(pos.cx, pos.cy);
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(24, 120);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => document.querySelector('[data-sp-probe="must-not-scroll"]')?.scrollTop ?? null);
    badMoved = after - pos.before;
  }
  await page.evaluate(() => document.querySelectorAll('[data-sp-probe]').forEach((n) => n.remove()));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const problems = [];
  if (good.skipped) problems.push(`the must-scroll probe could not be driven (${good.why})`);
  else if (!(good.moved > 0)) problems.push(`the must-scroll probe did not scroll (moved ${good.moved}px)`);
  if (!pos) problems.push('the must-not-scroll probe was not found');
  else if (badMoved !== 0) problems.push(`the must-not-scroll probe reported ${badMoved}px of movement`);
  return problems;
}

export async function run(ctx) {
  const browser = await ctx.chromium.launch({ args: ['--mute-audio'], ignoreDefaultArgs: ['--hide-scrollbars'] });
  const findings = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(ctx.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await settle(page, ctx.settleMs);
    const seen = new Set();
    for (const vp of [
      { w: 1280, h: 800, label: '1280x800' },
      { w: 414, h: 896, label: '414 wide' },
    ]) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.waitForTimeout(400);
      const problems = await control(page);
      if (problems.length) {
        const e = new Error(`the nested-scroll positive control failed at ${vp.label}: ${problems.join('; ')}. Nothing about nested scrolling was measured.`);
        e.cannotCheck = true;
        throw e;
      }
      for (const s of await page.evaluate(probeScrollables, PHANTOM)) {
        const r = await wheelOn(page, `[data-sp-scroll="${s.id}"]`, s.axis);
        if (r.skipped || r.moved > 0) continue;
        const key = `${s.sel}|${s.axis}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          sel: s.sel,
          msg:
            `a nested ${s.axis === 'y' ? 'vertical' : 'horizontal'} scroll region does not scroll at ${vp.label}: a real diagonal wheel over it moved it 0px and the page ${r.pageMoved}px. ` +
            (s.exempt
              ? 'It carries data-lenis-prevent, so the attribute is not taking effect; look for a competing wheel handler.'
              : "A smooth-scroll library is likely preventDefault-ing the wheel at the document; set its nested-scroll option or mark the region with the library's opt-out attribute."),
          measured: { ...s, viewport: vp.w, pageMoved: r.pageMoved },
        });
      }
      await page.evaluate(() => {
        document.querySelectorAll('[data-sp-scroll]').forEach((n) => n.removeAttribute('data-sp-scroll'));
        window.scrollTo(0, 0);
      });
    }
  } finally {
    await browser.close();
  }
  return { findings };
}
