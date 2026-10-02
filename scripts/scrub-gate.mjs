#!/usr/bin/env node
/* The scrub gate. It fails closed on anything that must never be in a public repository:
 *
 *   personal      the maintainer's personal email addresses, a macOS home directory path, the
 *                 hosted database's project id, Stripe account ids, the names of private
 *                 credential tools, and the lab's social account handles and DIDs
 *   keys          anything shaped like a credential: cloud, model-provider, payment, source-host
 *                 and package-registry keys, JWTs, and PEM private key blocks
 *   bypass        bot-detection bypass code: the stealth plugin and its wrappers, challenge-page
 *                 solver services, and overrides of navigator.webdriver
 *
 * The personal literals are stored here as SHA-256 digests. Every candidate token in a file is
 * hashed and compared, so this gate can refuse a string without publishing it. The bypass
 * patterns are assembled from fragments for the same reason in reverse: this file must pass its
 * own scan, and a regex written out whole would match itself.
 *
 *   node scripts/scrub-gate.mjs [dir]        scan the repository (default: this one)
 *   node scripts/scrub-gate.mjs --self-test  prove every rule fires, against generated fixtures
 *
 * Exit 0 clean, 1 a finding, 2 could not scan. There is no allowlist and no skip comment: a
 * finding is fixed by removing the string.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const j = (...parts) => parts.join('');

/* ── hashed literals ─────────────────────────────────────────────────────────────────────── */
const EMAIL_LOCAL = new Set([
  '1232b0f5e5073b48e735122a96ebd2ecd728ec46fb3d72531463bc31a37eac00',
  '7565b53036e265298424a9b7ed11ac715838278c797a6a8a4711ce604b6067d3',
  '9e5b2ac27f550fd4a4425af0744ba70ba84cb46b2f01e968dbfd377da6679c0e',
  '22918b4eb9aa29bee78df1bfe308f5faedc65260984f366ef37967e102fe0505',
  '2f986f5f901c9bdbe75d52d6c9994f239b9b71894fcccb4329f86240ce81df0f',
  'db06483bc5d43da544887df58608f4dad6a55b0cc646f8ea36ea56d4ff488953',
]);
const PROJECT_ID = new Set(['41f5de058b2a5859451df101ca9b7bc05fed4fdd952f25dde509286ee805f8ba']);
const PRIVATE_TOOL = new Set([
  '4d9203f0461c350eb8100826f9d419510df2fdb3514ef55996df3229daa1d3d8',
  '52d574851fe7dcf24427dc68898c1bee28897749c7cfef35736e9a835b998467',
]);
const HANDLE = new Set([
  '37354cb95dcc4ee9cf024879671464731bad838166678b217ea3441c8c6979cd',
  '7d51d82c55fe2d756d2e00861f2ade621edc5658bbb491d4f661238a2ae1e4fd',
  'b2f3a4aee965bf05b70efe860a49b531cc90c4d375ceb5770e9434652e56dcf0',
  'f11d00bfd64aed93522c78db5b6a6881c7713b01b2f7293b1a6c3678f35f4ee1',
  '1232b0f5e5073b48e735122a96ebd2ecd728ec46fb3d72531463bc31a37eac00',
  '4a20a45bb111de6b6ec8e5a780386a0f5ff9979765bd35cc36af9d10f0dc8bb8',
  'e5b60367ee225010efcf45a0cc3c2a557622aa2f517a7d754a1f8640a548d806',
  'a4c3b652a28e06e7c5287714ae80e0f2a9dbddd883f3aae947c1941dd272d382',
  '3a0e52ccc2254ebca7256e69f20950055cfd1ce4239346ad4a3d1b2f5b2d7420',
  '8e325fd979479aa192acb6414e62799d4e789b6eefaef7d2af15fe42879d0afe',
  '7327751d474f3cca55c8a93119ec4349be1329cdf99160bf544059eef36aedc3',
  '926b41eebada34c916aced7c7f3bf35da76621ed9ae50ad17afc1f61cfdf0d0f',
]);

