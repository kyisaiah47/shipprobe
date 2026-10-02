/* `shipprobe page <url|file|dir> [...]`: rendered-page checks in a real browser.
 *
 * Every other check reads source. A page can pass all of them and still ship an invisible hero,
 * white-on-white text, a label nobody can reach, a dead scroll region or a route with no way home.
 * These rules open the page in Chromium and measure it: computed styles, geometry, real input and
 * pixels. Every finding names a selector and a number.
 *
 * Exit 0 clean, 1 a finding, 2 could not check (no browser, a page that did not render, a rule
 * that could not measure). 2 wins over 1 and the findings still print.
 */
import { newResult, PASS, FAIL, UNCHECKED } from '../result.mjs';
import { resolveChromium, targetToUrl, openPage, inPage, sitemapRoutes } from './browser.mjs';
import { pageRenderFailure } from './rendered.mjs';
import { selectRules, RULES } from './rules/index.mjs';
import { VIEWPORTS } from './rules/ladder.mjs';

export { RULES };

const list = (v) => (v === null || v === undefined || v === true ? null : String(v).split(',').map((s) => s.trim()).filter(Boolean));

export async function runPage(targets, opts = {}) {
  const result = newResult('page', targets.join(' '));
  if (!targets.length) {
    result.unchecked.push({ why: 'no target. Usage: shipprobe page <url|file|dir> [...]' });
    return result;
  }
  let rules;
  try {
    rules = selectRules({ only: list(opts.only), skip: list(opts.skip), accent: opts.accent || null });
  } catch (e) {
    result.unchecked.push({ why: e.message });
    return result;
  }
  const widths = (list(opts.vw) || ['1280']).map(Number).filter((n) => n > 0);
  if (!widths.length) {
    result.unchecked.push({ why: `--vw "${opts.vw}" names no width` });
    return result;
  }
  const settleMs = Number.isFinite(Number(opts.settle)) && opts.settle !== undefined ? Number(opts.settle) : 1500;
  const stopSettle = Math.min(750, Math.max(60, settleMs));

  let chromium;
  try {
    chromium = resolveChromium();
  } catch (e) {
    result.unchecked.push({ why: e.message });
    return result;
  }

  let all = [...targets];
  if (opts.sample) {
    const n = Number(opts.sample) || 6;
    for (const t of targets.filter((x) => /^https?:\/\//i.test(x))) {
      const { routes, error } = await sitemapRoutes(new URL(t).origin, n);
      if (error) result.notes.push(`${t}: ${error}; no interior routes were added`);
      for (const u of routes) if (!all.includes(u)) all.push(u);
    }
  }

  const browser = await chromium.launch({ args: ['--mute-audio'] });
  const cache = {};
  const perRule = new Map(rules.map((r) => [r.id, 0]));
  const add = (rule, where, items, key = 'findings') => {
    for (const f of items || []) {
      const isWarn = key === 'warnings' || f.warning;
      const entry = {
        id: rule.id,
        severity: isWarn ? 'medium' : 'high',
        title: `${rule.id}: ${f.msg}`,
        where: `${f.sel} @ ${where}`,
        measured: f.measured,
        failing: !isWarn,
      };
      if (isWarn) result.warnings.push({ title: entry.title, where: entry.where });
      else {
        result.findings.push(entry);
        perRule.set(rule.id, perRule.get(rule.id) + 1);
      }
    }
  };
  const fail = (where, why, rule) => result.unchecked.push({ where: rule ? `${where} [${rule}]` : where, why: String(why).split('\n')[0] });

  try {
    for (const target of all) {
      let resolved;
      try {
        resolved = await targetToUrl(target);
      } catch (e) {
        fail(target, e.message);
        continue;
      }
      try {
        /* width-scoped rules, at each --vw width */
        const widthRules = rules.filter((r) => r.scope === 'width');
        for (let i = 0; i < widths.length && widthRules.length; i++) {
          const width = widths[i];
          const where = `${resolved.url} @${width}px`;
          let page;
          let resp;
          try {
            ({ page, resp } = await openPage(browser, resolved.url, { width, height: 800, settleMs }));
          } catch (e) {
            fail(where, `the page could not be opened: ${e.message}`);
            continue;
          }
          try {
            const broke = await pageRenderFailure(page, resp, inPage);
            if (broke) {
              fail(where, broke.msg);
              continue;
            }
            const ctx = { browser, chromium, page, inPage, openPage, url: resolved.url, origin: resolved.origin, width, height: 800, settleMs, stopSettle, options: opts, cache, shared: {}, first: i === 0 };
            for (const rule of widthRules) {
              try {
                const out = await rule.run(ctx);
                add(rule, where, out.findings);
                add(rule, where, out.warnings, 'warnings');
                for (const n of out.notes || []) result.notes.push(`[${rule.id}] ${n}`);
              } catch (e) {
                fail(where, e.cannotCheck ? e.message : `the rule threw: ${e.message}`, rule.id);
              }
            }
          } finally {
            await page.close().catch(() => {});
          }
        }

        /* ladder rules, on one page stepped through the widths */
        const ladderRules = rules.filter((r) => r.scope === 'ladder');
        if (ladderRules.length) {
          let page;
          let resp;
          try {
            ({ page, resp } = await openPage(browser, resolved.url, { width: 1280, height: 800, settleMs }));
            const broke = await pageRenderFailure(page, resp, inPage);
            if (broke) throw Object.assign(new Error(broke.msg), { cannotCheck: true });
            const ctx = { page, inPage, url: resolved.url, options: opts };
            for (const vp of VIEWPORTS) {
              await page.setViewportSize({ width: vp.w, height: vp.h });
              await page.evaluate(() => document.fonts?.ready).catch(() => {});
              await page.waitForTimeout(350);
              for (const rule of ladderRules) {
                try {
                  for (const f of await rule.probe(ctx, vp)) add(rule, resolved.url, [f], f.warning ? 'warnings' : 'findings');
                } catch (e) {
                  fail(resolved.url, e.cannotCheck ? e.message : `the rule threw: ${e.message}`, rule.id);
                }
              }
            }
          } catch (e) {
            fail(resolved.url, e.message);
          } finally {
            if (page) await page.close().catch(() => {});
          }
        }

        /* page-scoped rules */
        for (const rule of rules.filter((r) => r.scope === 'page')) {
          try {
            const out = await rule.run({ chromium, browser, inPage, url: resolved.url, settleMs, options: opts });
            add(rule, resolved.url, out.findings);
          } catch (e) {
            fail(resolved.url, e.cannotCheck ? e.message : `the rule threw: ${e.message}`, rule.id);
          }
        }
      } finally {
        await resolved.close();
      }
    }
  } finally {
    await browser.close();
  }

  /* De-duplicate: the same finding at the same place reported by two stops or two widths. */
  const seen = new Set();
  result.findings = result.findings.filter((f) => {
    const k = `${f.title}|${f.where.replace(/ @\d+px$/, '')}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const n = result.findings.length;
  result.data = {
    targets: all,
    widths,
    rules: rules.map((r) => r.id),
    byRule: Object.fromEntries([...perRule].filter(([, v]) => v > 0)),
  };
  result.code = result.unchecked.length ? UNCHECKED : n ? FAIL : PASS;
  result.summary =
    `${all.length} page(s), rules ${rules.map((r) => r.id).join(', ')} at ${widths.join('/')}px. ` +
    `${n} finding(s), ${result.warnings.length} warning(s), ${result.unchecked.length} could not be checked.` +
    (n ? ` By rule: ${Object.entries(result.data.byRule).map(([k, v]) => `${k} ${v}`).join(', ')}.` : '');
  return result;
}
