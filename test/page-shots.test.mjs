/* `shipprobe page --shots <dir>`: one full-page PNG per rendered viewport, named <width>.png, as
 * the deferless 0.1 render gate saved them. Pictures are taken at 1280px and wider only, so the
 * narrower ladder widths are measured and never captured. Every case runs on the page fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cli, FIX } from './helpers/cli.mjs';

const P = (n) => path.join(FIX, 'page', `${n}.html`);
const fresh = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shipprobe-shots-')), 'out');
const files = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);

/** Width and height from the PNG's IHDR chunk, after checking the signature. */
function png(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.toString('latin1', 1, 4), 'PNG', `${file} is not a PNG`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

test('--shots saves a full-page PNG at each desktop width, and its value is never read as a target', async () => {
  // The folder does not exist yet. Read as a target it would be "no such file", exit 2.
  const dir = fresh();
  const r = await cli(['page', '--shots', dir, P('clean'), '--settle', '150', '--json']);
  assert.equal(r.code, 0, r.out.slice(0, 3000));
  assert.deepEqual(r.json.data.targets, [P('clean')]);
  assert.deepEqual(files(dir), ['1280.png', '1920.png']);
  for (const w of [1280, 1920]) assert.equal(png(path.join(dir, `${w}.png`)).width, w);
  // Full page, as the old gate saved it: the clean fixture is taller than the 800px viewport.
  assert.ok(png(path.join(dir, '1280.png')).height > 800, 'the 1280 picture is the full page, not the viewport');
  assert.deepEqual(r.json.data.shots.map((s) => s.width), [1280, 1920]);
  assert.ok(r.json.notes.some((n) => n.includes('no picture at 320, 375, 414, 768px')), JSON.stringify(r.json.notes));
});

test('--shots=<dir> with only per-width rules saves exactly the --vw widths', async () => {
  const dir = fresh();
  const r = await cli(['page', P('clean'), '--settle', '150', '--json', '--only', 'contrast', '--vw', '1440', `--shots=${dir}`]);
  assert.equal(r.code, 0, r.out.slice(0, 3000));
  assert.deepEqual(files(dir), ['1440.png']);
  assert.equal(png(path.join(dir, '1440.png')).width, 1440);
});

test('--shots still saves the --vw width when only a page-scoped rule runs', async () => {
  const dir = fresh();
  const r = await cli(['page', P('clean'), '--settle', '150', '--json', '--only', 'nested', '--shots', dir]);
  assert.equal(r.code, 0, r.out.slice(0, 3000));
  assert.deepEqual(files(dir), ['1280.png']);
});

test('--shots on a run that renders no desktop width is exit 2 and opens no browser', async () => {
  const dir = fresh();
  const r = await cli(['page', P('clean'), '--json', '--only', 'contrast', '--vw', '1024', '--shots', dir]);
  assert.equal(r.code, 2, r.out.slice(0, 3000));
  assert.match(JSON.stringify(r.json.unchecked), /no picture would be saved/);
  assert.equal(fs.existsSync(dir), false);
});

test('--shots on a page that rendered nothing saves nothing and is exit 2', async () => {
  const dir = fresh();
  const r = await cli(['page', P('blank'), '--settle', '150', '--json', '--only', 'contrast', '--shots', dir]);
  assert.equal(r.code, 2, r.out.slice(0, 3000));
  assert.deepEqual(files(dir), []);
});

test('--shots without a value, or naming a file, is exit 2', async () => {
  assert.equal((await cli(['page', P('clean'), '--shots'])).code, 2);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shipprobe-shots-')), 'a-file');
  fs.writeFileSync(file, 'not a folder');
  const r = await cli(['page', P('clean'), '--json', '--shots', file]);
  assert.equal(r.code, 2, r.out.slice(0, 3000));
  assert.match(JSON.stringify(r.json.unchecked), /--shots could not create/);
});
