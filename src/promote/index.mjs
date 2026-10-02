/* `shipprobe promote`: run every declared gate against a local production build BEFORE anything
 * ships.
 *
 * The enabling mechanic for "I found it, I reported it, I left it for you" was never laziness. It
 * was ORDERING: the deploy ran its live checks after the deploy had landed, so by the time a
 * finding appeared the work was live and writing it up was the only move left. Run the gates in
 * front of the promote and the same finding blocks instead of annotating.
 *
 *   shipprobe init                         writes shipprobe.json and plan.spec.json
 *   shipprobe promote                      serves the build, runs every gate, exits non-zero on any
 *   shipprobe promote --url http://localhost:3000   skip the built-in server
 *
 * shipprobe.json:
 *   { "serve": { "command": "npm run start", "url": "http://localhost:3000", "readyTimeoutMs": 20000 },
 *     "gates": [
 *       { "name": "plan",  "shipprobe": ["plan", "plan.spec.json", "dist"] },
 *       { "name": "page",  "shipprobe": ["page", "{url}"] },
 *       { "name": "tests", "run": ["npm", "test"] } ] }
 *
 * `{url}` in any argument becomes the base URL under test. A `shipprobe` gate runs this same
 * installed copy of ShipProbe, so the version the config was written against is the one that runs.
 *
 * Invariants, both tested: a missing gate file is a failure, not a skip, and zero gates run is
 * exit 2, never a pass. A gate's own exit code is kept: a gate that could not check (2) makes the
 * promote exit 2, and a failing gate makes it exit 1.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { newResult, PASS, FAIL, UNCHECKED } from '../result.mjs';
import { combine } from '../exit.mjs';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'shipprobe.mjs');
export const CONFIG_NAMES = ['shipprobe.json', 'deferless.json'];

export const STARTER = {
  serve: { command: 'npm run start', url: 'http://localhost:3000', readyTimeoutMs: 20000 },
  gates: [
    { name: 'plan gate', shipprobe: ['plan', 'plan.spec.json', '.'] },
    { name: 'page gate', shipprobe: ['page', '{url}'] },
  ],
};

export const STARTER_SPEC = {
  source: 'docs/plans/YOUR-PLAN.md',
  checks: [{ kind: 'files', glob: 'dist/*.js', min: 1, quote: 'paste the sentence from the plan that this check enforces' }],
};

export function initConfig(dir = process.cwd()) {
  const cfg = path.join(dir, 'shipprobe.json');
  const spec = path.join(dir, 'plan.spec.json');
  if (fs.existsSync(cfg)) return { ok: false, message: `${cfg} already exists, and it is not overwritten.` };
  fs.writeFileSync(cfg, JSON.stringify(STARTER, null, 2) + '\n');
  if (!fs.existsSync(spec)) fs.writeFileSync(spec, JSON.stringify(STARTER_SPEC, null, 2) + '\n');
  return {
    ok: true,
    message:
      `wrote ${path.relative(dir, cfg)} and ${path.relative(dir, spec)}.\n` +
      'Replace the placeholder check with one check per binding sentence of your plan, and put the sentence itself in "quote". ' +
      'The quote is what a failure prints, so a violation is reported in the plan\'s words.',
  };
}

const substitute = (argv, base) => argv.map((a) => String(a).replace(/\{url\}/g, base).replace(/^~(?=$|\/)/, os.homedir()));

function runGate(g, base, repo, log) {
  const name = g.name || (g.run || g.shipprobe || []).join(' ') || '(unnamed)';
  let argv;
  if (Array.isArray(g.shipprobe) && g.shipprobe.length) argv = [process.execPath, BIN, ...substitute(g.shipprobe, base)];
  else if (Array.isArray(g.run) && g.run.length) argv = substitute(g.run, base);
  else return { name, code: FAIL, why: 'a gate needs "run" (an argv array) or "shipprobe" (ShipProbe arguments)' };

  /* A MISSING GATE IS A FAILURE, NOT A SKIP. A renamed check that silently stops running prints
   * the same OK as a check that found nothing. */
  const [cmd, ...rest] = argv;
  if (['node', 'sh', 'bash'].includes(path.basename(cmd)) && rest[0] && !rest[0].startsWith('-')) {
    const f = path.isAbsolute(rest[0]) ? rest[0] : path.join(repo, rest[0]);
    if (!fs.existsSync(f)) return { name, code: FAIL, why: `gate not found at ${rest[0]}` };
  }
  log(`\n==> ${name}: ${argv.map((a) => (a === process.execPath ? 'node' : a === BIN ? 'shipprobe' : a)).join(' ')}`);
  const r = spawnSync(cmd, rest, { stdio: 'inherit', cwd: repo, env: { ...process.env, SHIPPROBE_URL: base } });
  if (r.error) return { name, code: FAIL, why: `could not start: ${r.error.message}` };
  const code = r.status === null ? UNCHECKED : r.status;
  /* A gate that is not ShipProbe can exit with anything. Only 0 is a pass; 2 keeps its meaning;
   * every other non-zero is a failure. */
  const norm = code === 0 ? PASS : code === 2 ? UNCHECKED : code === 3 && g.shipprobe ? 3 : FAIL;
  return { name, code: norm, exit: code };
}

