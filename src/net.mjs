/* The network layer. Every request is time capped, size capped, follows a bounded number of
 * redirects by hand, and identifies itself.
 *
 * A request that hangs must become exit 2. It must never become a silent wait that a CI job's own
 * timeout eventually kills with no output.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let VERSION = '0.0.0';
try {
  VERSION = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8')).version;
} catch {
  /* the version is only used in the user agent */
}

export const UA = `ShipProbe/${VERSION} (+https://github.com/kyisaiah47/shipprobe; self-scan)`;
const MAX_REDIRECTS = 5;

/** fetch with a deadline and manual redirects. Returns the final Response plus the URL it came
 *  from, because `res.url` is empty when redirects are handled by hand. */
export async function timedFetch(url, { timeout = 9000, method = 'GET', headers = {}, body } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    let current = new URL(url);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(current.toString(), {
        method,
        body,
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'user-agent': UA, ...headers },
      });
      const location = res.headers.get('location');
      if (res.status < 300 || res.status >= 400 || !location || hop === MAX_REDIRECTS) {
        res.finalUrl = current.toString();
        return res;
      }
      current = new URL(location, current);
      /* A 303, and a 301 or 302 answering a POST, turn the next hop into a GET with no body,
       * which is what every browser does. */
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method !== 'GET')) {
        method = 'GET';
        body = undefined;
      }
    }
    throw new Error('too many redirects');
  } finally {
    clearTimeout(t);
  }
}

/** Read a body up to `cap` bytes, then stop. A huge bundle cannot run one check out of memory. */
export async function readCapped(res, cap) {
  const reader = res.body?.getReader?.();
  if (!reader) return await res.text();
  const dec = new TextDecoder();
  let total = 0;
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    out += dec.decode(value, { stream: true });
    if (total >= cap) {
      try {
        await reader.cancel();
      } catch {
        /* already closed */
      }
      break;
    }
  }
  return out + dec.decode();
}

/** JSON request with a deadline. Never throws for an HTTP status: the caller decides what a
 *  non-2xx answer means, and a non-JSON body is reported, not papered over. */
export async function fetchJson(url, { method = 'GET', body, timeout = 30000, headers = {} } = {}) {
  const res = await timedFetch(url, {
    method,
    timeout,
    headers: {
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* left null on purpose */
  }
  return { ok: res.ok, status: res.status, json, text, headers: res.headers };
}
