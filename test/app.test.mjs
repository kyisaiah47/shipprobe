/* The --app scaffold writes the right files for each mode and never overwrites. A full install and
 * `next build` of each mode runs in CI (the app job), because it downloads Next.js. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cli } from './helpers/cli.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sp-app-'));
const has = (dir, f) => fs.existsSync(path.join(dir, f));

test('both: two views, the welcome, the view controls and the API route', async () => {
  const dir = path.join(tmp(), 'app');
  const r = await cli(['--app', 'both', dir]);
  assert.equal(r.code, 0, r.out);
  for (const f of ['app/page.tsx', 'app/layout.tsx', 'app/api/check/route.ts', 'components/ConsoleHome.tsx', 'components/SimpleHome.tsx', 'components/site-view/Welcome.tsx', 'components/site-view/ViewControls.tsx', '.gitignore', 'package.json', 'AGENTS.md']) {
    assert.ok(has(dir, f), f);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.match(pkg.dependencies.shipprobe, /^\^\d+\.\d+\.\d+$/);
  assert.match(fs.readFileSync(path.join(dir, 'lib/mode.ts'), 'utf8'), /'both'/);
  assert.match(fs.readFileSync(path.join(dir, 'app/page.tsx'), 'utf8'), /PageViews/);
});

test('console: no Simple view and no welcome', async () => {
  const dir = path.join(tmp(), 'app');
  assert.equal((await cli(['--app', 'console', dir])).code, 0);
  assert.ok(has(dir, 'components/ConsoleHome.tsx'));
  assert.ok(!has(dir, 'components/SimpleHome.tsx'));
  assert.ok(!has(dir, 'components/site-view/Welcome.tsx'));
});

test('simple: no Console view and no welcome', async () => {
  const dir = path.join(tmp(), 'app');
  assert.equal((await cli(['--app', 'simple', dir])).code, 0);
  assert.ok(has(dir, 'components/SimpleHome.tsx'));
  assert.ok(!has(dir, 'components/ConsoleHome.tsx'));
  assert.ok(!has(dir, 'components/site-view/Welcome.tsx'));
});

test('the scaffold never writes into a non-empty directory, and needs a valid mode', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'keep.txt'), 'mine');
  assert.equal((await cli(['--app', 'both', dir])).code, 2);
  assert.equal(fs.readFileSync(path.join(dir, 'keep.txt'), 'utf8'), 'mine');
  assert.equal((await cli(['--app', 'fancy', path.join(tmp(), 'x')])).code, 2);
});

test('the template contains no native select', () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'templates', 'app');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(root)) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /<select\b/, f);
});
