/* --fix: repo-specific fix suggestions written from the findings, by the model you configure.
 *
 * The check runs first and its exit code stands. Then, when a model is configured, the failing
 * findings and a bounded read of the repository (package.json, the framework's config files, the
 * files the findings name) go to that model, and its suggestions are written to shipprobe-fixes.md.
 *
 * What never leaves the machine: .env files, anything under node_modules or .git, and any string
 * shaped like a credential, which is redacted before the prompt is built. The prompt is capped.
 *
 * Without a model, --fix does not run, and the command exits 2 before anything is checked: a flag
 * that cannot do what it says is a usage error, never a silent no-op.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createProvider, keyFor, PROVIDERS } from './providers.mjs';
import { redactSecrets } from '../security/secrets.mjs';

const CONTEXT_FILES = [
  'package.json',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'vite.config.ts',
  'vite.config.js',
  'astro.config.mjs',
  'nuxt.config.ts',
  'svelte.config.js',
  'vercel.json',
  'netlify.toml',
  'wrangler.toml',
  'wrangler.jsonc',
  'middleware.ts',
  'src/middleware.ts',
  'shipprobe.json',
];
const MAX_FILE = 6000;
const MAX_TOTAL = 40000;

/** The model configuration from flags, then SHIPPROBE_* variables. Throws a usage error. */
export function fixConfig(opts, env = process.env) {
  const provider = opts.provider || env.SHIPPROBE_PROVIDER;
  const model = opts.model || env.SHIPPROBE_MODEL;
  const baseUrl = opts.baseUrl || env.SHIPPROBE_BASE_URL;
  if (!provider) throw new Error(`--fix needs a model you configure: --provider ${PROVIDERS.join('|')} --model <id>. Nothing was checked.`);
  const cfg = { provider, model, baseUrl, apiKey: keyFor(provider, env) };
  createProvider(cfg);
  return cfg;
}

function safeRead(file) {
  const base = path.basename(file);
  if (/^\.env/.test(base) || /(^|\/)(node_modules|\.git)(\/|$)/.test(file)) return null;
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return null;
    return redactSecrets(fs.readFileSync(file, 'utf8').slice(0, MAX_FILE));
  } catch {
    return null;
  }
}

/** The repository context: framework files, then every file a finding names, capped. */
export function repoContext(result, repoDir) {
  const root = path.resolve(repoDir || '.');
  const named = new Set();
  for (const f of result.findings) {
    for (const cand of [f.file, f.where]) {
      if (!cand || typeof cand !== 'string') continue;
      const p = cand.split(' ')[0].split(':')[0];
      if (p && !/^https?:/.test(p) && fs.existsSync(path.join(root, p))) named.add(p);
    }
  }
  const files = [];
  let total = 0;
  for (const rel of [...CONTEXT_FILES, ...named]) {
    if (files.some((f) => f.path === rel)) continue;
    const text = safeRead(path.join(root, rel));
    if (text === null) continue;
    if (total + text.length > MAX_TOTAL) break;
    total += text.length;
    files.push({ path: rel, text });
  }
  return { root, files };
}

export const SYSTEM =
  'You write fix suggestions for one repository from a ShipProbe report. ' +
  'For each failing finding, name the file to change and give the change as a short diff or a code block. ' +
  'Use only files listed in the repository context, or say that a new file is needed and name it. ' +
  'Do not invent findings. If a finding cannot be fixed from the given context, say what to look at. ' +
  'Write plain sentences.';

export function buildPrompt(result, ctx) {
  const failing = result.findings.filter((f) => f.failing).slice(0, 40);
  const findings = failing.map((f) => ({ id: f.id, severity: f.severity, title: f.title, detail: redactSecrets(f.detail || ''), where: f.where, line: f.line }));
  let p = `ShipProbe command: ${result.command}\nSubject: ${result.subject}\nExit code: ${result.code}\nSummary: ${result.summary}\n\n`;
  p += `Failing findings (JSON):\n${JSON.stringify(findings, null, 2)}\n\n`;
  p += `Repository context (${ctx.files.length} file(s), secrets redacted):\n`;
  for (const f of ctx.files) p += `\n--- ${f.path}\n${f.text}\n`;
  return p;
}

export async function writeFixes(result, opts, { log = console.log } = {}) {
  const cfg = fixConfig(opts);
  const provider = createProvider(cfg);
  const ctx = repoContext(result, opts.repo);
  const out = path.resolve(opts.fixOut || 'shipprobe-fixes.md');
  const failing = result.findings.filter((f) => f.failing);
  let body;
  if (!failing.length) {
    body = 'The report has no failing finding, so no model was called and there is nothing to fix.';
  } else {
    body = await provider.complete({ system: SYSTEM, prompt: buildPrompt(result, ctx) });
  }
  const md =
    `# ShipProbe fix suggestions\n\n` +
    `- Command: \`shipprobe ${result.command}\` on \`${result.subject}\`, exit ${result.code}\n` +
    `- Written by: ${provider.name} \`${provider.model}\`, ${new Date().toISOString()}\n` +
    `- Repository context sent: ${ctx.files.map((f) => `\`${f.path}\``).join(', ') || 'none'}\n` +
    `- Each suggestion comes from a model. Read it before applying it.\n\n` +
    `${body.trim()}\n`;
  fs.writeFileSync(out, md);
  log(`  fix suggestions: ${out} (${failing.length} failing finding(s), ${provider.name} ${provider.model})`);
  return { path: out, provider: provider.name, model: provider.model, findings: failing.length };
}