/* Each hashed rule: a regex that extracts candidate tokens (group 1), and the digest set. */
const HASHED = [
  { id: 'personal-email', what: 'a personal email address', re: /([A-Za-z0-9._%+-]+)@[A-Za-z0-9-]/g, set: EMAIL_LOCAL },
  { id: 'project-id', what: "the hosted database's project id", re: /(?<![A-Za-z0-9])([a-z0-9]{20})(?![A-Za-z0-9])/g, set: PROJECT_ID },
  { id: 'private-tool', what: 'the name of a private credential tool', re: /(?<![\w-])(compound-[a-z]+)(?![\w-])/gi, set: PRIVATE_TOOL },
  { id: 'account-handle', what: 'an account handle', re: /(?<![\w.@/-])@([A-Za-z0-9_.-]{3,40})/g, set: HANDLE },
  {
    id: 'account-handle',
    what: 'an account handle in a profile URL',
    re: /\b(?:x|twitter|instagram|tiktok|youtube|threads|linkedin|reddit|dev|bsky)\.(?:com|net|to|app)\/(?:@|profile\/|company\/|u\/|user\/|in\/)?([A-Za-z0-9_.-]{3,60})/gi,
    set: HANDLE,
  },
  { id: 'account-handle', what: 'a forum username', re: /(?<![\w/])u\/([A-Za-z0-9_-]{3,30})/g, set: HANDLE },
];

/* ── plain rules ─────────────────────────────────────────────────────────────────────────── */
const PLAIN = [
  { id: 'home-path', what: 'a macOS home directory path', re: new RegExp(j('/Us', 'ers/[A-Za-z0-9._-]+')) },
  { id: 'stripe-account', what: 'a Stripe account id', re: new RegExp(j('\\bac', 'ct_[A-Za-z0-9]{8,}')) },
  { id: 'did', what: 'a decentralised identifier (DID)', re: new RegExp(j('did:p', 'lc:[a-z0-9]{16,}')) },

  { id: 'key-aws', what: 'an AWS access key', re: new RegExp(j('\\b(?:AK', 'IA|AS', 'IA)[0-9A-Z]{16}\\b')) },
  { id: 'key-anthropic', what: 'an Anthropic key', re: new RegExp(j('\\bsk-a', 'nt-[A-Za-z0-9_-]{20,}')) },
  { id: 'key-openai', what: 'an OpenAI key', re: new RegExp(j('\\bsk-(?:pr', 'oj-)?[A-Za-z0-9_-]{32,}')) },
  { id: 'key-stripe', what: 'a Stripe secret or restricted key', re: new RegExp(j('\\b(?:s', 'k|r', 'k)_(?:li', 've|te', 'st)_[A-Za-z0-9]{20,}')) },
  { id: 'key-stripe-webhook', what: 'a Stripe webhook secret', re: new RegExp(j('\\bwh', 'sec_[A-Za-z0-9]{20,}')) },
  { id: 'key-supabase', what: 'a Supabase secret key', re: new RegExp(j('\\bsb_se', 'cret_[A-Za-z0-9_-]{16,}')) },
  { id: 'key-github', what: 'a GitHub token', re: new RegExp(j('\\b(?:gh', '[pousr]_[A-Za-z0-9]{36,}|github_', 'pat_[A-Za-z0-9_]{40,})')) },
  { id: 'key-npm', what: 'an npm token', re: new RegExp(j('\\bnp', 'm_[A-Za-z0-9]{36}\\b')) },
  { id: 'key-google', what: 'a Google API key', re: new RegExp(j('\\bAI', 'za[0-9A-Za-z_-]{35}')) },
  { id: 'key-slack', what: 'a Slack token', re: new RegExp(j('\\bxo', 'x[abposr]-[A-Za-z0-9-]{10,}')) },
  { id: 'key-sendgrid', what: 'a SendGrid key', re: new RegExp(j('\\bS', 'G\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}')) },
  { id: 'key-resend', what: 'a Resend key', re: new RegExp(j('\\bre', '_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}')) },
  { id: 'key-jwt', what: 'a JSON Web Token', re: new RegExp(j('\\bey', 'J[A-Za-z0-9_-]{10,}\\.ey', 'J[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}')) },
  { id: 'key-pem', what: 'a PEM private key block', re: new RegExp(j('-----BEG', 'IN [A-Z ]*PRIV', 'ATE KEY-----')) },

  { id: 'bypass-stealth', what: 'the stealth plugin', re: new RegExp(j('puppeteer-extra-plu', 'gin-stealth|playwright-ex', 'tra|Stealth', 'Plugin'), 'i') },
  { id: 'bypass-solver', what: 'a challenge-page solving service', re: new RegExp(j('\\b2cap', 'tcha|anti-?cap', 'tcha|capso', 'lver|cap', 'tcha.?solv'), 'i') },
  {
    id: 'bypass-webdriver',
    what: 'an override of navigator.webdriver',
    re: new RegExp(
      j(
        'defineProperty\\(\\s*(?:navi', 'gator|Navi', 'gator\\.prototype)\\s*,\\s*[\'"`]web', 'driver',
        '|navi', 'gator\\.web', 'driver\\s*=[^=]',
        '|delete\\s+(?:navi', 'gator|Navi', 'gator\\.prototype)\\.web', 'driver',
        '|Automation', 'Controlled',
      ),
    ),
  },
];

