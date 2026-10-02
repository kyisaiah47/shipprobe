#!/usr/bin/env node
/* The worked example: every ShipProbe command against one fixture repository and one local dirty
 * page, each with the exit code it is expected to give.
 *
 *   node examples/run.mjs        or        npx shipprobe demo
 *
 * The fixture is demo-app, the app BreachProbe uses for its own worked example, rebuilt locally in
 * examples/breachprobe-demo-app. Nothing here leaves this machine: the site and its database are
 * served by examples/serve.mjs on loopback.
 *
 * The run is itself a test. It exits 0 only when every command gave the exit code written next to
 * it, so an example that drifts from what the README shows fails here first. A command that could
 * not run (Playwright missing, for the page and promote steps) is reported as could-not-check and
 * makes the demo exit 2. */
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'shipprobe.mjs');
const APP = path.join(HERE, 'breachprobe-demo-app');

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: APP });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
  });
}

export async function runExample({ log = console.log } = {}) {
  const { server, url } = await startServer(path.join(APP, 'site'));
  const steps = [
    { what: 'Score the repository\'s AGENTS.md', args: ['agents-md', APP], want: 0 },
    { what: 'Check a vendored package that downloads a binary at install', args: ['deps', path.join(APP, 'vendor', 'thumbs')], want: 1 },
    { what: 'Scan the running app the way BreachProbe scans its sample', args: ['security', url, '--owner-confirmed', '--supabase-url', url], want: 1 },
    { what: 'Check the sign-up page, which has a known contrast failure', args: ['page', path.join(APP, 'site', 'signup.html'), '--only', 'contrast,visible,clipped,page-chrome,noise', '--settle', '300'], want: 1 },
    { what: 'Check the site against its plan', args: ['plan', path.join(APP, 'plan.spec.json'), path.join(APP, 'site')], want: 0 },
    { what: 'Run every gate before a deploy', args: ['promote', '--repo', APP], want: 1 },
  ];
  const results = [];
  try {
    for (const s of steps) {
      const shown = ['shipprobe', ...s.args.map((a) => (a.startsWith(HERE) ? path.relative(process.cwd(), a) || '.' : a))].join(' ');
      log(`\n\x1b[1m${s.what}\x1b[0m\n\x1b[2m$ ${shown}\x1b[0m`);
      /* Asynchronous on purpose: this process also serves the site, and a blocking spawn would
       * stop it answering the very scan it started. */
      const r = await run([BIN, ...s.args, '--quiet']);
      log(r.out.trimEnd());
      results.push({ ...s, got: r.code });
    }
  } finally {
    server.close();
  }
  log('\nexample                                                              want  got');
  for (const r of results) log(`  ${r.what.padEnd(66)} ${String(r.want).padStart(4)} ${String(r.got).padStart(4)}${r.got === r.want ? '' : '  <- differs'}`);
  if (results.some((r) => r.got === 2)) {
    log('\nA step could not check (exit 2). For page and promote, install Playwright: npm i -D playwright && npx playwright install chromium');
    return 2;
  }
  const ok = results.every((r) => r.got === r.want);
  log(ok ? '\nEvery command gave the exit code the example says it gives.' : '\nAt least one command gave a different exit code from the one this example documents.');
  return ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await runExample());
}