async function serve(config, repo, url) {
  if (url) return { base: url, stop: () => {} };
  const s = config.serve;
  if (!s || !s.command) throw new Error('no "serve.command" in the config and no --url. The gates need something to run against.');
  const base = s.url || 'http://localhost:3000';
  const [cmd, ...rest] = Array.isArray(s.command) ? s.command : String(s.command).split(' ');
  const child = spawn(cmd, rest, { cwd: repo, stdio: 'ignore', detached: true });
  const stop = () => {
    try {
      process.kill(-child.pid);
    } catch {
      /* already gone */
    }
  };
  const deadline = Date.now() + (s.readyTimeoutMs || 20000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      const res = await fetch(base, { signal: AbortSignal.timeout(2000) });
      if (res.status < 500) return { base, stop };
    } catch {
      /* not up yet */
    }
  }
  stop();
  throw new Error(`the server did not come up on ${base} within ${(s.readyTimeoutMs || 20000) / 1000}s. Is the production build made?`);
}

export async function runPromote(opts = {}, { log = console.log } = {}) {
  const repo = path.resolve(opts.repo || '.');
  const result = newResult('promote', repo);
  if (!fs.existsSync(repo)) {
    result.unchecked.push({ where: repo, why: 'the --repo directory does not exist' });
    return result;
  }
  const names = opts.config ? [opts.config] : CONFIG_NAMES;
  const cfgPath = names.map((n) => path.join(repo, n)).find((p) => fs.existsSync(p));
  if (!cfgPath) {
    result.unchecked.push({ where: repo, why: `no ${names.join(' or ')}. A repository with no declared gates has not been checked. Run \`shipprobe init\`.` });
    return result;
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch (e) {
    result.unchecked.push({ where: cfgPath, why: `not valid JSON: ${e.message}` });
    return result;
  }
  const gates = config.gates || [];
  if (!gates.length) {
    result.unchecked.push({ where: cfgPath, why: 'the config declares no gates. A config that checks nothing is a document, not a gate.' });
    return result;
  }

  let server;
  try {
    server = await serve(config, repo, opts.url);
  } catch (e) {
    result.unchecked.push({ why: e.message });
    return result;
  }
  const ran = [];
  try {
    log(`gates against ${server.base}, before anything is promoted, so a finding blocks instead of annotating`);
    for (const g of gates) ran.push(runGate(g, server.base, repo, log));
  } finally {
    server.stop();
  }

  result.data = { config: cfgPath, base: server.base, gates: ran };
  for (const g of ran) {
    if (g.code === PASS) {
      result.findings.push({ id: 'gate-pass', severity: 'pass', title: `${g.name}: clean`, failing: false });
    } else if (g.code === UNCHECKED) {
      result.unchecked.push({ where: g.name, why: g.why || 'the gate could not check (exit 2)' });
    } else {
      result.findings.push({ id: 'gate-fail', severity: 'high', title: `${g.name}: ${g.why || `exit ${g.exit}`}`, failing: true, absent: g.code === 3 });
    }
  }
  const failing = ran.filter((g) => g.code !== PASS).length;
  result.code = combine(ran.map((g) => g.code));
  if (result.unchecked.length) result.code = UNCHECKED;
  result.summary = failing
    ? `${failing} of ${ran.length} gate(s) did not pass. Nothing promotes until they do. There is no flag that ships past this.`
    : `${ran.length} gate(s) clean. Safe to promote.`;
  return result;
}