const SKIP_DIRS = new Set(['.git', 'node_modules']);

function listFiles(root) {
  try {
    const top = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (path.resolve(top) === path.resolve(root)) {
      return execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 1 << 28 })
        .split('\0')
        .filter(Boolean)
        .filter((p) => fs.existsSync(path.join(root, p)));
    }
  } catch {
    /* not a checkout: walk */
  }
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p);
      } else if (e.isFile()) out.push(p);
    }
  };
  walk('');
  return out;
}

const redact = (s) => (s.length <= 8 ? `${s.slice(0, 2)}...` : `${s.slice(0, 4)}...${s.slice(-2)}`);

export function scanText(text, file = '(text)') {
  const hits = [];
  const lineOf = (i) => text.slice(0, i).split('\n').length;
  for (const r of HASHED) {
    r.re.lastIndex = 0;
    let m;
    while ((m = r.re.exec(text))) {
      if (r.set.has(sha(m[1].toLowerCase()))) hits.push({ file, line: lineOf(m.index), id: r.id, what: r.what, sample: redact(m[1]) });
    }
  }
  for (const r of PLAIN) {
    const re = new RegExp(r.re.source, r.re.flags.includes('g') ? r.re.flags : r.re.flags + 'g');
    let m;
    while ((m = re.exec(text))) hits.push({ file, line: lineOf(m.index), id: r.id, what: r.what, sample: redact(m[0]) });
  }
  return hits;
}

export function scanDir(root) {
  const hits = [];
  const errors = [];
  for (const rel of listFiles(root)) {
    let buf;
    try {
      buf = fs.readFileSync(path.join(root, rel));
    } catch (e) {
      errors.push(`${rel}: ${e.message}`);
      continue;
    }
    hits.push(...scanText(rel, `(path) ${rel}`));
    if (buf.subarray(0, 8000).includes(0)) continue;
    hits.push(...scanText(buf.toString('utf8'), rel));
  }
  return { hits, errors };
}

