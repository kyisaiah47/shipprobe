/* The real browser, and what every page rule needs from it.
 *
 * 1. PLAYWRIGHT IS RESOLVED AT RUN TIME, AND ITS ABSENCE IS EXIT 2. An optional dependency that
 *    reports "skipped, all good" when it is missing reads exactly like a check that found nothing.
 *    Resolution order: SHIPPROBE_PLAYWRIGHT (a path), the checked project's node_modules, then
 *    this package's own.
 *
 * 2. A LOCAL FILE IS SERVED OVER HTTP, NOT OPENED AS file://. Chromium treats a file:// image as
 *    cross-origin, so reading its pixels throws, and the figure rule would only ever exercise its
 *    error path. The file's directory is served on an ephemeral loopback port, which also gives
 *    the page an origin, so relative links and a sibling index.html behave as in production.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { CannotCheck } from '../exit.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

/** Candidates are injectable so the resolution order itself can be tested. */
export function resolveChromium(candidates = null) {
  const list = candidates || [
    ...(process.env.SHIPPROBE_PLAYWRIGHT ? [() => createRequire(import.meta.url)(path.resolve(process.env.SHIPPROBE_PLAYWRIGHT))] : []),
    () => createRequire(path.join(process.cwd(), 'package.json'))('playwright'),
    () => createRequire(path.join(process.cwd(), 'package.json'))('playwright-core'),
    () => createRequire(import.meta.url)('playwright'),
    () => createRequire(import.meta.url)('playwright-core'),
  ];
  let last = null;
  for (const t of list) {
    try {
      const pw = t();
      if (pw && pw.chromium) return pw.chromium;
    } catch (e) {
      last = e;
    }
  }
  throw new CannotCheck(
    'playwright is not installed, so no page could be opened and nothing was measured. ' +
      'Install it with: npm i -D playwright && npx playwright install chromium. ' +
      'Or point SHIPPROBE_PLAYWRIGHT at an existing install.' +
      (last ? ` (last resolver error: ${String(last.message).split('\n')[0]})` : ''),
  );
}

export async function serveDir(dir) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    let p;
    try {
      p = decodeURIComponent(String(req.url).split('?')[0]);
    } catch {
      res.writeHead(400);
      return res.end();
    }
    let file = path.join(root, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(root)) {
      res.writeHead(403);
      return res.end();
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><title>404</title><h1>404</h1>');
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

/** One target to { url, origin, close }. A URL passes through; a path gets a server. */
export async function targetToUrl(target) {
  if (/^https?:\/\//i.test(target)) {
    const u = new URL(target);
    return { url: u.href, origin: u.origin, close: async () => {} };
  }
  if (/^file:\/\//i.test(target)) return targetToUrl(path.normalize(decodeURIComponent(new URL(target).pathname)));
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) throw new CannotCheck(`no such file or directory: ${target}, and it is not an http(s) URL`);
  const isDir = fs.statSync(abs).isDirectory();
  const served = await serveDir(isDir ? abs : path.dirname(abs));
  const url = isDir ? `${served.origin}/` : `${served.origin}/${encodeURIComponent(path.basename(abs))}`;
  return { url, origin: served.origin, close: served.close, local: abs };
}

/* SETTLE BEFORE MEASURING. `networkidle` is about requests, and a webfont is not requested until
 * the layout that needs it exists, so the faces are awaited separately: a label measured in a
 * fallback face is measured at the wrong width. Then every image is forced eager, and the page is
 * walked once top to bottom, because a scroll-reveal holds an element at opacity 0 until it has
 * been in view. Measuring without that walk reports every below-fold section as invisible. */
export async function settle(page, settleMs) {
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.evaluate(async () => {
    for (const i of document.querySelectorAll('img')) {
      i.loading = 'eager';
      i.decoding = 'sync';
    }
    const h = Math.max(document.body?.scrollHeight || 0, document.documentElement.scrollHeight);
    for (let y = 0; y < h; y += Math.max(300, Math.round(innerHeight * 0.75))) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
    await Promise.all([...document.querySelectorAll('img')].map((i) => i.decode().catch(() => {})));
  }).catch(() => {});
  await page.waitForTimeout(settleMs);
}

export async function openPage(browser, url, { width = 1280, height = 800, settleMs = 1500, reducedMotion = null } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, ...(reducedMotion ? { reducedMotion } : {}) });
  const page = await context.newPage();
  page.on('close', () => context.close().catch(() => {}));
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(page, settleMs);
  return { page, resp, context };
}

/** Run an in-page probe by stringifying it, so it closes over nothing on this side. */
export function inPage(page, fn, ...args) {
  const body = fn.toString().replace(/^export\s+/, '');
  const call = args.map((a) => JSON.stringify(a)).join(', ');
  return page.evaluate(`(async () => { ${body} return await ${fn.name}(${call}); })()`);
}

/** One interior route per distinct first path segment from the site's own sitemap, so a sitemap
 *  of four thousand /kit/<slug> pages contributes one of them. */
export async function sitemapRoutes(origin, n) {
  const out = [];
  try {
    const res = await fetch(`${origin}/sitemap.xml`, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { routes: out, error: `sitemap.xml answered HTTP ${res.status}` };
    const xml = await res.text();
    const bySeg = new Map();
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      let u;
      try {
        u = new URL(m[1]);
      } catch {
        continue;
      }
      if (u.host !== new URL(origin).host) continue;
      const seg = u.pathname.split('/').filter(Boolean)[0];
      if (!seg || bySeg.has(seg)) continue;
      bySeg.set(seg, u.href);
    }
    out.push(...[...bySeg.values()].slice(0, n));
    return { routes: out };
  } catch (e) {
    return { routes: out, error: `sitemap.xml could not be read: ${e.message}` };
  }
}
