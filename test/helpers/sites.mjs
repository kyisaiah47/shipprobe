/* Local stand-ins for everything a test would otherwise reach over the network: a deployed app
 * with and without security defects, a fake PostgREST, an npm registry, the three hosted services
 * and an OpenAI-compatible model server.
 *
 * Every credential-shaped string here is BUILT AT RUN TIME from parts, so no file in this
 * repository holds one and the scrub gate stays meaningful. */
import http from 'node:http';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const b64u = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

export function makeJwt(payload, secret) {
  const head = b64u({ alg: 'HS256', typ: 'JWT' });
  const body = b64u(payload);
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export const REF = 'abcdefghijklmnopqrst';

export function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, port, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

const readBody = (req) =>
  new Promise((r) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => r(s));
  });

/** A deployed app. `dirty` ships a service_role key, the signing secret, readable tables, an
 *  unsigned-accepting webhook and no security headers. `clean` ships only the anon key. */
export async function securitySite({ dirty }) {
  const secret = crypto.randomBytes(20).toString('hex');
  const anon = makeJwt({ iss: 'supabase', ref: REF, role: 'anon' }, secret);
  const service = makeJwt({ iss: 'supabase', ref: REF, role: 'service_role' }, secret);
  const pk = ['pk', 'test', crypto.randomBytes(12).toString('hex')].join('_');
  const bundle = [
    `const SUPABASE_URL = "https://${REF}.supabase.co";`,
    `const ANON = "${anon}";`,
    dirty ? `const ADMIN_KEY = "${service}";` : '',
    dirty ? `const jwtSecret = "${secret}";` : '',
    `const client = createClient(SUPABASE_URL, ANON);`,
    `client.from("profiles").select("*");`,
    `const stripe = Stripe("${pk}");`,
    `fetch("/api/stripe/webhook");`,
    dirty ? `if (user.role === "admin") { showAdmin(); }` : '',
    dirty ? `localStorage.setItem("auth_token", token);` : '',
  ].join('\n');
  const headers = dirty
    ? { 'content-type': 'text/html; charset=utf-8' }
    : {
        'content-type': 'text/html; charset=utf-8',
        'strict-transport-security': 'max-age=63072000',
        'x-frame-options': 'DENY',
        'content-security-policy': "default-src 'self'",
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
      };
  const site = await listen(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/') {
      res.writeHead(200, headers);
      return res.end(`<!doctype html><title>Fixture app</title><h1>Fixture app</h1><script src="/assets/index-abc123.js"></script>`);
    }
    if (u.pathname === '/assets/index-abc123.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end(bundle);
    }
    if (u.pathname === '/api/stripe/webhook' && req.method === 'POST') {
      await readBody(req);
      if (dirty) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end('{"received":true}');
      }
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end('{"error":"No signatures found matching the expected signature for payload"}');
    }
    if (u.pathname === '/rest/v1/') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ definitions: { profiles: { properties: { id: {}, email: {} } }, notes: { properties: { id: {} } } } }));
    }
    if (u.pathname.startsWith('/rest/v1/')) {
      res.writeHead(200, { 'content-type': 'application/json', 'content-range': dirty ? '0-0/3' : '*/0' });
      return res.end(dirty ? '[{"id":1}]' : '[]');
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":"not found"}');
  });
  return site;
}

/* ── npm registry ─────────────────────────────────────────────────────────────────────────── */

function tarEntry(name, content) {
  const data = Buffer.from(content);
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, 'utf8');
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write('0', 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([h, data, pad]);
}

export function makeTarball(files) {
  const parts = Object.entries(files).map(([n, c]) => tarEntry(`package/${n}`, c));
  return zlib.gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));
}

/** A registry with three packages: `quiet-pkg` (no scripts), `net-pkg` (a postinstall that
 *  downloads, published by a new account last week), and `native-pkg` (node-gyp). */
