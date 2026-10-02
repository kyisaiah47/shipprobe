/* The command line. Every command returns a result, and the result's code is the exit code.
 *
 *   0  checked, nothing failed
 *   1  checked, and something failed
 *   2  could not check: never a pass, never collapsed into 0 or 1
 *   3  checked, and the thing was never produced
 *
 * There is no --force, no allowlist and no known-issues file. Each of those is a supported way to
 * record a failure and ship past it. An unknown flag is exit 2, so a typo can never quietly change
 * what was checked.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { printResult, newResult } from './result.mjs';
import { UNCHECKED, combine, MEANING } from './exit.mjs';
import { reportToGitHub } from './gh.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'));

export const USAGE = `shipprobe ${PKG.version}. One tool for shipping safely.

  shipprobe security <url> --owner-confirmed   free-scan security checks against a deployed URL
  shipprobe deps <pkg>                         what an npm package runs at install, and who published it
                                               (name[@version], a package directory, or a .tgz)
  shipprobe agents-md [dir]                    score the repository's agent-instruction files
  shipprobe page <url|file|dir> [...]          rendered-page checks in a real browser
  shipprobe plan <spec.json> <dir>             check an output directory against a plan spec
  shipprobe promote [--repo dir] [--url url]   run every gate in shipprobe.json before a deploy
  shipprobe init                               write a starter shipprobe.json and plan.spec.json
  shipprobe rules                              list the page rules
  shipprobe demo                               run the worked example
  shipprobe --app console|simple|both [dir]    scaffold a Next.js app wired to ShipProbe

Every command
  --json             print the result as JSON
  --quiet            print failing findings only
  --github           write annotations, the job summary and step outputs (the Action sets it)
  --hosted           also run the hosted check (security, deps, agents-md)
  --fix              write repo-specific fix suggestions with your own model:
    --provider openai|anthropic|gemini|openai-compatible|stub  --model <id>  [--base-url <url>]
    [--fix-out shipprobe-fixes.md] [--repo .]   key from SHIPPROBE_API_KEY or the provider's variable

security   --owner-confirmed (required)  --min-grade A-F  --supabase-url <url>
deps       --fail-on low|medium|high|critical (default high)
agents-md  --threshold 0-100 (default 60)  --per-file-threshold 0-100
page       --only <ids>  --skip <ids>  --vw <widths> (default 1280)  --home <url>
           --sample <n> (interior routes from sitemap.xml)  --accent <colour|--var>  --settle <ms>
           --shots <dir> (save <width>.png at each rendered width of 1280px or more)
promote    --repo <dir>  --url <url>  --config <file>

Exit codes: 0 pass, 1 fail, 2 could not check, 3 never produced.
There is no --force, no allowlist and no known-issues file.`;

const COMMON_BOOL = ['json', 'quiet', 'github', 'hosted', 'fix', 'help'];
const COMMON_VALUE = ['provider', 'model', 'base-url', 'fix-out', 'repo'];
/* A FLAG'S VALUE IS NOT A TARGET. `--sample 3` and `--shots out/` each put a bare token in argv.
 * The first deferless render gate filtered argv for targets without knowing which flags take a
 * value, read the `3` as a URL and failed on it once per run. Every flag in a `value` list below
 * takes the next token as its value, so that token never reaches the target list. */
const FLAGS = {
  security: { bool: ['owner-confirmed'], value: ['min-grade', 'supabase-url'] },
  deps: { bool: [], value: ['fail-on'] },
  'agents-md': { bool: [], value: ['threshold', 'per-file-threshold'] },
  page: { bool: ['sitemap'], value: ['only', 'skip', 'vw', 'home', 'sample', 'accent', 'settle', 'shots'] },
  plan: { bool: [], value: [] },
  promote: { bool: [], value: ['url', 'config'] },
  init: { bool: [], value: [] },
  rules: { bool: [], value: [] },
  demo: { bool: [], value: [] },
};
const HOSTED = new Set(['security', 'deps', 'agents-md']);

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/** Re-parse with the command's own schema, so a boolean never swallows the next positional. */
function parseFor(cmd, argv) {
  const spec = FLAGS[cmd] || { bool: [], value: [] };
  const bool = new Set([...COMMON_BOOL, ...spec.bool]);
  const value = new Set([...COMMON_VALUE, ...spec.value]);
  const out = { _: [], opts: {}, errors: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') {
      out.opts.help = true;
      continue;
    }
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
    if (bool.has(name)) {
      out.opts[camel(name)] = true;
      continue;
    }
    if (value.has(name)) {
      const v = eq > 0 ? a.slice(eq + 1) : argv[++i];
      if (v === undefined) out.errors.push(`--${name} needs a value`);
      else out.opts[camel(name)] = v;
      continue;
    }
    out.errors.push(`unknown flag --${name} for "${cmd}"`);
  }
  return out;
}

