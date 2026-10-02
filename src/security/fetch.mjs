/* What a visitor's browser receives: the page, its inline scripts and its JS bundles. Everything is
 * time and size capped, and only ever read with GET.
 *
 * This runs on your machine or your CI runner, so it scans whatever host you point it at, local
 * ones included. The hosted scanner refuses private addresses because it runs on a server anyone
 * can call; a CLI you run yourself has no such caller.
 */
import { timedFetch, readCapped } from '../net.mjs';

const NAV_TIMEOUT = 12000;
const ASSET_TIMEOUT = 9000;
const MAX_ASSET_BYTES = 3_000_000;
const MAX_ASSETS = 12;
const MAX_TOTAL_BYTES = 14_000_000;

export function normalizeUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) throw new Error('empty url');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  const parsed = new URL(u);
  parsed.username = '';
  parsed.password = '';
  parsed.hash = '';
  return parsed.toString();
}

export async function fetchPage(url) {
  try {
    const res = await timedFetch(url, { timeout: NAV_TIMEOUT });
    const html = await readCapped(res, 4_000_000);
    return { finalUrl: res.finalUrl || url, html, headers: res.headers, status: res.status, reachable: res.status < 500 };
  } catch (e) {
    return { finalUrl: url, html: '', headers: new Headers(), status: 0, reachable: false, error: String(e?.message || e) };
  }
}

/** Script URLs and inline script bodies, from <script> tags and module preloads. */
export function extractScripts(html, baseUrl) {
  const srcs = [];
  const inline = [];
  const tagRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = tagRe.exec(html))) {
    const attrs = m[1] || '';
    const body = m[2] || '';
    const srcMatch = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (srcMatch) {
      try {
        srcs.push(new URL(srcMatch[1], baseUrl).toString());
      } catch {
        /* an unparseable src is skipped */
      }
    } else if (body.trim()) inline.push(body);
  }
  const linkRe = /<link\b[^>]*\brel\s*=\s*["'](?:modulepreload|preload)["'][^>]*>/gi;
  let lm;
  while ((lm = linkRe.exec(html))) {
    const hrefM = lm[0].match(/\bhref\s*=\s*["']([^"']+)["']/i);
    const asM = lm[0].match(/\bas\s*=\s*["']script["']/i);
    if (hrefM && (asM || /modulepreload/i.test(lm[0])) && /\.m?js(\?|$)/i.test(hrefM[1])) {
      try {
        srcs.push(new URL(hrefM[1], baseUrl).toString());
      } catch {
        /* skipped */
      }
    }
  }
  const seen = new Set();
  const uniq = srcs.filter((s) => (seen.has(s) ? false : (seen.add(s), true)));
  return { srcs: uniq.slice(0, 40), inline };
}

function rank(u) {
  const s = u.toLowerCase();
  let r = 0;
  if (/index[-.]/.test(s)) r += 5;
  if (/\/(main|app|bundle|entry)[-.]/.test(s)) r += 4;
  if (/chunk|vendor/.test(s)) r += 2;
  if (/\.mjs(\?|$)/.test(s)) r += 1;
  return r;
}

/** The biggest app chunks first, capped by count and by bytes. */
export async function fetchBundles(srcs) {
  const out = [];
  let total = 0;
  const ranked = [...srcs].sort((a, b) => rank(b) - rank(a));
  for (const url of ranked.slice(0, MAX_ASSETS)) {
    if (total >= MAX_TOTAL_BYTES) break;
    try {
      const res = await timedFetch(url, { timeout: ASSET_TIMEOUT });
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') || '';
      if (ct && !/javascript|ecmascript|text|json|octet-stream/i.test(ct)) continue;
      const text = await readCapped(res, MAX_ASSET_BYTES);
      total += text.length;
      out.push({ url, text });
    } catch {
      /* one unreadable bundle does not stop the scan; the count of bundles read is reported */
    }
  }
  return out;
}

export { MAX_ASSETS };