export async function registry() {
  const day = 24 * 3600 * 1000;
  const now = Date.now();
  const pkgs = {
    'quiet-pkg': { files: { 'package.json': JSON.stringify({ name: 'quiet-pkg', version: '1.0.0' }), 'index.js': 'module.exports = 1;' }, publishers: ['alice', 'alice'] },
    'net-pkg': {
      files: {
        'package.json': JSON.stringify({ name: 'net-pkg', version: '2.0.0', scripts: { postinstall: 'node scripts/fetch.js' } }),
        'scripts/fetch.js': "require('https').get('https://downloads.example.net/bin-' + process.platform, () => {});",
      },
      publishers: ['alice', 'alice', 'mallory'],
    },
    'native-pkg': {
      files: { 'package.json': JSON.stringify({ name: 'native-pkg', version: '1.2.0', scripts: { install: 'node-gyp rebuild' } }), 'binding.gyp': '{}' },
      publishers: ['bob'],
    },
  };
  let base;
  const site = await listen((req, res) => {
    const u = new URL(req.url, 'http://x');
    const tar = u.pathname.match(/^\/([^/]+)\/-\/(.+)\.tgz$/);
    if (tar && pkgs[tar[1]]) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      return res.end(makeTarball(pkgs[tar[1]].files));
    }
    const name = decodeURIComponent(u.pathname.slice(1));
    const p = pkgs[name];
    if (!p) {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end('{"error":"Not found"}');
    }
    const manifest = JSON.parse(p.files['package.json']);
    const versions = {};
    const time = {};
    p.publishers.forEach((who, i) => {
      const v = i === p.publishers.length - 1 ? manifest.version : `0.${i}.0`;
      versions[v] = { name, version: v, scripts: manifest.scripts || {}, dist: { tarball: `${base}/${name}/-/${name}-${v}.tgz` }, _npmUser: { name: who } };
      time[v] = new Date(now - (p.publishers.length - 1 - i) * 200 * day - (i === p.publishers.length - 1 ? 0 : 0)).toISOString();
    });
    if (name === 'net-pkg') time['2.0.0'] = new Date(now - 7 * day).toISOString();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ name, 'dist-tags': { latest: manifest.version }, versions, time }));
  });
  base = site.url;
  return site;
}

/* ── hosted services and a model server ───────────────────────────────────────────────────── */

export async function hostedServices() {
  const calls = [];
  const site = await listen(async (req, res) => {
    const body = await readBody(req);
    calls.push({ method: req.method, path: req.url, body: body ? JSON.parse(body) : null });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/scan') {
      return res.end(
        JSON.stringify({
          scanId: 'scan-1',
          reachable: true,
          score: 40,
          grade: 'F',
          findings: [{ id: 'rls-cross-tenant', category: 'rls', severity: 'critical', title: 'Row-level security is broken', detail: 'A fresh user read rows in 2 tables they do not own.' }],
          rlsTeaser: { tables: 2, anonReadable: 0, detail: 'A brand-new signed-in user read rows in 2 user-scoped tables.' },
        }),
      );
    }
    if (req.url === '/api/score') {
      const files = JSON.parse(body).files;
      const { scoreFile } = await import('../../src/agents-md/index.mjs');
      return res.end(JSON.stringify({ files: files.map((f) => ({ path: f.path, quality: scoreFile(f.path, f.content).quality })), badge: { markdown: '[![AGENTS.md](badge)](link)' } }));
    }
    if (req.url === '/api/check') return res.end(JSON.stringify({ verdict: 'pass', registry: { versions_published: 2 } }));
    res.statusCode = 404;
    res.end('{"error":"nope"}');
  });
  return { ...site, calls };
}

/** Speaks chat completions. Records each request so a test can read the prompt that was sent. */
export async function modelServer() {
  const calls = [];
  const site = await listen(async (req, res) => {
    const body = JSON.parse((await readBody(req)) || '{}');
    calls.push({ path: req.url, auth: req.headers.authorization || null, body });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'In `package.json`, add a security header middleware.' } }] }));
  });
  return { ...site, calls };
}