async function execute(cmd, args, opts, log) {
  switch (cmd) {
    case 'security': {
      const { runSecurity } = await import('./security/index.mjs');
      const r = await runSecurity(args[0], opts);
      if (opts.hosted && r.code !== UNCHECKED) {
        const { hostedSecurity } = await import('./hosted/index.mjs');
        await hostedSecurity(r, r.subject);
        if (r.unchecked.length) r.code = UNCHECKED;
      }
      return r;
    }
    case 'deps': {
      const { runDeps } = await import('./deps/index.mjs');
      const r = await runDeps(args[0], opts);
      if (opts.hosted && r.code !== UNCHECKED) {
        const { hostedDeps } = await import('./hosted/index.mjs');
        await hostedDeps(r);
        if (r.unchecked.length) r.code = UNCHECKED;
      }
      return r;
    }
    case 'agents-md': {
      const { runAgentsMd } = await import('./agents-md/index.mjs');
      const r = runAgentsMd(args[0] || '.', opts);
      if (opts.hosted && r.data.files?.length) {
        const { hostedAgentsMd } = await import('./hosted/index.mjs');
        const files = r.data.files.map((f) => ({ path: f.path, content: fs.readFileSync(path.join(r.subject, f.path), 'utf8') }));
        await hostedAgentsMd(r, files, process.env.GITHUB_REPOSITORY);
        if (r.unchecked.length) r.code = UNCHECKED;
      }
      return r;
    }
    case 'page': {
      const { runPage } = await import('./page/index.mjs');
      if (opts.sitemap && !opts.sample) opts.sample = 6;
      return runPage(args, opts);
    }
    case 'plan': {
      const { runPlan } = await import('./plan/index.mjs');
      return runPlan(args[0], args[1]);
    }
    case 'promote': {
      const { runPromote } = await import('./promote/index.mjs');
      return runPromote(opts, { log });
    }
    default:
      return null;
  }
}

export async function main(argv, { log = console.log, err = console.error } = {}) {
  if (argv[0] === '--version' || argv[0] === '-v') {
    log(PKG.version);
    return 0;
  }
  if (argv[0] === '--app' || (argv[0] || '').startsWith('--app=')) {
    const { scaffoldApp } = await import('./app/index.mjs');
    const eq = argv[0].indexOf('=');
    const mode = eq > 0 ? argv[0].slice(eq + 1) : argv[1];
    const dir = (eq > 0 ? argv[1] : argv[2]) || 'shipprobe-app';
    return scaffoldApp(mode, dir, { log, err });
  }
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    log(USAGE);
    return cmd ? 0 : UNCHECKED;
  }
  if (!FLAGS[cmd]) {
    err(`shipprobe: unknown command "${cmd}"\n`);
    log(USAGE);
    return UNCHECKED;
  }
  const { _: args, opts, errors } = parseFor(cmd, rest);
  if (opts.help) {
    log(USAGE);
    return 0;
  }
  if (errors.length) {
    for (const e of errors) err(`shipprobe: ${e}`);
    return UNCHECKED;
  }
  if (opts.hosted && !HOSTED.has(cmd)) {
    err(`shipprobe: --hosted has no hosted extra for "${cmd}". It applies to ${[...HOSTED].join(', ')}.`);
    return UNCHECKED;
  }

  if (cmd === 'init') {
    const { initConfig } = await import('./promote/index.mjs');
    const r = initConfig(process.cwd());
    (r.ok ? log : err)(r.message);
    return r.ok ? 0 : UNCHECKED;
  }
  if (cmd === 'rules') {
    const { RULES } = await import('./page/rules/index.mjs');
    log(`shipprobe page rules (${RULES.length}):\n`);
    for (const r of RULES) log(`  ${r.id.padEnd(14)} ${r.summary}\n`);
    return 0;
  }
  if (cmd === 'demo') {
    const { runExample } = await import('../examples/run.mjs').catch(() => ({}));
    if (!runExample) {
      err('shipprobe: the worked example is not in this install. Clone the repository to run it.');
      return UNCHECKED;
    }
    return runExample({ log });
  }

  /* --fix is validated before anything is checked. */
  if (opts.fix) {
    try {
      const { fixConfig } = await import('./fix/index.mjs');
      fixConfig(opts);
    } catch (e) {
      err(`shipprobe: ${e.message}`);
      return UNCHECKED;
    }
  }

  let result;
  try {
    result = await execute(cmd, args, opts, opts.json ? () => {} : log);
  } catch (e) {
    result = newResult(cmd, args.join(' '));
    result.unchecked.push({ why: `${cmd} crashed: ${e?.stack || e}` });
  }

  if (opts.fix) {
    try {
      const { writeFixes } = await import('./fix/index.mjs');
      const fx = await writeFixes(result, opts, { log: opts.json ? () => {} : log });
      result.data.fixes = fx;
    } catch (e) {
      result.unchecked.push({ why: `--fix could not write suggestions: ${e.message}` });
      result.code = combine([result.code, UNCHECKED]);
    }
  }

  if (opts.github) reportToGitHub(result);
  if (opts.json) log(JSON.stringify(result, null, 2));
  else printResult(result, { log, quiet: !!opts.quiet });
  return result.code in MEANING ? result.code : UNCHECKED;
}