function selfTest() {
  /* Every fixture is built from fragments at run time, in a temp directory, so no file in this
   * repository ever holds one. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrub-self-'));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const cases = {
    'personal-email': j('mail ', 'kyisa', 'iah47', '@', 'gmail.com'),
    'project-id': j('xowekqd', 'sttxwbhfxvusa'),
    'private-tool': j('compound', '-vault get x'),
    'account-handle': j('follow @', 'compound', 'labsinc'),
    'home-path': j('/Us', 'ers/', 'someone/x'),
    'stripe-account': j('ac', 'ct_', '1Tabcdefghij'),
    did: j('did:', 'plc:', 'abcdefghijklmnopqrstuvwx'),
    'key-aws': j('AK', 'IA', 'ABCDEFGHIJKLMNOP'),
    'key-anthropic': j('sk-', 'ant-', 'a'.repeat(24)),
    'key-openai': j('sk-', 'proj-', 'b'.repeat(40)),
    'key-stripe': j('sk', '_live_', 'c'.repeat(24)),
    'key-stripe-webhook': j('wh', 'sec_', 'd'.repeat(24)),
    'key-supabase': j('sb_', 'secret_', 'e'.repeat(20)),
    'key-github': j('gh', 'p_', 'f'.repeat(36)),
    'key-npm': j('np', 'm_', 'g'.repeat(36)),
    'key-google': j('AI', 'za', 'h'.repeat(35)),
    'key-slack': j('xo', 'xb-', '1234567890-abc'),
    'key-sendgrid': j('S', 'G.', 'i'.repeat(16), '.', 'k'.repeat(16)),
    'key-resend': j('re', '_', 'abcdefgh', '_', 'm'.repeat(16)),
    'key-jwt': j(b64({ alg: 'HS256', typ: 'JWT' }), '.', b64({ role: 'service_role', iss: 'x' }), '.', 'n'.repeat(20)),
    'key-pem': j('-----BEG', 'IN RSA PRIV', 'ATE KEY-----'),
    'bypass-stealth': j('require("puppeteer-extra-plu', 'gin-stealth")'),
    'bypass-solver': j('const solver = "2cap', 'tcha"'),
    'bypass-webdriver': j('Object.defineProperty(navi', 'gator, "web', 'driver", { get: () => undefined })'),
  };
  let failed = 0;
  for (const [id, text] of Object.entries(cases)) {
    const f = path.join(dir, `${id}.txt`);
    fs.writeFileSync(f, `line one\n${text}\n`);
    const ids = scanText(fs.readFileSync(f, 'utf8'), f).map((h) => h.id);
    if (ids.includes(id)) console.log(`  ok    ${id} fires`);
    else {
      failed++;
      console.log(`  FAIL  ${id} did not fire on its fixture`);
    }
  }
  const clean = ['see https://github.com/acme/tool', 'a user@example.com address', 'npm i shipprobe', 'uses: acme/tool@v1', 'abcdefghijklmnopqrst is twenty letters', 'compound-labs and compound-ops are not banned'];
  for (const text of clean) {
    const hits = scanText(text);
    if (hits.length) {
      failed++;
      console.log(`  FAIL  a clean line fired ${hits.map((h) => h.id).join(', ')}: "${text}"`);
    } else console.log(`  ok    clean: "${text}"`);
  }
  const own = scanText(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8'), 'scripts/scrub-gate.mjs');
  if (own.length) {
    failed++;
    console.log(`  FAIL  this file matches its own rules: ${own.map((h) => `${h.id}@${h.line}`).join(', ')}`);
  } else console.log('  ok    this file passes its own scan');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failed ? `\n${failed} self-test failure(s)` : '\nself-test passed');
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  const root = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  let res;
  try {
    res = scanDir(root);
  } catch (e) {
    console.error(`scrub-gate: could not scan ${root}: ${e.message}`);
    process.exit(2);
  }
  for (const h of res.hits) console.error(`  ${h.file}:${h.line}  ${h.id}: ${h.what} (${h.sample})`);
  if (res.errors.length) {
    for (const e of res.errors) console.error(`  could not read ${e}`);
    console.error(`scrub-gate: ${res.errors.length} file(s) could not be read. That is exit 2, not a pass.`);
    process.exit(2);
  }
  if (res.hits.length) {
    console.error(`\nscrub-gate: ${res.hits.length} finding(s). Remove each string. There is no allowlist.`);
    process.exit(1);
  }
  console.log(`scrub-gate: clean. ${listFiles(root).length} file(s) scanned.`);
}
