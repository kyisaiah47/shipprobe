/* `shipprobe deps <pkg>`: what an npm package runs when it installs, and who published it.
 *
 *   deps left-pad                 the latest version, read from the npm registry
 *   deps sharp@0.33.5             a version or a dist-tag
 *   deps ./vendor/some-package    a package directory on disk
 *   deps ./some-package-1.0.0.tgz a packed tarball on disk
 *
 * The scripts are read from the package.json INSIDE the tarball, not from the registry's copy,
 * which can drift from what is really shipped. Publish history comes from the registry's own
 * per-version `_npmUser`, so it is available for registry packages and absent, and said to be
 * absent, for a local directory or tarball.
 *
 * Exit 1 when the verdict is at or above --fail-on (default high: a script that reaches the
 * network during install). Exit 2 when the package or the registry could not be read.
 */
import fs from 'node:fs';
import path from 'node:path';
import { newResult, PASS, FAIL } from '../result.mjs';
import { fetchJson, timedFetch } from '../net.mjs';
import { readTarball, stripPackagePrefix } from './tarball.mjs';
import { describeScript, invokedFileContent, extractInvokedFile } from './describe.mjs';
import { readPublishHistory } from './history.mjs';
import { buildVerdict, SEVERITY_WEIGHT, VERDICT_LABEL, VERDICT_DETAIL } from './verdict.mjs';

export const LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'];
const LEVELS = ['low', 'medium', 'high', 'critical'];
const NAME_RE = /^(@[a-z0-9-][a-z0-9._-]*\/)?[a-z0-9-][a-z0-9._-]*$/;

export const registryBase = () => (process.env.SHIPPROBE_NPM_REGISTRY || 'https://registry.npmjs.org').replace(/\/+$/, '');

/** `name@version`, with a scope's leading @ kept apart from the version's. */
export function parseSpec(spec) {
  const s = String(spec).trim();
  const at = s.lastIndexOf('@');
  if (at > 0) return { name: s.slice(0, at).toLowerCase(), version: s.slice(at + 1) || undefined };
  return { name: s.toLowerCase(), version: undefined };
}

async function fetchPackument(name) {
  const enc = name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
  const r = await fetchJson(`${registryBase()}/${enc}`, { timeout: 20000 });
  if (r.status === 404) return null;
  if (!r.ok || !r.json) throw new Error(`the registry answered HTTP ${r.status}`);
  return r.json;
}

function resolveVersion(pkg, requested) {
  const tags = pkg['dist-tags'] || {};
  const v = requested && pkg.versions?.[requested] ? requested : requested && tags[requested] ? tags[requested] : requested ? null : tags.latest;
  return v ? pkg.versions?.[v] || null : null;
}

function readScripts(scriptsField, files) {
  const out = [];
  for (const name of LIFECYCLE_SCRIPTS) {
    const command = scriptsField?.[name];
    if (!command) continue;
    const read = describeScript(command, files ? invokedFileContent(command, files) : undefined);
    out.push({ script: name, ...read, invokedFile: extractInvokedFile(command) });
  }
  return out;
}

function walkDir(root, rel = '', out = new Map(), depth = 0) {
  if (depth > 6 || out.size > 400) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      walkDir(root, p, out, depth + 1);
    } else if (e.isFile()) {
      const full = path.join(root, p);
      if (fs.statSync(full).size <= 400_000) out.set(p, fs.readFileSync(full));
    }
  }
  return out;
}

