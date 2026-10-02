/* `shipprobe --app console|simple|both [dir]`: scaffold a Next.js app wired to ShipProbe.
 *
 *   console  the dense working surface: the three web checks side by side, findings as tables
 *   simple   a roomier page: one first action, a labelled example, the other checks after it
 *   both     both views, a welcome dialog that explains them, and footer controls to switch
 *
 * The app runs the checks on its own server through ShipProbe's library: the security scan of a
 * URL, the install-time check of an npm package, and the score of a pasted agent-instruction
 * file. The page, plan and promote commands need a browser or a repository on disk, so the app
 * points to the CLI for them.
 *
 * The target directory must not exist or must be empty. Nothing is overwritten, and there is no
 * flag that makes it overwrite.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(HERE, '..', '..', 'templates', 'app');
const PKG = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'package.json'), 'utf8'));
export const MODES = ['console', 'simple', 'both'];

/* Files that only one mode needs. Everything else is shared. */
const ONLY = {
  'components/ConsoleHome.tsx': ['console', 'both'],
  'components/SimpleHome.tsx': ['simple', 'both'],
  'components/site-view/SiteViewProvider.tsx': ['both'],
  'components/site-view/Welcome.tsx': ['both'],
  'components/site-view/ViewControls.tsx': ['both'],
  'components/site-view/PageViews.tsx': ['both'],
  'components/site-view/Disclosure.tsx': ['simple', 'both'],
};

function walk(dir, rel = '', out = []) {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(dir, p, out);
    else out.push(p);
  }
  return out;
}

export function scaffoldApp(mode, dir, { log = console.log, err = console.error } = {}) {
  if (!MODES.includes(mode)) {
    err(`shipprobe: --app needs one of ${MODES.join(', ')}. Usage: shipprobe --app both ./my-app`);
    return 2;
  }
  const target = path.resolve(dir);
  if (fs.existsSync(target) && fs.readdirSync(target).length) {
    err(`shipprobe: ${target} exists and is not empty. The scaffold never overwrites a file; pick a new directory.`);
    return 2;
  }
  if (!fs.existsSync(TEMPLATE)) {
    err('shipprobe: the app template is missing from this install.');
    return 2;
  }
  const written = [];
  for (const rel of walk(TEMPLATE)) {
    if (ONLY[rel] && !ONLY[rel].includes(mode)) continue;
    /* `page.tsx.both` is written only in both mode, as page.tsx. */
    const suffix = rel.match(/\.(console|simple|both)$/);
    if (suffix && suffix[1] !== mode) continue;
    let out = suffix ? rel.slice(0, -suffix[0].length) : rel;
    /* npm drops a file named .gitignore from a published tarball, so it ships as `gitignore`. */
    if (path.basename(out) === 'gitignore') out = path.join(path.dirname(out), '.gitignore');
    let text = fs.readFileSync(path.join(TEMPLATE, rel));
    if (out.endsWith('.tmpl')) {
      out = out.slice(0, -5);
      text = Buffer.from(
        text
          .toString('utf8')
          .replaceAll('__SHIPPROBE_VERSION__', PKG.version)
          .replaceAll('__MODE__', mode)
          .replaceAll('__APP_NAME__', path.basename(target).toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'shipprobe-app'),
      );
    }
    const dest = path.join(target, out);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
    written.push(out);
  }
  log(`shipprobe: wrote a ${mode} app to ${target} (${written.length} files).

  cd ${path.relative(process.cwd(), target) || '.'}
  npm install
  npm run dev

The app runs the security, package and agent-file checks on its own server through ShipProbe.
Page, plan and promote checks run from the CLI: npx shipprobe page <url>.`);
  return 0;
}
