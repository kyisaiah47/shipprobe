#!/usr/bin/env node
/* Serves an example site the way it would be deployed, plus a stand-in for its hosted database.
 *
 *   node serve.mjs <dir> <port>
 *
 * The site's bundle carries the placeholder __ANON_KEY__. A real public anon key is a signed JSON
 * Web Token, and a token-shaped string must never be committed to this repository, so this server
 * signs a fresh one at start and puts it in the bundle as it is served.
 *
 * The headers match BreachProbe's sample: HSTS, frame protection and nosniff are set, and the
 * Content-Security-Policy and Referrer-Policy are missing. /rest/v1/ answers like PostgREST with
 * row-level security off, so the anonymous sweep finds readable tables. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

export function anonKey(ref) {
  const secret = crypto.randomBytes(24).toString('hex');
  const head = b64u({ alg: 'HS256', typ: 'JWT' });
  const body = b64u({ iss: 'supabase', ref, role: 'anon' });
  return `${head}.${body}.${crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
}

export function startServer(dir, port = 0) {
  const root = path.resolve(dir);
  const key = anonKey('demoappnotesfixtures');
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const headers = { 'strict-transport-security': 'max-age=31536000', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff' };
    if (u.pathname === '/rest/v1/') {
      res.writeHead(200, { ...headers, 'content-type': 'application/json' });
      return res.end(JSON.stringify({ definitions: { notes: { properties: { id: {}, body: {}, user_id: {} } }, profiles: { properties: { id: {}, email: {} } } } }));
    }
    if (u.pathname.startsWith('/rest/v1/')) {
      res.writeHead(200, { ...headers, 'content-type': 'application/json', 'content-range': '0-0/12' });
      return res.end('[{"id":1}]');
    }
    let file = path.join(root, path.normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(root)) {
      res.writeHead(403);
      return res.end();
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) {
      res.writeHead(404, { ...headers, 'content-type': 'text/html' });
      return res.end('<!doctype html><title>404</title><h1>Not found</h1>');
    }
    let body = fs.readFileSync(file);
    if (file.endsWith('.js')) body = Buffer.from(body.toString('utf8').replaceAll('__ANON_KEY__', key));
    res.writeHead(200, { ...headers, 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dir = 'site', port = '4178'] = process.argv.slice(2);
  const { url } = await startServer(dir, Number(port));
  console.log(`serving ${dir} at ${url}`);
}
