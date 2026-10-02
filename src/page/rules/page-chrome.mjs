/* page-chrome.mjs: every page wears the site's own header and footer.
 *
 * THE DEFECT. A route added by hand renders its own content and nothing else. No nav, no footer,
 * because the shell is a component somebody has to remember to wrap in and nothing anywhere says
 * so. It builds, it deploys, it returns 200, and it is a dead end: no way back to the product, no
 * pricing link, no footer. Every other check passes it.
 *
 * HOW IT DECIDES. The HOME PAGE of the same origin is the reference. There is no absolute
 * definition of "this site's chrome", only "what this site puts on its own front page". For each
 * route it compares:
 *
 *   NAV        the set of internal hrefs inside <nav>, <header> or [role=navigation]. A route
 *              passes when it carries at least half of home's nav destinations. Half, not all,
 *              because a legitimate sub-shell may drop a section link, and a page inside a
 *              signed-in shell has a nav of its own.
 *   FOOTER     a <footer> exists and holds at least one internal link. Footers vary far more than
 *              navs across a set of sites, so the check is presence, not similarity.
 *   HOME LINK  somewhere on the page an anchor points at `/`. A page with chrome that cannot get
 *              you back to the product is the same dead end wearing a nav.
 *
 * IT READS THE RENDERED PAGE, NOT THE SOURCE. Whether the route wrapped itself in the right
 * component is not the question; whether a reader can see a nav is. That also makes it work on a
 * static export, an exported template, and an app whose source is not on this machine.
 *
 * THE HOME PAGE IS THE REFERENCE, SO IT IS NEVER ITS OWN FINDING. Point the run at an interior
 * route, or pass a directory holding an index.html and the routes beside it. Where no home page
 * can be read the rule exits 2 and says which URL it tried, because "I could not check" and "I
 * checked and it was fine" are different answers and only one of them is green.
 */
import { CannotCheck } from "../../exit.mjs";

export const id = "page-chrome";
export const title = "page chrome";
export const scope = 'width';
export const summary =
  "A route that renders without the nav, the footer or a link home that its own front page " +
  "carries, measured against that front page rather than against a template.";

export function probeChrome() {
  const origin = location.origin;
  const internal = (a) => {
    const h = a.getAttribute("href");
    if (!h || h.startsWith("#") || /^(mailto|tel|javascript):/i.test(h)) return null;
    try {
      const u = new URL(h, origin);
      return u.origin === origin ? u.pathname.replace(/\/$/, "") || "/" : null;
    } catch {
      return null;
    }
  };
  const seen = (root) => {
    const out = new Set();
    for (const a of root.querySelectorAll("a[href]")) {
      const p = internal(a);
      if (p) out.add(p);
    }
    return [...out];
  };
  const visible = (n) => {
    const r = n.getBoundingClientRect();
    const s = getComputedStyle(n);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };

  const navRoots = [...document.querySelectorAll("nav, header, [role=navigation]")].filter(visible);
  const footRoots = [...document.querySelectorAll("footer, [role=contentinfo]")].filter(visible);

  return {
    path: location.pathname.replace(/\/$/, "") || "/",
    nav: [...new Set(navRoots.flatMap(seen))],
    navCount: navRoots.length,
    footer: [...new Set(footRoots.flatMap(seen))],
    footerCount: footRoots.length,
    homeLink: seen(document.body).includes("/"),
  };
}

/* One reference read per origin per run, cached on the shared context. */
async function homeChrome(ctx) {
  const homeUrl = ctx.options.home || `${ctx.origin}/`;
  ctx.cache.home = ctx.cache.home || new Map();
  const key = `${homeUrl}@${ctx.width}`;
  if (ctx.cache.home.has(key)) return ctx.cache.home.get(key);
  let value;
  try {
    const { page, resp } = await ctx.openPage(ctx.browser, homeUrl, { width: ctx.width, height: ctx.height, settleMs: ctx.settleMs });
    try {
      const status = resp && typeof resp.status === "function" ? resp.status() : null;
      if (status !== null && status >= 400) {
        throw new CannotCheck(
          `the reference home page answered HTTP ${status} at ${homeUrl}, so there is nothing to ` +
            `compare this route's chrome against. Pass --home <url> to name the front page.`,
        );
      }
      value = { url: homeUrl, chrome: await ctx.inPage(page, probeChrome) };
    } finally {
      await page.close();
    }
  } catch (e) {
    if (e instanceof CannotCheck) throw e;
    throw new CannotCheck(
      `the reference home page could not be read at ${homeUrl}: ${String(e.message || e).split("\n")[0]}. ` +
        `Pass --home <url> to name the front page.`,
    );
  }
  ctx.cache.home.set(key, value);
  return value;
}

export async function run(ctx) {
  const { page, inPage, url } = ctx;
  const home = await homeChrome(ctx);
  const here = await inPage(page, probeChrome);

  const homeNav = new Set(home.chrome.nav);
  const sameAsHome = new URL(url).pathname.replace(/\/$/, "") === new URL(home.url).pathname.replace(/\/$/, "");
  if (sameAsHome) {
    return {
      findings: [],
      notes: [
        `this route IS the reference front page (${home.url}), so it defines the chrome rather ` +
          `than being measured against it. Point the run at an interior route to measure one.`,
      ],
    };
  }

  const shared = here.nav.filter((p) => homeNav.has(p)).length;
  const need = Math.max(1, Math.ceil(homeNav.size / 2));
  const missing = [];
  if (!here.navCount || shared < need) {
    missing.push(
      `nav: carries ${shared} of the front page's ${homeNav.size} nav destination(s), needs ${need}` +
        (here.navCount ? "" : ", and there is no <nav>, <header> or [role=navigation] on the page"),
    );
  }
  if (!here.footerCount || !here.footer.length) {
    missing.push(here.footerCount ? "footer: present but holds no internal link" : "footer: none on the page");
  }
  if (!here.homeLink) missing.push("no anchor anywhere on the page points at /");

  if (!missing.length) return { findings: [], notes: [] };
  return {
    findings: [
      {
        sel: "(page)",
        msg: `${missing.join("; ")}. Reference front page: ${home.url}`,
        measured: {
          navShared: shared,
          navNeeded: need,
          navOnHome: homeNav.size,
          footerLinks: here.footer.length,
          homeLink: here.homeLink,
          home: home.url,
        },
      },
    ],
    notes: [],
  };
}