/** Read the package, wherever it lives. */
export async function inspect(spec) {
  const local = fs.existsSync(spec) ? path.resolve(spec) : null;
  if (local) {
    const stat = fs.statSync(local);
    let files;
    let source;
    if (stat.isDirectory()) {
      files = walkDir(local);
      source = 'directory';
    } else if (/\.(tgz|tar\.gz)$/i.test(local)) {
      files = stripPackagePrefix(readTarball(fs.readFileSync(local)).files);
      source = 'tarball';
    } else {
      throw new Error(`${spec} is a file but not a .tgz tarball`);
    }
    const pj = files.get('package.json');
    if (!pj) throw new Error(`${spec} holds no package.json`);
    const manifest = JSON.parse(pj.toString('utf8'));
    return {
      name: manifest.name || path.basename(local),
      version: manifest.version || '',
      source,
      scripts: readScripts(manifest.scripts || {}, files),
      hasNativeBuildFile: files.has('binding.gyp') || !!manifest.gypfile,
      history: null,
    };
  }

  const { name, version } = parseSpec(spec);
  if (!NAME_RE.test(name)) throw new Error(`"${spec}" is not a path on disk and not an npm package name`);
  const pkg = await fetchPackument(name);
  if (!pkg) return { name, version: version || '', missing: `no package named "${name}" on the registry` };
  const meta = resolveVersion(pkg, version);
  if (!meta) return { name, version: version || '', missing: version ? `"${name}" has no version or tag "${version}"` : `"${name}" has no published versions` };

  let scripts;
  let hasNativeBuildFile;
  let tarballRead = false;
  if (meta.dist?.tarball) {
    try {
      const res = await timedFetch(meta.dist.tarball, { timeout: 20000 });
      if (!res.ok) throw new Error(`tarball HTTP ${res.status}`);
      const files = stripPackagePrefix(readTarball(Buffer.from(await res.arrayBuffer())).files);
      const pj = files.get('package.json');
      let field = meta.scripts || {};
      if (pj) {
        try {
          field = JSON.parse(pj.toString('utf8')).scripts || {};
        } catch {
          /* fall back to the registry's copy */
        }
      }
      scripts = readScripts(field, files);
      hasNativeBuildFile = files.has('binding.gyp') || !!meta.gypfile;
      tarballRead = true;
    } catch {
      /* fall through to the registry's scripts field, so a transient tarball failure never
       * reports a clean package */
    }
  }
  if (!tarballRead) {
    scripts = readScripts(meta.scripts || {}, null);
    hasNativeBuildFile = !!meta.gypfile;
  }
  return {
    name,
    version: meta.version,
    source: 'registry',
    tarballRead,
    scripts,
    hasNativeBuildFile,
    history: readPublishHistory(pkg, meta.version),
  };
}

export async function runDeps(spec, opts = {}) {
  const result = newResult('deps', spec);
  if (!spec) {
    result.unchecked.push({ why: 'no package. Usage: shipprobe deps <name[@version] | directory | file.tgz>' });
    return result;
  }
  const failOn = String(opts.failOn || 'high').toLowerCase();
  if (!LEVELS.includes(failOn)) {
    result.unchecked.push({ why: `--fail-on "${opts.failOn}" is not one of ${LEVELS.join(', ')}.` });
    return result;
  }
  let p;
  try {
    p = await inspect(spec);
  } catch (e) {
    result.unchecked.push({ where: spec, why: `the package could not be read: ${e?.message || e}` });
    return result;
  }
  if (p.missing) {
    result.unchecked.push({ where: spec, why: p.missing });
    return result;
  }
  const { findings, verdict } = buildVerdict(p.scripts, p.hasNativeBuildFile, p.history);
  const floor = SEVERITY_WEIGHT[failOn];
  result.subject = `${p.name}@${p.version}`;
  result.findings = findings.map((f) => ({ ...f, failing: SEVERITY_WEIGHT[f.severity] >= floor && f.severity !== 'pass' }));
  result.data = { name: p.name, version: p.version, source: p.source, verdict, label: VERDICT_LABEL[verdict], scripts: p.scripts, history: p.history };
  result.summary = `${p.name}@${p.version}: ${VERDICT_LABEL[verdict]}. ${VERDICT_DETAIL[verdict]}`;
  if (!p.history) result.notes.push(`Read from a local ${p.source}, so there is no publish history to check. Run it against the registry name for the publisher checks.`);
  if (p.source === 'registry' && !p.tarballRead) result.notes.push('The tarball could not be read, so the scripts came from the registry\'s own copy of package.json.');
  result.code = result.findings.some((f) => f.failing) ? FAIL : PASS;
  return result;
}
