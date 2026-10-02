/* The page rendered, or the run says so instead of passing.
 *
 * `page.goto` does not throw on an HTTP error status: a 500 resolves like any other navigation. The
 * error page then paints two elements, every geometry rule returns an empty list because there is
 * nothing to measure, and an empty list prints a pass. So before any rule is asked anything, this
 * decides whether there is a page at all.
 *
 * Signals, each one something the response or the framework itself declares:
 *   status >= 400                      a fact, not an inference
 *   html#__next_error__, .next-error-h1, meta[name=next-error], vite-error-overlay, the Next dev
 *   overlay inside its shadow root     the framework's own error page
 *   blank                              ink on under 8% of one viewport AND under 400 characters
 *
 * The blank floors were measured on a Next app: broken routes put ink on 0 to 3.1% of a viewport
 * with up to 141 characters; the thinnest real page put ink on 14.3%. Both floors must be missed:
 * a picture-led page clears the ink floor on its figure alone, and a dense text page clears the
 * text floor. A meta refresh stub, a 204 and a non-HTML response are exempt by their own
 * declaration.
 */

export const BLANK_INK = 0.08;
export const BLANK_TEXT = 400;
const DOCUMENT_TYPE = /^\s*(?:text\/html|application\/xhtml\+xml)\b/i;

export function probePageRendered() {
  const REPLACED = new Set(['IMG', 'SVG', 'CANVAS', 'VIDEO', 'IFRAME', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'HR']);
  const paints = (el) => {
    if (REPLACED.has((el.tagName || '').toUpperCase())) return true;
    for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) return true;
    return false;
  };
  let painters = 0;
  let ink = 0;
  const body = document.body;
  if (body) {
    for (const el of body.querySelectorAll('*')) {
      if (!paints(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      painters++;
      ink += r.width * r.height;
    }
  }
  const text = ((body && (body.innerText || body.textContent)) || '').replace(/\s+/g, ' ').trim();
  const marks = [];
  if (document.documentElement && document.documentElement.id === '__next_error__') marks.push('html#__next_error__');
  if (document.querySelector('.next-error-h1')) marks.push('.next-error-h1');
  if (document.querySelector('meta[name="next-error"]')) marks.push('meta[name=next-error]');
  if (document.querySelector('vite-error-overlay')) marks.push('vite-error-overlay');
  for (const host of document.querySelectorAll('nextjs-portal')) {
    const sr = host.shadowRoot;
    if (sr && sr.querySelector('[data-nextjs-dialog], [data-nextjs-dialog-overlay], #nextjs__container_errors_label')) {
      marks.push('the Next.js error overlay');
      break;
    }
  }
  if (/Application error: a (?:client|server)-side exception has occurred/.test(text) && text.length < 600) marks.push("the framework's own application-error page");
  return {
    painters,
    inkShare: +(ink / Math.max(1, innerWidth * innerHeight)).toFixed(4),
    textLen: text.length,
    marks,
    metaRefresh: !!document.querySelector('meta[http-equiv="refresh" i]'),
    head: text.slice(0, 90),
  };
}

/** null when the page rendered, else { msg }. */
export async function pageRenderFailure(page, resp, inPage) {
  const status = resp && typeof resp.status === 'function' ? resp.status() : null;
  const headers = resp && typeof resp.headers === 'function' ? resp.headers() || {} : {};
  const ctype = String(headers['content-type'] || '');
  if (status !== null && status >= 400) return { msg: `HTTP ${status}. The route did not render, so nothing on it was measured.` };
  if (status === 204 || status === 205) return null;
  if (ctype && !DOCUMENT_TYPE.test(ctype)) return null;
  let d;
  try {
    d = await inPage(page, probePageRendered);
  } catch (e) {
    return { msg: `the page could not be inspected: ${String(e.message || e).split('\n')[0]}` };
  }
  if (!d) return { msg: 'the page could not be inspected' };
  if (d.marks.length) return { msg: `an error page is on screen, not the route: ${d.marks.join(' + ')}${d.head ? `; it reads "${d.head}"` : ''}. HTTP ${status ?? 'unknown'}.` };
  if (d.metaRefresh) return null;
  if (d.inkShare < BLANK_INK && d.textLen < BLANK_TEXT) {
    return {
      msg:
        `the document put ink on ${(d.inkShare * 100).toFixed(1)}% of one viewport across ${d.painters} painting element(s) and carries ${d.textLen} characters ` +
        `(floors ${(BLANK_INK * 100).toFixed(0)}% and ${BLANK_TEXT}). There is no layout to measure, so a pass would mean nothing was looked at.`,
    };
  }
  return null;
}
